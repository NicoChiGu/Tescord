import {
  StreamTransmissionMode,
  VideoCodecType,
  P2PSignalPayload,
  P2PTopologyUpdatePayload,
  P2PNetworkDiagnostics,
  P2PNodeMetrics,
  GatewayEvents,
  GatewayOpCode,
  NATType,
  StreamDetailedStats,
  ConnectionTopology,
} from "@tescord/types";
import { NATDetector, NATDetectionResult } from "./NATDetector.js";
import { gatewayClient } from "../gateway.js";
import { bitrateCalculator } from "../stats/BitrateCalculator.js";
import { sframeManager } from "../sframe.js";
import { getP2PIceServers } from "./iceServers.js";

export type StreamChangeCallback = (
  stream: MediaStream | null,
  ownerId: string,
) => void;
export type FallbackCallback = (reason: string) => void;

export class P2PStreamManager {
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  private activeChannelId: string | null = null;
  private activeGuildId: string | null = null;
  private currentUserId: string | null = null;
  private streamOwnerId: string | null = null;
  private transmissionMode: StreamTransmissionMode = "sfu";
  private targetVideoCodec: VideoCodecType = "h264";
  private targetBitrate: number | null = null;

  private currentParentId: string | null = null;
  private currentChildrenIds: string[] = [];

  // 动态 ICE 服务器 (双栈 STUN + Coturn TURN)
  private currentIceServers: RTCIceServer[] = [];

  // targetUserId -> 打洞重试状态追踪
  private peerRetries: Map<
    string,
    { attempts: number; timer?: any; inProgress: boolean }
  > = new Map();

  // peerId -> RTCPeerConnection
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  // peerId -> 早期到达的待处理 ICE 候选队列 (Buffer Queue)
  private pendingCandidatesMap: Map<string, RTCIceCandidateInit[]> = new Map();

  private streamChangeListeners: Set<StreamChangeCallback> = new Set();
  private fallbackListeners: Set<FallbackCallback> = new Set();

  private natInfo: NATDetectionResult | null = null;
  private iceConnectionCheckTimer: any = null;
  private upnpMappedPort: number | null = null;

  constructor() {
    // 异步预热 NAT 检测
    NATDetector.detect().then((res) => {
      this.natInfo = res;
    });
  }

  /**
   * 动态拉取服务端 Coturn TURN 与双栈 STUN 列表
   */
  public async fetchIceServers(forceRefresh = false): Promise<RTCIceServer[]> {
    this.currentIceServers = await getP2PIceServers(forceRefresh);
    return [...this.currentIceServers];
  }

  public setContext(userId: string | null) {
    if (this.currentUserId && this.currentUserId !== userId) this.stopAll();
    this.currentUserId = userId;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  public getStreamOwnerId(): string | null {
    return this.streamOwnerId;
  }

  public getActiveChannelId(): string | null {
    return this.activeChannelId;
  }

  public isBroadcasting(channelId?: string): boolean {
    if (!this.localStream) return false;
    if (!this.currentUserId || this.streamOwnerId !== this.currentUserId)
      return false;
    if (channelId && this.activeChannelId !== channelId) return false;
    return true;
  }

  public onStreamChange(cb: StreamChangeCallback): () => void {
    this.streamChangeListeners.add(cb);
    if (this.localStream && this.currentUserId) {
      cb(this.localStream, this.currentUserId);
    } else if (this.remoteStream && this.streamOwnerId) {
      cb(this.remoteStream, this.streamOwnerId);
    }
    return () => {
      this.streamChangeListeners.delete(cb);
    };
  }

  public onFallbackNeeded(cb: FallbackCallback): () => void {
    this.fallbackListeners.add(cb);
    return () => {
      this.fallbackListeners.delete(cb);
    };
  }

  /**
   * 主播发起 P2P 推流
   */
  public async startBroadcasting(
    channelId: string,
    guildId: string,
    stream: MediaStream,
    mode: "p2p_direct" | "p2p_relay",
    videoCodec: VideoCodecType = "h264",
    customBitrate?: number,
  ): Promise<void> {
    this.stopAll();

    // The broadcaster creates the real PeerConnections after viewers request
    // the stream, so it must load ICE before advertising availability. NAT
    // probing uses a separate temporary connection and cannot configure these
    // media PeerConnections for us.
    await this.fetchIceServers();

    this.activeChannelId = channelId;
    this.activeGuildId = guildId;
    this.streamOwnerId = this.currentUserId;
    this.transmissionMode = mode;
    this.localStream = stream;
    this.targetVideoCodec = videoCodec;
    this.targetBitrate = customBitrate || null;

    // 当底层硬件轨意外中断或用户在系统栏停止时，联动释放
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        this.stopAll();
      };
    }

