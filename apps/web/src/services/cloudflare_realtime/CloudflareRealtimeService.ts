import {
  CfCallsCreateSessionResponse,
  CfCallsPublishTrackResponse,
  CfCallsSubscribeTrackResponse,
  CfTurnIceServersResponse,
  CfMediaPublication,
  CfMediaTracksEvent,
} from "@tescord/types";
import { sframeManager } from "../sframe.js";
import { API_BASE } from "../../config.js";
import { apiFetch } from "../apiClient.js";
import { gatewayClient } from "../gateway.js";
import { useAuthStore } from "../../stores/useAuthStore.js";

export type CfRealtimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface CfRealtimeStateListener {
  (status: CfRealtimeConnectionStatus, error?: string): void;
}

/**
 * Cloudflare Realtime 客户端音视频驱动服务 (Serverless SFU & Calls TURN)
 *
 * 特性：
 * 1. 采用原生 WebRTC RTCPeerConnection 接入 Cloudflare Calls Anycast 边缘网络，免自建媒体服务器
 * 2. 挂接原生 SFrame Insertable Streams 端到端加密管线（帧离开浏览器前加密），确保 Cloudflare 只能看到密文
 * 3. 动态从后端拉取 Cloudflare Realtime TURN 凭据，打通极严苛企业/校园防火墙
 * 4. 独立于 LiveKit，二者互不冲突、可插拔切换
 */
export class CloudflareRealtimeService {
  private pc: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private currentChannelId: string | null = null;
  private connectionStatus: CfRealtimeConnectionStatus = "disconnected";

  private localAudioStream: MediaStream | null = null;
  private localAudioSender: RTCRtpSender | null = null;
  private negotiatedE2EEKey: Uint8Array | null = null;

  private remoteStreams = new Map<string, MediaStream>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private listeners = new Set<CfRealtimeStateListener>();
  private publishedTracks = new Map<string, { sender: RTCRtpSender; stream: MediaStream; mid: string; trackName: string }>();
  private subscribedTracks = new Set<string>();
  private operation: Promise<void> = Promise.resolve();
  private unbindTracks: (() => void) | null = null;
  private turnRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private remoteVideoListeners = new Set<(publication: CfMediaPublication, stream: MediaStream | null) => void>();
  private currentPublications = new Map<string, CfMediaPublication>();
  private remoteByMid = new Map<string, CfMediaPublication>();

