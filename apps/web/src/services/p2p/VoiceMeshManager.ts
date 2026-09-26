import {
  P2PSignalPayload,
  PeerLatencyReport,
  GatewayEvents,
  GatewayOpCode,
  clampVolume,
  StreamDetailedStats,
  ConnectionTopology,
  ICEServerConfigResponse,
} from "@tescord/types";
import { gatewayClient } from "../gateway.js";
import { audioEngine } from "../audioEngine.js";
import { livekitService } from "../livekit.js";
import { API_BASE } from "../../config.js";
import { apiFetch } from "../apiClient.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { bitrateCalculator } from "../stats/BitrateCalculator.js";
import { sframeManager } from "../sframe.js";

// 高可用 IPv4 / IPv6 双栈 STUN 池
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [];

export type LatencyUpdateCallback = (
  reports: Map<string, PeerLatencyReport>,
) => void;
export type VoiceFallbackCallback = (context: {
  channelId: string;
  guildId: string | null;
  callId: string | null;
  reason: string;
}) => void;

export class VoiceMeshManager {
  private activeChannelId: string | null = null;
  private activeGuildId: string | null = null;
  private activeCallId: string | null = null;
  private currentUserId: string | null = null;
  private isMeshActive: boolean = false;
  private hasConnectedPeer = false;
  private isFallbackToSFU: boolean = false;
  private fallbackReason: string = "";
  private fallbackCallbacks = new Set<VoiceFallbackCallback>();

