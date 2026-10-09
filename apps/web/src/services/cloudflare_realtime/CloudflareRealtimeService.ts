import {
  CfCallsCreateSessionResponse,
  CfCallsHeartbeatResponse,
  CfCallsCreateSessionRequest,
  CfCallsSubscribeTrackResponse,
  CfTurnIceServersResponse,
  CfMediaPublication,
  CfMediaTracksEvent,
  CfCallsSessionDescription,
  MediaJoinStage,
  MediaJoinTimingTrace,
  CfStreamWatchState,
  CfStreamViewersEvent,
  NetworkStats,
  StreamDetailedStats,
  AudioPlaybackStatus,
  clampVolume,
} from "@tescord/types";
import { sframeManager } from "../sframe.js";
import { API_BASE } from "../../config.js";
import { apiFetch } from "../apiClient.js";
import { gatewayClient } from "../gateway.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { tGlobal } from "../../i18n/index.js";

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
  fractionLost?: number;
  jitter?: number;
  framesDecoded?: number;
  framesEncoded?: number;
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
  private mediaOperationEpoch = 0;
  private sessionId: string | null = null;
  private pendingSessionLeaves = new Set<string>();
  private currentChannelId: string | null = null;
  private callContext: Pick<
    CfCallsCreateSessionRequest,
    "callId" | "gatewaySessionId"
  > | null = null;
  private connectionStatus: CfRealtimeConnectionStatus = "disconnected";

  private localAudioStream: MediaStream | null = null;
  private localAudioSender: RTCRtpSender | null = null;
  private audioBitrate = 64000;
  private negotiatedE2EEKey: Uint8Array | null = null;

  private remoteStreams = new Map<string, MediaStream>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private audioRoutes = new Map<
    string,
    {
      source: MediaStreamAudioSourceNode;
      gain: GainNode;
      analyser?: AnalyserNode;
      publication?: CfMediaPublication;
      track: MediaStreamTrack;
    }
  >();
  private playbackContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterVolume = 100;
  private audioPlaybackStatus: AudioPlaybackStatus = {
    canPlay: true,
    isInterrupted: false,
  };
  private audioPlaybackStatusListeners = new Set<
    (status: AudioPlaybackStatus) => void
  >();
  private playbackLifecycleBound = false;
  private deafened = false;
  private streamVolumes = new Map<string, number>();
  private activeSpeakers = new Set<string>();
  private speakerTimer: ReturnType<typeof setInterval> | null = null;
  private speakerListeners = new Set<(speakers: string[]) => void>();
  private volumeListeners = new Set<
    (identity: string, volume: number) => void
  >();
  private networkListeners = new Set<
    (stats: Map<string, NetworkStats>) => void
  >();
  private networkStats = new Map<string, NetworkStats>();
  private detailedStats = new Map<string, StreamDetailedStats>();
  private selectedPath: { candidateType: string; protocol: string } | null =
    null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private previousStats = new Map<
    string,
    { bytes: number; timestamp: number; packets: number; lost: number }
  >();
  private subscribedMids = new Map<string, string>();
  private watchingSessions = new Set<string>();
  private pendingWatches = new Map<string, Promise<CfStreamWatchState>>();
  private watchStates = new Map<string, CfStreamWatchState>();
  private watchListeners = new Set<(state: CfStreamWatchState) => void>();
  private publicationListeners = new Set<
    (publications: CfMediaPublication[]) => void
  >();
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
      rtpBaseline: { bytes: number; packets: number };
      keyGeneration: number;
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
  private initialPublicationRevision = 0;
  private latestPublications: CfMediaPublication[] | null = null;
  private latestPublicationRevision = 0;
  private publicationSyncReady = false;
  private subscriptionRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptionRetries = new Map<string, number>();
  private pendingSubscriptionRetries = new Map<string, boolean>();
  private joiningEpoch: number | null = null;
  private announcedTracks = new Set<string>();
  private announcementTask: {
    epoch: number;
    controller: AbortController;
    publications: Array<{
      source: string;
      sender: RTCRtpSender;
      trackName: string;
      track: MediaStreamTrack | null;
    }>;
    promise: Promise<boolean>;
  } | null = null;
  private joiningRetryCount = 0;
  private retiredJoin: {
    sourceEpoch: number;
    retiredEpoch: number;
    retryable: boolean;
    cleanup: Promise<void>;
  } | null = null;
  private joinTiming: MediaJoinTimingTrace | null = null;
  private preparingIce: {
    userId: string | undefined;
    promise: Promise<RTCIceServer[]>;
  } | null = null;
  private preparedTurnExpiresAt: number | null = null;

  public beginJoinTiming(channelId: string): void {
    const startedAt = Date.now();
    this.joinTiming = {
      channelId,
      operationEpoch: this.mediaOperationEpoch,
      startedAt,
      stages: { joinStarted: 0 },
    };
  }

  public markJoinStage(stage: MediaJoinStage): void {
    if (this.joinTiming && this.joinTiming.stages[stage] === undefined)
      this.joinTiming.stages[stage] = Date.now() - this.joinTiming.startedAt;
  }

  public prepareIceServers(): Promise<RTCIceServer[]> {
    const userId = useAuthStore.getState().user?.id;
    if (this.preparingIce?.userId === userId && this.preparingIce)
      return this.preparingIce.promise;
    const promise = this.fetchIceServers(userId);
    this.preparingIce = { userId, promise };
    void promise
      .finally(() => {
        if (this.preparingIce?.promise === promise) this.preparingIce = null;
      })
      .catch(() => undefined);
    return promise;
  }

  private async fetchIceServers(
    userId: string | undefined,
  ): Promise<RTCIceServer[]> {
    const checkAccount = () => {
      if (useAuthStore.getState().user?.id !== userId)
        throw new Error("MEDIA_CONTEXT_STALE");
    };
    for (const path of [
      "/api/cloudflare-realtime/ice-servers",
      "/api/network/ice-servers",
    ]) {
      try {
        const response = await apiFetch(`${API_BASE}${path}`, {
          headers: this.authHeaders,
          signal: AbortSignal.timeout(5_000),
        });
        checkAccount();
        if (!response.ok) continue;
        const data = (await response.json()) as CfTurnIceServersResponse;
        checkAccount();
        if (Array.isArray(data.iceServers) && data.iceServers.length) {
          if (typeof data.expiresAt === "number")
            this.preparedTurnExpiresAt = data.expiresAt;
          return data.iceServers;
        }
      } catch (error) {
        checkAccount();
        if (path === "/api/network/ice-servers")
          console.warn("[CF Realtime] ICE configuration unavailable", error);
      }
    }
    return [{ urls: "stun:stun.cloudflare.com:3478" }];
  }

  public getJoinTimingTrace(): MediaJoinTimingTrace | null {
    return this.joinTiming
      ? { ...this.joinTiming, stages: { ...this.joinTiming.stages } }
      : null;
  }

  private remoteByMid = new Map<string, CfMediaPublication>();

  constructor() {
    const settings = useSettingsStore.getState();
    this.masterVolume = clampVolume(settings.outputVolume);
    try {
      const saved = JSON.parse(
        localStorage.getItem("tescord_stream_volumes") || "{}",
      ) as Record<string, unknown>;
      for (const [userId, volume] of Object.entries(saved)) {
        if (typeof volume === "number")
          this.streamVolumes.set(userId, clampVolume(volume));
      }
    } catch {
      /* Invalid preferences must not interrupt media setup. */
    }
    this.unbindSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.outputVolume !== previous.outputVolume)
        this.setMasterVolume(state.outputVolume);
      if (state.userVolumes !== previous.userVolumes)
        this.updatePlaybackGains();
      if (state.audio.outputDeviceId !== previous.audio.outputDeviceId)
        void this.applyOutputDevice();
    });
  }

  private getOrCreatePlaybackContext(): AudioContext {
    if (!this.playbackContext || this.playbackContext.state === "closed") {
      this.playbackContext = new AudioContext();
      this.playbackContext.addEventListener(
        "statechange",
        this.handlePlaybackContextStateChange,
      );
      this.masterGain = this.playbackContext.createGain();
      this.masterGain.connect(this.playbackContext.destination);
      this.updatePlaybackGains();
      void this.applyOutputDevice();
      this.bindPlaybackLifecycleListeners();
    }
    if (this.playbackContext.state === "suspended")
      void this.playbackContext.resume().catch(() => undefined);
    return this.playbackContext;
  }

  public getAudioPlaybackStatus(): AudioPlaybackStatus {
    return { ...this.audioPlaybackStatus };
  }

  public onAudioPlaybackStatusChange(
    listener: (status: AudioPlaybackStatus) => void,
  ): () => void {
    this.audioPlaybackStatusListeners.add(listener);
    listener(this.getAudioPlaybackStatus());
    return () => this.audioPlaybackStatusListeners.delete(listener);
  }

  private setAudioPlaybackStatus(status: Partial<AudioPlaybackStatus>): void {
    const next = { ...this.audioPlaybackStatus, ...status };
    if (
      next.canPlay === this.audioPlaybackStatus.canPlay &&
      next.isInterrupted === this.audioPlaybackStatus.isInterrupted &&
      next.error === this.audioPlaybackStatus.error
    )
      return;
    this.audioPlaybackStatus = next;
    for (const listener of this.audioPlaybackStatusListeners) listener(next);
  }

  private handlePlaybackContextStateChange = (): void => {
    const state = this.playbackContext?.state as string | undefined;
    if (state === "suspended" || state === "interrupted") {
      this.setAudioPlaybackStatus({ canPlay: false, isInterrupted: true });
    } else if (state === "running") {
      this.setAudioPlaybackStatus({
        canPlay: true,
        isInterrupted: false,
        error: undefined,
      });
    }
  };

  private attemptSilentAudioRecovery = (): void => {
    if (!this.currentChannelId) return;
    void this.resumeAudio();
  };

  private onPlaybackVisibilityChange = (): void => {
    if (document.visibilityState === "visible")
      this.attemptSilentAudioRecovery();
  };

  private bindPlaybackLifecycleListeners(): void {
    if (this.playbackLifecycleBound || typeof window === "undefined") return;
    document.addEventListener(
      "visibilitychange",
      this.onPlaybackVisibilityChange,
    );
    window.addEventListener("pageshow", this.attemptSilentAudioRecovery);
    window.addEventListener("focus", this.attemptSilentAudioRecovery);
    this.playbackLifecycleBound = true;
  }

  private unbindPlaybackLifecycleListeners(): void {
    if (!this.playbackLifecycleBound || typeof window === "undefined") return;
    document.removeEventListener(
      "visibilitychange",
      this.onPlaybackVisibilityChange,
    );
    window.removeEventListener("pageshow", this.attemptSilentAudioRecovery);
    window.removeEventListener("focus", this.attemptSilentAudioRecovery);
    this.playbackLifecycleBound = false;
  }

  public async resumeAudio(): Promise<boolean> {
    let canPlay = true;
    if (this.playbackContext && this.playbackContext.state !== "closed") {
      const state = this.playbackContext.state as string;
      if (state === "suspended" || state === "interrupted") {
        try {
          await this.playbackContext.resume();
        } catch (error) {
          console.warn("[CF Realtime] Resume AudioContext failed", error);
          canPlay = false;
        }
      }
      canPlay = canPlay && this.playbackContext.state === "running";
    }

    const fallbackElements = [...this.audioElements.entries()].filter(
      ([trackId, audio]) => !this.audioRoutes.has(trackId) && audio.paused,
    );
    const playbackResults = await Promise.allSettled(
      fallbackElements.map(([, audio]) => audio.play()),
    );
    if (playbackResults.some((result) => result.status === "rejected"))
      canPlay = false;

    this.setAudioPlaybackStatus({
      canPlay,
      isInterrupted: !canPlay,
      error: undefined,
    });
    return canPlay;
  }

  public simulateInterruption(isInterrupted = true): void {
    this.setAudioPlaybackStatus({
      canPlay: !isInterrupted,
      isInterrupted,
      error: undefined,
    });
  }

  private async applyOutputDevice(): Promise<void> {
    const deviceId =
      useSettingsStore.getState().audio.outputDeviceId || "default";
    const context = this.playbackContext as
      (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (context?.setSinkId) {
      await context
        .setSinkId(deviceId)
        .catch((error) =>
          console.warn("[CF Realtime] Output device change failed", error),
        );
    }
    for (const audio of this.audioElements.values()) {
      const sinkAudio = audio as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (
        !this.audioRoutes.has(audio.dataset.trackId || "") &&
        sinkAudio.setSinkId
      ) {
        await sinkAudio.setSinkId(deviceId).catch(() => undefined);
      }
    }
  }

  private updatePlaybackGains(): void {
    if (this.masterGain && this.playbackContext) {
      this.masterGain.gain.setValueAtTime(
        this.deafened ? 0 : this.masterVolume / 100,
        this.playbackContext.currentTime,
      );
    }
    for (const [trackId, route] of this.audioRoutes) {
      const identity = route.publication?.userId;
      const volume =
        route.publication?.source === "screen-audio"
          ? this.getStreamVolume(identity || "")
          : this.getParticipantVolume(identity || "");
      route.gain.gain.setValueAtTime(
        volume / 100,
        this.playbackContext?.currentTime || 0,
      );
      const fallback = this.audioElements.get(trackId);
      if (fallback) fallback.muted = true;
    }
    for (const [trackId, audio] of this.audioElements) {
      if (this.audioRoutes.has(trackId)) continue;
      const publication = this.audioPublicationByTrackId(trackId);
      const volume =
        publication?.source === "screen-audio"
          ? this.getStreamVolume(publication.userId)
          : this.getParticipantVolume(publication?.userId || "");
      audio.muted = this.deafened;
      audio.volume = Math.min(1, (volume / 100) * (this.masterVolume / 100));
    }
  }

  private audioPublicationByTrackId(
    trackId: string,
  ): CfMediaPublication | undefined {
    for (const route of this.audioRoutes.values())
      if (route.track.id === trackId) return route.publication;
    return undefined;
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = clampVolume(volume);
    if (useSettingsStore.getState().outputVolume !== this.masterVolume)
      useSettingsStore.getState().setOutputVolume(this.masterVolume);
    this.updatePlaybackGains();
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setParticipantVolume(identity: string, volume: number): void {
    const clamped = clampVolume(volume);
    if (useSettingsStore.getState().userVolumes[identity] !== clamped)
      useSettingsStore.getState().setUserVolume(identity, clamped);
    this.updatePlaybackGains();
    for (const listener of this.volumeListeners) listener(identity, clamped);
  }

  public getParticipantVolume(identity: string): number {
    return clampVolume(
      useSettingsStore.getState().userVolumes[identity] ?? 100,
    );
  }

  public onParticipantVolumeChange(
    listener: (identity: string, volume: number) => void,
  ): () => void {
    this.volumeListeners.add(listener);
    return () => {
      this.volumeListeners.delete(listener);
    };
  }

  public setStreamVolume(identity: string, volume: number): void {
    this.streamVolumes.set(identity, clampVolume(volume));
    try {
      localStorage.setItem(
        "tescord_stream_volumes",
        JSON.stringify(Object.fromEntries(this.streamVolumes)),
      );
    } catch {
      /* Best effort. */
    }
    this.updatePlaybackGains();
  }

  public getStreamVolume(identity: string): number {
    return this.streamVolumes.get(identity) ?? 100;
  }

  public onActiveSpeakersChange(
    listener: (speakers: string[]) => void,
  ): () => void {
    this.speakerListeners.add(listener);
    listener([...this.activeSpeakers]);
    return () => {
      this.speakerListeners.delete(listener);
    };
  }

  public isParticipantSpeaking(identity: string): boolean {
    return this.activeSpeakers.has(identity);
  }

  private emitSpeakers(): void {
    const speakers = [...this.activeSpeakers];
    for (const listener of this.speakerListeners) listener(speakers);
  }

  private startSpeakerMonitor(): void {
    if (this.speakerTimer) return;
    this.speakerTimer = setInterval(() => {
      const active = new Set<string>();
      for (const route of this.audioRoutes.values()) {
        if (
          route.publication?.source !== "microphone" ||
          !route.analyser ||
          !route.publication.userId
        )
          continue;
        const samples = new Uint8Array(route.analyser.fftSize);
        route.analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          energy += centered * centered;
        }
        const rms = Math.sqrt(energy / samples.length);
        if (
          rms > 0.001 &&
          this.playbackContext?.state === "running" &&
          sframeManager.getStats().framesDecrypted > 0
        )
          this.markJoinStage("firstPlayableAudio");
        if (rms > 0.025) active.add(route.publication.userId);
      }
      if (
        active.size !== this.activeSpeakers.size ||
        [...active].some((id) => !this.activeSpeakers.has(id))
      ) {
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
        const active = response.ok
          ? ((await response.json()) as CfCallsHeartbeatResponse).active
          : undefined;
        if (
          (active === false ||
            response.status === 401 ||
            response.status === 403) &&
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
      if (
        published.stream.getVideoTracks().length &&
        this.sessionId &&
        this.currentChannelId
      ) {
        listener(
          {
            sessionId: this.sessionId,
            channelId: this.currentChannelId,
            userId: useAuthStore.getState().user?.id || "",
            trackName: published.trackName,
            kind: "video",
            source: published.trackName.startsWith("screen-")
              ? "screen"
              : "camera",
          },
          published.stream,
        );
      }
    }
    for (const [key, publication] of this.currentPublications) {
      if (publication.kind === "video")
        listener(publication, this.remoteStreams.get(key) || null);
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
        publications.push({
          sessionId: this.sessionId,
          channelId: this.currentChannelId,
          userId: localUserId,
          trackName: published.trackName,
          mid: published.mid,
          kind:
            source === "microphone" || source === "screen-audio"
              ? "audio"
              : "video",
          source: source as CfMediaPublication["source"],
        });
      }
    }
    return publications;
  }

  private emitPublications(): void {
    const publications = this.allPublications();
    for (const listener of this.publicationListeners) listener(publications);
  }

  private queue<T>(task: () => Promise<T>): Promise<T> {
    const epoch = this.mediaOperationEpoch;
    const result = this.operation.then(() => {
      if (epoch !== this.mediaOperationEpoch)
        throw new Error("MEDIA_CONTEXT_STALE");
      return task();
    });
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
    return Boolean(
      this.connectionStatus === "connected" &&
      sframeManager.hasActiveContext &&
      sframeManager.getStats().framesEncrypted > 0,
    );
  }

  public get selectedCandidatePath(): {
    candidateType: string;
    protocol: string;
  } | null {
    return this.connectionStatus === "connected" ? this.selectedPath : null;
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
    const epoch = this.mediaOperationEpoch;
    const channelId = this.currentChannelId;
    const callContext = this.callContext;
    const headers = this.authHeaders;
    await this.flushPendingSessionLeaves();
    if (epoch !== this.mediaOperationEpoch)
      throw new Error("MEDIA_CONTEXT_STALE");
    const sessionRes = await this.mutateSession(
      `${API_BASE}/api/cloudflare-realtime/session/new`,
      {
        method: "POST",
        headers: this.authHeaders,
        body: JSON.stringify({
          channelId,
          ...callContext,
        } satisfies CfCallsCreateSessionRequest),
      },
    );
    if (!sessionRes.ok)
      throw new Error(
        `Cloudflare media session request failed (${sessionRes.status})`,
      );
    let sessionData: CfCallsCreateSessionResponse;
    try {
      sessionData = (await sessionRes.json()) as CfCallsCreateSessionResponse;
      if (typeof sessionData?.sessionId !== "string" || !sessionData.sessionId)
        throw new Error("Invalid Cloudflare media session");
    } catch (error) {
      // A sessions/new response without an ID cannot be inspected or replayed.
      // Retire this attempt and use the same single replacement budget.
      this.retireAmbiguousSession(epoch, true);
      throw error;
    }
    if (
      epoch !== this.mediaOperationEpoch ||
      channelId !== this.currentChannelId
    ) {
      void apiFetch(`${API_BASE}/api/cloudflare-realtime/session/leave`, {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId: sessionData.sessionId }),
        signal: AbortSignal.timeout(3_000),
      }).catch(() => {});
      throw new Error("MEDIA_CONTEXT_STALE");
    }
    this.sessionId = sessionData.sessionId;
    this.initialPublications = sessionData.tracks || [];
    this.initialPublicationRevision = sessionData.tracksRevision ?? 0;
    if (sessionData.requiresE2EE && !sframeManager.hasActiveContext) {
      throw new Error("E2EE media key unavailable");
    }
    this.startHeartbeat();
    this.unbindViewers = gatewayClient.on(
      "CF_STREAM_VIEWERS",
      (event: CfStreamViewersEvent) => {
        if (event.channelId !== this.currentChannelId) return;
        this.setWatchState({
          ...event,
          watching: this.watchingSessions.has(event.publisherSessionId),
        });
      },
    );
    return sessionData.sessionId;
  }

  private async leaveMediaSession(sessionId: string): Promise<void> {
    try {
      const response = await apiFetch(
        `${API_BASE}/api/cloudflare-realtime/session/leave`,
        {
          method: "POST",
          headers: this.authHeaders,
          body: JSON.stringify({ sessionId }),
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (response.ok || response.status === 403 || response.status === 404) {
        this.pendingSessionLeaves.delete(sessionId);
        return;
      }
    } catch {
      // A disconnected browser cannot revoke its old SFU session yet.
    }
    this.pendingSessionLeaves.add(sessionId);
  }

  private async flushPendingSessionLeaves(): Promise<void> {
    for (const sessionId of this.pendingSessionLeaves)
      await this.leaveMediaSession(sessionId);
    if (this.pendingSessionLeaves.size)
      throw new Error("Previous media session cleanup pending");
  }

  /**
   * 配置房间协商的端到端加密密钥 (SFrame / 256 位)
   */
  public setNegotiatedE2EEKey(key: Uint8Array | null): void {
    if (sframeManager.hasActiveContext) return;
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
      audioBitrate?: number;
      iceServers?: RTCIceServer[];
      iceTransportPolicy?: RTCIceTransportPolicy;
      callId?: string;
      gatewaySessionId?: string;
    },
    retryCount = 0,
  ): Promise<string> {
    if (
      this.connectionStatus === "connected" ||
      this.connectionStatus === "connecting"
    ) {
      await this.disconnect();
    }

    if (
      options?.audioStream &&
      !options.audioStream
        .getAudioTracks()
        .some((track) => track.readyState === "live")
    )
      throw new Error("MEDIA_CONTEXT_STALE");
    sframeManager.assertReady();
    const epoch = ++this.mediaOperationEpoch;
    const joiningUserId = useAuthStore.getState().user?.id;
    const joiningGatewaySession = gatewayClient.getSessionId();
    this.joiningEpoch = epoch;
    this.joiningRetryCount = retryCount;
    const accountIsCurrent = () =>
      joiningUserId === useAuthStore.getState().user?.id &&
      joiningGatewaySession === gatewayClient.getSessionId();
    const checkCurrent = () => {
      if (
        epoch !== this.mediaOperationEpoch ||
        this.currentChannelId !== channelId ||
        !accountIsCurrent()
      )
        throw new Error("MEDIA_CONTEXT_STALE");
    };
    this.currentChannelId = channelId;
    this.callContext = {
      ...(options?.callId ? { callId: options.callId } : {}),
      gatewaySessionId: options?.gatewaySessionId,
    };
    this.audioBitrate = options?.audioBitrate || 64000;
    if (!this.joinTiming || this.joinTiming.channelId !== channelId)
      this.beginJoinTiming(channelId);
    this.joinTiming!.operationEpoch = epoch;
    this.latestPublications = null;
    this.latestPublicationRevision = 0;
    this.initialPublicationRevision = 0;
    this.publicationSyncReady = false;
    // Register before sessions/new: a Gateway publication can beat its HTTP snapshot.
    this.unbindTracks = gatewayClient.on(
      "CF_MEDIA_TRACKS",
      (event: CfMediaTracksEvent) => {
        if (epoch !== this.mediaOperationEpoch || event.channelId !== channelId)
          return;
        const revision = event.revision ?? 0;
        if (
          !Number.isSafeInteger(revision) ||
          revision < this.latestPublicationRevision
        )
          return;
        this.latestPublicationRevision = revision;
        this.latestPublications = event.tracks;
        if (this.publicationSyncReady)
          void this.syncPublications(event.tracks).catch((error: unknown) => {
            if (epoch === this.mediaOperationEpoch)
              console.warn("[CF Realtime] Publication sync failed", error);
          });
      },
    );
    this.setStatus("connecting");

    try {
      const iceServers = options?.iceServers?.length
        ? options.iceServers
        : await this.prepareIceServers();
      if (this.preparedTurnExpiresAt)
        this.scheduleTurnRefresh(this.preparedTurnExpiresAt);

      checkCurrent();
      // 2. 初始化原生 RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: iceServers || [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
        iceTransportPolicy: options?.iceTransportPolicy || "all",
        encodedInsertableStreams: true,
      } as RTCConfiguration);
      this.pc = pc;

      // 3. 监听远端流到达事件
      pc.ontrack = (event) => {
        if (epoch !== this.mediaOperationEpoch || pc !== this.pc) {
          event.track.stop();
          return;
        }
        console.log(
          "[CF Realtime] 收到远端音轨:",
          event.track.id,
          "kind:",
          event.track.kind,
        );

        // 若当前房间开启了 E2EE，挂接 SFrame 解密管线 (在扬声器播放前还原明文)
        if (event.receiver) {
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
        if (
          publication &&
          this.currentPublications.get(
            `${publication.sessionId}:${publication.trackName}`,
          )?.userId !== publication.userId
        ) {
          sframeManager.detachReceiver(event.receiver);
          event.track.stop();
          return;
        }
        if (!publication) {
          sframeManager.detachReceiver(event.receiver);
          event.track.stop();
          return;
        }
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
            const source = context.createMediaStreamSource(
              new MediaStream([event.track]),
            );
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
            this.audioRoutes.set(trackId, {
              source,
              gain,
              analyser,
              publication,
              track: event.track,
            });
            audioEl.muted = true;
          } catch (error) {
            console.warn(
              "[CF Realtime] Web Audio unavailable; falling back to HTMLAudioElement",
              error,
            );
            void this.applyOutputDevice();
            audioEl
              .play()
              .catch((playErr) =>
                console.warn(
                  "[CF Realtime] Remote audio autoplay blocked",
                  playErr,
                ),
              );
          }
          this.updatePlaybackGains();
          event.track.addEventListener(
            "ended",
            () => this.releaseRemoteTrack(trackId),
            { once: true },
          );
        }
      };

      // 4. 监听网络连接状态
      pc.onconnectionstatechange = () => {
        if (epoch !== this.mediaOperationEpoch || pc !== this.pc) return;
        console.log(
          "[CF Realtime] PeerConnection 状态变更:",
          pc.connectionState,
        );
        if (pc.connectionState === "connected") {
          this.markJoinStage("connected");
          this.setStatus("connected");
          this.startStatsPolling();
        } else if (pc.connectionState === "disconnected") {
          this.setStatus("reconnecting");
        } else if (pc.connectionState === "failed") {
          // Initial setup owns its bounded replacement attempt and must retain
          // the microphone until that attempt has finished.
          if (this.joiningEpoch === epoch) return;
          const cleanup = this.disconnect();
          const retiredEpoch = this.mediaOperationEpoch;
          void cleanup.then(() => {
            if (retiredEpoch === this.mediaOperationEpoch)
              this.setStatus("failed", "MEDIA_CONTEXT_STALE");
          });
        }
      };

      // 在申请短寿命的 SFU 会话前完成本地 ICE 候选收集。
      if (options?.audioStream)
        await this.publishMicrophoneStream(options.audioStream);
      else await this.createMediaSession();

      checkCurrent();
      let announcement: Promise<boolean> | undefined;
      if (options?.audioStream) {
        // Cloudflare session_error/425 requires transport setup and connection
        // before later mutations, even when the publication SDP is already stable.
        // Healthy setup is normally around one second after publication. A
        // stalled transport must not consume the short-lived session's 30s TTL.
        await this.waitForConnected(pc, 5_000);
        checkCurrent();
        announcement = this.scheduleTrackAnnouncement();
        checkCurrent();
      }
      this.publicationSyncReady = true;
      const publications =
        this.latestPublications !== null &&
        this.latestPublicationRevision >= this.initialPublicationRevision
          ? this.latestPublications
          : this.initialPublications;
      this.latestPublicationRevision = Math.max(
        this.latestPublicationRevision,
        this.initialPublicationRevision,
      );
      await this.syncPublications(publications);
      checkCurrent();
      await announcement;
      checkCurrent();
      if (!this.sessionId)
        throw new Error("Media session lost during connection");
      return this.sessionId;
    } catch (err: unknown) {
      if (epoch !== this.mediaOperationEpoch) {
        const retired = this.retiredJoin;
        if (
          retryCount === 0 &&
          retired?.sourceEpoch === epoch &&
          retired.retryable &&
          retired.retiredEpoch === this.mediaOperationEpoch
        ) {
          await retired.cleanup;
          if (
            retired.retiredEpoch !== this.mediaOperationEpoch ||
            !accountIsCurrent() ||
            this.pc ||
            this.currentChannelId ||
            (options?.audioStream &&
              !options.audioStream
                .getAudioTracks()
                .some((track) => track.readyState === "live"))
          )
            throw err;
          // Reuse the authorized encryption context, never the uncertain SFU allocation.
          sframeManager.assertReady();
          this.retiredJoin = null;
          this.setStatus("reconnecting");
          return this.connect(channelId, options, retryCount + 1);
        }
        throw err;
      }
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
        if (this.mediaOperationEpoch !== epoch + 1 || !accountIsCurrent())
          throw err;
        sframeManager.assertReady();
        this.setStatus("reconnecting");
        return this.connect(channelId, options, retryCount + 1);
      }
      console.error("[CF Realtime] 连接建立异常:", err);
      this.setStatus(
        "failed",
        err instanceof Error ? err.message : "MEDIA_KEY_INVALID",
      );
      throw err;
    } finally {
      if (this.joiningEpoch === epoch) this.joiningEpoch = null;
    }
  }

  private releaseRemoteTrack(trackId: string): void {
    // MediaStreamTrack.stop() does not emit "ended". Revoke the transform before
    // stopping a vanished subscription so its Worker cannot fail the whole call
    // or remain in the next epoch's receiver-key acknowledgement set.
    for (const receiver of this.pc?.getReceivers() || [])
      if (receiver.track.id === trackId) sframeManager.detachReceiver(receiver);
    const route = this.audioRoutes.get(trackId);
    if (route) {
      route.analyser?.disconnect();
      route.source.disconnect();
      route.gain.disconnect();
      this.audioRoutes.delete(trackId);
    }
    const audio = this.audioElements.get(trackId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      this.audioElements.delete(trackId);
    }
    if (
      route?.publication?.userId &&
      this.activeSpeakers.delete(route.publication.userId)
    )
      this.emitSpeakers();
    if (!this.audioRoutes.size && this.speakerTimer) {
      clearInterval(this.speakerTimer);
      this.speakerTimer = null;
    }
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
    const epoch = this.mediaOperationEpoch;
    const expectedPc = this.pc;
    const channelId = this.currentChannelId;
    await this.queue(async () => {
      const pc = this.pc;
      if (
        epoch !== this.mediaOperationEpoch ||
        pc !== expectedPc ||
        track.readyState !== "live"
      )
        throw new Error("MEDIA_CONTEXT_STALE");
      let sessionId = this.sessionId;
      if (
        !pc ||
        !this.currentChannelId ||
        (!sessionId && source !== "microphone")
      )
        throw new Error("No Cloudflare media session");
      sframeManager.assertReady();
      const transceiver = pc.addTransceiver(track, {
        direction: "sendonly",
        streams: [stream],
      });
      const sender = transceiver.sender;
      try {
        sframeManager.attachSender(sender);
        const keyGeneration =
          sframeManager.getSenderKeyReadiness(sender)?.generation;
        if (keyGeneration === undefined)
          throw new Error("MEDIA_KEY_UNAVAILABLE");
        const rtpBaseline = await this.senderRtpCounters(sender);
        if (source === "microphone") {
          const parameters = sender.getParameters();
          parameters.encodings = parameters.encodings?.length
            ? parameters.encodings
            : [{}];
          parameters.encodings[0].maxBitrate = this.audioBitrate;
          await sender.setParameters(parameters);
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.waitForIceGathering(pc);
        this.markJoinStage("iceReady");
        if (
          epoch !== this.mediaOperationEpoch ||
          pc !== this.pc ||
          track.readyState !== "live"
        )
          throw new Error("MEDIA_CONTEXT_STALE");
        if (!sessionId) sessionId = await this.createMediaSession();
        const mid = transceiver.mid;
        if (!mid) throw new Error("Missing track MID");
        const trackName = `${source}-${crypto.randomUUID()}`;
        const response = await this.mutateSession(
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
        const data = await this.readTrackResponse(response, "local");
        if (
          epoch !== this.mediaOperationEpoch ||
          pc !== this.pc ||
          channelId !== this.currentChannelId ||
          track.readyState !== "live"
        )
          throw new Error("MEDIA_CONTEXT_STALE");
        if (!data.sessionDescription?.sdp)
          throw new Error("Missing Cloudflare answer");
        const result = data.tracks?.find(
          (item) => item.trackName === trackName,
        );
        if (!result || result.errorCode) throw new Error("MEDIA_KEY_INVALID");
        await this.completeSdpExchange(pc, sessionId, epoch, data);
        if (epoch !== this.mediaOperationEpoch || pc !== this.pc)
          throw new Error("MEDIA_CONTEXT_STALE");
        this.markJoinStage("published");
        this.publishedTracks.set(source, {
          sender,
          stream,
          mid,
          trackName,
          rtpBaseline,
          keyGeneration,
        });
        this.emitPublications();
        if (this.connectionStatus === "connected")
          void this.scheduleTrackAnnouncement();
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
        if (pc.signalingState !== "closed") pc.removeTrack(sender);
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
      const pc = this.pc;
      const sessionId = this.sessionId;
      const epoch = this.mediaOperationEpoch;
      const response = await this.mutateSession(
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
      if (
        epoch !== this.mediaOperationEpoch ||
        pc !== this.pc ||
        sessionId !== this.sessionId
      )
        throw new Error("MEDIA_CONTEXT_STALE");
      pc.removeTrack(published.sender);
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
      this.announcedTracks.delete(published.trackName);
      this.emitPublications();
      void this.scheduleTrackAnnouncement();
    });
  }

  public async switchCameraDevice(deviceId: string): Promise<boolean> {
    return this.queue(async () => {
      const epoch = this.mediaOperationEpoch;
      const pc = this.pc;
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
      if (epoch !== this.mediaOperationEpoch || pc !== this.pc) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("MEDIA_CONTEXT_STALE");
      }
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
      void this.scheduleTrackAnnouncement();
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

  private async senderRtpCounters(
    sender: RTCRtpSender,
  ): Promise<{ bytes: number; packets: number }> {
    const report = await sender.getStats();
    let bytes = 0,
      packets = 0;
    report.forEach((value) => {
      const row = value as RtcRecord;
      if (row.type !== "outbound-rtp") return;
      bytes += row.bytesSent || 0;
      packets += row.packetsSent || 0;
    });
    return { bytes, packets };
  }

  /** Wait outside the SDP queue so receiving ready remote tracks can continue. */
  private scheduleTrackAnnouncement(): Promise<boolean> {
    const pc = this.pc,
      sessionId = this.sessionId,
      channelId = this.currentChannelId;
    const epoch = this.mediaOperationEpoch;
    const userId = useAuthStore.getState().user?.id;
    const gatewaySessionId = gatewayClient.getSessionId();
    if (!pc || !sessionId || !channelId) return Promise.resolve(false);
    const all = [...this.publishedTracks].map(([source, publication]) => ({
      source,
      ...publication,
      track: publication.sender.track,
    }));
    const pending = all.filter(
      (item) => !this.announcedTracks.has(item.trackName),
    );
    if (!pending.length) {
      this.announcementTask?.controller.abort();
      this.announcementTask = null;
      return Promise.resolve(true);
    }
    const previous = this.announcementTask;
    if (
      previous?.epoch === epoch &&
      previous.publications.length === all.length &&
      all.every(
        (item, index) =>
          previous.publications[index].sender === item.sender &&
          previous.publications[index].trackName === item.trackName &&
          previous.publications[index].track === item.track,
      )
    )
      return previous.promise;
    previous?.controller.abort();
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      epoch === this.mediaOperationEpoch &&
      pc === this.pc &&
      sessionId === this.sessionId &&
      channelId === this.currentChannelId &&
      userId === useAuthStore.getState().user?.id &&
      gatewaySessionId === gatewayClient.getSessionId() &&
      this.publishedTracks.size === all.length &&
      all.every((item) => {
        const owned = this.publishedTracks.get(item.source);
        return (
          owned?.sender === item.sender &&
          owned.trackName === item.trackName &&
          item.sender.track === item.track &&
          item.sender.track?.readyState === "live" &&
          pc.getSenders().includes(item.sender)
        );
      });
    const candidates = new Map(
      pending.map((item) => [
        item.sender,
        {
          generation: item.keyGeneration,
          baseline: item.rtpBaseline,
        },
      ]),
    );
    const deadline = Date.now() + 15_000;
    const run = async (): Promise<boolean> => {
      while (current()) {
        if (!sframeManager.hasActiveContext)
          throw new Error("MEDIA_KEY_UNAVAILABLE");
        const ready = await Promise.all(
          pending.map(async (item) => {
            const before = sframeManager.getSenderKeyReadiness(item.sender);
            if (!before?.ready) return null;
            const counts = await this.senderRtpCounters(item.sender);
            const after = sframeManager.getSenderKeyReadiness(item.sender);
            if (
              !current() ||
              !after?.ready ||
              before.generation !== after.generation ||
              before.keyId !== after.keyId
            )
              return null;
            const candidate = candidates.get(item.sender)!;
            if (candidate.generation !== after.generation) {
              // Bytes from the preceding key generation cannot authorize a new announcement.
              candidates.set(item.sender, {
                generation: after.generation,
                baseline: counts,
              });
              return null;
            }
            return counts.bytes > candidate.baseline.bytes ||
              counts.packets > candidate.baseline.packets
              ? {
                  sender: item.sender,
                  generation: after.generation,
                  keyId: after.keyId,
                }
              : null;
          }),
        );
        if (!current()) return false;
        if (
          pc.connectionState === "connected" &&
          ready.every((item) => item !== null) &&
          ready.every((item) => {
            const key = sframeManager.getSenderKeyReadiness(item!.sender);
            return (
              key?.ready &&
              key.generation === item!.generation &&
              key.keyId === item!.keyId
            );
          })
        ) {
          const keysCurrent = () =>
            ready.every((item) => {
              const key = sframeManager.getSenderKeyReadiness(item!.sender);
              return (
                key?.ready &&
                key.generation === item!.generation &&
                key.keyId === item!.keyId
              );
            });
          const announced = await this.queue(async () => {
            // Wait behind complete publication SDP before advertising the entire session.
            if (!current() || !keysCurrent()) return false;
            const response = await apiFetch(
              `${API_BASE}/api/cloudflare-realtime/tracks/ready`,
              {
                method: "POST",
                headers: this.authHeaders,
                body: JSON.stringify({ sessionId }),
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(5_000),
                ]),
              },
            );
            if (!current() || !keysCurrent()) return false;
            if (!response.ok)
              throw new Error(`Media announcement failed (${response.status})`);
            for (const item of pending)
              this.announcedTracks.add(item.trackName);
            return true;
          });
          if (announced) return true;
        }
        if (Date.now() >= deadline) throw new Error("MEDIA_KEY_UNAVAILABLE");
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 100);
          controller.signal.addEventListener("abort", done, { once: true });
        });
      }
      return false;
    };
    const promise = run().catch((error: unknown) => {
      if (current()) {
        void this.disconnect();
        this.setStatus(
          "failed",
          error instanceof Error ? error.message : "MEDIA_KEY_UNAVAILABLE",
        );
      }
      return false;
    });
    this.announcementTask = { epoch, controller, publications: all, promise };
    return promise;
  }

  /** Mutation response loss cannot be retried safely: retire the ambiguous transport. */
  private retireAmbiguousSession(epoch: number, retryable = false): void {
    if (epoch !== this.mediaOperationEpoch) return;
    const canRebuild =
      retryable && this.joiningEpoch === epoch && this.joiningRetryCount === 0;
    // Disconnect clears the active transport synchronously. Late cleanup completion
    // must never overwrite a replacement connection's status.
    const cleanup = this.disconnect(false).catch((error: unknown) =>
      console.warn("[CF Realtime] Retired session cleanup pending", error),
    );
    this.retiredJoin = {
      sourceEpoch: epoch,
      retiredEpoch: this.mediaOperationEpoch,
      retryable: canRebuild,
      cleanup,
    };
    this.setStatus(
      canRebuild ? "reconnecting" : "failed",
      "MEDIA_CONTEXT_STALE",
    );
  }

  private async mutateSession(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const epoch = this.mediaOperationEpoch;
    try {
      const response = await apiFetch(url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status >= 500) throw new Error("MEDIA_CONTEXT_STALE");
      return response;
    } catch (error) {
      if (epoch === this.mediaOperationEpoch) {
        this.retireAmbiguousSession(epoch, true);
      }
      throw error;
    }
  }

  private async readTrackResponse(
    response: Response,
    location: "local" | "remote",
  ): Promise<CfCallsSubscribeTrackResponse> {
    const epoch = this.mediaOperationEpoch;
    try {
      const value: unknown = await response.json();
      if (!value || typeof value !== "object")
        throw new Error("MEDIA_CONTEXT_STALE");
      const data = value as Record<string, unknown>;
      if (
        !Array.isArray(data.tracks) ||
        data.errorCode ||
        (data.requiresImmediateRenegotiation !== undefined &&
          typeof data.requiresImmediateRenegotiation !== "boolean")
      )
        throw new Error("MEDIA_CONTEXT_STALE");
      for (const value of data.tracks) {
        if (!value || typeof value !== "object")
          throw new Error("MEDIA_CONTEXT_STALE");
        const track = value as Record<string, unknown>;
        if (
          (track.location !== undefined && track.location !== location) ||
          typeof track.trackName !== "string" ||
          (track.mid !== undefined && typeof track.mid !== "string") ||
          (track.sessionId !== undefined &&
            typeof track.sessionId !== "string") ||
          (track.errorCode !== undefined && typeof track.errorCode !== "string")
        )
          throw new Error("MEDIA_CONTEXT_STALE");
        // The SFU response can omit location; it is fixed by this request's direction.
        if (track.location === undefined) track.location = location;
      }
      if (data.sessionDescription !== undefined) {
        if (
          !data.sessionDescription ||
          typeof data.sessionDescription !== "object"
        )
          throw new Error("MEDIA_CONTEXT_STALE");
        const description = data.sessionDescription as Record<string, unknown>;
        if (
          (description.type !== "offer" && description.type !== "answer") ||
          typeof description.sdp !== "string" ||
          !description.sdp
        )
          throw new Error("MEDIA_CONTEXT_STALE");
      }
      return value as CfCallsSubscribeTrackResponse;
    } catch (error) {
      if (epoch === this.mediaOperationEpoch)
        this.retireAmbiguousSession(epoch);
      throw error;
    }
  }

  private async completeSdpExchange(
    pc: RTCPeerConnection,
    sessionId: string,
    epoch: number,
    data: {
      sessionDescription?: CfCallsSessionDescription;
      requiresImmediateRenegotiation?: boolean;
    },
  ): Promise<void> {
    const check = () => {
      if (
        epoch !== this.mediaOperationEpoch ||
        pc !== this.pc ||
        sessionId !== this.sessionId
      )
        throw new Error("MEDIA_CONTEXT_STALE");
    };
    check();
    const description = data.sessionDescription;
    if (!description) {
      if (data.requiresImmediateRenegotiation)
        throw new Error("MEDIA_CONTEXT_STALE");
      return;
    }
    if (
      !description.sdp ||
      (description.type !== "offer" && description.type !== "answer")
    )
      throw new Error("MEDIA_CONTEXT_STALE");
    await pc.setRemoteDescription(description);
    check();
    if (description.type === "answer") return;
    // An offer always needs an answer; finish the backend exchange before freeing the queue.
    const answer = await pc.createAnswer();
    check();
    await pc.setLocalDescription(answer);
    check();
    await this.waitForIceGathering(pc);
    check();
    const response = await this.mutateSession(
      `${API_BASE}/api/cloudflare-realtime/tracks/renegotiate`,
      {
        method: "PUT",
        headers: this.authHeaders,
        body: JSON.stringify({
          sessionId,
          sessionDescription: {
            type: "answer",
            sdp: pc.localDescription?.sdp || answer.sdp,
          },
        }),
      },
    );
    check();
    if (!response.ok) throw new Error("MEDIA_CONTEXT_STALE");
  }

  public async subscribeRemoteTrack(
    publisherSessionId: string,
    trackName: string,
  ): Promise<void> {
    const key = `${publisherSessionId}:${trackName}`;
    return this.queue(() => this.subscribeRemoteTracksNow([key], true));
  }

  private async subscribeRemoteTracksNow(
    keys: string[],
    explicitWatch = false,
  ): Promise<void> {
    if (keys.length > 16) {
      for (let index = 0; index < keys.length; index += 16)
        await this.subscribeRemoteTracksNow(
          keys.slice(index, index + 16),
          explicitWatch,
        );
      return;
    }
    const pc = this.pc;
    const sessionId = this.sessionId;
    const channelId = this.currentChannelId;
    const epoch = this.mediaOperationEpoch;
    if (!pc || !sessionId || !channelId) return;
    const requested = keys
      .map((key) => this.currentPublications.get(key))
      .filter(
        (item): item is CfMediaPublication =>
          !!item &&
          item.channelId === channelId &&
          item.sessionId !== sessionId &&
          item.userId !== useAuthStore.getState().user?.id &&
          !this.subscribedTracks.has(`${item.sessionId}:${item.trackName}`) &&
          (this.subscriptionRetries.get(
            `${item.sessionId}:${item.trackName}`,
          ) || 0) < 5 &&
          !this.pendingSubscriptionRetries.has(
            `${item.sessionId}:${item.trackName}`,
          ) &&
          (item.source === "microphone" ||
            item.source === "camera" ||
            explicitWatch ||
            this.watchingSessions.has(item.sessionId)),
      );
    if (!requested.length) return;
    const check = () => {
      if (
        epoch !== this.mediaOperationEpoch ||
        pc !== this.pc ||
        sessionId !== this.sessionId ||
        channelId !== this.currentChannelId
      )
        throw new Error("MEDIA_CONTEXT_STALE");
    };
    // Charge attempts when the queued operation actually runs, including its first request.
    // Repeated snapshots must not renew the budget for the same publication.
    for (const publication of requested) {
      const key = `${publication.sessionId}:${publication.trackName}`;
      this.subscriptionRetries.set(
        key,
        (this.subscriptionRetries.get(key) || 0) + 1,
      );
    }
    const response = await this.mutateSession(
      `${API_BASE}/api/cloudflare-realtime/tracks/subscribe`,
      {
        method: "POST",
        headers: this.authHeaders,
        body: JSON.stringify({
          channelId,
          sessionId,
          tracks: requested.map((item) => ({
            publisherSessionId: item.sessionId,
            trackName: item.trackName,
          })),
        }),
      },
    );
    check();
    if (!response.ok) throw new Error(`Subscribe failed (${response.status})`);
    const data = await this.readTrackResponse(response, "remote");
    check();
    const successes: Array<{
      key: string;
      publication: CfMediaPublication;
      mid: string;
    }> = [];
    const rejected: CfMediaPublication[] = [];
    const matched = new Set<string>();
    for (const remote of data.tracks || []) {
      const publications = requested.filter(
        (item) =>
          item.trackName === remote.trackName &&
          (!remote.sessionId || remote.sessionId === item.sessionId),
      );
      const publication = publications[0];
      const key =
        publication && `${publication.sessionId}:${publication.trackName}`;
      if (
        publications.length !== 1 ||
        !key ||
        matched.has(key) ||
        (!remote.errorCode && !remote.mid)
      ) {
        this.retireAmbiguousSession(epoch);
        throw new Error("MEDIA_CONTEXT_STALE");
      }
      matched.add(key);
      if (remote.errorCode) {
        rejected.push(publication);
        continue;
      }
      // Install MID ownership before setRemoteDescription emits ontrack.
      this.remoteByMid.set(remote.mid!, publication);
      this.subscribedMids.set(key, remote.mid!);
      successes.push({ key, publication, mid: remote.mid! });
    }
    if (matched.size !== requested.length) {
      this.retireAmbiguousSession(epoch);
      throw new Error("MEDIA_CONTEXT_STALE");
    }
    try {
      await this.completeSdpExchange(pc, sessionId, epoch, data);
      check();
    } catch (error) {
      if (epoch === this.mediaOperationEpoch)
        this.retireAmbiguousSession(epoch);
      throw error;
    }
    const unwantedMids: string[] = [];
    for (const success of successes) {
      const current = this.currentPublications.get(success.key);
      if (
        current?.userId === success.publication.userId &&
        current.channelId === channelId
      )
        this.subscribedTracks.add(success.key);
      else {
        unwantedMids.push(success.mid);
        this.remoteByMid.delete(success.mid);
        this.subscribedMids.delete(success.key);
      }
    }
    if (unwantedMids.length) {
      const closed = await this.mutateSession(
        `${API_BASE}/api/cloudflare-realtime/tracks/unsubscribe`,
        {
          method: "PUT",
          headers: this.authHeaders,
          body: JSON.stringify({
            channelId,
            sessionId,
            tracks: unwantedMids.map((mid) => ({ mid })),
          }),
        },
      );
      check();
      if (!closed.ok) throw new Error("MEDIA_CONTEXT_STALE");
    }
    if (successes.length) this.markJoinStage("subscribed");
    // Per-track rejection is a known non-allocation; successful MIDs remain valid.
    // Retry just those rejected resources, never replay an uncertain request.
    if (rejected.length)
      this.scheduleSubscriptionRetry(rejected, epoch, explicitWatch);
  }

  private scheduleSubscriptionRetry(
    failed: CfMediaPublication[],
    epoch: number,
    explicitWatch: boolean,
  ): void {
    let retryable = false;
    for (const publication of failed) {
      const key = `${publication.sessionId}:${publication.trackName}`;
      const attempts = this.subscriptionRetries.get(key) || 0;
      if (attempts < 5 && this.currentPublications.has(key)) {
        this.pendingSubscriptionRetries.set(
          key,
          explicitWatch || this.pendingSubscriptionRetries.get(key) || false,
        );
        retryable = true;
      }
    }
    if (!retryable || this.subscriptionRetryTimer) return;
    this.subscriptionRetryTimer = setTimeout(() => {
      this.subscriptionRetryTimer = null;
      if (epoch !== this.mediaOperationEpoch) return;
      const pending = [...this.pendingSubscriptionRetries];
      this.pendingSubscriptionRetries.clear();
      void this.queue(async () => {
        const automatic = pending
          .filter(([, explicit]) => !explicit)
          .map(([key]) => key);
        const watched = pending
          .filter(([, explicit]) => explicit)
          .map(([key]) => key);
        await this.subscribeRemoteTracksNow(automatic);
        await this.subscribeRemoteTracksNow(watched, true);
      }).catch((error: unknown) => {
        if (epoch === this.mediaOperationEpoch)
          console.warn(
            "[CF Realtime] Rejected subscription retry failed",
            error,
          );
      });
    }, 250);
  }

  private async syncPublications(tracks: CfMediaPublication[]): Promise<void> {
    tracks = tracks.filter(
      (track) =>
        track.channelId === this.currentChannelId &&
        track.sessionId !== this.sessionId &&
        track.userId !== useAuthStore.getState().user?.id,
    );
    const desired = new Set(
      tracks.map((track) => `${track.sessionId}:${track.trackName}`),
    );
    for (const [key, old] of this.currentPublications) {
      if (!desired.has(key)) {
        if (
          old.source === "screen" &&
          this.watchingSessions.has(old.sessionId)
        ) {
          void this.stopWatchingStream(old.sessionId, true).catch(
            (error: unknown) =>
              console.warn("[CF Realtime] Stop vanished stream failed", error),
          );
        }
        this.emitVideo(old, null);
        this.currentPublications.delete(key);
        this.subscribedTracks.delete(key);
        this.subscriptionRetries.delete(key);
        this.pendingSubscriptionRetries.delete(key);
        const mid = this.subscribedMids.get(key);
        if (mid) this.remoteByMid.delete(mid);
        this.subscribedMids.delete(key);
        const stream = this.remoteStreams.get(key);
        stream?.getTracks().forEach((track) => {
          this.releaseRemoteTrack(track.id);
          track.stop();
        });
        this.remoteStreams.delete(key);
      }
    }
    for (const track of tracks) {
      if (track.sessionId === this.sessionId) continue;
      const key = `${track.sessionId}:${track.trackName}`;
      this.currentPublications.set(key, track);
    }
    this.emitPublications();
    await this.queue(() =>
      this.subscribeRemoteTracksNow([...this.currentPublications.keys()]),
    );
    const publications = this.allPublications();
    this.emitPublications();
    for (const publication of publications) {
      if (
        publication.source === "screen" &&
        !this.watchStates.has(publication.sessionId)
      ) {
        void this.refreshViewerCount(publication.sessionId);
      }
    }
  }

  private async refreshViewerCount(publisherSessionId: string): Promise<void> {
    if (!this.currentChannelId || !this.sessionId) return;
    const channelId = this.currentChannelId;
    try {
      const query = new URLSearchParams({
        channelId,
        publisherSessionId,
        sessionId: this.sessionId,
      });
      const response = await apiFetch(
        `${API_BASE}/api/cloudflare-realtime/streams/viewers?${query}`,
        { headers: this.authHeaders },
      );
      if (!response.ok || this.currentChannelId !== channelId) return;
      const event = (await response.json()) as CfStreamViewersEvent;
      this.setWatchState({
        ...event,
        watching: this.watchingSessions.has(publisherSessionId),
      });
    } catch (error) {
      console.warn("[CF Realtime] Viewer count refresh failed", error);
    }
  }

  public getScreenPublicationForUser(
    userId: string,
  ): CfMediaPublication | null {
    return (
      this.allPublications().find(
        (publication) =>
          publication.userId === userId && publication.source === "screen",
      ) || null
    );
  }

  public onPublicationsChange(
    listener: (publications: CfMediaPublication[]) => void,
  ): () => void {
    this.publicationListeners.add(listener);
    listener(this.allPublications());
    return () => {
      this.publicationListeners.delete(listener);
    };
  }

  public getWatchState(publisherSessionId: string): CfStreamWatchState | null {
    return this.watchStates.get(publisherSessionId) || null;
  }

  public onStreamWatchChange(
    listener: (state: CfStreamWatchState) => void,
  ): () => void {
    this.watchListeners.add(listener);
    for (const state of this.watchStates.values()) listener(state);
    return () => {
      this.watchListeners.delete(listener);
    };
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
        if (this.remoteStreams.has(key)) {
          clearInterval(timer);
          resolve();
        } else if (!this.sessionId || Date.now() >= deadline) {
          clearInterval(timer);
          reject(new Error("Subscribed stream did not arrive"));
        }
      }, 50);
    });
  }

  public startWatchingStream(
    publisherSessionId: string,
  ): Promise<CfStreamWatchState> {
    const pending = this.pendingWatches.get(publisherSessionId);
    if (pending) return pending;
    const operation = this.startWatchingStreamNow(publisherSessionId);
    this.pendingWatches.set(publisherSessionId, operation);
    void operation
      .finally(() => {
        if (this.pendingWatches.get(publisherSessionId) === operation)
          this.pendingWatches.delete(publisherSessionId);
      })
      .catch(() => undefined);
    return operation;
  }

  private async subscribeNewWatchTracks(
    publisherSessionId: string,
  ): Promise<void> {
    return this.queue(() =>
      this.subscribeRemoteTracksNow(
        [...this.currentPublications.values()]
          .filter(
            (publication) =>
              publication.sessionId === publisherSessionId &&
              (publication.source === "screen" ||
                publication.source === "screen-audio"),
          )
          .map(
            (publication) =>
              `${publication.sessionId}:${publication.trackName}`,
          ),
        true,
      ),
    );
  }

  private async startWatchingStreamNow(
    publisherSessionId: string,
  ): Promise<CfStreamWatchState> {
    if (!this.sessionId || !this.currentChannelId)
      throw new Error("No Cloudflare media session");
    const screen = [...this.currentPublications.values()].find(
      (publication) =>
        publication.sessionId === publisherSessionId &&
        publication.source === "screen",
    );
    if (!screen) throw new Error("Screen publication unavailable");
    if (this.watchingSessions.has(publisherSessionId))
      return (
        this.watchStates.get(publisherSessionId) || {
          channelId: this.currentChannelId,
          publisherSessionId,
          hostUserId: screen.userId,
          viewerCount: 0,
          watching: true,
        }
      );
    const epoch = this.mediaOperationEpoch;
    const sessionId = this.sessionId;
    const check = () => {
      if (
        epoch !== this.mediaOperationEpoch ||
        sessionId !== this.sessionId ||
        !this.currentPublications.has(`${screen.sessionId}:${screen.trackName}`)
      )
        throw new Error("MEDIA_CONTEXT_STALE");
    };
    try {
      await this.subscribeNewWatchTracks(publisherSessionId);
      check();
      await this.waitForRemoteStream(`${screen.sessionId}:${screen.trackName}`);
      check();
      const response = await apiFetch(
        `${API_BASE}/api/cloudflare-realtime/streams/watch`,
        {
          method: "POST",
          headers: this.authHeaders,
          body: JSON.stringify({
            channelId: this.currentChannelId,
            sessionId: this.sessionId,
            publisherSessionId,
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Watch registration failed (${response.status})`);
      const state = (await response.json()) as CfStreamWatchState;
      check();
      this.watchingSessions.add(publisherSessionId);
      this.setWatchState(state);
      await this.subscribeNewWatchTracks(publisherSessionId);
      return state;
    } catch (error) {
      if (epoch !== this.mediaOperationEpoch) throw error;
      await this.releaseScreenSubscriptions(publisherSessionId).catch(
        () => undefined,
      );
      throw error;
    }
  }

  private async releaseScreenSubscriptions(
    publisherSessionId: string,
    serverAlreadyClosed = false,
  ): Promise<void> {
    return this.queue(() =>
      this.releaseScreenSubscriptionsNow(
        publisherSessionId,
        serverAlreadyClosed,
      ),
    );
  }

  private async releaseScreenSubscriptionsNow(
    publisherSessionId: string,
    serverAlreadyClosed: boolean,
  ): Promise<void> {
    const epoch = this.mediaOperationEpoch;
    const pc = this.pc;
    const sessionId = this.sessionId;
    const publications = [...this.currentPublications.values()].filter(
      (publication) =>
        publication.sessionId === publisherSessionId &&
        (publication.source === "screen" ||
          publication.source === "screen-audio"),
    );
    const mids = publications
      .map((publication) =>
        this.subscribedMids.get(
          `${publication.sessionId}:${publication.trackName}`,
        ),
      )
      .filter((mid): mid is string => !!mid);
    if (
      !serverAlreadyClosed &&
      mids.length &&
      this.sessionId &&
      this.currentChannelId
    ) {
      const response = await this.mutateSession(
        `${API_BASE}/api/cloudflare-realtime/tracks/unsubscribe`,
        {
          method: "PUT",
          headers: this.authHeaders,
          body: JSON.stringify({
            channelId: this.currentChannelId,
            sessionId: this.sessionId,
            tracks: mids.map((mid) => ({ mid })),
          }),
        },
      );
      if (
        epoch !== this.mediaOperationEpoch ||
        pc !== this.pc ||
        sessionId !== this.sessionId
      )
        throw new Error("MEDIA_CONTEXT_STALE");
      if (!response.ok)
        throw new Error(`Unsubscribe failed (${response.status})`);
    }
    for (const publication of publications) {
      const key = `${publication.sessionId}:${publication.trackName}`;
      this.subscribedTracks.delete(key);
      const mid = this.subscribedMids.get(key);
      if (mid) this.remoteByMid.delete(mid);
      this.subscribedMids.delete(key);
      const stream = this.remoteStreams.get(key);
      if (stream) {
        for (const track of stream.getTracks()) {
          this.releaseRemoteTrack(track.id);
          track.stop();
        }
      }
      this.remoteStreams.delete(key);
      if (publication.kind === "video") this.emitVideo(publication, null);
    }
  }

  public async stopWatchingStream(
    publisherSessionId: string,
    serverAlreadyClosed = false,
  ): Promise<void> {
    await this.pendingWatches.get(publisherSessionId)?.catch(() => undefined);
    if (!this.sessionId || !this.currentChannelId) return;
    const publication = [...this.currentPublications.values()].find(
      (item) =>
        item.sessionId === publisherSessionId && item.source === "screen",
    );
    this.watchingSessions.delete(publisherSessionId);
    const previous = this.watchStates.get(publisherSessionId);
    if (previous) this.setWatchState({ ...previous, watching: false });
    const response = serverAlreadyClosed
      ? null
      : await apiFetch(`${API_BASE}/api/cloudflare-realtime/streams/unwatch`, {
          method: "POST",
          headers: this.authHeaders,
          body: JSON.stringify({
            channelId: this.currentChannelId,
            sessionId: this.sessionId,
            publisherSessionId,
          }),
        }).catch(() => null);
    try {
      await this.releaseScreenSubscriptions(
        publisherSessionId,
        serverAlreadyClosed,
      );
    } finally {
      if (response?.ok)
        this.setWatchState((await response.json()) as CfStreamWatchState);
      else if (publication)
        this.setWatchState({
          channelId: this.currentChannelId,
          publisherSessionId,
          hostUserId: publication.userId,
          viewerCount: previous?.viewerCount || 0,
          watching: false,
        });
    }
  }

  public onNetworkStatsUpdate(
    listener: (stats: Map<string, NetworkStats>) => void,
  ): () => void {
    this.networkListeners.add(listener);
    listener(new Map(this.networkStats));
    return () => {
      this.networkListeners.delete(listener);
    };
  }

  public getNetworkStats(identity?: string): NetworkStats | null {
    const key = identity || useAuthStore.getState().user?.id || "local";
    const stats = this.networkStats.get(key);
    return stats && Date.now() - stats.timestamp < 5_000 ? stats : null;
  }

  public getAllNetworkStats(): NetworkStats[] {
    return [...this.networkStats.values()].filter(
      (stats) => Date.now() - stats.timestamp < 5_000,
    );
  }

  public async getDetailedStats(
    identity?: string,
  ): Promise<StreamDetailedStats> {
    if (this.pc && this.connectionStatus === "connected")
      await this.refreshStats();
    const userId = identity || useAuthStore.getState().user?.id || "local";
    return (
      this.detailedStats.get(userId) ||
      this.emptyDetailedStats(
        userId,
        !identity || identity === useAuthStore.getState().user?.id,
      )
    );
  }

  private emptyDetailedStats(
    identity: string,
    isLocal: boolean,
  ): StreamDetailedStats {
    return {
      participantIdentity: identity,
      isLocal,
      mimeType: tGlobal("voice:networkStats.noMedia"),
      playerCore: "WebRTC / Cloudflare Realtime",
      audioInfo: tGlobal("voice:networkStats.noAudio"),
      encoder: tGlobal("voice:networkStats.unknown"),
      streamHost: "Cloudflare SFU",
      connectionMode: tGlobal("voice:networkStats.waitingMedia"),
      topology: "SFU_SERVER",
      protocol: tGlobal("voice:networkStats.unknown"),
      bufferLength: tGlobal("voice:networkStats.adaptive"),
      downloadBitrate: tGlobal("voice:connectionPopover.noData"),
      uploadBitrate: tGlobal("voice:connectionPopover.noData"),
      rtt: tGlobal("voice:networkStats.noSfuRtt"),
      packetLoss: tGlobal("voice:connectionPopover.noData"),
      jitter: tGlobal("voice:connectionPopover.noData"),
      transportVerified: false,
    };
  }

  private startStatsPolling(): void {
    if (this.statsTimer) return;
    void this.refreshStats();
    this.statsTimer = setInterval(() => {
      void this.refreshStats();
    }, 1_000);
  }

  private statsInFlight: Promise<void> | null = null;
  private refreshStats(): Promise<void> {
    if (this.statsInFlight) return this.statsInFlight;
    this.statsInFlight = this.collectStats()
      .catch((error) => {
        console.warn("[CF Realtime] RTC stats collection failed", error);
      })
      .finally(() => {
        this.statsInFlight = null;
      });
    return this.statsInFlight;
  }

  private async collectStats(): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.connectionState === "closed") return;
    const report = await pc.getStats();
    if (this.pc !== pc) return;
    const stats = [...report.values()] as RtcRecord[];
    const byId = new Map(stats.map((item) => [item.id, item]));
    const selectedId = stats.find(
      (item) => item.type === "transport" && item.selectedCandidatePairId,
    )?.selectedCandidatePairId;
    const pair = selectedId
      ? byId.get(selectedId)
      : stats.find(
          (item) =>
            item.type === "candidate-pair" &&
            item.state === "succeeded" &&
            item.nominated,
        );
    const localCandidate = pair?.localCandidateId
      ? byId.get(pair.localCandidateId)
      : undefined;
    const remoteCandidate = pair?.remoteCandidateId
      ? byId.get(pair.remoteCandidateId)
      : undefined;
    const rttMs =
      typeof pair?.currentRoundTripTime === "number"
        ? Math.round(pair.currentRoundTripTime * 1000)
        : undefined;
    const protocol = (
      remoteCandidate?.protocol ||
      localCandidate?.protocol ||
      tGlobal("voice:networkStats.unknown")
    ).toUpperCase();
    const candidateType =
      localCandidate?.candidateType || remoteCandidate?.candidateType;
    this.selectedPath =
      pair && candidateType ? { candidateType, protocol } : null;
    const connectionMode = tGlobal(
      candidateType === "relay"
        ? "voice:connectionPopover.pathTurn"
        : "voice:connectionPopover.pathSfu",
      { protocol },
    );
    const host = remoteCandidate?.address
      ? `${remoteCandidate.address}:${remoteCandidate.port || ""}`
      : "Cloudflare SFU";
    const ipVersion = remoteCandidate?.address
      ? remoteCandidate.address.includes(":")
        ? "IPv6"
        : "IPv4"
      : undefined;
    const localId = useAuthStore.getState().user?.id || "local";
    const identities = new Set<string>([localId]);
    for (const publication of this.remoteByMid.values())
      if (publication.userId) identities.add(publication.userId);
    const nextNetwork = new Map<string, NetworkStats>();
    const nextDetailed = new Map<string, StreamDetailedStats>();
    for (const identity of identities) {
      const isLocal = identity === localId;
      const mids = new Set<string>();
      if (isLocal)
        for (const published of this.publishedTracks.values())
          mids.add(published.mid);
      else
        for (const [mid, publication] of this.remoteByMid)
          if (publication.userId === identity) mids.add(mid);
      const trackIds = new Set<string>();
      if (!isLocal)
        for (const [key, stream] of this.remoteStreams) {
          const publication = this.currentPublications.get(key);
          if (publication?.userId === identity)
            stream.getTracks().forEach((track) => trackIds.add(track.id));
        }
      const media = stats.filter((item) => {
        if (item.type !== (isLocal ? "outbound-rtp" : "inbound-rtp"))
          return false;
        if (item.mid) return mids.has(item.mid);
        return !!item.trackIdentifier && trackIds.has(item.trackIdentifier);
      });
      let received = 0,
        sent = 0,
        downBps = 0,
        upBps = 0,
        packets = 0,
        lost = 0,
        jitterMs = 0,
        jitterCount = 0,
        decoded = 0,
        encoded = 0;
      let audioCodec: string | undefined,
        videoCodec: string | undefined,
        videoInfo: string | undefined;
      for (const item of media) {
        const codec = item.codecId
          ? byId.get(item.codecId)?.mimeType
          : undefined;
        const kind =
          item.kind ||
          item.mediaType ||
          (codec?.startsWith("video/") ? "video" : "audio");
        if (codec && !/\/((rtx)|(red)|(ulpfec)|(flexfec)|(cn))$/i.test(codec)) {
          if (kind === "video") videoCodec = codec;
          else audioCodec = codec;
        }
        const bytes = isLocal ? item.bytesSent || 0 : item.bytesReceived || 0;
        if (isLocal) sent += bytes;
        else received += bytes;
        const prior = this.previousStats.get(item.id);
        if (prior && item.timestamp > prior.timestamp && bytes >= prior.bytes) {
          const rate =
            ((bytes - prior.bytes) * 8_000) /
            (item.timestamp - prior.timestamp);
          if (isLocal) upBps += rate;
          else downBps += rate;
        }
        const packetCount = isLocal
          ? item.packetsSent || 0
          : item.packetsReceived || 0;
        const feedback = isLocal
          ? stats.find(
              (entry) =>
                entry.type === "remote-inbound-rtp" &&
                entry.localId === item.id,
            )
          : item;
        const lostCount = feedback?.packetsLost || 0;
        const priorPackets = prior?.packets;
        const priorLost = prior?.lost;
        if (
          !isLocal &&
          priorPackets !== undefined &&
          priorLost !== undefined &&
          packetCount >= priorPackets &&
          lostCount >= priorLost
        ) {
          packets += packetCount - priorPackets;
          lost += lostCount - priorLost;
        }
        if (
          isLocal &&
          typeof feedback?.fractionLost === "number" &&
          Number.isFinite(feedback.fractionLost)
        ) {
          const fraction = Math.max(0, Math.min(1, feedback.fractionLost));
          packets += 100 * (1 - fraction);
          lost += 100 * fraction;
        }
        this.previousStats.set(item.id, {
          bytes,
          timestamp: item.timestamp,
          packets: packetCount,
          lost: lostCount,
        });
        if (typeof item.jitter === "number") {
          jitterMs += item.jitter * 1_000;
          jitterCount++;
        }
        if (kind === "video") {
          if (isLocal) encoded += item.framesEncoded || 0;
          else decoded += item.framesDecoded || 0;
          if (item.frameWidth && item.frameHeight)
            videoInfo = `${item.frameWidth}×${item.frameHeight}${item.framesPerSecond ? ` @ ${Math.round(item.framesPerSecond)} FPS` : ""}`;
        }
      }
      if (media.length === 0 && !isLocal) continue;
      const loss =
        packets + lost > 0
          ? Math.round((lost / (packets + lost)) * 10_000) / 100
          : undefined;
      const jitter = jitterCount
        ? Math.round(jitterMs / jitterCount)
        : undefined;
      const bitrate = Math.round((isLocal ? upBps : downBps) / 1_000);
      const quality: NetworkStats["quality"] =
        !media.length || rttMs === undefined
          ? "unknown"
          : rttMs > 250 || (loss ?? 0) > 5
            ? "poor"
            : rttMs > 120 || (loss ?? 0) > 2
              ? "good"
              : "excellent";
      nextNetwork.set(identity, {
        identity,
        rtt: rttMs,
        packetLoss: loss,
        jitter,
        bitrate,
        codec: audioCodec,
        videoCodec,
        videoResolution: videoInfo?.split(" @ ")[0],
        videoFramerate: videoInfo?.includes(" @ ")
          ? Number(videoInfo.split(" @ ")[1].split(" ")[0])
          : undefined,
        videoBitrate: videoCodec ? bitrate : undefined,
        quality,
        timestamp: Date.now(),
      });
      const formatRate = (bps: number, bytes: number) =>
        `${bps > 0 ? `${Math.round(bps / 1_000)} kbps` : tGlobal("voice:networkStats.noRate")} (${(bytes / 1_048_576).toFixed(2)} MiB)`;
      nextDetailed.set(identity, {
        participantIdentity: identity,
        isLocal,
        mimeType:
          videoCodec || audioCodec || tGlobal("voice:networkStats.noCodec"),
        playerCore: "WebRTC / Cloudflare Realtime",
        videoInfo,
        audioInfo: audioCodec || tGlobal("voice:networkStats.noAudio"),
        encoder: isLocal
          ? videoCodec || audioCodec || tGlobal("voice:networkStats.unknown")
          : tGlobal("voice:networkStats.remoteEncoderUnknown"),
        streamHost: host,
        connectionMode,
        topology: "SFU_SERVER",
        protocol,
        bufferLength: tGlobal("voice:networkStats.adaptive"),
        encodedFrames: isLocal && videoInfo ? String(encoded) : undefined,
        decodedFrames: !isLocal && videoInfo ? String(decoded) : undefined,
        downloadBitrate: formatRate(downBps, received),
        uploadBitrate: formatRate(upBps, sent),
        rawDownloadBitrateBps: downBps,
        rawUploadBitrateBps: upBps,
        totalBytesReceived: received,
        totalBytesSent: sent,
        rtt:
          rttMs === undefined
            ? tGlobal("voice:networkStats.noSfuRtt")
            : tGlobal("voice:networkStats.sfuRtt", { value: rttMs }),
        packetLoss:
          loss === undefined
            ? tGlobal("voice:connectionPopover.noData")
            : `${loss}%`,
        jitter:
          jitter === undefined
            ? tGlobal("voice:connectionPopover.noData")
            : `${jitter} ms`,
        ipVersion,
        candidateType,
        actualSendCodec: isLocal ? videoCodec || audioCodec : undefined,
        actualReceiveCodec: !isLocal ? videoCodec || audioCodec : undefined,
        transportVerified:
          !!pair &&
          media.some(
            (item) =>
              (isLocal ? item.bytesSent || 0 : item.bytesReceived || 0) > 0,
          ),
      });
    }
    this.networkStats = nextNetwork;
    this.detailedStats = nextDetailed;
    for (const listener of this.networkListeners)
      listener(new Map(nextNetwork));
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
    this.mediaOperationEpoch++;
    this.announcementTask?.controller.abort();
    this.announcementTask = null;
    this.announcedTracks.clear();
    const pendingCleanup: Promise<unknown>[] = [];

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
    if (oldSessionId) pendingCleanup.push(this.leaveMediaSession(oldSessionId));
    // 释放远端播放 Audio 元素
    for (const trackId of [...this.audioElements.keys()])
      this.releaseRemoteTrack(trackId);
    this.unbindPlaybackLifecycleListeners();
    if (this.playbackContext) {
      this.playbackContext.removeEventListener(
        "statechange",
        this.handlePlaybackContextStateChange,
      );
      pendingCleanup.push(this.playbackContext.close().catch(() => undefined));
    }
    this.playbackContext = null;
    this.masterGain = null;
    this.setAudioPlaybackStatus({
      canPlay: true,
      isInterrupted: false,
      error: undefined,
    });
    this.activeSpeakers.clear();
    this.emitSpeakers();
    this.remoteStreams.clear();
    this.currentPublications.clear();
    this.initialPublications = [];
    this.initialPublicationRevision = 0;
    this.latestPublications = null;
    this.latestPublicationRevision = 0;
    this.publicationSyncReady = false;
    if (this.subscriptionRetryTimer) clearTimeout(this.subscriptionRetryTimer);
    this.subscriptionRetryTimer = null;
    this.subscriptionRetries.clear();
    this.pendingSubscriptionRetries.clear();
    this.operation = Promise.resolve();
    this.remoteByMid.clear();
    this.subscribedTracks.clear();
    this.subscribedMids.clear();
    this.watchingSessions.clear();
    this.pendingWatches.clear();
    this.watchStates.clear();
    for (const listener of this.publicationListeners) listener([]);
    this.networkStats.clear();
    this.detailedStats.clear();
    this.selectedPath = null;
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
        sframeManager.detachPeerConnection(this.pc);
        this.pc.close();
      } catch {}
      this.pc = null;
    }

    this.sessionId = null;
    this.currentChannelId = null;
    this.callContext = null;
    this.setStatus("disconnected");
    await Promise.allSettled(pendingCleanup);
  }

  private async waitForIceGathering(
    pc: RTCPeerConnection,
    options?: {
      timeoutMs?: number;
      debounceMs?: number;
      maxGatherTimeMs?: number;
    },
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 10_000;
    const debounceMs = options?.debounceMs ?? 100;
    const maxGatherTimeMs = options?.maxGatherTimeMs ?? 750;

    const candidateTypes = new Set<string>();
    let gatheredCandidateCount = 0;
    const captureSdpCandidates = () => {
      const sdp = pc.localDescription?.sdp || "";
      for (const match of sdp.matchAll(/\btyp\s+(host|srflx|prflx|relay)\b/g))
        candidateTypes.add(match[1]);
    };
    const configuration = pc.getConfiguration?.() || {};
    const relayOnly = configuration.iceTransportPolicy === "relay";
    const hasTurnServer = (configuration.iceServers || []).some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => /^turns?:/i.test(url));
    });
    const hasAnyCandidate = () => {
      captureSdpCandidates();
      return candidateTypes.size > 0 || gatheredCandidateCount > 0;
    };
    const hasPreferredCandidate = () => {
      captureSdpCandidates();
      return relayOnly
        ? candidateTypes.has("relay")
        : candidateTypes.has("srflx") || candidateTypes.has("relay");
    };
    const hasFinalCandidate = () => {
      return relayOnly ? hasPreferredCandidate() : hasAnyCandidate();
    };

    // Cloudflare 使用完整 SDP（非 trickle ICE）协商。收集中不能因首个
    // host 候选提前提交；收集完成后普通策略仍保留 host-only 的 ICE 回退，
    // relay-only 策略则必须实际收集到 relay 候选。
    if (pc.iceGatheringState === "complete") {
      if (hasFinalCandidate()) return;
      throw new Error("No ICE candidates gathered for the required transport");
    }

    await new Promise<void>((resolve, reject) => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;
      let finished = false;

      const cleanup = () => {
        finished = true;
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (maxTimer) {
          clearTimeout(maxTimer);
          maxTimer = null;
        }
        if (hardTimer) {
          clearTimeout(hardTimer);
          hardTimer = null;
        }
        pc.removeEventListener("icecandidate", onCandidate);
        pc.removeEventListener("icegatheringstatechange", onStateChange);
      };

      const finish = (isSuccess: boolean, reason?: string) => {
        if (finished) return;
        cleanup();
        if (isSuccess && hasFinalCandidate()) {
          resolve();
        } else {
          reject(
            new Error(
              reason || "No ICE candidates gathered for the required transport",
            ),
          );
        }
      };

      const onCandidate = (e: RTCPeerConnectionIceEvent) => {
        if (!e.candidate) {
          // 浏览器底层所有候选收集完成标志
          finish(hasFinalCandidate());
          return;
        }

        gatheredCandidateCount++;
        const candidateStr = e.candidate.candidate || "";
        const typeMatch = candidateStr.match(
          /\btyp\s+(host|srflx|prflx|relay)\b/,
        );
        if (typeMatch) candidateTypes.add(typeMatch[1]);
        // 捕获到公网反射 (srflx) 或中继 (relay) 候选时，启动短防抖打捞，不必死等慢速的 TLS/TCP TURN 协议
        const isPublicOrRelay = relayOnly
          ? candidateTypes.has("relay")
          : candidateTypes.has("srflx") || candidateTypes.has("relay");

        const canDebounce =
          candidateTypes.has("relay") ||
          (!hasTurnServer && candidateTypes.has("srflx"));
        if (isPublicOrRelay && canDebounce && !debounceTimer) {
          debounceTimer = setTimeout(() => {
            finish(true);
          }, debounceMs);
        }
      };

      const onStateChange = () => {
        if (pc.iceGatheringState === "complete") {
          finish(hasFinalCandidate());
        }
      };

      // 达到最大打捞时间，仅在已有公网可用候选时提前提交 SDP。
      maxTimer = setTimeout(() => {
        if (hasPreferredCandidate()) {
          finish(true);
        }
      }, maxGatherTimeMs);

      // 最终硬超时兜底保护
      hardTimer = setTimeout(() => {
        finish(hasFinalCandidate(), "ICE candidate gathering timed out");
      }, timeoutMs);

      pc.addEventListener("icecandidate", onCandidate);
      pc.addEventListener("icegatheringstatechange", onStateChange);

      captureSdpCandidates();
      if (hasPreferredCandidate() && !debounceTimer)
        debounceTimer = setTimeout(() => finish(true), debounceMs);
      // 防御性立即检查一次状态
      if (pc.iceGatheringState === "complete") {
        finish(hasFinalCandidate());
      }
    });
  }

  /**
   * 诊断与测试专用：暴露 waitForIceGathering 以便执行基准时延与边界测试
   */
  public async testWaitForIceGathering(
    pc: RTCPeerConnection,
    options?: {
      timeoutMs?: number;
      debounceMs?: number;
      maxGatherTimeMs?: number;
    },
  ): Promise<void> {
    return this.waitForIceGathering(pc, options);
  }
}

export const cloudflareRealtimeService = new CloudflareRealtimeService();

if (typeof window !== "undefined") {
  (
    window as unknown as {
      cloudflareRealtimeService: CloudflareRealtimeService;
    }
  ).cloudflareRealtimeService = cloudflareRealtimeService;
}
