import {
  CfCallsCreateSessionResponse,
  CfCallsPublishTrackResponse,
  CfCallsSubscribeTrackResponse,
  CfTurnIceServersResponse,
  CfMediaPublication,
  CfMediaTracksEvent,
  CfStreamWatchState,
  CfStreamViewersEvent,
  NetworkStats,
  StreamDetailedStats,
  clampVolume,
} from "@tescord/types";
import { sframeManager } from "../sframe.js";
import { API_BASE } from "../../config.js";
import { apiFetch } from "../apiClient.js";
import { gatewayClient } from "../gateway.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";

export type CfRealtimeConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

export interface CfRealtimeStateListener {
  (status: CfRealtimeConnectionStatus, error?: string): void;
}

type RtcRecord = RTCStats & {
  mid?: string;
  kind?: string;
  mediaType?: string;
  trackIdentifier?: string;
  codecId?: string;
  mimeType?: string;
  bytesReceived?: number;
  bytesSent?: number;
  packetsReceived?: number;
  packetsSent?: number;
  packetsLost?: number;
  jitter?: number;
  framesDecoded?: number;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  selectedCandidatePairId?: string;
  state?: string;
  nominated?: boolean;
  currentRoundTripTime?: number;
  localCandidateId?: string;
  remoteCandidateId?: string;
  protocol?: string;
  address?: string;
  port?: number;
  candidateType?: "host" | "srflx" | "prflx" | "relay";
  localId?: string;
  roundTripTime?: number;
};

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
  private audioRoutes = new Map<string, {
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    analyser?: AnalyserNode;
    publication?: CfMediaPublication;
    track: MediaStreamTrack;
  }>();
  private playbackContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterVolume = 100;
  private deafened = false;
  private streamVolumes = new Map<string, number>();
  private activeSpeakers = new Set<string>();
  private speakerTimer: ReturnType<typeof setInterval> | null = null;
  private speakerListeners = new Set<(speakers: string[]) => void>();
  private volumeListeners = new Set<(identity: string, volume: number) => void>();
  private networkListeners = new Set<(stats: Map<string, NetworkStats>) => void>();
  private networkStats = new Map<string, NetworkStats>();
  private detailedStats = new Map<string, StreamDetailedStats>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private previousStats = new Map<string, { bytes: number; timestamp: number }>();
  private subscribedMids = new Map<string, string>();
  private watchingSessions = new Set<string>();
  private pendingWatches = new Map<string, Promise<CfStreamWatchState>>();
  private watchStates = new Map<string, CfStreamWatchState>();
  private watchListeners = new Set<(state: CfStreamWatchState) => void>();
  private publicationListeners = new Set<(publications: CfMediaPublication[]) => void>();
  private unbindViewers: (() => void) | null = null;
  private unbindSettings: (() => void) | null = null;
  private listeners = new Set<CfRealtimeStateListener>();
  private publishedTracks = new Map<
    string,
    {
      sender: RTCRtpSender;
      stream: MediaStream;
      mid: string;
      trackName: string;
    }
  >();
  private subscribedTracks = new Set<string>();
  private operation: Promise<void> = Promise.resolve();
  private unbindTracks: (() => void) | null = null;
  private turnRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private remoteVideoListeners = new Set<
    (publication: CfMediaPublication, stream: MediaStream | null) => void
  >();
  private currentPublications = new Map<string, CfMediaPublication>();
  private initialPublications: CfMediaPublication[] = [];
  private remoteByMid = new Map<string, CfMediaPublication>();

  constructor() {
    const settings = useSettingsStore.getState();
    this.masterVolume = clampVolume(settings.outputVolume);
    try {
      const saved = JSON.parse(localStorage.getItem("tescord_stream_volumes") || "{}") as Record<string, unknown>;
      for (const [userId, volume] of Object.entries(saved)) {
        if (typeof volume === "number") this.streamVolumes.set(userId, clampVolume(volume));
      }
    } catch { /* Invalid preferences must not interrupt media setup. */ }
    this.unbindSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.outputVolume !== previous.outputVolume) this.setMasterVolume(state.outputVolume);
      if (state.userVolumes !== previous.userVolumes) this.updatePlaybackGains();
      if (state.audio.outputDeviceId !== previous.audio.outputDeviceId) void this.applyOutputDevice();
    });
  }

  private getOrCreatePlaybackContext(): AudioContext {
    if (!this.playbackContext || this.playbackContext.state === "closed") {
      this.playbackContext = new AudioContext();
      this.masterGain = this.playbackContext.createGain();
      this.masterGain.connect(this.playbackContext.destination);
      this.updatePlaybackGains();
      void this.applyOutputDevice();
    }
    if (this.playbackContext.state === "suspended") void this.playbackContext.resume().catch(() => undefined);
    return this.playbackContext;
  }

  private async applyOutputDevice(): Promise<void> {
    const deviceId = useSettingsStore.getState().audio.outputDeviceId || "default";
    const context = this.playbackContext as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (context?.setSinkId) {
      await context.setSinkId(deviceId).catch((error) => console.warn("[CF Realtime] Output device change failed", error));
    }
    for (const audio of this.audioElements.values()) {
      const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (!this.audioRoutes.has(audio.dataset.trackId || "") && sinkAudio.setSinkId) {
        await sinkAudio.setSinkId(deviceId).catch(() => undefined);
      }
    }
  }

  private updatePlaybackGains(): void {
    if (this.masterGain && this.playbackContext) {
      this.masterGain.gain.setValueAtTime(this.deafened ? 0 : this.masterVolume / 100, this.playbackContext.currentTime);
    }
    for (const [trackId, route] of this.audioRoutes) {
      const identity = route.publication?.userId;
      const volume = route.publication?.source === "screen-audio"
        ? this.getStreamVolume(identity || "")
        : this.getParticipantVolume(identity || "");
      route.gain.gain.setValueAtTime(volume / 100, this.playbackContext?.currentTime || 0);
      const fallback = this.audioElements.get(trackId);
      if (fallback) fallback.muted = true;
    }
    for (const [trackId, audio] of this.audioElements) {
      if (this.audioRoutes.has(trackId)) continue;
      const publication = this.audioPublicationByTrackId(trackId);
      const volume = publication?.source === "screen-audio"
        ? this.getStreamVolume(publication.userId) : this.getParticipantVolume(publication?.userId || "");
      audio.muted = this.deafened;
      audio.volume = Math.min(1, (volume / 100) * (this.masterVolume / 100));
    }
  }

  private audioPublicationByTrackId(trackId: string): CfMediaPublication | undefined {
    for (const route of this.audioRoutes.values()) if (route.track.id === trackId) return route.publication;
    return undefined;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = clampVolume(volume);
    if (useSettingsStore.getState().outputVolume !== this.masterVolume) useSettingsStore.getState().setOutputVolume(this.masterVolume);
    this.updatePlaybackGains();
  }

  public getMasterVolume(): number { return this.masterVolume; }

  public setParticipantVolume(identity: string, volume: number): void {
    const clamped = clampVolume(volume);
    if (useSettingsStore.getState().userVolumes[identity] !== clamped) useSettingsStore.getState().setUserVolume(identity, clamped);
    this.updatePlaybackGains();
    for (const listener of this.volumeListeners) listener(identity, clamped);
  }

  public getParticipantVolume(identity: string): number {
    return clampVolume(useSettingsStore.getState().userVolumes[identity] ?? 100);
  }

  public onParticipantVolumeChange(listener: (identity: string, volume: number) => void): () => void {
    this.volumeListeners.add(listener);
    return () => { this.volumeListeners.delete(listener); };
  }

  public setStreamVolume(identity: string, volume: number): void {
    this.streamVolumes.set(identity, clampVolume(volume));
    try { localStorage.setItem("tescord_stream_volumes", JSON.stringify(Object.fromEntries(this.streamVolumes))); } catch { /* Best effort. */ }
    this.updatePlaybackGains();
  }

  public getStreamVolume(identity: string): number { return this.streamVolumes.get(identity) ?? 100; }

  public onActiveSpeakersChange(listener: (speakers: string[]) => void): () => void {
    this.speakerListeners.add(listener);
    listener([...this.activeSpeakers]);
    return () => { this.speakerListeners.delete(listener); };
  }

  public isParticipantSpeaking(identity: string): boolean { return this.activeSpeakers.has(identity); }

  private emitSpeakers(): void {
    const speakers = [...this.activeSpeakers];
    for (const listener of this.speakerListeners) listener(speakers);
  }

  private startSpeakerMonitor(): void {
    if (this.speakerTimer) return;
    this.speakerTimer = setInterval(() => {
      const active = new Set<string>();
      for (const route of this.audioRoutes.values()) {
        if (route.publication?.source !== "microphone" || !route.analyser || !route.publication.userId) continue;
        const samples = new Uint8Array(route.analyser.fftSize);
        route.analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) { const centered = (sample - 128) / 128; energy += centered * centered; }
        if (Math.sqrt(energy / samples.length) > 0.025) active.add(route.publication.userId);
      }
      if (active.size !== this.activeSpeakers.size || [...active].some((id) => !this.activeSpeakers.has(id))) {
        this.activeSpeakers = active;
        this.emitSpeakers();
      }
    }, 120);
  }

  private readonly pagehideHandler = (): void => {
    if (!this.sessionId) return;
    void fetch(`${API_BASE}/api/cloudflare-realtime/session/leave`, {
      method: "POST",
      headers: this.authHeaders,
      body: JSON.stringify({ sessionId: this.sessionId }),
      keepalive: true,
    }).catch(() => undefined);
  };

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    window.addEventListener("pagehide", this.pagehideHandler);
    this.heartbeatTimer = setInterval(async () => {
      const sessionId = this.sessionId;
      if (!sessionId) return;
      try {
        const response = await apiFetch(
          `${API_BASE}/api/cloudflare-realtime/session/heartbeat`,
          {
            method: "POST",
            headers: this.authHeaders,
            body: JSON.stringify({ sessionId }),
          },
        );
        if (
          (response.status === 401 || response.status === 403) &&
          this.sessionId === sessionId
        ) {
          await this.disconnect();
          this.setStatus("failed", "Media session revoked");
        }
      } catch (error) {
        console.warn("[CF Realtime] Media heartbeat failed", error);
      }
    }, 10_000);
  }

  public onRemoteVideo(
    listener: (
      publication: CfMediaPublication,
      stream: MediaStream | null,
    ) => void,
  ): () => void {
    this.remoteVideoListeners.add(listener);
    for (const published of this.publishedTracks.values()) {
      if (published.stream.getVideoTracks().length && this.sessionId && this.currentChannelId) {
        listener({ sessionId: this.sessionId, channelId: this.currentChannelId,
          userId: useAuthStore.getState().user?.id || "", trackName: published.trackName,
          kind: "video", source: published.trackName.startsWith("screen-") ? "screen" : "camera" }, published.stream);
      }
    }
    for (const [key, publication] of this.currentPublications) {
      if (publication.kind === "video") listener(publication, this.remoteStreams.get(key) || null);
    }
    return () => {
      this.remoteVideoListeners.delete(listener);
    };
  }

  private emitVideo(
    publication: CfMediaPublication,
    stream: MediaStream | null,
  ): void {
    for (const listener of this.remoteVideoListeners)
      listener(publication, stream);
  }

  private allPublications(): CfMediaPublication[] {
    const publications = [...this.currentPublications.values()];
    const localUserId = useAuthStore.getState().user?.id;
    if (this.sessionId && this.currentChannelId && localUserId) {
      for (const [source, published] of this.publishedTracks) {
        publications.push({ sessionId: this.sessionId, channelId: this.currentChannelId,
          userId: localUserId, trackName: published.trackName, mid: published.mid,
          kind: source === "microphone" || source === "screen-audio" ? "audio" : "video",
          source: source as CfMediaPublication["source"] });
      }
    }
    return publications;
  }

  private emitPublications(): void {
    const publications = this.allPublications();
    for (const listener of this.publicationListeners) listener(publications);
  }

  private queue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
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
    const token =
      useAuthStore.getState().token ||
      sessionStorage.getItem("tescord_access_token") ||
      localStorage.getItem("tescord_access_token");
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

  private async createMediaSession(): Promise<string> {
    if (!this.currentChannelId) throw new Error("No media channel selected");
    const sessionRes = await apiFetch(
      `${API_BASE}/api/cloudflare-realtime/session/new`,
      {
        method: "POST",
        headers: this.authHeaders,
        body: JSON.stringify({ channelId: this.currentChannelId }),
      },
    );
    if (!sessionRes.ok)
      throw new Error(
        `Cloudflare media session request failed (${sessionRes.status})`,
      );
    const sessionData =
      (await sessionRes.json()) as CfCallsCreateSessionResponse;
    if (!sessionData?.sessionId)
      throw new Error("Invalid Cloudflare media session");
    this.sessionId = sessionData.sessionId;
    this.initialPublications = sessionData.tracks || [];
    if (
      sessionData.requiresE2EE &&
      (!this.negotiatedE2EEKey || !sframeManager.getStats().enabled)
    ) {
      throw new Error("E2EE media key unavailable");
    }
    this.startHeartbeat();
    this.unbindTracks = gatewayClient.on(
      "CF_MEDIA_TRACKS",
      (event: CfMediaTracksEvent) => {
        if (event.channelId === this.currentChannelId)
          void this.syncPublications(event.tracks);
      },
    );
    this.unbindViewers = gatewayClient.on("CF_STREAM_VIEWERS", (event: CfStreamViewersEvent) => {
      if (event.channelId !== this.currentChannelId) return;
      this.setWatchState({ ...event, watching: this.watchingSessions.has(event.publisherSessionId) });
    });
    return sessionData.sessionId;
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
    console.log(
      "[CF Realtime] SFrame 端到端加密密钥已装载，媒体流将以密文转发至 Cloudflare",
    );
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
    if (
      this.connectionStatus === "connected" ||
      this.connectionStatus === "connecting"
    ) {
      await this.disconnect();
    }

    this.currentChannelId = channelId;
    this.setStatus("connecting");

    try {
      // 1. 获取 ICE / TURN 服务器配置 (动态从 Cloudflare Calls TURN 拉取)
      let iceServers = options?.iceServers;
      if (!iceServers || iceServers.length === 0) {
        try {
          const res = await apiFetch(
            `${API_BASE}/api/cloudflare-realtime/ice-servers`,
            {
              headers: this.authHeaders,
            },
          );
          if (res.ok) {
            const turnData = (await res.json()) as CfTurnIceServersResponse;
            if (turnData?.iceServers) {
              iceServers = turnData.iceServers as RTCIceServer[];
              this.scheduleTurnRefresh(turnData.expiresAt);
            }
          }
        } catch (turnErr) {
          console.warn(
            "[CF Realtime] 获取 Cloudflare 专用 TURN 失败，尝试回退通用网络接口",
            turnErr,
          );
        }

        if (!iceServers || iceServers.length === 0) {
          const fallbackRes = await apiFetch(
            `${API_BASE}/api/network/ice-servers`,
            {
              headers: this.authHeaders,
            },
          ).catch(() => null);
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
        console.log(
          "[CF Realtime] 收到远端音轨:",
          event.track.id,
          "kind:",
          event.track.kind,
        );

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
          this.remoteStreams.set(
            `${publication.sessionId}:${publication.trackName}`,
            stream,
          );
          if (event.track.kind === "video") {
            this.emitVideo(publication, stream);
            return;
          }
        }
        if (event.track.kind !== "audio") return;
        // 每路音轨独立增益后进入统一母带。分析器在增益之前，讲话提示不受用户音量影响。
        let audioEl = this.audioElements.get(trackId);
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          audioEl.srcObject = stream;
          audioEl.dataset.trackId = trackId;
          this.audioElements.set(trackId, audioEl);
          try {
            const context = this.getOrCreatePlaybackContext();
            const source = context.createMediaStreamSource(new MediaStream([event.track]));
            const gain = context.createGain();
            source.connect(gain);
            gain.connect(this.masterGain!);
            let analyser: AnalyserNode | undefined;
            if (publication?.source === "microphone") {
              analyser = context.createAnalyser();
              analyser.fftSize = 256;
              source.connect(analyser);
              this.startSpeakerMonitor();
            }
            this.audioRoutes.set(trackId, { source, gain, analyser, publication, track: event.track });
            audioEl.muted = true;
          } catch (error) {
            console.warn("[CF Realtime] Web Audio unavailable; falling back to HTMLAudioElement", error);
            void this.applyOutputDevice();
            audioEl.play().catch((playErr) => console.warn("[CF Realtime] Remote audio autoplay blocked", playErr));
          }
          this.updatePlaybackGains();
          event.track.addEventListener("ended", () => this.releaseRemoteTrack(trackId), { once: true });
        }
      };

      // 4. 监听网络连接状态
      pc.onconnectionstatechange = () => {
        console.log(
          "[CF Realtime] PeerConnection 状态变更:",
          pc.connectionState,
        );
        if (pc.connectionState === "connected") {
          this.setStatus("connected");
          this.startStatsPolling();
        } else if (pc.connectionState === "disconnected") {
          this.setStatus("reconnecting");
        } else if (pc.connectionState === "failed") {
          void this.disconnect().then(() =>
            this.setStatus("failed", "WebRTC 连接失败"),
          );
        }
      };

      // 在申请短寿命的 SFU 会话前完成本地 ICE 候选收集。
      if (options?.audioStream)
        await this.publishMicrophoneStream(options.audioStream);
      else await this.createMediaSession();

      if (options?.audioStream) {
        await this.waitForConnected(pc, 30_000);
        await this.announceTracks();
      }
      await this.syncPublications(this.initialPublications);
      if (!this.sessionId)
        throw new Error("Media session lost during connection");
      return this.sessionId;
    } catch (err: any) {
      console.error("[CF Realtime] 连接建立异常:", err);
      const shouldRetry =
        retryCount === 0 &&
        err instanceof Error &&
        (err.message.includes("ICE timeout") ||
          err.message.includes("media connection failed") ||
          err.message.includes("No ICE candidates gathered") ||
          err.message.includes("ICE candidate gathering timed out") ||
          err.message.includes("Publish failed (502)")) &&
        Boolean(
          options?.audioStream
            ?.getAudioTracks()
            .some((track) => track.readyState === "live"),
        );
      await this.disconnect(!shouldRetry);
      if (shouldRetry) {
        this.setStatus("reconnecting");
        return this.connect(channelId, options, retryCount + 1);
      }
      this.setStatus("failed", err?.message || "连接失败");
      throw err;
    }
  }

  private releaseRemoteTrack(trackId: string): void {
    const route = this.audioRoutes.get(trackId);
    if (route) {
      route.analyser?.disconnect();
      route.source.disconnect();
      route.gain.disconnect();
      this.audioRoutes.delete(trackId);
    }
    const audio = this.audioElements.get(trackId);
    if (audio) { audio.pause(); audio.srcObject = null; this.audioElements.delete(trackId); }
    if (route?.publication?.userId && this.activeSpeakers.delete(route.publication.userId)) this.emitSpeakers();
    if (!this.audioRoutes.size && this.speakerTimer) { clearInterval(this.speakerTimer); this.speakerTimer = null; }
  }

  /**
   * 推送本地麦克风音频流至 Cloudflare Calls
   */
  public async publishMicrophoneStream(
    audioStream: MediaStream,
  ): Promise<boolean> {
    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No microphone track");
    this.localAudioStream = audioStream;
    await this.publishMediaTrack(audioTrack, audioStream, "microphone");
    return true;
  }

  public async publishMediaTrack(
    track: MediaStreamTrack,
    stream: MediaStream,
    source: CfMediaPublication["source"],
  ): Promise<void> {
    await this.queue(async () => {
      const pc = this.pc;
      let sessionId = this.sessionId;
      if (
        !pc ||
        !this.currentChannelId ||
        (!sessionId && source !== "microphone")
      )
        throw new Error("No Cloudflare media session");
      if (this.negotiatedE2EEKey && !sframeManager.getStats().enabled)
        throw new Error("E2EE key unavailable");
      const transceiver = pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [stream],
      });
      const sender = transceiver.sender;
      try {
        if (this.negotiatedE2EEKey) sframeManager.attachSender(sender);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.waitForIceGathering(pc);
        if (!sessionId) sessionId = await this.createMediaSession();
        const mid = transceiver.mid;
        if (!mid) throw new Error("Missing track MID");
        const trackName = `${source}-${crypto.randomUUID()}`;
        const response = await apiFetch(
          `${API_BASE}/api/cloudflare-realtime/tracks/publish`,
          {
            method: "POST",
            headers: this.authHeaders,
            body: JSON.stringify({
              channelId: this.currentChannelId,
              sessionId,
              sessionDescription: {
                type: "offer",
                sdp: pc.localDescription?.sdp,
              },
              tracks: [{ mid, trackName, kind: track.kind, source }],
            }),
          },
        );
        if (!response.ok)
          throw new Error(`Publish failed (${response.status})`);
        const data = (await response.json()) as CfCallsPublishTrackResponse;
        if (!data.sessionDescription?.sdp)
          throw new Error("Missing Cloudflare answer");
        await pc.setRemoteDescription({
          type: "answer",
          sdp: data.sessionDescription.sdp,
        });
        this.publishedTracks.set(source, { sender, stream, mid, trackName });
        this.emitPublications();
        if (this.connectionStatus === "connected") await this.announceTracks();
        if (source === "screen") void this.refreshViewerCount(sessionId);
        if (track.kind === "video")
          this.emitVideo(
            {
              sessionId,
              channelId: this.currentChannelId,
              userId: useAuthStore.getState().user?.id || "",
              trackName,
              kind: "video",
              source,
            },
            stream,
          );
        if (source === "microphone") this.localAudioSender = sender;
      } catch (error) {
        pc.removeTrack(sender);
        throw error;
      }
    });
  }

  public async unpublishSource(
    source: CfMediaPublication["source"],
  ): Promise<void> {
    await this.queue(async () => {
      const published = this.publishedTracks.get(source);
      if (!published || !this.pc || !this.sessionId) return;
      const response = await apiFetch(
        `${API_BASE}/api/cloudflare-realtime/tracks/close`,
        {
          method: "PUT",
          headers: this.authHeaders,
          body: JSON.stringify({
            sessionId: this.sessionId,
            tracks: [{ mid: published.mid, trackName: published.trackName }],
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Close track failed (${response.status})`);
      this.pc.removeTrack(published.sender);
      if (source === "camera" || source === "screen")
        this.emitVideo(
          {
            sessionId: this.sessionId,
            channelId: this.currentChannelId || "",
            userId: useAuthStore.getState().user?.id || "",
            trackName: published.trackName,
            kind: "video",
            source,
          },
          null,
        );
      if (source !== "microphone") published.sender.track?.stop();
      this.publishedTracks.delete(source);
      this.emitPublications();
    });
  }

  public async switchCameraDevice(deviceId: string): Promise<boolean> {
    return this.queue(async () => {
      const published = this.publishedTracks.get("camera");
      if (!published || !this.pc || !this.sessionId || !this.currentChannelId)
        return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        video:
          deviceId && deviceId !== "default"
            ? { deviceId: { exact: deviceId } }
            : true,
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("Selected camera has no video track");
      }
      try {
        await published.sender.replaceTrack(track);
      } catch (error) {
        stream.getTracks().forEach((item) => item.stop());
        throw error;
      }
      const previous = published.stream;
      published.stream = stream;
      previous.getVideoTracks().forEach((item) => item.stop());
      this.emitVideo(
        {
          sessionId: this.sessionId,
          channelId: this.currentChannelId,
          userId: useAuthStore.getState().user?.id || "",
          trackName: published.trackName,
          kind: "video",
          source: "camera",
        },
        stream,
      );
      return true;
    });
  }

  private async announceTracks(): Promise<void> {
    if (!this.sessionId) return;
    const response = await apiFetch(
      `${API_BASE}/api/cloudflare-realtime/tracks/ready`,
      {
        method: "POST",
        headers: this.authHeaders,
        body: JSON.stringify({ sessionId: this.sessionId }),
      },
    );
    if (!response.ok)
      throw new Error(`Media announcement failed (${response.status})`);
  }

  /**
   * 订阅其他成员发布的远端音频轨道 (Remote Track)
   */
  public async subscribeRemoteTrack(
    publisherSessionId: string,
    trackName: string,
  ): Promise<void> {
    return this.queue(() =>
      this.subscribeRemoteTrackNow(publisherSessionId, trackName),
    );
  }

  private async subscribeRemoteTrackNow(
    publisherSessionId: string,
    trackName: string,
  ): Promise<void> {
    if (!this.pc || !this.sessionId) return;

    // 1. 向服务端请求订阅，触发 Cloudflare SFU 返回 Offer
    const subscriberSessionId = this.sessionId;
    const publicationKey = `${publisherSessionId}:${trackName}`;
    const requestSubscription = () =>
      apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/subscribe`, {
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
    for (
      let attempt = 0;
      (subRes.status === 400 || subRes.status === 502) && attempt < 4;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      if (
        this.sessionId !== subscriberSessionId ||
        !this.currentPublications.has(publicationKey)
      )
        return;
      subRes = await requestSubscription();
    }

    if (!subRes.ok) {
      throw new Error(`订阅远端轨道请求失败: ${subRes.statusText}`);
    }

    const subData = (await subRes.json()) as CfCallsSubscribeTrackResponse;
    if (!subData?.sessionDescription?.sdp) {
      throw new Error("Cloudflare SFU 未返回拉流 Offer SDP");
    }
    const publication = this.currentPublications.get(
      `${publisherSessionId}:${trackName}`,
    );
    for (const remoteTrack of subData.tracks || []) {
      if (publication && remoteTrack.mid) {
        this.remoteByMid.set(remoteTrack.mid, publication);
        this.subscribedMids.set(publicationKey, remoteTrack.mid);
      }
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
    await this.waitForIceGathering(this.pc);

    // 3. 提交 Answer 完成重协商
    const renegRes = await apiFetch(
      `${API_BASE}/api/cloudflare-realtime/tracks/renegotiate`,
      {
        method: "PUT",
        headers: this.authHeaders,
        body: JSON.stringify({
          sessionId: this.sessionId,
          sessionDescription: {
            type: "answer",
            sdp: this.pc.localDescription?.sdp || answer.sdp,
          },
        }),
      },
    );

    if (!renegRes.ok) {
      throw new Error(`Cloudflare 重协商失败: ${renegRes.statusText}`);
    }

    console.log(
      "[CF Realtime] 成功订阅远端轨道:",
      trackName,
      "发布者:",
      publisherSessionId,
    );
  }

  private async syncPublications(tracks: CfMediaPublication[]): Promise<void> {
    const desired = new Set(
      tracks.map((track) => `${track.sessionId}:${track.trackName}`),
    );
    for (const [key, old] of this.currentPublications) {
      if (!desired.has(key)) {
        if (old.source === "screen" && this.watchingSessions.has(old.sessionId)) {
          await this.stopWatchingStream(old.sessionId).catch((error) => console.warn("[CF Realtime] Stop vanished stream failed", error));
        }
        this.emitVideo(old, null);
        this.currentPublications.delete(key);
        this.subscribedTracks.delete(key);
        const mid = this.subscribedMids.get(key);
        if (mid) this.remoteByMid.delete(mid);
        this.subscribedMids.delete(key);
        const stream = this.remoteStreams.get(key);
        stream?.getTracks().forEach((track) => { this.releaseRemoteTrack(track.id); track.stop(); });
        this.remoteStreams.delete(key);
      }
    }
    for (const track of tracks) {
      if (track.sessionId === this.sessionId) continue;
      const key = `${track.sessionId}:${track.trackName}`;
      this.currentPublications.set(key, track);
      if (this.subscribedTracks.has(key) || (track.source !== "microphone" && track.source !== "camera")) continue;
      this.subscribedTracks.add(key);
      try {
        await this.subscribeRemoteTrack(track.sessionId, track.trackName);
      } catch (error) {
        this.subscribedTracks.delete(key);
        console.error("[CF Realtime] Remote subscribe failed", error);
      }
    }
    const publications = this.allPublications();
    this.emitPublications();
    for (const publication of publications) {
      if (publication.source === "screen" && !this.watchStates.has(publication.sessionId)) {
        void this.refreshViewerCount(publication.sessionId);
      }
    }
  }

  private async refreshViewerCount(publisherSessionId: string): Promise<void> {
    if (!this.currentChannelId || !this.sessionId) return;
    const channelId = this.currentChannelId;
    try {
      const query = new URLSearchParams({ channelId, publisherSessionId, sessionId: this.sessionId });
      const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/streams/viewers?${query}`, { headers: this.authHeaders });
      if (!response.ok || this.currentChannelId !== channelId) return;
      const event = await response.json() as CfStreamViewersEvent;
      this.setWatchState({ ...event, watching: this.watchingSessions.has(publisherSessionId) });
    } catch (error) { console.warn("[CF Realtime] Viewer count refresh failed", error); }
  }

  public getScreenPublicationForUser(userId: string): CfMediaPublication | null {
    return this.allPublications().find((publication) => publication.userId === userId && publication.source === "screen") || null;
  }

  public onPublicationsChange(listener: (publications: CfMediaPublication[]) => void): () => void {
    this.publicationListeners.add(listener);
    listener(this.allPublications());
    return () => { this.publicationListeners.delete(listener); };
  }

  public getWatchState(publisherSessionId: string): CfStreamWatchState | null {
    return this.watchStates.get(publisherSessionId) || null;
  }

  public onStreamWatchChange(listener: (state: CfStreamWatchState) => void): () => void {
    this.watchListeners.add(listener);
    for (const state of this.watchStates.values()) listener(state);
    return () => { this.watchListeners.delete(listener); };
  }

  private setWatchState(state: CfStreamWatchState): void {
    this.watchStates.set(state.publisherSessionId, state);
    for (const listener of this.watchListeners) listener(state);
  }

  private async waitForRemoteStream(key: string): Promise<void> {
    if (this.remoteStreams.has(key)) return;
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const timer = setInterval(() => {
        if (this.remoteStreams.has(key)) { clearInterval(timer); resolve(); }
        else if (!this.sessionId || Date.now() >= deadline) { clearInterval(timer); reject(new Error("Subscribed stream did not arrive")); }
      }, 50);
    });
  }

  public startWatchingStream(publisherSessionId: string): Promise<CfStreamWatchState> {
    const pending = this.pendingWatches.get(publisherSessionId);
    if (pending) return pending;
    const operation = this.startWatchingStreamNow(publisherSessionId);
    this.pendingWatches.set(publisherSessionId, operation);
    void operation.finally(() => {
      if (this.pendingWatches.get(publisherSessionId) === operation) this.pendingWatches.delete(publisherSessionId);
    }).catch(() => undefined);
    return operation;
  }

  private async startWatchingStreamNow(publisherSessionId: string): Promise<CfStreamWatchState> {
    if (!this.sessionId || !this.currentChannelId) throw new Error("No Cloudflare media session");
    const screen = [...this.currentPublications.values()].find((publication) => publication.sessionId === publisherSessionId && publication.source === "screen");
    if (!screen) throw new Error("Screen publication unavailable");
    if (this.watchingSessions.has(publisherSessionId)) return this.watchStates.get(publisherSessionId) || {
      channelId: this.currentChannelId, publisherSessionId, hostUserId: screen.userId, viewerCount: 0, watching: true,
    };
    const tracks = [...this.currentPublications.values()].filter((publication) => publication.sessionId === publisherSessionId && (publication.source === "screen" || publication.source === "screen-audio"));
    try {
      for (const publication of tracks) {
        const key = `${publication.sessionId}:${publication.trackName}`;
        if (!this.subscribedTracks.has(key)) {
          await this.subscribeRemoteTrack(publication.sessionId, publication.trackName);
          this.subscribedTracks.add(key);
        }
      }
      await this.waitForRemoteStream(`${screen.sessionId}:${screen.trackName}`);
      const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/streams/watch`, {
        method: "POST", headers: this.authHeaders,
        body: JSON.stringify({ channelId: this.currentChannelId, sessionId: this.sessionId, publisherSessionId }),
      });
      if (!response.ok) throw new Error(`Watch registration failed (${response.status})`);
      const state = await response.json() as CfStreamWatchState;
      this.watchingSessions.add(publisherSessionId);
      this.setWatchState(state);
      return state;
    } catch (error) {
      await this.releaseScreenSubscriptions(publisherSessionId).catch(() => undefined);
      throw error;
    }
  }

  private async releaseScreenSubscriptions(publisherSessionId: string): Promise<void> {
    const publications = [...this.currentPublications.values()].filter((publication) => publication.sessionId === publisherSessionId && (publication.source === "screen" || publication.source === "screen-audio"));
    const mids = publications.map((publication) => this.subscribedMids.get(`${publication.sessionId}:${publication.trackName}`)).filter((mid): mid is string => !!mid);
    if (mids.length && this.sessionId && this.currentChannelId) {
      const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/tracks/unsubscribe`, {
        method: "PUT", headers: this.authHeaders,
        body: JSON.stringify({ channelId: this.currentChannelId, sessionId: this.sessionId, tracks: mids.map((mid) => ({ mid })) }),
      });
      if (!response.ok) throw new Error(`Unsubscribe failed (${response.status})`);
    }
    for (const publication of publications) {
      const key = `${publication.sessionId}:${publication.trackName}`;
      this.subscribedTracks.delete(key);
      const mid = this.subscribedMids.get(key);
      if (mid) this.remoteByMid.delete(mid);
      this.subscribedMids.delete(key);
      const stream = this.remoteStreams.get(key);
      if (stream) { for (const track of stream.getTracks()) { this.releaseRemoteTrack(track.id); track.stop(); } }
      this.remoteStreams.delete(key);
      if (publication.kind === "video") this.emitVideo(publication, null);
    }
  }

  public async stopWatchingStream(publisherSessionId: string): Promise<void> {
    await this.pendingWatches.get(publisherSessionId)?.catch(() => undefined);
    if (!this.sessionId || !this.currentChannelId) return;
    const publication = [...this.currentPublications.values()].find((item) => item.sessionId === publisherSessionId && item.source === "screen");
    this.watchingSessions.delete(publisherSessionId);
    const previous = this.watchStates.get(publisherSessionId);
    if (previous) this.setWatchState({ ...previous, watching: false });
    const response = await apiFetch(`${API_BASE}/api/cloudflare-realtime/streams/unwatch`, {
      method: "POST", headers: this.authHeaders,
      body: JSON.stringify({ channelId: this.currentChannelId, sessionId: this.sessionId, publisherSessionId }),
    }).catch(() => null);
    try { await this.releaseScreenSubscriptions(publisherSessionId); }
    finally {
      if (response?.ok) this.setWatchState(await response.json() as CfStreamWatchState);
      else if (publication) this.setWatchState({ channelId: this.currentChannelId, publisherSessionId, hostUserId: publication.userId, viewerCount: previous?.viewerCount || 0, watching: false });
    }
  }

  public onNetworkStatsUpdate(listener: (stats: Map<string, NetworkStats>) => void): () => void {
    this.networkListeners.add(listener);
    listener(new Map(this.networkStats));
    return () => { this.networkListeners.delete(listener); };
  }

  public getNetworkStats(identity?: string): NetworkStats | null {
    const key = identity || useAuthStore.getState().user?.id || "local";
    const stats = this.networkStats.get(key);
    return stats && Date.now() - stats.timestamp < 5_000 ? stats : null;
  }

  public getAllNetworkStats(): NetworkStats[] {
    return [...this.networkStats.values()].filter((stats) => Date.now() - stats.timestamp < 5_000);
  }

  public async getDetailedStats(identity?: string): Promise<StreamDetailedStats> {
    if (this.pc && this.connectionStatus === "connected") await this.refreshStats();
    const userId = identity || useAuthStore.getState().user?.id || "local";
    return this.detailedStats.get(userId) || this.emptyDetailedStats(userId, !identity || identity === useAuthStore.getState().user?.id);
  }

  private emptyDetailedStats(identity: string, isLocal: boolean): StreamDetailedStats {
    return {
      participantIdentity: identity, isLocal, mimeType: "暂无媒体数据", playerCore: "WebRTC / Cloudflare Realtime",
      audioInfo: "暂无音轨", encoder: "未知", streamHost: "Cloudflare SFU", connectionMode: "等待媒体数据",
      topology: "SFU_SERVER", protocol: "未知", bufferLength: "WebRTC 自适应", downloadBitrate: "暂无数据",
      uploadBitrate: "暂无数据", rtt: "暂无数据（本机 ↔ SFU）", packetLoss: "暂无数据", jitter: "暂无数据",
      transportVerified: false,
    };
  }

  private startStatsPolling(): void {
    if (this.statsTimer) return;
    void this.refreshStats();
    this.statsTimer = setInterval(() => { void this.refreshStats(); }, 1_000);
  }

  private statsInFlight: Promise<void> | null = null;
  private refreshStats(): Promise<void> {
    if (this.statsInFlight) return this.statsInFlight;
    this.statsInFlight = this.collectStats().catch((error) => {
      console.warn("[CF Realtime] RTC stats collection failed", error);
    }).finally(() => { this.statsInFlight = null; });
    return this.statsInFlight;
  }

  private async collectStats(): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.connectionState === "closed") return;
    const report = await pc.getStats();
    if (this.pc !== pc) return;
    const stats = [...report.values()] as RtcRecord[];
    const byId = new Map(stats.map((item) => [item.id, item]));
    const selectedId = stats.find((item) => item.type === "transport" && item.selectedCandidatePairId)?.selectedCandidatePairId;
    const pair = selectedId ? byId.get(selectedId) : stats.find((item) => item.type === "candidate-pair" && item.state === "succeeded" && item.nominated);
    const localCandidate = pair?.localCandidateId ? byId.get(pair.localCandidateId) : undefined;
    const remoteCandidate = pair?.remoteCandidateId ? byId.get(pair.remoteCandidateId) : undefined;
    const rttMs = typeof pair?.currentRoundTripTime === "number" ? Math.round(pair.currentRoundTripTime * 1000) : undefined;
    const protocol = (remoteCandidate?.protocol || localCandidate?.protocol || "未知").toUpperCase();
    const candidateType = localCandidate?.candidateType || remoteCandidate?.candidateType;
    const connectionMode = candidateType === "relay" ? `SFU 经 TURN (${protocol})` : `SFU ${candidateType || "ICE"} (${protocol})`;
    const host = remoteCandidate?.address ? `${remoteCandidate.address}:${remoteCandidate.port || ""}` : "Cloudflare SFU";
    const ipVersion = remoteCandidate?.address ? (remoteCandidate.address.includes(":") ? "IPv6" : "IPv4") : undefined;
    const localId = useAuthStore.getState().user?.id || "local";
    const identities = new Set<string>([localId]);
    for (const publication of this.remoteByMid.values()) if (publication.userId) identities.add(publication.userId);
    const nextNetwork = new Map<string, NetworkStats>();
    const nextDetailed = new Map<string, StreamDetailedStats>();
    for (const identity of identities) {
      const isLocal = identity === localId;
      const mids = new Set<string>();
      if (isLocal) for (const published of this.publishedTracks.values()) mids.add(published.mid);
      else for (const [mid, publication] of this.remoteByMid) if (publication.userId === identity) mids.add(mid);
      const trackIds = new Set<string>();
      if (!isLocal) for (const [key, stream] of this.remoteStreams) {
        const publication = this.currentPublications.get(key);
        if (publication?.userId === identity) stream.getTracks().forEach((track) => trackIds.add(track.id));
      }
      const media = stats.filter((item) => {
        if (item.type !== (isLocal ? "outbound-rtp" : "inbound-rtp")) return false;
        if (item.mid) return mids.has(item.mid);
        return !!item.trackIdentifier && trackIds.has(item.trackIdentifier);
      });
      let received = 0, sent = 0, downBps = 0, upBps = 0, packets = 0, lost = 0, jitterMs = 0, jitterCount = 0, decoded = 0;
      let audioCodec: string | undefined, videoCodec: string | undefined, videoInfo: string | undefined;
      for (const item of media) {
        const codec = item.codecId ? byId.get(item.codecId)?.mimeType : undefined;
        const kind = item.kind || item.mediaType || (codec?.startsWith("video/") ? "video" : "audio");
        if (codec && !/\/((rtx)|(red)|(ulpfec)|(flexfec)|(cn))$/i.test(codec)) {
          if (kind === "video") videoCodec = codec; else audioCodec = codec;
        }
        const bytes = isLocal ? item.bytesSent || 0 : item.bytesReceived || 0;
        if (isLocal) sent += bytes; else received += bytes;
        const prior = this.previousStats.get(item.id);
        if (prior && item.timestamp > prior.timestamp && bytes >= prior.bytes) {
          const rate = (bytes - prior.bytes) * 8_000 / (item.timestamp - prior.timestamp);
          if (isLocal) upBps += rate; else downBps += rate;
        }
        this.previousStats.set(item.id, { bytes, timestamp: item.timestamp });
        packets += isLocal ? item.packetsSent || 0 : item.packetsReceived || 0;
        lost += item.packetsLost || 0;
        if (typeof item.jitter === "number") { jitterMs += item.jitter * 1_000; jitterCount++; }
        if (kind === "video") {
          decoded += item.framesDecoded || 0;
          if (item.frameWidth && item.frameHeight) videoInfo = `${item.frameWidth}×${item.frameHeight}${item.framesPerSecond ? ` @ ${Math.round(item.framesPerSecond)} FPS` : ""}`;
        }
      }
      if (media.length === 0 && !isLocal) continue;
      const loss = packets + lost > 0 ? Math.round(lost / (packets + lost) * 10_000) / 100 : undefined;
      const jitter = jitterCount ? Math.round(jitterMs / jitterCount) : undefined;
      const bitrate = Math.round((isLocal ? upBps : downBps) / 1_000);
      const quality: NetworkStats["quality"] = !media.length || rttMs === undefined ? "unknown" :
        (rttMs > 250 || (loss ?? 0) > 5) ? "poor" : (rttMs > 120 || (loss ?? 0) > 2) ? "good" : "excellent";
      nextNetwork.set(identity, { identity, rtt: rttMs, packetLoss: loss, jitter, bitrate,
        codec: audioCodec, videoCodec, videoResolution: videoInfo?.split(" @ ")[0],
        videoFramerate: videoInfo?.includes(" @ ") ? Number(videoInfo.split(" @ ")[1].split(" ")[0]) : undefined,
        videoBitrate: videoCodec ? bitrate : undefined, quality, timestamp: Date.now() });
      const formatRate = (bps: number, bytes: number) => `${bps > 0 ? `${Math.round(bps / 1_000)} kbps` : "暂无速率"} (${(bytes / 1_048_576).toFixed(2)} MiB)`;
      nextDetailed.set(identity, {
        participantIdentity: identity, isLocal, mimeType: videoCodec || audioCodec || "暂无协商编解码器",
        playerCore: "WebRTC / Cloudflare Realtime", videoInfo, audioInfo: audioCodec || "暂无音轨",
        encoder: isLocal ? (videoCodec || audioCodec || "未知") : "远端编码器不可见",
        streamHost: host, connectionMode, topology: "SFU_SERVER", protocol, bufferLength: "WebRTC 自适应",
        decodedFrames: videoInfo ? String(decoded) : undefined,
        downloadBitrate: formatRate(downBps, received), uploadBitrate: formatRate(upBps, sent),
        rawDownloadBitrateBps: downBps, rawUploadBitrateBps: upBps, totalBytesReceived: received, totalBytesSent: sent,
        rtt: rttMs === undefined ? "暂无数据（本机 ↔ SFU）" : `${rttMs} ms（本机 ↔ SFU）`,
        packetLoss: loss === undefined ? "暂无数据" : `${loss}%`, jitter: jitter === undefined ? "暂无数据" : `${jitter} ms`,
        ipVersion, candidateType, actualSendCodec: isLocal ? videoCodec || audioCodec : undefined,
        actualReceiveCodec: !isLocal ? videoCodec || audioCodec : undefined,
        transportVerified: !!pair && media.some((item) => (isLocal ? item.bytesSent || 0 : item.bytesReceived || 0) > 0),
      });
    }
    this.networkStats = nextNetwork;
    this.detailedStats = nextDetailed;
    for (const listener of this.networkListeners) listener(new Map(nextNetwork));
  }

  public setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    this.updatePlaybackGains();
  }

  private scheduleTurnRefresh(expiresAt: number): void {
    if (this.turnRefreshTimer) clearTimeout(this.turnRefreshTimer);
    const ms = Math.max(
      30_000,
      (expiresAt - Math.floor(Date.now() / 1000) - 300) * 1000,
    );
    this.turnRefreshTimer = setTimeout(async () => {
      if (!this.pc) return;
      try {
        const response = await apiFetch(
          `${API_BASE}/api/cloudflare-realtime/ice-servers`,
          { headers: this.authHeaders },
        );
        if (!response.ok) throw new Error(`TURN refresh ${response.status}`);
        const data = (await response.json()) as CfTurnIceServersResponse;
        this.pc?.setConfiguration({ iceServers: data.iceServers });
        this.scheduleTurnRefresh(data.expiresAt);
      } catch (error) {
        console.warn("TURN refresh failed", error);
      }
    }, ms);
  }

  private waitForConnected(
    pc: RTCPeerConnection,
    timeoutMs = 15_000,
  ): Promise<void> {
    if (pc.connectionState === "connected") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Cloudflare media ICE timeout"));
      }, timeoutMs);
      const check = () => {
        if (pc.connectionState === "connected") {
          cleanup();
          resolve();
        }
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          cleanup();
          reject(new Error("Cloudflare media connection failed"));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        pc.removeEventListener("connectionstatechange", check);
      };
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
    this.unbindViewers?.();
    this.unbindViewers = null;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    if (this.speakerTimer) clearInterval(this.speakerTimer);
    this.speakerTimer = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    window.removeEventListener("pagehide", this.pagehideHandler);
    if (this.turnRefreshTimer) clearTimeout(this.turnRefreshTimer);
    this.turnRefreshTimer = null;
    const oldSessionId = this.sessionId;
    if (oldSessionId) {
      await apiFetch(`${API_BASE}/api/cloudflare-realtime/session/leave`, {
        method: "POST",
        headers: this.authHeaders,
        body: JSON.stringify({ sessionId: oldSessionId }),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => undefined);
    }
    // 释放远端播放 Audio 元素
    for (const trackId of [...this.audioElements.keys()]) this.releaseRemoteTrack(trackId);
    if (this.playbackContext) await this.playbackContext.close().catch(() => undefined);
    this.playbackContext = null;
    this.masterGain = null;
    this.activeSpeakers.clear();
    this.emitSpeakers();
    this.remoteStreams.clear();
    this.currentPublications.clear();
    this.initialPublications = [];
    this.remoteByMid.clear();
    this.subscribedTracks.clear();
    this.subscribedMids.clear();
    this.watchingSessions.clear();
    this.pendingWatches.clear();
    this.watchStates.clear();
    for (const listener of this.publicationListeners) listener([]);
    this.networkStats.clear();
    this.detailedStats.clear();
    this.previousStats.clear();
    for (const listener of this.networkListeners) listener(new Map());
    for (const published of this.publishedTracks.values()) {
      if (published.stream !== this.localAudioStream)
        published.stream.getTracks().forEach((track) => track.stop());
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

  private async waitForIceGathering(
    pc: RTCPeerConnection,
    timeoutMs = 15_000,
  ): Promise<void> {
    const hasCandidate = () =>
      pc.localDescription?.sdp?.includes("a=candidate:") === true;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        pc.removeEventListener("icecandidate", check);
        pc.removeEventListener("icegatheringstatechange", check);
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") {
          cleanup();
          if (hasCandidate()) resolve();
          else reject(new Error("No ICE candidates gathered"));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        if (hasCandidate()) resolve();
        else reject(new Error("ICE candidate gathering timed out"));
      }, timeoutMs);
      pc.addEventListener("icecandidate", check);
      pc.addEventListener("icegatheringstatechange", check);
      check();
    });
  }
}

export const cloudflareRealtimeService = new CloudflareRealtimeService();