    // 立即通知监听器：主播本地画面就绪
    for (const cb of this.streamChangeListeners) {
      cb(this.localStream, this.currentUserId || "");
    }

    console.info(`🚀 P2PStreamManager 主播推流已就绪 [模式: ${mode}]`);
  }

  /**
   * 观众进入并准备拉取 P2P 直播流
   */
  public async joinStream(
    channelId: string,
    guildId: string,
    streamOwnerId: string,
    mode: StreamTransmissionMode,
  ): Promise<void> {
    if (this.streamOwnerId === this.currentUserId && this.localStream) {
      return; // 自身是主播，忽略
    }

    // 防重入：若已经连入相同频道和主播，且连接正常或正在握手，直接复用，避免连接被反复掐死
    if (
      this.activeChannelId === channelId &&
      this.streamOwnerId === streamOwnerId &&
      (this.remoteStream || this.peerConnections.size > 0)
    ) {
      return;
    }

    this.stopAll();

    this.activeChannelId = channelId;
    this.activeGuildId = guildId;
    this.streamOwnerId = streamOwnerId;
    this.transmissionMode = mode;

    await this.fetchIceServers();

    if (!this.natInfo) {
      this.natInfo = await NATDetector.detect();
    }

    // 上报自身加入与网络质量指标
    const initialMetrics: P2PNodeMetrics = {
      userId: this.currentUserId || "unknown",
      natType: this.natInfo.natType,
      hasIPv6: this.natInfo.hasIPv6,
      rtt: 35,
      packetLoss: 0,
      downstreamCount: 0,
      maxDownstream: 2,
    };

    gatewayClient.sendRaw({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.P2P_TOPOLOGY_UPDATE,
      d: {
        channelId,
        initialMetrics,
      },
    });

    // 主动向主播发送 REQUEST_STREAM 信令，确保主播收到后主动发起 Offer
    this.sendSignal({
      guildId,
      channelId,
      senderId: this.currentUserId || "",
      targetId: streamOwnerId,
      streamOwnerId,
      type: "REQUEST_STREAM",
    });

    // 启动 5 秒连接看门狗：若超时未连通且无媒体流，触发打洞重试机制
    clearTimeout(this.iceConnectionCheckTimer);
    this.iceConnectionCheckTimer = setTimeout(() => {
      if (!this.remoteStream || this.remoteStream.getTracks().length === 0) {
        console.warn("⚠️ P2P 直连等待超时，触发打洞重试机制");
        this.scheduleHolePunchRetry(streamOwnerId);
      }
    }, 5000);
  }

  /**
   * 接收服务端拓扑更新广播
   */
  public async handleTopologyUpdate(
    payload: P2PTopologyUpdatePayload,
  ): Promise<void> {
    if (!this.currentUserId || payload.channelId !== this.activeChannelId)
      return;

    this.transmissionMode = payload.transmissionMode;
    const myNode = payload.nodes[this.currentUserId];
    if (!myNode) return;

    const newParentId = myNode.parentId;
    const newChildrenIds = myNode.childrenIds || [];

    // 1. 父节点发生变化（切源或被分配到新中继节点）
    if (newParentId !== this.currentParentId) {
      if (this.currentParentId) {
        this.closePeerConnection(this.currentParentId);
      }
      this.currentParentId = newParentId;

      if (newParentId && this.currentUserId !== this.streamOwnerId) {
        // 向新父节点主动索取推流 Offer
        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: newParentId,
          streamOwnerId: this.streamOwnerId || "",
          type: "REQUEST_STREAM",
        });
      }
    }

    // 2. 子节点变化（我是主播或接力节点，需要向新子节点供流）
    const removedChildren = this.currentChildrenIds.filter(
      (id) => !newChildrenIds.includes(id),
    );
    for (const id of removedChildren) {
      this.closePeerConnection(id);
    }

    const addedChildren = newChildrenIds.filter(
      (id) => !this.currentChildrenIds.includes(id),
    );
    this.currentChildrenIds = newChildrenIds;

    // 对新增的子节点，若当前自身持有媒体流，主动向其发起 Offer
    if (this.localStream || this.remoteStream) {
      for (const childId of addedChildren) {
        await this.sendOfferToChild(childId);
      }
    }
  }

  /**
   * 供流方（主播或接力节点）主动向子节点建立连接并发送 Offer
   */
  private async sendOfferToChild(childId: string): Promise<void> {
    const streamToOffer = this.localStream || this.remoteStream;
    if (!streamToOffer) return;

    const pc = this.getOrCreatePeerConnection(childId);
    const senders = pc.getSenders();

    for (const track of streamToOffer.getTracks()) {
      const alreadyAdded = senders.some((s) => s.track?.id === track.id);
      if (!alreadyAdded) {
        const sender = pc.addTrack(track, streamToOffer);
        if (sframeManager.getStats().enabled)
          sframeManager.attachSender(sender);
      }
    }

    // 1. 设置目标视频编解码器优先级 (优先使用用户选择的 H.264 / AV1 / H.265 / VP9，打破 Chromium 默认锁定 VP8)
    const videoTransceiver = pc
      .getTransceivers()
      .find(
        (t) =>
          t.sender.track?.kind === "video" ||
          t.receiver.track?.kind === "video",
      );
    if (videoTransceiver && "setCodecPreferences" in videoTransceiver) {
      if (
        typeof RTCRtpSender !== "undefined" &&
        typeof RTCRtpSender.getCapabilities === "function"
      ) {
        const caps = RTCRtpSender.getCapabilities("video");
        if (caps?.codecs) {
          const targetMime = `video/${this.targetVideoCodec.toLowerCase()}`;
          const matched = caps.codecs.filter(
            (c) => c.mimeType.toLowerCase() === targetMime,
          );
          const others = caps.codecs.filter(
            (c) => c.mimeType.toLowerCase() !== targetMime,
          );
          if (matched.length > 0) {
            try {
              videoTransceiver.setCodecPreferences([...matched, ...others]);
            } catch (err) {
              console.warn("P2P setCodecPreferences error:", err);
            }
          }
        }
      }
    }

    // 2. 限制推流目标码率 (maxBitrate)
    if (this.targetBitrate) {
      const videoSender = pc
        .getSenders()
        .find((s) => s.track?.kind === "video");
      if (videoSender) {
        try {
          const params = videoSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = this.targetBitrate;
          await videoSender.setParameters(params);
        } catch (e) {
          console.warn("P2P setParameters maxBitrate failed:", e);
        }
      }
    }

    try {
      if (pc.signalingState !== "stable") {
        await new Promise<void>((resolve) => {
          const handler = () => {
            if (pc.signalingState === "stable") {
              pc.removeEventListener("signalingstatechange", handler);
              resolve();
            }
          };
          pc.addEventListener("signalingstatechange", handler);
          setTimeout(() => {
            pc.removeEventListener("signalingstatechange", handler);
            resolve();
          }, 1500);
        });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignal({
        guildId: this.activeGuildId || "",
        channelId: this.activeChannelId || "",
        senderId: this.currentUserId || "",
        targetId: childId,
        streamOwnerId: this.streamOwnerId || "",
        type: "OFFER",
        sdp: offer,
      });
    } catch (e) {
      console.error(`Failed to create offer for child ${childId}:`, e);
    }
  }

  /**
   * 处理端到端 P2P 信令 (Offer / Answer / ICE Candidate / REQUEST_STREAM)
   */
  public async handleP2PSignal(signal: P2PSignalPayload): Promise<void> {
    const { senderId, type, sdp, candidate } = signal;

    if (type === "REQUEST_STREAM") {
      // 收到下游子节点的推流请求，主动向其发起 Offer
      const streamToOffer = this.localStream || this.remoteStream;
      if (streamToOffer) {
        await this.sendOfferToChild(senderId);
      }
    } else if (type === "OFFER" && sdp) {
      // 观众端（或接力节点）收到供流方发来的媒体 Offer
      const pc = this.getOrCreatePeerConnection(senderId);

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        // 应用排队中的候选
        await this.flushPendingCandidates(senderId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: senderId,
          streamOwnerId: this.streamOwnerId || "",
          type: "ANSWER",
          sdp: answer,
        });
      } catch (e) {
        console.error(`Failed to handle OFFER from ${senderId}:`, e);
      }
    } else if (type === "ANSWER" && sdp) {
      // 供流方收到下游回复的 Answer
      const pc = this.peerConnections.get(senderId);
      if (pc && pc.signalingState === "have-local-offer") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await this.flushPendingCandidates(senderId, pc);
        } catch (e) {
          console.error(`Failed to set remote answer from ${senderId}:`, e);
        }
      }
    } else if (type === "ICE_CANDIDATE" && candidate) {
      const pc = this.peerConnections.get(senderId);
      if (!pc || !pc.remoteDescription) {
        // remoteDescription 未就绪前，放入缓冲队列排队
        if (!this.pendingCandidatesMap.has(senderId)) {
          this.pendingCandidatesMap.set(senderId, []);
        }
        this.pendingCandidatesMap.get(senderId)!.push(candidate);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn("Failed to add ICE candidate directly:", e);
        }
      }
    }
  }

  /**
   * 清空并执行排队的早期 ICE 候选
   */
  private async flushPendingCandidates(
    peerId: string,
    pc: RTCPeerConnection,
  ): Promise<void> {
    const queue = this.pendingCandidatesMap.get(peerId);
    if (!queue || queue.length === 0) return;
    this.pendingCandidatesMap.delete(peerId);

    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn("Error applying flushed ICE candidate:", e);
      }
    }
  }

  /**
   * 停止当前所有推拉流与连接
   */
  public stopAll(): void {
    clearTimeout(this.iceConnectionCheckTimer);

    // 清理所有打洞重试定时器
    for (const info of this.peerRetries.values()) {
      if (info.timer) clearTimeout(info.timer);
    }
    this.peerRetries.clear();

    for (const pc of this.peerConnections.values()) {
      try {
        pc.close();
      } catch {}
    }
    this.peerConnections.clear();
    this.pendingCandidatesMap.clear();

    if (
      this.upnpMappedPort &&
      typeof window !== "undefined" &&
      window.electronAPI?.network?.unmapPort
    ) {
      window.electronAPI.network
        .unmapPort(this.upnpMappedPort, "UDP")
        .catch(() => {});
      this.upnpMappedPort = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
    }

    const previousOwner = this.streamOwnerId || this.currentUserId || "";
    this.localStream = null;
    this.remoteStream = null;
    this.currentParentId = null;
    this.currentChildrenIds = [];
    this.activeChannelId = null;
    this.streamOwnerId = null;

    if (previousOwner) {
      for (const cb of this.streamChangeListeners) {
        cb(null, previousOwner);
      }
    }
  }

  /**
   * 获取当前连接的实时网络诊断信息
   */
  public async getDiagnostics(): Promise<P2PNetworkDiagnostics> {
    if (!this.natInfo) {
      this.natInfo = await NATDetector.detect();
    }

    let rtt: number | undefined;
    let packetLoss: number | undefined;
    let activePair: any = undefined;

    // 统计与父节点或首个子节点的 PeerConnection 诊断
    const targetId = this.currentParentId || this.currentChildrenIds[0];
    if (targetId) {
      const pc = this.peerConnections.get(targetId);
      if (pc) {
        try {
          const stats = await pc.getStats();
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
                rtt = Math.round(report.currentRoundTripTime * 1000);
              }
            }
            if (report.type === "inbound-rtp" && report.kind === "video") {
              const lost = report.packetsLost || 0;
              const total = (report.packetsReceived || 0) + lost;
              if (total > 0) {
                packetLoss = Number((lost / total).toFixed(3));
              }
            }
            if (
              report.type === "candidate-pair" &&
              (selectedPairId
                ? report.id === selectedPairId
                : report.nominated && report.state === "succeeded")
            ) {
              const localCand = stats.get(report.localCandidateId);
              const remoteCand = stats.get(report.remoteCandidateId);
              if (localCand && remoteCand) {
                activePair = {
                  localCandidateType: localCand.candidateType,
                  remoteCandidateType: remoteCand.candidateType,
                  protocol: localCand.protocol,
                  localAddress: localCand.ip || localCand.address,
                  remoteAddress: remoteCand.ip || remoteCand.address,
                };
              }
            }
          });
        } catch {}
      }
    }

    return {
      transmissionMode: this.transmissionMode,
      natType: this.natInfo.natType,
      hasIPv6: this.natInfo.hasIPv6,
      rtt,
      packetLoss,
      activeCandidatePair: activePair,
      downstreamPeersCount: this.currentChildrenIds.length,
    };
  }

  private getOrCreatePeerConnection(peerId: string): RTCPeerConnection {
    let pc = this.peerConnections.get(peerId);
    if (pc) return pc;

    pc = new RTCPeerConnection({
      iceServers: this.currentIceServers,
      iceCandidatePoolSize: 2,
      ...(sframeManager.getStats().enabled
        ? { encodedInsertableStreams: true }
        : {}),
    } as RTCConfiguration);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: peerId,
          streamOwnerId: this.streamOwnerId || "",
          type: "ICE_CANDIDATE",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc?.iceConnectionState;
      console.info(`[P2P ICE: ${peerId}] State: ${state}`);
      if (state === "connected") {
        clearTimeout(this.iceConnectionCheckTimer);
        const retryInfo = this.peerRetries.get(peerId);
        if (retryInfo?.timer) clearTimeout(retryInfo.timer);
        this.peerRetries.delete(peerId);
      } else if (state === "failed" || state === "disconnected") {
        this.scheduleHolePunchRetry(peerId);
      }
    };

    pc.ontrack = (event) => {
      if (sframeManager.getStats().enabled)
        sframeManager.attachReceiver(event.receiver);
      console.info("🎉 收到远程媒体轨:", event.track.kind);
      const incomingStream = event.streams[0] || new MediaStream([event.track]);
      this.remoteStream = incomingStream;

      clearTimeout(this.iceConnectionCheckTimer);

      for (const cb of this.streamChangeListeners) {
        cb(this.remoteStream, this.streamOwnerId || peerId);
      }

      // 如果当前是接力模式且有下游子节点，把新到达的 Track 自动中继给下游
      if (
        this.transmissionMode === "p2p_relay" &&
        this.currentChildrenIds.length > 0
      ) {
        this.relayTrackToChildren(event.track, incomingStream);
      }
    };

    this.peerConnections.set(peerId, pc);
    return pc;
  }

  /**
   * 规划 P2P 直播流打洞重试 (最多 3 次，指数退避 1.2s -> 2.5s -> 4s)
   */
  private scheduleHolePunchRetry(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (!pc || pc.iceConnectionState === "connected") return;

    let retryInfo = this.peerRetries.get(peerId);
    if (!retryInfo) {
      retryInfo = { attempts: 0, inProgress: false };
      this.peerRetries.set(peerId, retryInfo);
    }

    if (retryInfo.inProgress) return;

    const MAX_RETRIES = 3;
    if (retryInfo.attempts >= MAX_RETRIES) {
      console.warn(
        `[P2PStream] Peer ${peerId} 经历 ${MAX_RETRIES} 次打洞重试均失败，触发回退询问`,
      );
      this.notifyFallback(
        "P2P 直连打洞经 3 次重试均失败，双方可能处于对称型 NAT 或防火墙拦截，建议降级至 SFU 服务端",
      );
      return;
    }

    retryInfo.attempts++;
    retryInfo.inProgress = true;
    const backoffDelays = [1200, 2500, 4000];
    const delay = backoffDelays[retryInfo.attempts - 1] || 3000;

    console.info(
      `[P2PStream] 正在为节点 ${peerId} 安排第 ${retryInfo.attempts}/${MAX_RETRIES} 次打洞重试 (${delay}ms 后启动 ICE Restart)...`,
    );

    if (retryInfo.timer) clearTimeout(retryInfo.timer);
    retryInfo.timer = setTimeout(async () => {
      await this.executeIceRestart(peerId, retryInfo!.attempts);
    }, delay);
  }

  private async executeIceRestart(
    peerId: string,
    attempt: number,
  ): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    const retryInfo = this.peerRetries.get(peerId);
    if (!pc || pc.iceConnectionState === "connected") {
      if (retryInfo) retryInfo.inProgress = false;
      return;
    }

    try {
      console.info(
        `[P2PStream] 正在执行针对 ${peerId} 的打洞重试 (第 ${attempt}/3 次 ICE Restart)...`,
      );
      if (typeof pc.restartIce === "function") {
        pc.restartIce();
      }
      if (this.localStream) {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: peerId,
          streamOwnerId: this.streamOwnerId || this.currentUserId || "",
          type: "OFFER",
          sdp: offer,
        });
      } else {
        this.sendSignal({
          guildId: this.activeGuildId || "",
          channelId: this.activeChannelId || "",
          senderId: this.currentUserId || "",
          targetId: peerId,
          streamOwnerId: this.streamOwnerId || "",
          type: "REQUEST_STREAM",
        });
      }
    } catch (e) {
      console.warn(`[P2PStream] 对节点 ${peerId} 执行 ICE Restart 失败:`, e);
    } finally {
      if (retryInfo) retryInfo.inProgress = false;
    }
  }

  private async relayTrackToChildren(
    _track: MediaStreamTrack,
    _fullStream: MediaStream,
  ): Promise<void> {
    for (const childId of this.currentChildrenIds) {
      try {
        await this.sendOfferToChild(childId);
      } catch (err) {
        console.error(
          `[P2PStream] relayTrackToChildren to child ${childId} failed:`,
          err,
        );
      }
    }
  }

  private closePeerConnection(peerId: string): void {
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
  }

  private sendSignal(signal: P2PSignalPayload): void {
    gatewayClient.sendRaw({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.P2P_SIGNAL,
      d: signal,
    });
  }

  private notifyFallback(reason: string): void {
    for (const cb of this.fallbackListeners) {
      cb(reason);
    }
  }

  public getTargetVideoCodec(): VideoCodecType {
    return this.targetVideoCodec;
  }

  /**
   * 获取 P2P 直播或接力流的详细媒体属性与实时统计
   */
  public async getP2PStreamDetailedStats(
    peerId?: string,
  ): Promise<StreamDetailedStats | null> {
    const targetPeerId = peerId || this.streamOwnerId || "";
    const isPublisher = Boolean(this.localStream);
    const pc =
      this.peerConnections.get(targetPeerId) ||
      (isPublisher ? this.peerConnections.values().next().value : undefined);

    let rtt = "N/A";
    let jitter = "N/A";
    let packetLoss = "N/A";
    let streamHost = "未知";
    let protocol = "未知";
    let ipVersion: "IPv4" | "IPv6" | undefined;
    let candidateType: "host" | "srflx" | "prflx" | "relay" | undefined;
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let decodedFrames = "N/A";
    let videoInfo = "未知";
    let encoder = "浏览器 WebRTC 媒体管线";
    let actualSendCodec: string | undefined;
    let actualReceiveCodec: string | undefined;
    let selectedPairFound = false;

    const retryInfo = this.peerRetries.get(targetPeerId);
    const holePunchStatus =
      pc?.iceConnectionState === "connected"
        ? "P2P 直连打洞已连通"
        : retryInfo && retryInfo.attempts > 0
          ? `打洞重试中 (${retryInfo.attempts}/3)`
          : `正在建立打洞连接 (${pc?.iceConnectionState || "checking"})`;

    if (pc) {
      try {
        const report = await pc.getStats();
        let selectedPairId = "";
        report.forEach((stat: any) => {
          if (stat.type === "transport" && stat.selectedCandidatePairId) {
            selectedPairId = stat.selectedCandidatePairId;
          }
        });

        const formatCodecLabel = (
          codec: any,
          kind: "video" | "audio" = "video",
        ) => {
          if (!codec || !codec.mimeType) return "";
          const name = codec.mimeType
            .replace(/^(video|audio)\//i, "")
            .toUpperCase();
          if (kind === "video") {
            const sub: string[] = [];
            if (codec.payloadType !== undefined)
              sub.push(String(codec.payloadType));
            if (codec.sdpFmtpLine) sub.push(codec.sdpFmtpLine);
            return sub.length > 0 ? `${name} (${sub.join(", ")})` : name;
          } else {
            const parts: string[] = [];
            if (codec.clockRate)
              parts.push(`${Math.round(codec.clockRate / 1000)}kHz`);
            if (codec.channels) parts.push(`${codec.channels}ch`);
            if (codec.payloadType !== undefined)
              parts.push(`PT:${codec.payloadType}`);
            return parts.length > 0 ? `${name} (${parts.join(", ")})` : name;
          }
        };

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
          }

          if (
            stat.type === "inbound-rtp" &&
            stat.kind === "video" &&
            !stat.isRemote
          ) {
            const codec = stat.codecId ? report.get(stat.codecId) : null;
            if (
              codec?.mimeType &&
              !/rtx|red|ulpfec|flexfec/i.test(codec.mimeType)
            )
              actualReceiveCodec = codec.mimeType;
            if (stat.bytesReceived) totalBytesReceived += stat.bytesReceived;
            if (typeof stat.jitter === "number")
              jitter = `${(stat.jitter * 1000).toFixed(1)}ms`;
            if (typeof stat.fractionLost === "number")
              packetLoss = `${(stat.fractionLost * 100).toFixed(1)}%`;
            if (stat.framesDecoded !== undefined) {
              decodedFrames = `${stat.framesDecoded} frames (${stat.framesDropped || 0} dropped)`;
            }
            const codecLabel = formatCodecLabel(codec, "video");
            const resFps =
              stat.frameWidth && stat.frameHeight
                ? stat.framesPerSecond
                  ? `${stat.frameWidth}x${stat.frameHeight}@${Math.round(stat.framesPerSecond)}fps`
                  : `${stat.frameWidth}x${stat.frameHeight}`
                : "";
            videoInfo =
              [resFps, codecLabel].filter(Boolean).join(" · ") || "接收中";
          }

          if (
            stat.type === "outbound-rtp" &&
            stat.kind === "video" &&
            !stat.isRemote
          ) {
            const codec = stat.codecId ? report.get(stat.codecId) : null;
            if (
              codec?.mimeType &&
              !/rtx|red|ulpfec|flexfec/i.test(codec.mimeType)
            )
              actualSendCodec = codec.mimeType;
            if (stat.bytesSent) totalBytesSent += stat.bytesSent;
            const parts: string[] = [];
            if (stat.encoderImplementation)
              parts.push(stat.encoderImplementation);
            if (stat.scalabilityMode) parts.push(stat.scalabilityMode);
            if (parts.length > 0) encoder = parts.join(" · ");

            if (stat.framesEncoded !== undefined) {
              decodedFrames = `Encoded: ${stat.framesEncoded} frames${stat.retransmittedPacketsSent ? ` (${stat.retransmittedPacketsSent} retrans)` : ""}`;
            }
            const codecLabel = formatCodecLabel(codec, "video");
            const resFps =
              stat.frameWidth && stat.frameHeight
                ? stat.framesPerSecond
                  ? `${stat.frameWidth}x${stat.frameHeight}@${Math.round(stat.framesPerSecond)}fps`
                  : `${stat.frameWidth}x${stat.frameHeight}`
                : "";
            videoInfo =
              [resFps, codecLabel].filter(Boolean).join(" · ") || "推流中";
          }

          // 采集远端回传给发送端的 RTCP 指标
          if (isPublisher && stat.type === "remote-inbound-rtp") {
            if (typeof stat.roundTripTime === "number") {
              rtt = `${Math.round(stat.roundTripTime * 1000)}ms`;
            }
            if (typeof stat.fractionLost === "number") {
              packetLoss = `${(stat.fractionLost * 100).toFixed(1)}%`;
            }
            if (typeof stat.jitter === "number") {
              jitter = `${(stat.jitter * 1000).toFixed(1)}ms`;
            }
          }
        });
      } catch (err) {
        console.warn(`[P2PStream] getStats failed for ${targetPeerId}:`, err);
      }
    }

    const rateRes = bitrateCalculator.compute(
      `p2pstream-${targetPeerId || "self"}`,
      totalBytesSent,
      totalBytesReceived,
    );

    const isRelay = this.transmissionMode === "p2p_relay";
    const topology: ConnectionTopology = isRelay
      ? "P2P_TREE_RELAY"
      : "P2P_DIRECT";
    const connectionMode =
      !selectedPairFound || !candidateType || !ipVersion
        ? "协商中"
        : isRelay
          ? `P2P Tree Relay (${protocol} / 树状分发)`
          : candidateType === "host"
            ? `P2P Direct (${protocol} / Host ${ipVersion})`
            : candidateType === "srflx"
              ? `P2P Direct (${protocol} / STUN ${ipVersion})`
              : `P2P Relay (${protocol} / TURN ${ipVersion})`;

    return {
      participantIdentity: targetPeerId,
      isLocal: isPublisher,
      mimeType:
        [actualSendCodec, actualReceiveCodec].filter(Boolean).join(" / ") ||
        "未知",
      playerCore: "WebRTC P2P Stream Engine",
      videoInfo,
      audioInfo: "由 WebRTC 协商（未单独采集）",
      encoder,
      streamHost,
      connectionMode,
      topology,
      protocol,
      bufferLength: isPublisher ? "0.0ms (推流直出)" : "未知",
      decodedFrames,
      downloadBitrate:
        totalBytesSent + totalBytesReceived > 0
          ? isPublisher
            ? rateRes.uploadFormatted
            : rateRes.downloadFormatted
          : "未知",
      uploadBitrate:
        isPublisher && totalBytesSent > 0 ? rateRes.uploadFormatted : undefined,
      rawDownloadBitrateBps: isPublisher
        ? rateRes.uploadBps
        : rateRes.downloadBps,
      rawUploadBitrateBps: isPublisher ? rateRes.uploadBps : undefined,
      totalBytesReceived,
      totalBytesSent,
      rtt,
      packetLoss,
      jitter,
      holePunchStatus,
      ipVersion,
      candidateType,
      preferredVideoCodec: this.targetVideoCodec,
      actualSendCodec,
      actualReceiveCodec,
      codecFallbackReason:
        (actualSendCodec || actualReceiveCodec) &&
        !(actualSendCodec || actualReceiveCodec)
          ?.toLowerCase()
          .includes(this.targetVideoCodec.toLowerCase())
          ? "对端能力或浏览器协商导致编码降级"
          : undefined,
      transportVerified:
        selectedPairFound &&
        (totalBytesSent > 0 || totalBytesReceived > 0) &&
        rateRes.uploadBps + rateRes.downloadBps > 0,
    };
  }
}

export const p2pStreamManager = new P2PStreamManager();
