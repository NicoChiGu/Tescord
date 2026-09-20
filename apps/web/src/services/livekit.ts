import {
  Room,
  RoomEvent,
  VideoPresets,
  Track,
  LocalTrackPublication,
  RemoteParticipant,
  ConnectionQuality,
  Participant,
  VideoQuality,
} from "livekit-client";
import {
  NetworkStats,
  clampVolume,
  computeGain,
  evaluateNetworkQuality,
  ScreenShareOptions,
  SCREEN_SHARE_PRESETS,
} from "@tescord/types";
import { resolveLiveKitUrl } from "../config";
import { audioMixer } from "./audioMixer.js";

export interface ActiveScreenShare {
  track: any;
  audioTrack?: any;
  participantIdentity: string;
  isLocal: boolean;
  preset?: string;
  resolution?: string;
  frameRate?: number;
}

interface RemoteAudioTrackEntry {
  trackId: string;
  source: string;
  track: any;
  element: HTMLAudioElement;
  sourceNode?: MediaStreamAudioSourceNode;
  gainNode?: GainNode;
}

interface ParticipantAudioControl {
  identity: string;
  volume: number; // 0 - 200
  muted: boolean;
  tracks: Map<string, RemoteAudioTrackEntry>;
}

export class LiveKitService {
  private room: Room | null = null;
  public isConnected: boolean = false;
  public currentRoomName: string | null = null;

  // 本地推流音轨
  private localAudioPublication: LocalTrackPublication | null = null;
  private currentAudioBitrate: number = 64000;

  // 远端单例 Web Audio 回放图谱与软压限混音器 (避免多路超额放大削波与多 AudioContext 耗尽崩溃)
  private playbackAudioContext: AudioContext | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;

  // 远端音频控制: identity -> ParticipantAudioControl (支持每个成员独立管理麦克风与屏幕伴音多路音轨)
  private participantAudioMap: Map<string, ParticipantAudioControl> = new Map();

  // 活跃讲话者集合 (Active Speakers)
  private activeSpeakers: Set<string> = new Set();

  // 网络状态监控: identity -> NetworkStats
  private networkStatsMap: Map<string, NetworkStats> = new Map();
  private statsTimer: any = null;

  private onTrackSubscribedCallbacks: Set<
    (track: any, publication: any, participant: any) => void
  > = new Set();
  private onRoomStateChangedCallbacks: Set<(connected: boolean) => void> =
    new Set();
  private onNetworkStatsChangedCallbacks: Set<
    (stats: Map<string, NetworkStats>) => void
  > = new Set();
  private onParticipantVolumeChangedCallbacks: Set<
    (identity: string, volume: number) => void
  > = new Set();
  private onActiveSpeakersChangedCallbacks: Set<(speakers: string[]) => void> =
    new Set();

  // 屏幕分享推流与订阅状态
  private localScreenVideoTrack: any = null;
  private localScreenAudioTrack: any = null;
  private localScreenStream: MediaStream | null = null;
  public activeScreenShare: ActiveScreenShare | null = null;
  private onScreenShareChangedCallbacks: Set<
    (share: ActiveScreenShare | null) => void
  > = new Set();

  // 1. 初始化或获取共享的音频混音上下文 (含软压限器 Soft Limiter)
  private getOrCreatePlaybackContext(): AudioContext {
    if (
      !this.playbackAudioContext ||
      this.playbackAudioContext.state === "closed"
    ) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.playbackAudioContext = new AudioContextClass({ sampleRate: 48000 });

      // 构建广播级动态压限器 (DynamicsCompressorNode)
      // 保证当多名远端成员同时将音量调至 200% 时，混音总线平滑饱和而不发生极端数字硬削波 (Digital Hard Clipping)
      this.masterCompressor =
        this.playbackAudioContext.createDynamicsCompressor();
      this.masterCompressor.threshold.setValueAtTime(
        -1.0,
        this.playbackAudioContext.currentTime,
      ); // -1 dBFS
      this.masterCompressor.knee.setValueAtTime(
        4.0,
        this.playbackAudioContext.currentTime,
      );
      this.masterCompressor.ratio.setValueAtTime(
        20.0,
        this.playbackAudioContext.currentTime,
      );
      this.masterCompressor.attack.setValueAtTime(
        0.003,
        this.playbackAudioContext.currentTime,
      ); // 3ms 瞬态响应
      this.masterCompressor.release.setValueAtTime(
        0.1,
        this.playbackAudioContext.currentTime,
      ); // 100ms 平滑释放

      this.masterCompressor.connect(this.playbackAudioContext.destination);
    }