  // 动态 ICE 服务器 (双栈 STUN + Coturn TURN)
  private currentIceServers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS];
  private isIceServersLoaded: boolean = false;
  private iceServersLoadedAt = 0;

  // targetUserId -> RTCPeerConnection
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  // targetUserId -> 待处理 ICE candidates 队列
  private pendingCandidatesMap: Map<string, RTCIceCandidateInit[]> = new Map();
  // targetUserId -> 远端音频元素与音量控制
  private remoteAudioElements: Map<string, HTMLAudioElement> = new Map();
  // targetUserId -> 最新延迟报告
  private latencyReports: Map<string, PeerLatencyReport> = new Map();
  // targetUserId -> 打洞重试状态追踪
  private peerRetries: Map<
    string,
    { attempts: number; timer?: any; inProgress: boolean }
  > = new Map();

  private statsTimer: any = null;
  private latencyCallbacks: Set<LatencyUpdateCallback> = new Set();
  private localAudioTrack: MediaStreamTrack | null = null;

  /**
   * 动态拉取服务端 Coturn TURN 与双栈 STUN 列表
   */
  public async fetchIceServers(): Promise<RTCIceServer[]> {
    if (
      this.isIceServersLoaded &&
      Date.now() - this.iceServersLoadedAt < 60 * 60 * 1000
    )
      return this.currentIceServers;
    try {
      const token =
        useAuthStore.getState().token ||
        sessionStorage.getItem("tescord_access_token") ||
        localStorage.getItem("tescord_access_token");
      const res = await apiFetch(`${API_BASE}/api/network/ice-servers`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) {
        const data = (await res.json()) as ICEServerConfigResponse;
        if (data.iceServers && Array.isArray(data.iceServers)) {
          this.currentIceServers = data.iceServers as RTCIceServer[];
          this.isIceServersLoaded = true;
          this.iceServersLoadedAt = Date.now();
          return this.currentIceServers;
        }
      }
    } catch (e) {
      console.warn(
        "[VoiceMesh] Failed to fetch dynamic ICE servers, using defaults:",
        e,
      );
    }
    return this.currentIceServers;
  }

  constructor() {
    // 监听全局音量变动，动态联动 Mesh P2P 远端音频
    livekitService.onParticipantVolumeChange((identity, vol) => {
      const audioEl = this.remoteAudioElements.get(identity);
      if (audioEl) {
        // HTMLAudioElement volume 为 0.0 - 1.0 (超过 100% 依赖 Web Audio GainNode，此处做基础音量缩放)
        audioEl.volume = Math.min(1.0, Math.max(0, vol / 100));
      }
    });
  }

  public setContext(userId: string) {
    this.currentUserId = userId;
  }

  public getIsMeshActive(): boolean {
    return this.isMeshActive;
  }

  public getIsFallbackToSFU(): boolean {
    return this.isFallbackToSFU;
  }

  public getFallbackReason(): string {
    return this.fallbackReason;
  }

  public getConnectedPeersCount(): number {
    let count = 0;
    for (const pc of this.peerConnections.values()) {
      if (pc.connectionState === "connected") count++;
    }
    return count;
  }

  public triggerFallbackToSFU(
    reason: string = "网络穿透协商受阻，已平滑降级回退至 LiveKit SFU 服务器",
  ): void {
    if (!this.isMeshActive || this.isFallbackToSFU || !this.activeChannelId)
      return;
    this.isFallbackToSFU = true;
    this.fallbackReason = reason;
    for (const callback of this.fallbackCallbacks) {
      callback({
        channelId: this.activeChannelId,
        guildId: this.activeGuildId,
        callId: this.activeCallId,
        reason,
      });
    }
    this.notifyLatencyUpdate();
  }

  public onFallbackNeeded(callback: VoiceFallbackCallback): () => void {
    this.fallbackCallbacks.add(callback);
    return () => this.fallbackCallbacks.delete(callback);
  }

  public onLatencyUpdate(cb: LatencyUpdateCallback): () => void {
    this.latencyCallbacks.add(cb);
    return () => {
      this.latencyCallbacks.delete(cb);
    };
  }

  /**
   * 加入或切换到纯语音 Mesh P2P 通话
   */
  public async startVoiceMesh(
    channelId: string,
    guildId: string,
    localStream: MediaStream,
    otherUserIds: string[],
    callId?: string,
  ): Promise<void> {
    this.stopAll();

    this.activeChannelId = channelId;
    this.activeGuildId = guildId;
    this.activeCallId = callId || null;
    this.isMeshActive = true;
    this.hasConnectedPeer = false;
    this.isFallbackToSFU = false;
    this.fallbackReason = "";

    await this.fetchIceServers();

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.localAudioTrack = audioTrack;
    }

    // 与房间内已存在的其他成员主动建立点对点呼叫 (PeerConnection Offer)
    for (const targetId of otherUserIds) {
      if (targetId && targetId !== this.currentUserId) {
        if (
          this.activeCallId &&
          this.currentUserId &&
          this.currentUserId.localeCompare(targetId) > 0
        ) {
          continue;
        }
        await this.initiateCallToPeer(targetId);
      }
    }

    // 启动 1.5s 周期性 getStats 独立延迟监控
    this.startStatsMonitoring();
  }

  /**
   * 停止并释放所有 P2P 语音链路
   */
  public stopAll(): void {
    this.isMeshActive = false;
    this.hasConnectedPeer = false;
    this.isFallbackToSFU = false;
    this.fallbackReason = "";
    this.activeChannelId = null;
    this.activeGuildId = null;
    this.activeCallId = null;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    // 清理所有重试定时器
    for (const info of this.peerRetries.values()) {
      if (info.timer) clearTimeout(info.timer);
    }
    this.peerRetries.clear();

    // 关闭所有 PeerConnection
    for (const [peerId, pc] of this.peerConnections.entries()) {
      try {
        pc.close();
      } catch {}
    }
    this.peerConnections.clear();
    this.pendingCandidatesMap.clear();

    // 释放远端音频元素
    for (const [peerId, el] of this.remoteAudioElements.entries()) {
      try {
        el.srcObject = null;
        el.pause();
        el.remove();
      } catch {}
    }
    this.remoteAudioElements.clear();
    this.latencyReports.clear();
    this.notifyLatencyUpdate();
  }

  /**
   * 获取与指定远端成员的点对点独立延迟报告
   */
  public getPeerLatency(userId: string): PeerLatencyReport | null {
    return this.latencyReports.get(userId) || null;
  }

  /**
   * 获取所有连接的成员延迟
   */
  public getAllPeerLatencies(): Map<string, PeerLatencyReport> {
    return new Map(this.latencyReports);
  }

  public async waitForConnectedPeer(timeoutMs = 8_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.isMeshActive && Date.now() < deadline) {
      if (this.getConnectedPeersCount() > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.getConnectedPeersCount() > 0;
  }

  /**
   * 计算双维度延迟指标：
   * 优先返回当前活跃发言者的物理直连延迟；若无人发言，返回所有已连接成员的直连中位数延迟。
   */
  public getActiveSpeakerOrMedianLatency(activeSpeakerId?: string | null): {
    rtt: number;
    targetId?: string;
    isSpeaker: boolean;
    connectionType?: string;
  } {
    if (activeSpeakerId && activeSpeakerId !== this.currentUserId) {
      const speakerReport = this.latencyReports.get(activeSpeakerId);
      if (speakerReport) {
        return {
          rtt: speakerReport.rtt,
          targetId: activeSpeakerId,
          isSpeaker: true,
          connectionType: speakerReport.connectionType,
        };
      }
    }

    // 若无发言者或发言者是自己，取全员延迟中位数
    const allReports = Array.from(this.latencyReports.values()).filter(
      (r) => r.rtt > 0,
    );
    if (allReports.length === 0) {
      return { rtt: 0, isSpeaker: false };
    }

    allReports.sort((a, b) => a.rtt - b.rtt);
    const mid = Math.floor(allReports.length / 2);
    const medianReport =
      allReports.length % 2 !== 0 ? allReports[mid] : allReports[mid - 1];

    return {
      rtt: medianReport.rtt,
      targetId: medianReport.targetUserId,
      isSpeaker: false,
      connectionType: medianReport.connectionType,
    };
  }

  /**
   * 处理网关下发的纯语音 P2P 信令
   */
  public async handleVoiceSignal(signal: P2PSignalPayload): Promise<void> {
    if (!this.isMeshActive) return;
    const { senderId, type, sdp, candidate } = signal;
    if (!senderId || senderId === this.currentUserId) return;

    switch (type) {
      case "VOICE_OFFER": {
        if (!sdp) return;
        const pc = this.getOrCreatePeerConnection(senderId);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          // 排空已缓冲的 ICE
          await this.flushPendingCandidates(senderId, pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          this.sendSignal({
            guildId: this.activeGuildId || "",
            channelId: this.activeChannelId || "",
            senderId: this.currentUserId || "",
            targetId: senderId,
            streamOwnerId: this.currentUserId || "",
            type: "VOICE_ANSWER",
            sdp: answer,
          });
        } catch (e) {
          console.error(`[VoiceMesh] 处理来自 ${senderId} 的 OFFER 失败:`, e);
        }
        break;
      }

      case "VOICE_ANSWER": {
        if (!sdp) return;
        const pc = this.peerConnections.get(senderId);
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            await this.flushPendingCandidates(senderId, pc);
          } catch (e) {
            console.error(
              `[VoiceMesh] 处理来自 ${senderId} 的 ANSWER 失败:`,
              e,
            );
          }
        }
        break;
      }

      case "VOICE_ICE_CANDIDATE": {
        if (!candidate) return;
        const pc = this.peerConnections.get(senderId);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn(
              `[VoiceMesh] 添加来自 ${senderId} 的 ICE candidate 失败:`,
              e,
            );
          }
        } else {
          // 暂存到 buffer 队列
          const queue = this.pendingCandidatesMap.get(senderId) || [];
          queue.push(candidate);
          this.pendingCandidatesMap.set(senderId, queue);
        }
        break;
      }

      case "VOICE_LEAVE": {
        this.closePeer(senderId);
        break;
      }
    }
  }

  /**
   * 主动向指定节点发送 VOICE_OFFER 建立点对点语音通道
   */
  private async initiateCallToPeer(targetId: string): Promise<void> {
    const pc = this.getOrCreatePeerConnection(targetId);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      this.sendSignal({
        guildId: this.activeGuildId || "",
        channelId: this.activeChannelId || "",
        senderId: this.currentUserId || "",
        targetId,
        streamOwnerId: this.currentUserId || "",
        type: "VOICE_OFFER",
        sdp: offer,
      });
    } catch (e) {
      console.error(`[VoiceMesh] 发起呼叫至 ${targetId} 失败:`, e);
    }
  }

  private getOrCreatePeerConnection(peerId: string): RTCPeerConnection {
    let pc = this.peerConnections.get(peerId);
    if (pc) return pc;

    pc = new RTCPeerConnection({
      iceServers: this.currentIceServers,
      bundlePolicy: "max-bundle",
      ...(sframeManager.getStats().enabled
        ? { encodedInsertableStreams: true }
        : {}),
    } as RTCConfiguration);

    // 绑定本地音频轨道
    if (this.localAudioTrack) {
      const sender = pc.addTrack(this.localAudioTrack);
      if (sframeManager.getStats().enabled) sframeManager.attachSender(sender);
    }

    // 处理 ICE candidate (包含 IPv4 与 IPv6 双栈候选)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: peerId,
          streamOwnerId: this.currentUserId || "",
          type: "VOICE_ICE_CANDIDATE",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // 监听远端音频流
    pc.ontrack = (event) => {
      if (sframeManager.getStats().enabled)
        sframeManager.attachReceiver(event.receiver);
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      this.attachRemoteAudio(peerId, remoteStream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc?.connectionState;
      if (state === "connected") {
        this.hasConnectedPeer = true;
        const retryInfo = this.peerRetries.get(peerId);
        if (retryInfo?.timer) clearTimeout(retryInfo.timer);
        this.peerRetries.delete(peerId);
      } else if (state === "disconnected" || state === "failed") {
        this.scheduleHolePunchRetry(peerId);
      } else if (state === "closed") {
        this.closePeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc?.iceConnectionState;
      if (iceState === "failed" || iceState === "disconnected") {
        this.scheduleHolePunchRetry(peerId);
      }
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  /**
   * 规划针对对端节点的打洞重试 (最多 3 次，指数退避 1.2s -> 2.5s -> 4s)
   */
  private scheduleHolePunchRetry(peerId: string): void {
    if (!this.isMeshActive) return;
    const pc = this.peerConnections.get(peerId);
    if (!pc || pc.connectionState === "connected") return;

    let retryInfo = this.peerRetries.get(peerId);
    if (!retryInfo) {
      retryInfo = { attempts: 0, inProgress: false };
      this.peerRetries.set(peerId, retryInfo);
    }

    if (retryInfo.inProgress) return;

    const MAX_RETRIES = 3;
    if (retryInfo.attempts >= MAX_RETRIES) {
      console.warn(
        `[VoiceMesh] 节点 ${peerId} 经历 ${MAX_RETRIES} 次打洞重试后仍未连通，判定穿透受阻`,
      );
      this.closePeer(peerId);
      if (
        this.hasConnectedPeer &&
        this.getConnectedPeersCount() === 0 &&
        this.peerConnections.size === 0
      ) {
        this.triggerFallbackToSFU(
          "P2P 网状打洞经 3 次重试失败（双方可能存在双对称 NAT 或防火墙阻止），已平滑降级至 SFU 服务端中继",
        );
      }
      return;
    }

    retryInfo.attempts++;
    retryInfo.inProgress = true;
    const backoffDelays = [1200, 2500, 4000];
    const delay = backoffDelays[retryInfo.attempts - 1] || 3000;

    console.info(
      `[VoiceMesh] 正在为节点 ${peerId} 安排第 ${retryInfo.attempts}/${MAX_RETRIES} 次打洞重试 (${delay}ms 后启动 ICE Restart)...`,
    );

    if (retryInfo.timer) clearTimeout(retryInfo.timer);
    retryInfo.timer = setTimeout(async () => {
      await this.executeIceRestart(peerId, retryInfo!.attempts);
    }, delay);
  }

  /**
   * 执行 WebRTC ICE Restart 重新打洞
   */
  private async executeIceRestart(
    peerId: string,
    attempt: number,
  ): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    const retryInfo = this.peerRetries.get(peerId);
    if (!pc || pc.connectionState === "connected" || !this.isMeshActive) {
      if (retryInfo) retryInfo.inProgress = false;
      return;
    }

    try {
      console.info(
        `[VoiceMesh] 正在执行针对 ${peerId} 的打洞重试 (第 ${attempt}/3 次 ICE Restart)...`,
      );
      if (typeof pc.restartIce === "function") {
        pc.restartIce();
      }
      const offer = await pc.createOffer({
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      this.sendSignal({
        guildId: this.activeGuildId || "",
        channelId: this.activeChannelId || "",
        senderId: this.currentUserId || "",
        targetId: peerId,
        streamOwnerId: this.currentUserId || "",
        type: "VOICE_OFFER",
        sdp: offer,
      });
    } catch (e) {
      console.warn(`[VoiceMesh] 对节点 ${peerId} 执行 ICE Restart 失败:`, e);
    } finally {
      if (retryInfo) retryInfo.inProgress = false;
    }
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream) {
    let audioEl = this.remoteAudioElements.get(peerId);
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      this.remoteAudioElements.set(peerId, audioEl);
    }

    // 设置初始音量
    const userVol = livekitService.getParticipantVolume(peerId) ?? 100;
    audioEl.volume = Math.min(1.0, Math.max(0, userVol / 100));
    audioEl.srcObject = stream;
    audioEl.play().catch(() => {});
  }

  private async flushPendingCandidates(
    peerId: string,
    pc: RTCPeerConnection,
  ): Promise<void> {
    const queue = this.pendingCandidatesMap.get(peerId);
    if (queue && queue.length > 0) {
      for (const cand of queue) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("[VoiceMesh] 排空 ICE candidate 失败:", e);
        }
      }
      this.pendingCandidatesMap.delete(peerId);
    }
  }

  private closePeer(peerId: string) {
    const retryInfo = this.peerRetries.get(peerId);
    if (retryInfo?.timer) clearTimeout(retryInfo.timer);
    this.peerRetries.delete(peerId);

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peerConnections.delete(peerId);
    }
    this.pendingCandidatesMap.delete(peerId);

    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) {
      try {
        audioEl.srcObject = null;
        audioEl.pause();
        audioEl.remove();
      } catch {}
      this.remoteAudioElements.delete(peerId);
    }

    this.latencyReports.delete(peerId);
    if (
      this.isMeshActive &&
      this.hasConnectedPeer &&
      this.peerConnections.size === 0
    ) {
      this.triggerFallbackToSFU(
        "P2P 直连断开或穿透协商受阻，正在连接 LiveKit SFU",
      );
    }
    this.notifyLatencyUpdate();
  }

  /**
   * 获取指定远端节点的 P2P Mesh 详细媒体属性与实时统计
   */
  public async getVoiceMeshStats(
    peerId: string,
  ): Promise<StreamDetailedStats | null> {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return null;

    let rtt = "N/A";
    let jitter = "N/A";
    let packetLoss = "N/A";
    let streamHost = "未知";
    let protocol = "未知";
    let ipVersion: "IPv4" | "IPv6" | undefined;
    let candidateType: "host" | "srflx" | "prflx" | "relay" | undefined;
    let connectionMode = "协商中";
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let actualSendCodec: string | undefined;
    let actualReceiveCodec: string | undefined;
    let selectedPairFound = false;

    const retryInfo = this.peerRetries.get(peerId);
    const holePunchStatus =
      pc.connectionState === "connected"
        ? "P2P Mesh 打洞已连通"
        : retryInfo && retryInfo.attempts > 0
          ? `打洞重试中 (${retryInfo.attempts}/3)`
          : `正在建立打洞连接 (${pc.connectionState || "connecting"})`;

    try {
      const report = await pc.getStats();
      let selectedPairId = "";
      report.forEach((stat: any) => {
        if (stat.type === "transport" && stat.selectedCandidatePairId) {
          selectedPairId = stat.selectedCandidatePairId;
        }
      });

      report.forEach((stat: any) => {
        if (
          stat.type === "candidate-pair" &&
          (selectedPairId
            ? stat.id === selectedPairId
            : stat.nominated && stat.state === "succeeded")
        ) {
          selectedPairFound = true;
          if (typeof stat.currentRoundTripTime === "number") {
            rtt = `${Math.round(stat.currentRoundTripTime * 1000)}ms`;
          }
          const localCand = report.get(stat.localCandidateId);
          const remoteCand = report.get(stat.remoteCandidateId);
          if (remoteCand?.protocol || localCand?.protocol) {
            protocol = (
              remoteCand?.protocol || localCand?.protocol
            ).toUpperCase();
          }
          if (remoteCand?.address) {
            streamHost = `${remoteCand.address}:${remoteCand.port || ""}`;
          }
          const checkAddr = remoteCand?.address || localCand?.address || "";
          if (checkAddr.includes(":") && !checkAddr.startsWith("fe80:")) {
            ipVersion = "IPv6";
          }
          if (remoteCand?.candidateType) {
            candidateType = remoteCand.candidateType;
          } else if (localCand?.candidateType) {
            candidateType = localCand.candidateType;
          }

          if (candidateType === "host") {
            connectionMode = `P2P Mesh Direct (${protocol} / Host ${ipVersion})`;
          } else if (candidateType === "srflx") {
            connectionMode = `P2P Mesh Direct (${protocol} / STUN ${ipVersion})`;
          } else if (candidateType === "relay") {
            connectionMode = `P2P Mesh Relay (${protocol} / TURN ${ipVersion})`;
          } else {
            connectionMode = `P2P Mesh (${protocol} / ${ipVersion})`;
          }
        }

        if (
          stat.type === "inbound-rtp" &&
          stat.kind === "audio" &&
          !stat.isRemote
        ) {
          const codec = stat.codecId ? report.get(stat.codecId) : null;
          if (codec?.mimeType && !/red|cn/i.test(codec.mimeType))
            actualReceiveCodec = codec.mimeType;
          if (stat.bytesReceived) totalBytesReceived += stat.bytesReceived;
          if (typeof stat.jitter === "number")
            jitter = `${(stat.jitter * 1000).toFixed(1)}ms`;
          if (typeof stat.fractionLost === "number")
            packetLoss = `${(stat.fractionLost * 100).toFixed(1)}%`;
        }

        if (
          stat.type === "outbound-rtp" &&
          stat.kind === "audio" &&
          !stat.isRemote
        ) {
          const codec = stat.codecId ? report.get(stat.codecId) : null;
          if (codec?.mimeType && !/red|cn/i.test(codec.mimeType))
            actualSendCodec = codec.mimeType;
          if (stat.bytesSent) totalBytesSent += stat.bytesSent;
        }
      });
    } catch (err) {
      console.warn(`[VoiceMesh] getStats failed for ${peerId}:`, err);
    }

    const rateRes = bitrateCalculator.compute(
      `mesh-${peerId}`,
      totalBytesSent,
      totalBytesReceived,
    );

    return {
      participantIdentity: peerId,
      isLocal: false,
      mimeType:
        [actualSendCodec, actualReceiveCodec].filter(Boolean).join(" / ") ||
        "未知",
      playerCore: "WebRTC P2P Mesh Engine",
      videoInfo: "无视频 (纯语音 Mesh)",
      audioInfo: "由 WebRTC 实际协商",
      encoder: "浏览器 WebRTC 音频管线",
      streamHost,
      connectionMode,
      topology: "P2P_MESH" as ConnectionTopology,
      protocol,
      bufferLength: "未知",
      decodedFrames: "N/A",
      downloadBitrate:
        totalBytesSent + totalBytesReceived > 0
          ? rateRes.downloadFormatted
          : "未知",
      uploadBitrate: totalBytesSent > 0 ? rateRes.uploadFormatted : undefined,
      rawDownloadBitrateBps: rateRes.downloadBps,
      rawUploadBitrateBps: rateRes.uploadBps,
      totalBytesReceived,
      totalBytesSent,
      rtt,
      packetLoss,
      jitter,
      holePunchStatus,
      ipVersion,
      candidateType,
      actualSendCodec,
      actualReceiveCodec,
      transportVerified:
        selectedPairFound &&
        (totalBytesSent > 0 || totalBytesReceived > 0) &&
        rateRes.uploadBps + rateRes.downloadBps > 0,
    };
  }

  private startStatsMonitoring() {
    if (this.statsTimer) clearInterval(this.statsTimer);

    this.statsTimer = setInterval(async () => {
      if (!this.isMeshActive) return;

      for (const [peerId, pc] of this.peerConnections.entries()) {
        if (pc.connectionState !== "connected") continue;

        try {
          const stats = await pc.getStats();
          let rttMs = 0;
          let jitterMs: number | undefined;
          let packetLoss: number | undefined;
          let connectionType: "LAN" | "P2P" | "RELAY" = "P2P";

          let selectedPairId = "";
          stats.forEach((report) => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
              selectedPairId = report.selectedCandidatePairId;
            }
          });

          stats.forEach((report) => {
            if (
              report.type === "candidate-pair" &&
              (selectedPairId
                ? report.id === selectedPairId
                : report.nominated && report.state === "succeeded")
            ) {
              if (typeof report.currentRoundTripTime === "number") {
                rttMs = Math.round(report.currentRoundTripTime * 1000);
              }
            }
            if (report.type === "inbound-rtp" && report.kind === "audio") {
              if (typeof report.jitter === "number") {
                jitterMs = Math.round(report.jitter * 1000);
              }
              const totalPackets =
                (report.packetsReceived || 0) + (report.packetsLost || 0);
              if (totalPackets > 0) {
                packetLoss = (report.packetsLost || 0) / totalPackets;
              }
            }
          });

          this.latencyReports.set(peerId, {
            targetUserId: peerId,
            rtt: rttMs,
            jitter: jitterMs,
            packetLoss,
            connectionType,
            updatedAt: Date.now(),
          });
        } catch (e) {
          console.warn(`[VoiceMesh] getStats error for ${peerId}:`, e);
        }
      }

      this.notifyLatencyUpdate();
    }, 1500);
  }

  private notifyLatencyUpdate() {
    const map = new Map(this.latencyReports);
    for (const cb of this.latencyCallbacks) {
      try {
        cb(map);
      } catch (e) {
        console.warn("[VoiceMesh] onLatencyUpdate callback error:", e);
      }
    }
  }

  private sendSignal(signal: P2PSignalPayload) {
    gatewayClient.sendRaw({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.P2P_SIGNAL,
      d: this.activeCallId ? { ...signal, callId: this.activeCallId } : signal,
    });
  }
}

export const voiceMeshManager = new VoiceMeshManager();
