import {
  P2PSignalPayload,
  PeerLatencyReport,
  GatewayEvents,
  GatewayOpCode,
  clampVolume,
  StreamDetailedStats,
  ConnectionTopology,
} from "@tescord/types";
import { gatewayClient } from "../gateway.js";
import { audioEngine } from "../audioEngine.js";
import { livekitService } from "../livekit.js";
import { bitrateCalculator } from "../stats/BitrateCalculator.js";
import { sframeManager } from "../sframe.js";
import {
  AudioQualitySampler,
  tuneOpusDescription,
  adaptReceiverBuffer,
  adaptOpusSender,
} from "./audioQuality.js";
import type { AudioReceiveQuality } from "@tescord/types";
import { getP2PIceServers } from "./iceServers.js";

export type LatencyUpdateCallback = (
  reports: Map<string, PeerLatencyReport>,
) => void;
export type VoiceFallbackCallback = (context: {
  channelId: string;
  guildId: string | null;
  callId: string | null;
  reason: string;
}) => void;
export type ActiveSpeakersChangeCallback = (speakers: string[]) => void;

interface VoiceNegotiationState {
  pc: RTCPeerConnection;
  queue: Promise<void>;
  pendingOfferId?: string;
  acceptedOfferId?: string;
  ignoreOffer: boolean;
}

export class VoiceMeshManager {
  private audioQualitySampler = new AudioQualitySampler();
  private audioQuality = new Map<string, AudioReceiveQuality[]>();
  public getAudioQuality(peerId: string): AudioReceiveQuality[] {
    return [...(this.audioQuality.get(peerId) || [])];
  }
  private activeChannelId: string | null = null;
  private activeGuildId: string | null = null;
  private activeCallId: string | null = null;
  private currentUserId: string | null = null;
  private isMeshActive: boolean = false;
  private meshGeneration = 0;
  private hasConnectedPeer = false;
  private isFallbackToSFU: boolean = false;
  private fallbackReason: string = "";
  private allowFallbackToSFU: boolean = true;
  private fallbackCallbacks = new Set<VoiceFallbackCallback>();

  // 动态 ICE 服务器 (双栈 STUN + Coturn TURN)
  private currentIceServers: RTCIceServer[] = [];

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

  // 远端音频 Web Audio 能量分析旁路 (peerId -> { stream, sourceNode, analyserNode })
  private participantAudioMap: Map<
    string,
    {
      stream: MediaStream;
      sourceNode?: MediaStreamAudioSourceNode;
      analyserNode?: AnalyserNode;
    }
  > = new Map();
  private sharedAudioContext: AudioContext | null = null;
  private activeSpeakers: Set<string> = new Set();
  private remoteSpeakingStates: Map<
    string,
    {
      isSpeaking: boolean;
      lastActive: number;
      consecutiveAbove: number;
      smoothedEnergy: number;
    }
  > = new Map();
  private remoteEnergyTimer: any = null;
  private activeSpeakersCallbacks: Set<ActiveSpeakersChangeCallback> =
    new Set();

  private statsTimer: any = null;
  private latencyCallbacks: Set<LatencyUpdateCallback> = new Set();
  private localAudioTrack: MediaStreamTrack | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;
  private videoSenders: Map<string, RTCRtpSender> = new Map();
  private remoteCameraTracks: Map<string, MediaStreamTrack> = new Map();
  private cameraTracksCallbacks: Set<
    (tracks: Map<string, MediaStreamTrack>) => void
  > = new Set();
  private negotiations = new Map<string, VoiceNegotiationState>();

  private isCurrentPeer(peerId: string, pc: RTCPeerConnection): boolean {
    return this.isMeshActive && this.peerConnections.get(peerId) === pc;
  }

  private clearHandshake(peerId: string): void {
    const timer = this.handshakeTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.handshakeTimers.delete(peerId);
  }

  private armHandshake(
    peerId: string,
    pc: RTCPeerConnection,
    offerId: string,
  ): void {
    this.clearHandshake(peerId);
    const timer = setTimeout(() => {
      if (this.handshakeTimers.get(peerId) !== timer) return;
      this.handshakeTimers.delete(peerId);
      if (
        this.isCurrentPeer(peerId, pc) &&
        this.channelMemberIds.has(peerId) &&
        this.negotiations.get(peerId)?.pendingOfferId === offerId &&
        pc.connectionState !== "connected"
      ) {
        this.scheduleHolePunchRetry(peerId);
      }
    }, 5000);
    this.handshakeTimers.set(peerId, timer);
  }

  // SDP and ICE for one PC are serialized, including locally initiated offers.
  // This prevents createOffer/setLocalDescription racing a received offer.
  private negotiatePeer(
    peerId: string,
    pc: RTCPeerConnection,
    operation: (state: VoiceNegotiationState) => Promise<void>,
  ): Promise<void> {
    let state = this.negotiations.get(peerId);
    if (!state || state.pc !== pc) {
      state = { pc, queue: Promise.resolve(), ignoreOffer: false };
      this.negotiations.set(peerId, state);
    }
    const current = state;
    const pending = current.queue.then(async () => {
      if (this.isCurrentPeer(peerId, pc)) await operation(current);
    });
    current.queue = pending.catch(() => {});
    return pending;
  }