  private readonly pagehideHandler = (): void => {
    if (!this.sessionId) return;
    void fetch(`${API_BASE}/api/cloudflare-realtime/session/leave`, {
      method: "POST", headers: this.authHeaders,
      body: JSON.stringify({ sessionId: this.sessionId }), keepalive: true,
    }).catch(() => undefined);
  };

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    window.addEventListener("pagehide", this.pagehideHandler);
    this.heartbeatTimer = setInterval(async () => {
      const sessionId = this.sessionId;
      if (!sessionId) return;
      try {
        const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/session/heartbeat`, {
          method: "POST", headers: this.authHeaders, body: JSON.stringify({ sessionId }),
        });
        if ((response.status === 401 || response.status === 403) && this.sessionId === sessionId) {
          await this.disconnect();
          this.setStatus("failed", "Media session revoked");
        }
      } catch (error) {
        console.warn("[CF Realtime] Media heartbeat failed", error);
      }
    }, 10_000);
  }

  public onRemoteVideo(listener: (publication: CfMediaPublication, stream: MediaStream | null) => void): () => void {
    this.remoteVideoListeners.add(listener);
    return () => { this.remoteVideoListeners.delete(listener); };
  }

  private emitVideo(publication: CfMediaPublication, stream: MediaStream | null): void {
    for (const listener of this.remoteVideoListeners) listener(publication, stream);
  }

  private queue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  public get currentSessionId(): string | null {
    return this.sessionId;
  }

  public get status(): CfRealtimeConnectionStatus {
    return this.connectionStatus;
  }

  public get channelId(): string | null {
    return this.currentChannelId;
  }

  public get isE2EEActive(): boolean {
    return Boolean(this.negotiatedE2EEKey && sframeManager.getStats().enabled);
  }

  private get authHeaders(): Record<string, string> {
    const token = useAuthStore.getState().token || sessionStorage.getItem("tescord_access_token") || localStorage.getItem("tescord_access_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * 注册连接状态监听器
   */
  public onStatusChange(listener: CfRealtimeStateListener): () => void {
    this.listeners.add(listener);
    listener(this.connectionStatus);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: CfRealtimeConnectionStatus, error?: string): void {
    this.connectionStatus = status;
    for (const listener of this.listeners) {
      try {
        listener(status, error);
      } catch (err) {
        console.error("[CF Realtime] Status listener error:", err);
      }
    }
  }

  /**
   * 配置房间协商的端到端加密密钥 (SFrame / 256 位)
   */
  public setNegotiatedE2EEKey(key: Uint8Array | null): void {
    if (!key) {
      this.negotiatedE2EEKey = null;
      sframeManager.disable();
      return;
    }
    this.negotiatedE2EEKey = new Uint8Array(key);
    sframeManager.setNegotiatedKey(this.negotiatedE2EEKey);
    console.log("[CF Realtime] SFrame 端到端加密密钥已装载，媒体流将以密文转发至 Cloudflare");
  }

  /**
   * 连接到 Cloudflare Calls SFU 语音频道
   */
  public async connect(
    channelId: string,
    options?: {
      audioStream?: MediaStream;
      iceServers?: RTCIceServer[];
    },
    retryCount = 0,
  ): Promise<string> {
    if (this.connectionStatus === "connected" || this.connectionStatus === "connecting") {
      await this.disconnect();
    }

    this.currentChannelId = channelId;
    this.setStatus("connecting");

    try {
      // 1. 获取 ICE / TURN 服务器配置 (动态从 Cloudflare Calls TURN 拉取)
      let iceServers = options?.iceServers;
      if (!iceServers || iceServers.length === 0) {
        try {
          const res = await apiFetch(`${API_BASE}/api/cloudflare-realtime/ice-servers`, {
            headers: this.authHeaders,
          });
          if (res.ok) {
            const turnData = (await res.json()) as CfTurnIceServersResponse;
            if (turnData?.iceServers) {
              iceServers = turnData.iceServers as RTCIceServer[];
              this.scheduleTurnRefresh(turnData.expiresAt);
            }
          }
        } catch (turnErr) {
          console.warn("[CF Realtime] 获取 Cloudflare 专用 TURN 失败，尝试回退通用网络接口", turnErr);
        }

        if (!iceServers || iceServers.length === 0) {
          const fallbackRes = await apiFetch(`${API_BASE}/api/network/ice-servers`, {
            headers: this.authHeaders,
          }).catch(() => null);
          if (fallbackRes?.ok) {
            const fallbackData = await fallbackRes.json();
            if (fallbackData?.iceServers) {
              iceServers = fallbackData.iceServers;
            }
          }
        }
      }

      // 2. 初始化原生 RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: iceServers || [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
        encodedInsertableStreams: Boolean(this.negotiatedE2EEKey),
      } as RTCConfiguration);
      this.pc = pc;

      // 3. 监听远端流到达事件
      pc.ontrack = (event) => {
        console.log("[CF Realtime] 收到远端音轨:", event.track.id, "kind:", event.track.kind);

        // 若当前房间开启了 E2EE，挂接 SFrame 解密管线 (在扬声器播放前还原明文)
        if (this.negotiatedE2EEKey && event.receiver) {
          try {
            sframeManager.attachReceiver(event.receiver);
            console.log("[CF Realtime] SFrame 解密管线成功挂接至接收音轨");
          } catch (e2eeErr) {
            event.track.stop();
            this.setStatus("failed", "E2EE receiver unavailable");
            void this.disconnect();
            return;
          }
        }

        const stream = event.streams[0] || new MediaStream([event.track]);
        const trackId = event.track.id;
        const publication = this.remoteByMid.get(event.transceiver.mid || "");
        if (!publication) this.remoteStreams.set(trackId, stream);
        if (publication) {
          this.remoteStreams.set(`${publication.sessionId}:${publication.trackName}`, stream);
          if (event.track.kind === "video") {
            this.emitVideo(publication, stream);
            return;
          }
        }
        if (event.track.kind !== "audio") return;
        // 绑定自动播放 Audio 元素
        let audioEl = this.audioElements.get(trackId);
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          audioEl.srcObject = stream;
          this.audioElements.set(trackId, audioEl);
          audioEl.play().catch((playErr) => {
            console.warn("[CF Realtime] 远端音频自动播放受阻，等待用户手势解锁:", playErr);
          });
        }
      };

      // 4. 监听网络连接状态
      pc.onconnectionstatechange = () => {
        console.log("[CF Realtime] PeerConnection 状态变更:", pc.connectionState);
        if (pc.connectionState === "connected") {
          this.setStatus("connected");
        } else if (pc.connectionState === "disconnected") {
          this.setStatus("reconnecting");
        } else if (pc.connectionState === "failed") {
          void this.disconnect().then(() => this.setStatus("failed", "WebRTC 连接失败"));
        }
      };

      // 5. 调用后端创建 Cloudflare Calls 边缘会话 (Session)
      const sessionRes = await apiFetch(`${API_BASE}/api/cloudflare-realtime/session/new`, {
        method: "POST",
        headers: this.authHeaders,
        body: JSON.stringify({ channelId }),
      });
      if (!sessionRes.ok) {
        throw new Error(`未能获取 Cloudflare Calls Session: ${sessionRes.statusText}`);
      }
      const sessionData = (await sessionRes.json()) as CfCallsCreateSessionResponse;
      if (!sessionData?.sessionId) {
        throw new Error("未能获取有效的 Cloudflare Calls SessionId");
      }
      this.sessionId = sessionData.sessionId;
      this.startHeartbeat();
      if (sessionData.requiresE2EE && (!this.negotiatedE2EEKey || !sframeManager.getStats().enabled)) {
        throw new Error("E2EE media key unavailable");
      }
      this.unbindTracks = gatewayClient.on("CF_MEDIA_TRACKS", (event: CfMediaTracksEvent) => {
        if (event.channelId === this.currentChannelId) void this.syncPublications(event.tracks);
      });

      // 6. 若提供了麦克风音频流，立即执行推流 (Publish)
      if (options?.audioStream) {
        await this.publishMicrophoneStream(options.audioStream);
      }

      if (options?.audioStream) {
        await this.waitForConnected(pc, 30_000);
        await this.announceTracks();
      }
      await this.syncPublications(sessionData.tracks || []);
      return this.sessionId;
    } catch (err: any) {
      console.error("[CF Realtime] 连接建立异常:", err);
      const shouldRetry = retryCount === 0 && err instanceof Error &&
        err.message.includes("ICE timeout") &&
        Boolean(options?.audioStream?.getAudioTracks().some(track => track.readyState === "live"));
      await this.disconnect(!shouldRetry);
      if (shouldRetry) {
        this.setStatus("reconnecting");
        return this.connect(channelId, options, retryCount + 1);
      }
      this.setStatus("failed", err?.message || "连接失败");
      throw err;
    }
  }

  /**
   * 推送本地麦克风音频流至 Cloudflare Calls
   */
  public async publishMicrophoneStream(audioStream: MediaStream): Promise<boolean> {
    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No microphone track");
    this.localAudioStream = audioStream;
    await this.publishMediaTrack(audioTrack, audioStream, "microphone");
    return true;
  }

  public async publishMediaTrack(track: MediaStreamTrack, stream: MediaStream, source: CfMediaPublication["source"]): Promise<void> {
    await this.queue(async () => {
      const pc = this.pc;
      const sessionId = this.sessionId;
      if (!pc || !sessionId || !this.currentChannelId) throw new Error("No Cloudflare media session");
      if (this.negotiatedE2EEKey && !sframeManager.getStats().enabled) throw new Error("E2EE key unavailable");
      const transceiver = pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      const sender = transceiver.sender;
      try {
        if (this.negotiatedE2EEKey) sframeManager.attachSender(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.waitForIceGathering(pc);
        const mid = transceiver.mid;
        if (!mid) throw new Error("Missing track MID");
        const trackName = `${source}-${crypto.randomUUID()}`;
        const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/publish`, {
          method: "POST", headers: this.authHeaders,
          body: JSON.stringify({ channelId: this.currentChannelId, sessionId,
            sessionDescription: { type: "offer", sdp: pc.localDescription?.sdp },
            tracks: [{ mid, trackName, kind: track.kind, source }],
          }),
        });
        if (!response.ok) throw new Error(`Publish failed (${response.status})`);
        const data = await response.json() as CfCallsPublishTrackResponse;
        if (!data.sessionDescription?.sdp) throw new Error("Missing Cloudflare answer");
        await pc.setRemoteDescription({ type: "answer", sdp: data.sessionDescription.sdp });
        this.publishedTracks.set(source, { sender, stream, mid, trackName });
        if (this.connectionStatus === "connected") await this.announceTracks();
        if (track.kind === "video") this.emitVideo({ sessionId, channelId: this.currentChannelId, userId: useAuthStore.getState().user?.id || "", trackName, kind: "video", source }, stream);
        if (source === "microphone") this.localAudioSender = sender;
      } catch (error) {
        pc.removeTrack(sender);
        throw error;
      }
    });
  }

  public async unpublishSource(source: CfMediaPublication["source"]): Promise<void> {
    await this.queue(async () => {
      const published = this.publishedTracks.get(source);
      if (!published || !this.pc || !this.sessionId) return;
      const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/close`, {
        method: "PUT", headers: this.authHeaders,
        body: JSON.stringify({ sessionId: this.sessionId, tracks: [{ mid: published.mid, trackName: published.trackName }] }),
      });
      if (!response.ok) throw new Error(`Close track failed (${response.status})`);
      this.pc.removeTrack(published.sender);
      if (source === "camera" || source === "screen") this.emitVideo({ sessionId: this.sessionId, channelId: this.currentChannelId || "", userId: useAuthStore.getState().user?.id || "", trackName: published.trackName, kind: "video", source }, null);
      if (source !== "microphone") for (const track of published.stream.getTracks()) track.stop();
      this.publishedTracks.delete(source);
    });
  }

  private async announceTracks(): Promise<void> {
    if (!this.sessionId) return;
    const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/ready`, {
      method: "POST", headers: this.authHeaders, body: JSON.stringify({ sessionId: this.sessionId }),
    });
    if (!response.ok) throw new Error(`Media announcement failed (${response.status})`);
  }

  /**
   * 订阅其他成员发布的远端音频轨道 (Remote Track)
   */
  public async subscribeRemoteTrack(
    publisherSessionId: string,
    trackName: string,
  ): Promise<void> {
    return this.queue(() => this.subscribeRemoteTrackNow(publisherSessionId, trackName));
  }

  private async subscribeRemoteTrackNow(publisherSessionId: string, trackName: string): Promise<void> {
    if (!this.pc || !this.sessionId) return;

    // 1. 向服务端请求订阅，触发 Cloudflare SFU 返回 Offer
    const subscriberSessionId = this.sessionId;
    const publicationKey = `${publisherSessionId}:${trackName}`;
    const requestSubscription = () => apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/subscribe`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({
        channelId: this.currentChannelId || "",
        sessionId: subscriberSessionId,
        tracks: [
          {
            publisherSessionId,
            trackName,
          },
        ],
      }),
    });
    let subRes = await requestSubscription();
    for (let attempt = 0; (subRes.status === 400 || subRes.status === 502) && attempt < 4; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      if (this.sessionId !== subscriberSessionId || !this.currentPublications.has(publicationKey)) return;
      subRes = await requestSubscription();
    }

    if (!subRes.ok) {
      throw new Error(`订阅远端轨道请求失败: ${subRes.statusText}`);
    }

    const subData = (await subRes.json()) as CfCallsSubscribeTrackResponse;
    if (!subData?.sessionDescription?.sdp) {
      throw new Error("Cloudflare SFU 未返回拉流 Offer SDP");
    }
    const publication = this.currentPublications.get(`${publisherSessionId}:${trackName}`);
    for (const remoteTrack of subData.tracks || []) {
      if (publication && remoteTrack.mid) this.remoteByMid.set(remoteTrack.mid, publication);
    }

    // 2. 客户端应用 SFU 的 Offer 并生成 Answer
    await this.pc.setRemoteDescription(
      new RTCSessionDescription({
        type: "offer",
        sdp: subData.sessionDescription.sdp,
      }),
    );

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIceGathering(this.pc, 5000);

    // 3. 提交 Answer 完成重协商
    const renegRes = await apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/renegotiate`, {
      method: "PUT",
      headers: this.authHeaders,
      body: JSON.stringify({
        sessionId: this.sessionId,
        sessionDescription: {
          type: "answer",
          sdp: this.pc.localDescription?.sdp || answer.sdp,
        },
      }),
    });

    if (!renegRes.ok) {
      throw new Error(`Cloudflare 重协商失败: ${renegRes.statusText}`);
    }

    console.log("[CF Realtime] 成功订阅远端轨道:", trackName, "发布者:", publisherSessionId);
  }

  private async syncPublications(tracks: CfMediaPublication[]): Promise<void> {
    const desired = new Set(tracks.map(track => `${track.sessionId}:${track.trackName}`));
    for (const [key, old] of this.currentPublications) {
      if (!desired.has(key)) {
        this.emitVideo(old, null);
        this.currentPublications.delete(key);
        this.subscribedTracks.delete(key);
        const stream = this.remoteStreams.get(key);
        stream?.getTracks().forEach(track => track.stop());
        this.remoteStreams.delete(key);
      }
    }
    for (const track of tracks) {
      if (track.sessionId === this.sessionId) continue;
      const key = `${track.sessionId}:${track.trackName}`;
      this.currentPublications.set(key, track);
      if (this.subscribedTracks.has(key)) continue;
      this.subscribedTracks.add(key);
      try { await this.subscribeRemoteTrack(track.sessionId, track.trackName); }
      catch (error) { this.subscribedTracks.delete(key); console.error("[CF Realtime] Remote subscribe failed", error); }
    }
  }

  public setDeafened(deafened: boolean): void {
    for (const audio of this.audioElements.values()) audio.muted = deafened;
  }

  private scheduleTurnRefresh(expiresAt: number): void {
    if (this.turnRefreshTimer) clearTimeout(this.turnRefreshTimer);
    const ms = Math.max(30_000, (expiresAt - Math.floor(Date.now() / 1000) - 300) * 1000);
    this.turnRefreshTimer = setTimeout(async () => {
      if (!this.pc) return;
      try {
        const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/ice-servers`, { headers: this.authHeaders });
        if (!response.ok) throw new Error(`TURN refresh ${response.status}`);
        const data = await response.json() as CfTurnIceServersResponse;
        this.pc?.setConfiguration({ iceServers: data.iceServers });
        this.scheduleTurnRefresh(data.expiresAt);
      } catch (error) { console.warn("TURN refresh failed", error); }
    }, ms);
  }

  private waitForConnected(pc: RTCPeerConnection, timeoutMs = 15_000): Promise<void> {
    if (pc.connectionState === "connected") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Cloudflare media ICE timeout")); }, timeoutMs);
      const check = () => {
        if (pc.connectionState === "connected") { cleanup(); resolve(); }
        if (pc.connectionState === "failed" || pc.connectionState === "closed") { cleanup(); reject(new Error("Cloudflare media connection failed")); }
      };
      const cleanup = () => { clearTimeout(timer); pc.removeEventListener("connectionstatechange", check); };
      pc.addEventListener("connectionstatechange", check);
      check();
    });
  }

  /**
   * 切换麦克风静音状态
   */
  public setMicrophoneMute(muted: boolean): void {
    if (!this.localAudioStream) return;
    for (const track of this.localAudioStream.getAudioTracks()) {
      track.enabled = !muted;
    }
  }

  /**
   * 断开连接并释放所有资源
   */
  public async disconnect(stopLocalAudio = true): Promise<void> {
    console.log("[CF Realtime] 正在断开 Cloudflare 语音连接...");

    this.unbindTracks?.();
    this.unbindTracks = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    window.removeEventListener("pagehide", this.pagehideHandler);
    if (this.turnRefreshTimer) clearTimeout(this.turnRefreshTimer);
    this.turnRefreshTimer = null;
    const oldSessionId = this.sessionId;
    if (oldSessionId) {
      await apiFetch(`${API_BASE}/api/cloudflare-realtime/session/leave`, {
        method: "POST", headers: this.authHeaders, body: JSON.stringify({ sessionId: oldSessionId }),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined);
    }
    // 释放远端播放 Audio 元素
    for (const audioEl of this.audioElements.values()) {
      audioEl.pause();
      audioEl.srcObject = null;
    }
    this.audioElements.clear();
    this.remoteStreams.clear();
    this.currentPublications.clear();
    this.remoteByMid.clear();
    this.subscribedTracks.clear();
    for (const published of this.publishedTracks.values()) {
      if (published.stream !== this.localAudioStream) published.stream.getTracks().forEach(track => track.stop());
    }
    this.publishedTracks.clear();

    // 停止本地音频轨道采集
    if (this.localAudioStream) {
      for (const track of this.localAudioStream.getTracks()) {
        if (stopLocalAudio) {
          try {
            track.stop();
          } catch {}
        }
      }
      this.localAudioStream = null;
    }
    this.localAudioSender = null;

    // 关闭 PeerConnection
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    this.sessionId = null;
    this.currentChannelId = null;
    this.setStatus("disconnected");
  }

  private async waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 800): Promise<void> {
    if (pc.iceGatheringState === "complete") return;
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      pc.addEventListener("icegatheringstatechange", check);
      setTimeout(done, timeoutMs);
    });
  }
}

export const cloudflareRealtimeService = new CloudflareRealtimeService();