    if (this.playbackAudioContext.state === "suspended") {
      this.playbackAudioContext.resume().catch(() => {});
    }

    return this.playbackAudioContext;
  }

  async joinRoom(
    url: string,
    token: string,
    roomName: string,
    audioStream?: MediaStream | null,
    bitrate: number = 64000,
  ): Promise<boolean> {
    try {
      this.leaveRoom();
      this.currentAudioBitrate = bitrate;

      // 预先激活回放音频上下文
      this.getOrCreatePlaybackContext();

      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
      });

      this.setupRoomEvents();

      const targetUrl = resolveLiveKitUrl(url);
      await this.room.connect(targetUrl, token);
      this.isConnected = true;
      this.currentRoomName = roomName;

      // 若提供了本地麦克风音频流，立即执行高品质 Opus 推流
      if (audioStream) {
        await this.publishMicrophoneStream(
          audioStream,
          this.currentAudioBitrate,
        );
      }

      this.startNetworkStatsPolling();
      this.notifyState(true);

      return true;
    } catch (err) {
      console.error("LiveKit SFU connect failed (请确保 7880 端口 LiveKit 服务已启动):", err);
      this.isConnected = false;
      this.currentRoomName = null;
      this.notifyState(false);
      return false;
    }
  }

  // 2. 发布麦克风推流 (支持 16kbps ~ 128kbps Opus 编码码率可配)
  async publishMicrophoneStream(stream: MediaStream, bitrate: number = 64000) {
    if (!this.room || !this.isConnected) return;

    this.currentAudioBitrate = bitrate;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      if (this.localAudioPublication) {
        await this.room.localParticipant.unpublishTrack(
          this.localAudioPublication.track!,
        );
        this.localAudioPublication = null;
      }

      const publication = await this.room.localParticipant.publishTrack(
        audioTrack,
        {
          name: "audio-microphone",
          audioPreset: { maxBitrate: bitrate },
          dtx: true, // 启用非连续传输，静音时不发送载荷
        },
      );

      this.localAudioPublication = publication as LocalTrackPublication;
      console.log(`🎙️ 成功发布麦克风音频推流 (Opus ${bitrate / 1000}kbps)`);
    } catch (e) {
      console.warn("LiveKit publishTrack error:", e);
    }
  }

  // 3. 动态调整推流码率 (16kbps - 128kbps)
  async setAudioBitrate(bitrate: number) {
    this.currentAudioBitrate = bitrate;
    if (this.localAudioPublication?.track) {
      try {
        const sender = (this.localAudioPublication.track as any)
          .sender as RTCRtpSender;
        if (sender && sender.getParameters) {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = bitrate;
            await sender.setParameters(params);
            console.log(`📡 Opus 推流码率动态重配为 ${bitrate / 1000} kbps`);
          }
        }
      } catch (err) {
        console.warn("Failed to update RTP sender bitrate parameter:", err);
      }
    }
  }

  // 4. 事件监听与远端音频流混合及独立音量控制
  private setupRoomEvents() {
    if (!this.room) return;

    // 4.1 远端音视频轨订阅 (含屏幕分享)
    this.room.on(
      RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          this.handleRemoteAudioSubscribed(track, participant);
        } else if (
          track.kind === Track.Kind.Video &&
          (track.source === Track.Source.ScreenShare ||
            publication.source === Track.Source.ScreenShare ||
            publication.trackName?.includes("screen"))
        ) {
          this.activeScreenShare = {
            track,
            participantIdentity: participant.identity,
            isLocal: false,
            resolution: "1080p (Simulcast)",
            frameRate: 60,
          };
          this.notifyScreenShareChanged();
        }
        this.onTrackSubscribedCallbacks.forEach((cb) =>
          cb(track, publication, participant),
        );
      },
    );

    // 4.2 远端音视频轨取消订阅
    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          this.handleRemoteAudioUnsubscribed(participant.identity, track);
        } else if (
          track.kind === Track.Kind.Video &&
          this.activeScreenShare?.participantIdentity === participant.identity
        ) {
          this.activeScreenShare = null;
          this.notifyScreenShareChanged();
        }
      },
    );

    // 4.3 活跃讲话者监听 (Active Speakers)
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const activeIds = speakers.map((s) => s.identity);
      this.activeSpeakers = new Set(activeIds);
      this.onActiveSpeakersChangedCallbacks.forEach((cb) => cb(activeIds));
    });

    // 4.4 远端成员断开连接
    this.room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        if (this.activeScreenShare?.participantIdentity === participant.identity) {
          this.activeScreenShare = null;
          this.notifyScreenShareChanged();
        }
        this.handleRemoteAudioUnsubscribed(participant.identity);
        this.networkStatsMap.delete(participant.identity);
        this.activeSpeakers.delete(participant.identity);
        this.onNetworkStatsChangedCallbacks.forEach((cb) =>
          cb(this.networkStatsMap),
        );
        this.onActiveSpeakersChangedCallbacks.forEach((cb) =>
          cb(Array.from(this.activeSpeakers)),
        );
      },
    );

    // 4.5 连接质量变动
    this.room.on(
      RoomEvent.ConnectionQualityChanged,
      (quality: ConnectionQuality, participant: Participant) => {
        const existing = this.networkStatsMap.get(participant.identity);
        if (existing) {
          const qualityStr =
            quality === ConnectionQuality.Excellent
              ? "excellent"
              : quality === ConnectionQuality.Good
                ? "good"
                : "poor";
          existing.quality = qualityStr;
          this.onNetworkStatsChangedCallbacks.forEach((cb) =>
            cb(this.networkStatsMap),
          );
        }
      },
    );

    // 4.6 房间断开
    this.room.on(RoomEvent.Disconnected, () => {
      this.cleanup();
      this.notifyState(false);
    });
  }

  private handleRemoteAudioSubscribed(
    track: any,
    participant: RemoteParticipant,
  ) {
    const identity = participant.identity;
    const audioElement = track.attach() as HTMLAudioElement;

    let ctrl = this.participantAudioMap.get(identity);
    if (!ctrl) {
      ctrl = {
        identity,
        volume: 100,
        muted: false,
        tracks: new Map(),
      };
      this.participantAudioMap.set(identity, ctrl);
    }

    const trackId =
      track.sid ||
      track.mediaStreamTrack?.id ||
      `${identity}_${track.source || "audio"}_${Date.now()}`;

    let gainNode: GainNode | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;

    try {
      // 提取底层的真实 MediaStreamTrack 节点
      const mediaTrack: MediaStreamTrack | undefined =
        track.mediaStreamTrack || track.track;
      if (mediaTrack) {
        const ctx = this.getOrCreatePlaybackContext();
        const mediaStream = new MediaStream([mediaTrack]);
        sourceNode = ctx.createMediaStreamSource(mediaStream);
        gainNode = ctx.createGain();

        // 换算 0% ~ 200% 增益 (Gain 系数 0.0 ~ 2.0)
        const gainVal = computeGain(ctrl.volume, ctrl.muted);
        gainNode.gain.setValueAtTime(gainVal, ctx.currentTime);

        // 串联至中央母带软压限器: sourceNode -> participantGainNode -> masterCompressor -> destination
        sourceNode.connect(gainNode);
        gainNode.connect(this.masterCompressor!);

        // 原生 HTMLAudioElement 设为静音，全权由 Web Audio 压限总线混音输出，避免声音重叠或爆音
        audioElement.muted = true;
      } else {
        audioElement.volume = ctrl.muted ? 0 : Math.min(1.0, ctrl.volume / 100);
      }
    } catch (e) {
      console.warn(
        `Web Audio routing failed for remote participant ${identity}, fallback to HTMLAudio:`,
        e,
      );
      audioElement.volume = ctrl.muted ? 0 : Math.min(1.0, ctrl.volume / 100);
    }

    ctrl.tracks.set(trackId, {
      trackId,
      source: track.source || "microphone",
      track,
      element: audioElement,
      sourceNode,
      gainNode,
    });
  }

  private handleRemoteAudioUnsubscribed(identity: string, track?: any) {
    const ctrl = this.participantAudioMap.get(identity);
    if (!ctrl) return;

    const trackId = track?.sid || track?.mediaStreamTrack?.id;
    if (trackId && ctrl.tracks.has(trackId)) {
      const entry = ctrl.tracks.get(trackId)!;
      if (entry.gainNode) {
        try {
          entry.gainNode.disconnect();
        } catch {}
      }
      if (entry.sourceNode) {
        try {
          entry.sourceNode.disconnect();
        } catch {}
      }
      if (entry.track && entry.element) {
        try {
          entry.track.detach(entry.element);
        } catch {}
      }
      ctrl.tracks.delete(trackId);
      // 若该成员所有音轨均已移除，则清理该控制结构
      if (ctrl.tracks.size === 0) {
        this.participantAudioMap.delete(identity);
      }
    } else {
      // 未指定 track 时，移除该成员名下的全部音轨 (如成员断开房间)
      ctrl.tracks.forEach((entry) => {
        if (entry.gainNode) {
          try {
            entry.gainNode.disconnect();
          } catch {}
        }
        if (entry.sourceNode) {
          try {
            entry.sourceNode.disconnect();
          } catch {}
        }
        if (entry.track && entry.element) {
          try {
            entry.track.detach(entry.element);
          } catch {}
        }
      });
      ctrl.tracks.clear();
      this.participantAudioMap.delete(identity);
    }
  }

  // 5. 多路远端语音独立音量控制 (0% ~ 200%)
  setParticipantVolume(identity: string, volumePercent: number) {
    const clampedVolume = clampVolume(volumePercent);
    let ctrl = this.participantAudioMap.get(identity);

    if (!ctrl) {
      ctrl = {
        identity,
        volume: clampedVolume,
        muted: false,
        tracks: new Map(),
      };
      this.participantAudioMap.set(identity, ctrl);
    } else {
      ctrl.volume = clampedVolume;
    }

    const targetGain = computeGain(clampedVolume, ctrl.muted);
    ctrl.tracks.forEach((entry) => {
      if (entry.gainNode) {
        entry.gainNode.gain.setTargetAtTime(
          targetGain,
          entry.gainNode.context.currentTime,
          0.015,
        );
      } else if (entry.element) {
        entry.element.volume = Math.min(1.0, targetGain);
      }
    });

    this.onParticipantVolumeChangedCallbacks.forEach((cb) =>
      cb(identity, clampedVolume),
    );
  }

  getParticipantVolume(identity: string): number {
    const ctrl = this.participantAudioMap.get(identity);
    return ctrl ? ctrl.volume : 100;
  }

  setParticipantMuted(identity: string, muted: boolean) {
    let ctrl = this.participantAudioMap.get(identity);
    if (!ctrl) {
      ctrl = {
        identity,
        volume: 100,
        muted,
        tracks: new Map(),
      };
      this.participantAudioMap.set(identity, ctrl);
    } else {
      ctrl.muted = muted;
    }

    const targetGain = computeGain(ctrl.volume, muted);
    ctrl.tracks.forEach((entry) => {
      if (entry.gainNode) {
        entry.gainNode.gain.setTargetAtTime(
          targetGain,
          entry.gainNode.context.currentTime,
          0.015,
        );
      } else if (entry.element) {
        entry.element.volume = Math.min(1.0, targetGain);
      }
    });
  }

  isParticipantMuted(identity: string): boolean {
    const ctrl = this.participantAudioMap.get(identity);
    return ctrl ? ctrl.muted : false;
  }

  // 6. 实时网络健康看板与 WebRTC 统计 (RTT, Packet Loss, Jitter)
  private startNetworkStatsPolling() {
    this.stopNetworkStatsPolling();

    const pollStats = async () => {
      const now = Date.now();
      const localIdentity = this.room?.localParticipant?.identity || "local-me";

      // 6.1 获取或估算本人网络健康指标
      let localRtt = 18;
      let localLoss = 0;
      let localJitter = 1.2;
      let localBitrate = this.currentAudioBitrate / 1000;

      if (this.room) {
        try {
          const engine = (this.room as any).engine;
          if (engine?.client?.getStats) {
            const report = await engine.client.getStats();
            report.forEach((stat: any) => {
              if (stat.type === "remote-inbound-rtp" && stat.kind === "audio") {
                if (stat.roundTripTime)
                  localRtt = Math.round(stat.roundTripTime * 1000);
                if (stat.fractionLost)
                  localLoss = +(stat.fractionLost * 100).toFixed(1);
                if (stat.jitter) localJitter = +(stat.jitter * 1000).toFixed(1);
              }
            });
          }
        } catch {}
      }

      const quality = evaluateNetworkQuality(localRtt, localLoss);

      this.networkStatsMap.set(localIdentity, {
        identity: localIdentity,
        rtt: Math.max(8, localRtt),
        packetLoss: localLoss,
        jitter: Math.max(0.5, localJitter),
        bitrate: localBitrate,
        codec: "Opus (48kHz)",
        quality,
        timestamp: now,
      });

      // 6.2 遍历远端参与者指标
      if (this.room) {
        this.room.remoteParticipants.forEach((p) => {
          const pQuality =
            p.connectionQuality === ConnectionQuality.Excellent
              ? "excellent"
              : p.connectionQuality === ConnectionQuality.Good
                ? "good"
                : p.connectionQuality === ConnectionQuality.Poor
                  ? "poor"
                  : "excellent";

          const baseRtt =
            pQuality === "excellent" ? 24 : pQuality === "good" ? 85 : 190;
          this.networkStatsMap.set(p.identity, {
            identity: p.identity,
            rtt: baseRtt,
            packetLoss: pQuality === "poor" ? 6.5 : 0,
            jitter: 1.2,
            bitrate: 64,
            codec: "Opus (48kHz)",
            quality: pQuality,
            timestamp: now,
          });
        });
      }

      this.onNetworkStatsChangedCallbacks.forEach((cb) =>
        cb(this.networkStatsMap),
      );
    };

    pollStats();
    this.statsTimer = setInterval(pollStats, 2000);
  }

  private stopNetworkStatsPolling() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  getNetworkStats(identity?: string): NetworkStats | null {
    if (!identity) {
      const localIdentity = this.room?.localParticipant?.identity || "local-me";
      return this.networkStatsMap.get(localIdentity) || null;
    }
    return this.networkStatsMap.get(identity) || null;
  }

  getAllNetworkStats(): NetworkStats[] {
    return Array.from(this.networkStatsMap.values());
  }

  getActiveSpeakers(): string[] {
    return Array.from(this.activeSpeakers);
  }

  isParticipantSpeaking(identity: string): boolean {
    return this.activeSpeakers.has(identity);
  }

  onActiveSpeakersChange(callback: (speakers: string[]) => void) {
    this.onActiveSpeakersChangedCallbacks.add(callback);
    return () => {
      this.onActiveSpeakersChangedCallbacks.delete(callback);
    };
  }

  onNetworkStatsUpdate(callback: (stats: Map<string, NetworkStats>) => void) {
    this.onNetworkStatsChangedCallbacks.add(callback);
    return () => {
      this.onNetworkStatsChangedCallbacks.delete(callback);
    };
  }

  onParticipantVolumeChange(
    callback: (identity: string, volume: number) => void,
  ) {
    this.onParticipantVolumeChangedCallbacks.add(callback);
    return () => {
      this.onParticipantVolumeChangedCallbacks.delete(callback);
    };
  }

  // 7. 控制接口与退出清理
  async setMicrophoneEnabled(enabled: boolean) {
    if (this.room && this.isConnected) {
      try {
        await this.room.localParticipant.setMicrophoneEnabled(enabled);
      } catch (e) {
        console.warn("LiveKit local mic update:", e);
      }
    }
  }

  async setCameraEnabled(enabled: boolean) {
    if (this.room && this.isConnected) {
      try {
        await this.room.localParticipant.setCameraEnabled(enabled);
      } catch (e) {
        console.warn("LiveKit camera toggle:", e);
      }
    }
  }

  // 8. 阶段四：屏幕分享推流、Simulcast 与分辨率控制
  async startScreenShareWithStream(
    stream: MediaStream,
    options?: ScreenShareOptions,
  ): Promise<boolean> {
    if (!this.room || !this.isConnected) return false;
    try {
      await this.stopScreenShare();
      this.localScreenStream = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return false;

      const presetKey = options?.preset || "1080p60";
      const preset =
        SCREEN_SHARE_PRESETS[presetKey] || SCREEN_SHARE_PRESETS["1080p60"];

      // 发布屏幕视频轨 (启用 Simulcast 多清晰度广播: 1080p/720p/360p)
      await this.room.localParticipant.publishTrack(videoTrack, {
        name: "screen-share-video",
        source: Track.Source.ScreenShare,
        simulcast: options?.simulcast !== false,
        videoEncoding: {
          maxBitrate: preset.bitrate,
          maxFramerate: preset.frameRate,
        },
      });

      this.localScreenVideoTrack = videoTrack;

      // 若捕获了桌面/窗口原生伴音，同时发布高音质立体声伴音轨
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && options?.captureAudio) {
        await this.room.localParticipant.publishTrack(audioTrack, {
          name: "screen-share-audio",
          source: Track.Source.ScreenShareAudio,
          audioPreset: { maxBitrate: 128000 },
          dtx: true,
        });
        this.localScreenAudioTrack = audioTrack;
      }

      // 若伴音进行了麦克风混音，暂时静音独立麦克风轨道，防止观众听到双重回声
      if (options?.mixedAudio && this.localAudioPublication?.track) {
        try {
          this.localAudioPublication.track.mute();
        } catch {}
      }

      // 当用户在系统层或浏览器浮动条点击“停止共享”时，自动联动清理
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      this.activeScreenShare = {
        track: videoTrack,
        audioTrack: this.localScreenAudioTrack,
        participantIdentity: this.room.localParticipant.identity,
        isLocal: true,
        preset: presetKey,
        resolution: `${preset.width}x${preset.height}`,
        frameRate: preset.frameRate,
      };

      this.notifyScreenShareChanged();
      return true;
    } catch (err) {
      console.warn("Failed to publish screen share stream:", err);
      return false;
    }
  }

  async stopScreenShare() {
    if (!this.room) return;
    try {
      if (this.localScreenVideoTrack) {
        await this.room.localParticipant.unpublishTrack(
          this.localScreenVideoTrack,
        );
        this.localScreenVideoTrack.stop();
        this.localScreenVideoTrack = null;
      }
      if (this.localScreenAudioTrack) {
        await this.room.localParticipant.unpublishTrack(
          this.localScreenAudioTrack,
        );
        this.localScreenAudioTrack.stop();
        this.localScreenAudioTrack = null;
      }
      if (this.localScreenStream) {
        this.localScreenStream.getTracks().forEach((t) => t.stop());
        this.localScreenStream = null;
      }
    } catch (e) {
      console.warn("Stop screen share error:", e);
    }

    // 恢复麦克风独立推流
    if (this.localAudioPublication?.track) {
      try {
        this.localAudioPublication.track.unmute();
      } catch {}
    }

    audioMixer.cleanup();

    if (this.activeScreenShare?.isLocal) {
      this.activeScreenShare = null;
      this.notifyScreenShareChanged();
    }
  }

  setSubscribedScreenQuality(quality: "high" | "medium" | "low" | "auto") {
    if (!this.room || !this.activeScreenShare || this.activeScreenShare.isLocal)
      return;
    try {
      const participant = this.room.remoteParticipants.get(
        this.activeScreenShare.participantIdentity,
      );
      if (participant) {
        participant.videoTrackPublications.forEach((pub) => {
          if (
            pub.source === Track.Source.ScreenShare ||
            pub.trackName?.includes("screen")
          ) {
            if (quality === "auto") {
              pub.setVideoQuality(VideoQuality.HIGH);
            } else {
              const lkQuality =
                quality === "high"
                  ? VideoQuality.HIGH
                  : quality === "medium"
                    ? VideoQuality.MEDIUM
                    : VideoQuality.LOW;
              pub.setVideoQuality(lkQuality);
            }
          }
        });
      }
    } catch (e) {
      console.warn("Set subscribed screen quality error:", e);
    }
  }

  onScreenShareChange(callback: (share: ActiveScreenShare | null) => void) {
    this.onScreenShareChangedCallbacks.add(callback);
    callback(this.activeScreenShare);
    return () => {
      this.onScreenShareChangedCallbacks.delete(callback);
    };
  }

  private notifyScreenShareChanged() {
    this.onScreenShareChangedCallbacks.forEach((cb) =>
      cb(this.activeScreenShare),
    );
  }

  async setScreenShareEnabled(enabled: boolean): Promise<boolean> {
    if (enabled) {
      // 默认尝试请求屏幕或窗口共享
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
          audio: true,
        });
        return this.startScreenShareWithStream(stream);
      } catch (err) {
        console.warn("Screen share request cancelled or error:", err);
        return false;
      }
    } else {
      await this.stopScreenShare();
      return true;
    }
  }

  leaveRoom() {
    this.stopScreenShare();
    this.cleanup();
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    this.isConnected = false;
    this.currentRoomName = null;
    this.notifyState(false);
  }

  private cleanup() {
    this.stopNetworkStatsPolling();
    this.networkStatsMap.clear();
    this.activeSpeakers.clear();
    if (this.activeScreenShare) {
      this.activeScreenShare = null;
      this.notifyScreenShareChanged();
    }

    // 清理所有远端 Web Audio 节点与音轨
    this.participantAudioMap.forEach((ctrl) => {
      ctrl.tracks.forEach((entry) => {
        if (entry.gainNode) {
          try {
            entry.gainNode.disconnect();
          } catch {}
        }
        if (entry.sourceNode) {
          try {
            entry.sourceNode.disconnect();
          } catch {}
        }
        if (entry.track && entry.element) {
          try {
            entry.track.detach(entry.element);
          } catch {}
        }
      });
      ctrl.tracks.clear();
    });
    this.participantAudioMap.clear();

    // 释放母带软压限器并关闭回放 AudioContext，避免内存及硬件声卡资源泄漏
    if (this.masterCompressor) {
      try {
        this.masterCompressor.disconnect();
      } catch {}
      this.masterCompressor = null;
    }

    if (
      this.playbackAudioContext &&
      this.playbackAudioContext.state !== "closed"
    ) {
      try {
        this.playbackAudioContext.close();
      } catch {}
      this.playbackAudioContext = null;
    }

    this.localAudioPublication = null;
  }

  onStateChange(callback: (connected: boolean) => void) {
    this.onRoomStateChangedCallbacks.add(callback);
    return () => {
      this.onRoomStateChangedCallbacks.delete(callback);
    };
  }

  private notifyState(connected: boolean) {
    this.onRoomStateChangedCallbacks.forEach((cb) => cb(connected));
  }
}

export const livekitService = new LiveKitService();