  private candidateMatchesRemote(
    pc: RTCPeerConnection,
    candidate: RTCIceCandidateInit,
  ): boolean {
    const fragment =
      candidate.usernameFragment ||
      /(?:^| )ufrag ([^ ]+)/.exec(candidate.candidate || "")?.[1];
    if (!fragment) return true;
    return (pc.remoteDescription?.sdp || "")
      .split(/\r?\n/)
      .some((line) => line === `a=ice-ufrag:${fragment}`);
  }

  private bufferCandidate(
    peerId: string,
    candidate: RTCIceCandidateInit,
  ): void {
    const queue = this.pendingCandidatesMap.get(peerId) || [];
    queue.push(candidate);
    this.pendingCandidatesMap.set(peerId, queue.slice(-128));
  }

  private handshakeTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private memberJoinTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  // 当前频道内除自身外的其他在线成员 ID 集合
  private channelMemberIds: Set<string> = new Set();

  /**
   * 动态拉取服务端 Coturn TURN 与双栈 STUN 列表
   */
  public async fetchIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
    this.currentIceServers = await getP2PIceServers(forceRefresh);
    return [...this.currentIceServers];
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

  public setContext(userId: string | null) {
    if (this.currentUserId && this.currentUserId !== userId) this.stopAll();
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

  /**
   * 订阅 P2P 网状网络内的所有摄像头视频轨道（包含本地与远端）
   */
  public onCameraTracksChange(
    callback: (tracks: Map<string, MediaStreamTrack>) => void,
  ): () => void {
    this.cameraTracksCallbacks.add(callback);
    callback(this.getAllCameraTracks());
    return () => {
      this.cameraTracksCallbacks.delete(callback);
    };
  }

  public getAllCameraTracks(): Map<string, MediaStreamTrack> {
    const map = new Map<string, MediaStreamTrack>(this.remoteCameraTracks);
    if (this.localVideoTrack) {
      map.set("local", this.localVideoTrack);
    }
    return map;
  }

  private notifyCameraTracksChange(): void {
    const tracks = this.getAllCameraTracks();
    for (const cb of this.cameraTracksCallbacks) {
      try {
        cb(tracks);
      } catch (err) {
        console.error("[VoiceMesh] Camera tracks callback error:", err);
      }
    }
  }

  /**
   * 动态设置本地摄像头视频轨道并通过 replaceTrack 实时推送给网状网络对端
   */
  public async setLocalVideoTrack(
    track: MediaStreamTrack | null,
  ): Promise<void> {
    this.localVideoTrack = track;
    if (track) {
      track.onended = () => {
        if (this.localVideoTrack === track) {
          void this.setLocalVideoTrack(null);
        }
      };
    }

    for (const [peerId, pc] of this.peerConnections) {
      const sender = this.videoSenders.get(peerId);
      if (sender) {
        try {
          await sender.replaceTrack(track);
        } catch (err) {
          console.error(
            `[VoiceMesh] replaceTrack for peer ${peerId} failed:`,
            err,
          );
        }
      }
    }

    this.notifyCameraTracksChange();
  }

  public setAllowFallbackToSFU(allow: boolean): void {
    this.allowFallbackToSFU = allow;
  }

  public triggerFallbackToSFU(
    reason: string = "网络穿透协商受阻，已平滑降级回退至 LiveKit SFU 服务器",
  ): void {
    if (!this.allowFallbackToSFU) {
      console.log(
        `[VoiceMesh] 频道配置为强制纯 P2P Mesh，阻止自动降级至 SFU: ${reason}`,
      );
      return;
    }
    // 守卫：若当前频道内除自己外无其他有效成员（最后一人留守），严禁降级至 SFU，保持纯 P2P 待命
    if (this.channelMemberIds.size === 0) {
      console.log(
        `[VoiceMesh] 频道内仅剩当前用户一人，拦截 SFU 降级回退，保持 P2P 引擎待命: ${reason}`,
      );
      return;
    }
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

  public onActiveSpeakersChange(cb: ActiveSpeakersChangeCallback): () => void {
    this.activeSpeakersCallbacks.add(cb);
    cb(Array.from(this.activeSpeakers));
    return () => {
      this.activeSpeakersCallbacks.delete(cb);
    };
  }

  public getActiveSpeakers(): string[] {
    return Array.from(this.activeSpeakers);
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
    options?: { allowFallbackToSFU?: boolean },
  ): Promise<void> {
    this.stopAll();
    const generation = this.meshGeneration;

    if (!sframeManager.hasActiveContext) {
      throw new Error("E2EE 密钥未就绪，禁止建立私信音视频连接");
    }

    this.activeChannelId = channelId;
    this.activeGuildId = guildId;
    this.activeCallId = callId || null;
    this.allowFallbackToSFU = options?.allowFallbackToSFU ?? true;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.localAudioTrack = audioTrack;
    }
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.localVideoTrack = videoTrack;
    }

    this.isMeshActive = true;
    this.hasConnectedPeer = false;
    this.isFallbackToSFU = false;
    this.fallbackReason = "";

    await this.fetchIceServers();
    if (
      !this.isMeshActive ||
      this.activeChannelId !== channelId ||
      this.meshGeneration !== generation
    )
      return;

    const effectiveOtherMembers = (otherUserIds || []).filter(
      (id) => id && id !== this.currentUserId,
    );
    this.channelMemberIds = new Set(effectiveOtherMembers);

    // 与房间内已存在的其他成员主动建立点对点呼叫 (PeerConnection Offer)
    for (const targetId of otherUserIds) {
      if (
        !this.isMeshActive ||
        this.activeChannelId !== channelId ||
        this.meshGeneration !== generation
      )
        return;
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

    if (this.meshGeneration !== generation || !this.isMeshActive) return;
    // 启动 1.5s 周期性 getStats 独立延迟监控
    this.startStatsMonitoring();
  }

  /**
   * 停止并释放所有 P2P 语音链路
   */
  public stopAll(): void {
    this.meshGeneration++;
    this.isMeshActive = false;
    this.hasConnectedPeer = false;
    this.isFallbackToSFU = false;
    this.fallbackReason = "";
    this.activeChannelId = null;
    this.activeGuildId = null;
    this.activeCallId = null;
    this.channelMemberIds.clear();

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    // 清理握手与对端探测定时器
    for (const timer of this.handshakeTimers.values()) {
      clearTimeout(timer);
    }
    this.handshakeTimers.clear();

    for (const timer of this.memberJoinTimers.values()) {
      clearTimeout(timer);
    }
    this.memberJoinTimers.clear();

    // 清理所有重试定时器
    for (const info of this.peerRetries.values()) {
      if (info.timer) clearTimeout(info.timer);
    }
    this.peerRetries.clear();

    // 关闭所有 PeerConnection
    for (const [peerId, pc] of this.peerConnections.entries()) {
      try {
        sframeManager.detachPeerConnection(pc);
        pc.close();
      } catch {}
    }
    this.peerConnections.clear();
    this.negotiations.clear();
    this.videoSenders.clear();
    this.remoteCameraTracks.clear();
    this.localVideoTrack = null;
    this.localAudioTrack = null;
    this.notifyCameraTracksChange();
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

    // 释放远端音频 Web Audio 能量分析旁路
    this.stopRemoteAudioEnergyMonitoring();
    for (const entry of this.participantAudioMap.values()) {
      if (entry.sourceNode) {
        try {
          entry.sourceNode.disconnect();
        } catch {}
      }
    }
    this.participantAudioMap.clear();
    this.remoteSpeakingStates.clear();
    if (this.activeSpeakers.size > 0) {
      this.activeSpeakers.clear();
      this.notifyActiveSpeakersUpdate();
    }

    this.latencyReports.clear();
    this.notifyLatencyUpdate();
  }

  /**
   * 广播 VOICE_LEAVE 信令，通知频道内所有对端立即关闭连接并清理打洞状态
   */
  public broadcastLeaveSignal(): void {
    if (!this.isMeshActive || !this.activeChannelId) return;
    try {
      const targets = this.activeCallId
        ? Array.from(this.channelMemberIds)
        : [undefined];
      for (const targetId of targets) {
        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId,
          callId: this.activeCallId || undefined,
          targetId,
          senderId: this.currentUserId || "",
          streamOwnerId: this.currentUserId || "",
          type: "VOICE_LEAVE",
        });
      }
      console.log(
        `[VoiceMesh] 已向频道 ${this.activeChannelId} 广播 VOICE_LEAVE 离开信令`,
      );
    } catch (e) {
      console.warn("[VoiceMesh] 广播 VOICE_LEAVE 离开信令失败:", e);
    }
  }

  /**
   * 对端用户离开语音频道处理（信令或网关状态广播联动触发）
   */
  public handlePeerLeave(peerId: string): void {
    this.channelMemberIds.delete(peerId);
    this.closePeer(peerId);

    // 若当前频道仅剩本端一人，重置待命状态并清除所有打洞队列
    if (this.channelMemberIds.size === 0) {
      console.log(
        `[VoiceMesh] 节点 ${peerId} 已离开，频道内仅剩当前用户，保持纯 P2P 待命，清空打洞重试队列`,
      );
      this.hasConnectedPeer = false;
      for (const info of this.peerRetries.values()) {
        if (info.timer) clearTimeout(info.timer);
      }
      this.peerRetries.clear();
      this.notifyLatencyUpdate();
    }
  }

  /**
   * 权威同步频道内在线成员列表（供网关状态对齐）
   */
  public updateChannelMembers(memberIds: string[]): void {
    const nextMembers = new Set(
      memberIds.filter((id) => id && id !== this.currentUserId),
    );
    this.channelMemberIds = nextMembers;

    // 清理已不在成员列表中的连接与重试
    for (const peerId of Array.from(this.peerConnections.keys())) {
      if (!this.channelMemberIds.has(peerId)) {
        this.closePeer(peerId);
      }
    }

    if (this.channelMemberIds.size === 0) {
      this.hasConnectedPeer = false;
      for (const info of this.peerRetries.values()) {
        if (info.timer) clearTimeout(info.timer);
      }
      this.peerRetries.clear();
      this.notifyLatencyUpdate();
    } else if (this.isMeshActive && this.activeChannelId) {
      // 针对新加入或重进的成员，若 2.5 秒内双方仍未建立 PeerConnection，主动发起探测呼叫，打破单边等待僵局
      for (const peerId of nextMembers) {
        if (
          !this.peerConnections.has(peerId) &&
          !this.memberJoinTimers.has(peerId)
        ) {
          const timer = setTimeout(() => {
            this.memberJoinTimers.delete(peerId);
            if (
              this.isMeshActive &&
              this.channelMemberIds.has(peerId) &&
              !this.peerConnections.has(peerId)
            ) {
              console.log(
                `[VoiceMesh] 成员 ${peerId} 进房 2.5 秒内未收到呼叫，本地主动发起双向建连握手...`,
              );
              void this.initiateCallToPeer(peerId);
            }
          }, 2500);
          this.memberJoinTimers.set(peerId, timer);
        }
      }
    }
  }

  public getOtherMemberCount(): number {
    return this.channelMemberIds.size;
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

  /**
   * 用户主动重试一个已经失败的节点。终态失败的 PeerConnection 已关闭，
   * 因此必须重新创建连接并发送全新的 Offer，而不是对不存在的连接做 ICE Restart。
   */
  public async retryPeer(peerId: string): Promise<void> {
    if (
      !this.isMeshActive ||
      !this.activeChannelId ||
      !peerId ||
      peerId === this.currentUserId
    )
      return;

    const generation = this.meshGeneration;
    this.isFallbackToSFU = false;
    this.fallbackReason = "";
    this.closePeer(peerId, { preserveReport: true });
    this.setPeerReport(peerId, {
      rtt: 0,
      jitter: undefined,
      packetLoss: undefined,
      connectionType: "P2P",
      status: "connecting",
    });
    await this.fetchIceServers(true);
    if (generation !== this.meshGeneration || !this.isMeshActive) return;
    await this.initiateCallToPeer(peerId);
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
    if (
      signal.channelId !== this.activeChannelId ||
      (signal.callId || null) !== this.activeCallId
    )
      return;
    const { senderId, type, sdp, candidate } = signal;
    if (!senderId || senderId === this.currentUserId) return;

    switch (type) {
      case "VOICE_OFFER": {
        if (!sdp) return;
        const joinTimer = this.memberJoinTimers.get(senderId);
        if (joinTimer) {
          clearTimeout(joinTimer);
          this.memberJoinTimers.delete(senderId);
        }
        try {
          const pc = this.getOrCreatePeerConnection(senderId);
          await this.negotiatePeer(senderId, pc, async (state) => {
            if (
              signal.negotiationId &&
              signal.negotiationId === state.acceptedOfferId
            )
              return;
            const collision = pc.signalingState !== "stable";
            const polite = (this.currentUserId || "") > senderId;
            state.ignoreOffer = collision && !polite;
            if (state.ignoreOffer) return;
            if (collision) {
              await pc.setLocalDescription({ type: "rollback" });
              if (!this.isCurrentPeer(senderId, pc)) return;
            }
            state.pendingOfferId = undefined;
            this.clearHandshake(senderId);
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            if (!this.isCurrentPeer(senderId, pc)) return;
            await this.flushPendingCandidates(senderId, pc);
            if (!this.isCurrentPeer(senderId, pc)) return;
            const answer = await pc.createAnswer();
            if (!this.isCurrentPeer(senderId, pc)) return;
            await pc.setLocalDescription(tuneOpusDescription(answer));
            if (!this.isCurrentPeer(senderId, pc)) return;
            state.acceptedOfferId = signal.negotiationId;
            this.sendSignal({
              guildId: this.activeGuildId || "",
              channelId: this.activeChannelId || "",
              senderId: this.currentUserId || "",
              targetId: senderId,
              streamOwnerId: this.currentUserId || "",
              type: "VOICE_ANSWER",
              negotiationId: signal.negotiationId,
              sdp: pc.localDescription?.toJSON() || answer,
            });
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
            await this.negotiatePeer(senderId, pc, async (state) => {
              if (
                pc.signalingState !== "have-local-offer" ||
                !state.pendingOfferId ||
                signal.negotiationId !== state.pendingOfferId
              )
                return;
              await pc.setRemoteDescription(new RTCSessionDescription(sdp));
              if (!this.isCurrentPeer(senderId, pc)) return;
              state.pendingOfferId = undefined;
              state.ignoreOffer = false;
              this.clearHandshake(senderId);
              await this.flushPendingCandidates(senderId, pc);
            });
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
        if (pc) {
          await this.negotiatePeer(senderId, pc, async (state) => {
            if (state.ignoreOffer || !pc.remoteDescription) {
              this.bufferCandidate(senderId, candidate);
              return;
            }
            if (!this.candidateMatchesRemote(pc, candidate)) {
              this.bufferCandidate(senderId, candidate);
              return;
            }
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.warn(
                `[VoiceMesh] 添加来自 ${senderId} 的 ICE candidate 失败:`,
                e,
              );
            }
          });
        } else this.bufferCandidate(senderId, candidate);
        break;
      }

      case "VOICE_LEAVE": {
        console.log(
          `[VoiceMesh] 收到来自对端 ${senderId} 的 VOICE_LEAVE 信令，即刻执行离房清理`,
        );
        this.handlePeerLeave(senderId);
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
      await this.negotiatePeer(targetId, pc, async (state) => {
        if (pc.signalingState !== "stable") return;
        state.pendingOfferId = crypto.randomUUID();
        state.ignoreOffer = false;
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        if (!this.isCurrentPeer(targetId, pc)) return;
        await pc.setLocalDescription(tuneOpusDescription(offer));
        if (!this.isCurrentPeer(targetId, pc)) return;

        this.armHandshake(targetId, pc, state.pendingOfferId);

        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId,
          streamOwnerId: this.currentUserId || "",
          type: "VOICE_OFFER",
          negotiationId: state.pendingOfferId,
          sdp: pc.localDescription?.toJSON() || offer,
        });
      });
    } catch (e) {
      console.error(`[VoiceMesh] 发起呼叫至 ${targetId} 失败:`, e);
    }
  }

  private getOrCreatePeerConnection(peerId: string): RTCPeerConnection {
    let pc = this.peerConnections.get(peerId);
    if (pc) return pc;

    sframeManager.assertReady();
    const e2eeEnabled = sframeManager.getStats().enabled;
    if (!e2eeEnabled || !sframeManager.hasActiveContext) {
      throw new Error("E2EE 密钥未就绪，禁止建立私信音视频连接");
    }

    pc = new RTCPeerConnection({
      iceServers: this.currentIceServers,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      ...(e2eeEnabled ? { encodedInsertableStreams: true } : {}),
    } as RTCConfiguration);
    this.setPeerReport(peerId, {
      rtt: 0,
      connectionType: "P2P",
      status: "connecting",
    });
    const encryptedVideoReceivers = new WeakSet<RTCRtpReceiver>();

    try {
      // 加密管线必须在 SDP 协商和摄像头轨道热插拔之前完成挂载。
      if (this.localAudioTrack) {
        const sender = pc.addTrack(this.localAudioTrack);
        if (e2eeEnabled) sframeManager.attachSender(sender);
      }

      // 预置双向视频 Transceiver，实现统一 PeerConnection 热插拔。
      const videoTransceiver = pc.addTransceiver("video", {
        direction: "sendrecv",
      });
      if (e2eeEnabled) {
        sframeManager.attachSender(videoTransceiver.sender);
        sframeManager.attachReceiver(videoTransceiver.receiver);
        encryptedVideoReceivers.add(videoTransceiver.receiver);
      }
      if (videoTransceiver.sender) {
        this.videoSenders.set(peerId, videoTransceiver.sender);
        if (this.localVideoTrack) {
          void videoTransceiver.sender
            .replaceTrack(this.localVideoTrack)
            .catch((err) => {
              if (!this.isCurrentPeer(peerId, pc!)) return;
              console.error(
                `[VoiceMesh] 初始视频轨道绑定失败 (${peerId}):`,
                err,
              );
              this.closePeer(peerId);
            });
        }
      }
    } catch (err) {
      this.audioQuality.delete(peerId);
      this.videoSenders.delete(peerId);
      if (e2eeEnabled) {
        sframeManager.detachPeerConnection(pc);
        pc.close();
        throw err;
      }
      console.warn(`[VoiceMesh] 预置视频 Transceiver 异常 (${peerId}):`, err);
    }

    // 处理 ICE candidate (包含 IPv4 与 IPv6 双栈候选)
    pc.onicecandidate = (event) => {
      if (!this.isCurrentPeer(peerId, pc!)) return;
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

    // 监听远端音视频流
    pc.ontrack = (event) => {
      if (!this.isCurrentPeer(peerId, pc!)) return;
      if (!sframeManager.hasActiveContext) {
        this.closePeer(peerId);
        return;
      }
      if (event.track.kind === "audio") {
        try {
          if (e2eeEnabled) sframeManager.attachReceiver(event.receiver);
        } catch (err) {
          console.error(`[VoiceMesh] 音频解密管线挂载失败 (${peerId}):`, err);
          this.closePeer(peerId);
          return;
        }
        const remoteStream = event.streams[0] || new MediaStream([event.track]);
        this.attachRemoteAudio(peerId, remoteStream);
      } else if (event.track.kind === "video") {
        // 远端可能协商额外的视频 receiver；每个都必须先挂载解密管线。
        if (e2eeEnabled && !encryptedVideoReceivers.has(event.receiver)) {
          try {
            sframeManager.attachReceiver(event.receiver);
            encryptedVideoReceivers.add(event.receiver);
          } catch (err) {
            console.error(`[VoiceMesh] 视频解密管线挂载失败 (${peerId}):`, err);
            this.closePeer(peerId);
            return;
          }
        }
        console.log(`[VoiceMesh] 收到节点 ${peerId} 的远端摄像头视频轨道`);
        this.remoteCameraTracks.set(peerId, event.track);
        this.notifyCameraTracksChange();
        event.track.onended = () => {
          if (!this.isCurrentPeer(peerId, pc!)) return;
          this.remoteCameraTracks.delete(peerId);
          this.notifyCameraTracksChange();
        };
        event.track.onmute = () => {
          if (!this.isCurrentPeer(peerId, pc!)) return;
          this.notifyCameraTracksChange();
        };
        event.track.onunmute = () => {
          if (!this.isCurrentPeer(peerId, pc!)) return;
          this.notifyCameraTracksChange();
        };
      }
    };

    pc.onconnectionstatechange = () => {
      if (!this.isCurrentPeer(peerId, pc!)) return;
      const state = pc?.connectionState;
      if (state === "connected") {
        this.hasConnectedPeer = true;
        const hsTimer = this.handshakeTimers.get(peerId);
        if (hsTimer) {
          clearTimeout(hsTimer);
          this.handshakeTimers.delete(peerId);
        }
        const retryInfo = this.peerRetries.get(peerId);
        if (retryInfo?.timer) clearTimeout(retryInfo.timer);
        this.peerRetries.delete(peerId);
        this.setPeerReport(peerId, { status: "connected" });
      } else if (state === "disconnected" || state === "failed") {
        this.scheduleHolePunchRetry(peerId);
      } else if (state === "closed") {
        this.closePeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (!this.isCurrentPeer(peerId, pc!)) return;
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
  public scheduleHolePunchRetry(peerId: string): void {
    if (!this.isMeshActive) return;

    // 守卫 1：若该节点已不在当前频道在线成员集合中，直接关闭并清理
    if (!this.channelMemberIds.has(peerId)) {
      console.log(
        `[VoiceMesh] 节点 ${peerId} 已不在当前语音频道，跳过打洞重试调度并清理`,
      );
      this.closePeer(peerId);
      return;
    }

    // 守卫 2：若当前频道内已无对端成员（单人留守），保持纯 P2P 待命
    if (this.channelMemberIds.size === 0) {
      console.log(
        `[VoiceMesh] 当前频道内仅剩当前用户，保持纯 P2P 待命，跳过打洞重试`,
      );
      return;
    }

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
      this.closePeer(peerId, { preserveReport: true });
      this.setPeerReport(peerId, { status: "failed" });
      // Mesh 中任何一个终态失败都会形成失语分区。无论此前是否曾连接
      // 成功，都应触发整个本地 Mesh 的 SFU 降级评估。
      this.triggerFallbackToSFU("P2P 网状打洞经 3 次重试失败，正在切换至 SFU");
      return;
    }

    retryInfo.attempts++;
    retryInfo.inProgress = true;
    this.setPeerReport(peerId, { status: "connecting" });
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
    if (
      !pc ||
      pc.connectionState === "connected" ||
      !this.isMeshActive ||
      !this.channelMemberIds.has(peerId) ||
      this.channelMemberIds.size === 0
    ) {
      if (retryInfo) retryInfo.inProgress = false;
      return;
    }

    try {
      console.info(
        `[VoiceMesh] 正在执行针对 ${peerId} 的打洞重试 (第 ${attempt}/3 次 ICE Restart)...`,
      );
      await this.negotiatePeer(peerId, pc, async (state) => {
        if (pc.connectionState === "connected") return;
        if (pc.signalingState === "have-local-offer") {
          await pc.setLocalDescription({ type: "rollback" });
          if (!this.isCurrentPeer(peerId, pc)) return;
        }
        if (pc.signalingState !== "stable") return;
        state.pendingOfferId = crypto.randomUUID();
        state.ignoreOffer = false;
        if (typeof pc.restartIce === "function") {
          pc.restartIce();
        }
        const offer = await pc.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        if (!this.isCurrentPeer(peerId, pc)) return;
        await pc.setLocalDescription(tuneOpusDescription(offer));
        if (!this.isCurrentPeer(peerId, pc)) return;

        this.armHandshake(peerId, pc, state.pendingOfferId);

        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: peerId,
          streamOwnerId: this.currentUserId || "",
          type: "VOICE_OFFER",
          negotiationId: state.pendingOfferId,
          sdp: pc.localDescription?.toJSON() || offer,
        });
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

    // 挂接 Web Audio AnalyserNode 进行实时说话能量检测（仅旁路分析，不输出至 destination 以免与 audio 标签重复发声）
    this.setupRemoteAudioAnalysis(peerId, stream);
  }

  private async flushPendingCandidates(
    peerId: string,
    pc: RTCPeerConnection,
  ): Promise<void> {
    const queue = this.pendingCandidatesMap.get(peerId);
    if (queue && queue.length > 0) {
      this.pendingCandidatesMap.delete(peerId);
      for (const cand of queue) {
        if (!this.isCurrentPeer(peerId, pc)) return;
        if (!this.candidateMatchesRemote(pc, cand)) continue;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("[VoiceMesh] 排空 ICE candidate 失败:", e);
        }
      }
    }
  }

  public closePeer(peerId: string, options: { preserveReport?: boolean } = {}) {
    this.negotiations.delete(peerId);
    const retryInfo = this.peerRetries.get(peerId);
    if (retryInfo?.timer) clearTimeout(retryInfo.timer);
    this.peerRetries.delete(peerId);

    const hsTimer = this.handshakeTimers.get(peerId);
    if (hsTimer) {
      clearTimeout(hsTimer);
      this.handshakeTimers.delete(peerId);
    }
    const joinTimer = this.memberJoinTimers.get(peerId);
    if (joinTimer) {
      clearTimeout(joinTimer);
      this.memberJoinTimers.delete(peerId);
    }
    this.audioQuality.delete(peerId);
    this.videoSenders.delete(peerId);
    if (this.remoteCameraTracks.has(peerId)) {
      this.remoteCameraTracks.delete(peerId);
      this.notifyCameraTracksChange();
    }

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      this.peerConnections.delete(peerId);
      try {
        sframeManager.detachPeerConnection(pc);
        pc.close();
      } catch {}
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

    // 清理 Web Audio 能量分析节点
    const audioEntry = this.participantAudioMap.get(peerId);
    if (audioEntry?.sourceNode) {
      try {
        audioEntry.sourceNode.disconnect();
      } catch {}
    }
    this.participantAudioMap.delete(peerId);
    this.remoteSpeakingStates.delete(peerId);
    if (this.activeSpeakers.delete(peerId)) {
      this.notifyActiveSpeakersUpdate();
    }

    if (!options.preserveReport) this.latencyReports.delete(peerId);
    if (this.getConnectedPeersCount() === 0) {
      this.hasConnectedPeer = false;
    }
    this.notifyLatencyUpdate();
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (
      !this.sharedAudioContext ||
      this.sharedAudioContext.state === "closed"
    ) {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      this.sharedAudioContext = new AudioCtx();
    }
    if (this.sharedAudioContext.state === "suspended") {
      this.sharedAudioContext.resume().catch(() => {});
    }
    return this.sharedAudioContext;
  }

  private setupRemoteAudioAnalysis(peerId: string, stream: MediaStream) {
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const ctx = this.getOrCreateAudioContext();
      if (!ctx) return;

      const existing = this.participantAudioMap.get(peerId);
      if (existing?.sourceNode) {
        try {
          existing.sourceNode.disconnect();
        } catch {}
      }

      const sourceNode = ctx.createMediaStreamSource(stream);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.2;
      sourceNode.connect(analyserNode);

      this.participantAudioMap.set(peerId, {
        stream,
        sourceNode,
        analyserNode,
      });
      this.startRemoteAudioEnergyMonitoring();
    } catch (e) {
      console.warn(`[VoiceMesh] 为节点 ${peerId} 挂接音频能量分析器失败:`, e);
    }
  }

  private startRemoteAudioEnergyMonitoring() {
    if (this.remoteEnergyTimer) return;

    const sampleBuffer = new Uint8Array(128); // 256 / 2
    this.remoteEnergyTimer = setInterval(() => {
      if (!this.isMeshActive || this.participantAudioMap.size === 0) {
        if (this.participantAudioMap.size === 0) {
          this.stopRemoteAudioEnergyMonitoring();
        }
        return;
      }

      const now = Date.now();
      let hasChange = false;

      this.participantAudioMap.forEach((entry, peerId) => {
        let maxAvgEnergy = 0;
        if (entry.analyserNode) {
          try {
            entry.analyserNode.getByteFrequencyData(sampleBuffer);
            let sum = 0;
            for (let i = 0; i < sampleBuffer.length; i++) {
              sum += sampleBuffer[i];
            }
            maxAvgEnergy = sum / sampleBuffer.length;
          } catch {}
        }

        // 门限判断与平滑防抖算法（对齐 SFU 标准）:
        // 1. 指数移动平均 (EMA) 平滑滤波，消除频谱微小起伏
        // 2. 连续 2 帧 (约 70ms) 超过门限确认启动 (Attack)
        // 3. 释放滞后 (Hangover) 延长至 450ms
        const ENERGY_THRESHOLD = 6;
        const HANGOVER_MS = 450;

        let state = this.remoteSpeakingStates.get(peerId);
        if (!state) {
          state = {
            isSpeaking: false,
            lastActive: 0,
            consecutiveAbove: 0,
            smoothedEnergy: 0,
          };
          this.remoteSpeakingStates.set(peerId, state);
        }

        state.smoothedEnergy =
          state.smoothedEnergy === 0
            ? maxAvgEnergy
            : state.smoothedEnergy * 0.6 + maxAvgEnergy * 0.4;

        if (state.smoothedEnergy >= ENERGY_THRESHOLD) {
          state.consecutiveAbove++;
          if (state.consecutiveAbove >= 2) {
            state.lastActive = now;
            if (!state.isSpeaking) {
              state.isSpeaking = true;
              this.activeSpeakers.add(peerId);
              hasChange = true;
            }
          }
        } else {
          state.consecutiveAbove = 0;
          if (state.isSpeaking && now - state.lastActive > HANGOVER_MS) {
            state.isSpeaking = false;
            this.activeSpeakers.delete(peerId);
            hasChange = true;
          }
        }
      });

      if (hasChange) {
        this.notifyActiveSpeakersUpdate();
      }
    }, 35);
  }

  private stopRemoteAudioEnergyMonitoring() {
    if (this.remoteEnergyTimer) {
      clearInterval(this.remoteEnergyTimer);
      this.remoteEnergyTimer = null;
    }
  }

  private notifyActiveSpeakersUpdate() {
    const list = Array.from(this.activeSpeakers);
    for (const cb of this.activeSpeakersCallbacks) {
      try {
        cb(list);
      } catch (e) {
        console.warn("[VoiceMesh] onActiveSpeakersChange 回调异常:", e);
      }
    }
  }

  private setPeerReport(
    peerId: string,
    patch: Partial<Omit<PeerLatencyReport, "targetUserId" | "updatedAt">>,
  ): void {
    const previous = this.latencyReports.get(peerId);
    this.latencyReports.set(peerId, {
      targetUserId: peerId,
      rtt: previous?.rtt ?? 0,
      jitter: previous?.jitter,
      packetLoss: previous?.packetLoss,
      connectionType: previous?.connectionType ?? "P2P",
      status: previous?.status ?? "connecting",
      ...patch,
      updatedAt: Date.now(),
    });
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
          const quality = this.audioQualitySampler.sample(stat);
          if (quality.packetLossPercent !== undefined)
            packetLoss = `${quality.packetLossPercent.toFixed(1)}%`;
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
      bufferLength:
        this.audioQuality.get(peerId)?.[0]?.jitterBufferDelayMs !== undefined
          ? `${this.audioQuality.get(peerId)![0].jitterBufferDelayMs!.toFixed(1)}ms`
          : "未知",
      audioReceiveQuality: this.getAudioQuality(peerId),
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
          const trackQuality: AudioReceiveQuality[] = [];
          let connectionType: "LAN" | "P2P" | "RELAY" = "P2P";

          let selectedPairId = "";
          stats.forEach((report) => {
            if (report.type === "transport" && report.selectedCandidatePairId) {
              selectedPairId = report.selectedCandidatePairId;
            }
          });

          let selectedPair: RTCStats | null = null;
          stats.forEach((report) => {
            if (
              report.type === "candidate-pair" &&
              (selectedPairId
                ? report.id === selectedPairId
                : report.nominated && report.state === "succeeded")
            ) {
              selectedPair = report;
              if (typeof report.currentRoundTripTime === "number") {
                rttMs = Math.round(report.currentRoundTripTime * 1000);
              }
            }
            if (report.type === "inbound-rtp" && report.kind === "audio") {
              if (typeof report.jitter === "number") {
                jitterMs = Math.round(report.jitter * 1000);
              }
              const quality = this.audioQualitySampler.sample(report);
              trackQuality.push(quality);
              packetLoss = quality.packetLossPercent;
              const receiver = pc
                .getReceivers()
                .find(
                  (item) =>
                    item.track.kind === "audio" &&
                    (!report.trackIdentifier ||
                      item.track.id === report.trackIdentifier),
                );
              if (receiver) adaptReceiverBuffer(receiver, quality);
            }
            if (
              report.type === "remote-inbound-rtp" &&
              report.kind === "audio"
            ) {
              // Adapt the uplink from the peer's feedback, never from unrelated downlink loss.
              let uplinkLoss: number | undefined;
              const outbound = report.localId
                ? stats.get(report.localId)
                : undefined;
              if (outbound && typeof report.packetsLost === "number") {
                const sent = outbound.packetsSent || 0;
                uplinkLoss = this.audioQualitySampler.sample({
                  id: `uplink:${peerId}:${report.id}`,
                  timestamp: report.timestamp,
                  packetsReceived: Math.max(0, sent - report.packetsLost),
                  packetsLost: report.packetsLost,
                  bytesReceived: outbound.bytesSent || 0,
                }).packetLossPercent;
              } else if (typeof report.fractionLost === "number")
                uplinkLoss =
                  Math.max(0, Math.min(1, report.fractionLost)) * 100;
              for (const sender of pc.getSenders())
                void adaptOpusSender(sender, uplinkLoss);
            }
          });

          if (selectedPair) {
            const pair = selectedPair as RTCStats & {
              localCandidateId?: string;
              remoteCandidateId?: string;
            };
            const localCandidate = pair.localCandidateId
              ? stats.get(pair.localCandidateId)
              : undefined;
            const remoteCandidate = pair.remoteCandidateId
              ? stats.get(pair.remoteCandidateId)
              : undefined;
            const localType = localCandidate?.candidateType;
            const remoteType = remoteCandidate?.candidateType;
            if (localType === "relay" || remoteType === "relay") {
              connectionType = "RELAY";
            } else if (localType === "host" && remoteType === "host") {
              connectionType = "LAN";
            }
          }

          this.audioQuality.set(peerId, trackQuality);
          this.latencyReports.set(peerId, {
            targetUserId: peerId,
            rtt: rttMs,
            jitter: jitterMs,
            packetLoss,
            connectionType,
            status: "connected",
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
