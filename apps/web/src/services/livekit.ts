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
  supportsAV1,
  supportsVP9,
  supportsH265,
  ExternalE2EEKeyProvider,
} from "livekit-client";
import LiveKitE2EEWorker from "livekit-client/e2ee-worker?worker";
import {
  NetworkStats,
  clampVolume,
  computeGain,
  evaluateNetworkQuality,
  ScreenShareOptions,
  SCREEN_SHARE_PRESETS,
  VideoCodecType,
  CodecCapabilityInfo,
  DEFAULT_VIDEO_CODEC,
  MIN_CUSTOM_BITRATE,
  MAX_CUSTOM_BITRATE,
  VoiceConnectionStatus,
  AudioPlaybackStatus,
  StreamDetailedStats,
  ConnectionTopology,
} from "@tescord/types";
import { resolveLiveKitUrl } from "../config";
import { audioMixer } from "./audioMixer.js";
import { audioEngine } from "./audioEngine.js";
import { soundManager } from "./soundManager.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";
import { bitrateCalculator } from "./stats/BitrateCalculator.js";

export type { StreamDetailedStats };

let cachedH265Supported: boolean | null = null;
let cachedH265Reason: string | undefined = undefined;

export async function detectSupportedVideoCodecsAsync(): Promise<
  CodecCapabilityInfo[]
> {
  if (cachedH265Supported === null) {
    let supported = false;
    let isIntel = false;

    // 1. Electron 桌面端原生 GPU 显卡探测 (Intel 0x8086 / NVIDIA 0x10de / AMD 0x1002)
    if (typeof window !== "undefined" && window.electronAPI?.getGPUInfo) {
      try {
        const gpu = await window.electronAPI.getGPUInfo();
        if (gpu?.isIntel || gpu?.isNvidia || gpu?.isAmd) {
          supported = true;
          isIntel = Boolean(gpu?.isIntel);
        }
      } catch (e) {
        console.warn("getGPUInfo detection error:", e);
      }
    }

    // 2. Web 浏览器端通过标准 WebCodecs 异步校验底层硬件加速 (Chrome/Edge 107+ HEVC)
    if (
      !supported &&
      typeof VideoEncoder !== "undefined" &&
      typeof VideoEncoder.isConfigSupported === "function"
    ) {
      try {
        const configEnc = await VideoEncoder.isConfigSupported({
          codec: "hev1.1.6.L93.B0", // HEVC Main Profile, Level 3.1
          width: 1920,
          height: 1080,
          bitrate: 3000000,
          framerate: 60,
          hardwareAcceleration: "prefer-hardware",
        });
        if (configEnc.supported) {
          supported = true;
        }
      } catch {}
    }

    if (
      !supported &&
      typeof VideoDecoder !== "undefined" &&
      typeof VideoDecoder.isConfigSupported === "function"
    ) {
      try {
        const configDec = await VideoDecoder.isConfigSupported({
          codec: "hev1.1.6.L93.B0",
          hardwareAcceleration: "prefer-hardware",
        });
        if (configDec.supported) {
          supported = true;
        }
      } catch {}
    }

    // 3. WebRTC RTCRtpSender 能力回退校验
    if (
      !supported &&
      typeof RTCRtpSender !== "undefined" &&
      typeof RTCRtpSender.getCapabilities === "function"
    ) {
      try {
        const caps = RTCRtpSender.getCapabilities("video");
        if (
          caps?.codecs?.some(
            (c) =>
              c.mimeType.toLowerCase() === "video/h265" ||
              c.mimeType.toLowerCase() === "video/hevc",
          )
        ) {
          supported = true;
        }
      } catch {}
    }

    cachedH265Supported = supported;
    if (supported) {
      cachedH265Reason = undefined;
    } else {
      cachedH265Reason = isIntel
        ? "检测到 Intel 硬件支持，但当前浏览器未开启 WebRTC H265 支持"
        : "当前浏览器或系统未启用 H.265 硬件加速";
    }
  }

  return detectSupportedVideoCodecs();
}

export function detectSupportedVideoCodecs(): CodecCapabilityInfo[] {
  const mimeTypes = new Set<string>();
  if (
    typeof RTCRtpSender !== "undefined" &&
    typeof RTCRtpSender.getCapabilities === "function"
  ) {
    try {
      const caps = RTCRtpSender.getCapabilities("video");
      if (caps?.codecs) {
        caps.codecs.forEach((c) => {
          if (c.mimeType) mimeTypes.add(c.mimeType.toLowerCase());
        });
      }
    } catch (e) {
      console.warn("RTCRtpSender.getCapabilities error:", e);
    }
  }

  const av1Supported = Boolean(supportsAV1() || mimeTypes.has("video/av1"));
  const vp9Supported = Boolean(supportsVP9() || mimeTypes.has("video/vp9"));
  const h265Supported = Boolean(
    cachedH265Supported ??
    (supportsH265() ||
      mimeTypes.has("video/hevc") ||
      mimeTypes.has("video/h265")),
  );
  const h264Supported =
    mimeTypes.size === 0 ? true : mimeTypes.has("video/h264");
  const vp8Supported = true; // VP8 通用兜底支持

  return [
    {
      codec: "h264",
      label: "H.264 (AVC)",
      description:
        "硬件加速普及度最高，极低 CPU 占用与功耗，高帧率竞技推流首选",
      supported: h264Supported,
      isHardwareAccelerated: true,
    },
    {
      codec: "av1",
      label: "AV1 (Next-Gen)",
      description:
        "次世代超高压缩比，同画质节省 40%+ 带宽，代码/文本演示极致锐利",
      supported: av1Supported,
      isHardwareAccelerated: av1Supported,
      reason: av1Supported ? undefined : "当前浏览器或硬件暂不支持 AV1 编码",
    },
    {
      codec: "vp9",
      label: "VP9",
      description: "高画质与 SVC 可伸缩分层支持，画质细腻抗弱网",
      supported: vp9Supported,
      isHardwareAccelerated: false,
      reason: vp9Supported ? undefined : "当前环境不支持 VP9 编码",
    },
    {
      codec: "vp8",
      label: "VP8 (通用基准)",
      description: "最广泛的设备兼容性，适合老旧低配设备与跨平台兜底",
      supported: vp8Supported,
      isHardwareAccelerated: false,
    },
    {
      codec: "h265",
      label: "H.265 (HEVC)",
      description:
        "高压缩比与硬件级加速，支持 Intel / NVIDIA 硬件编解码与极清直播",
      supported: h265Supported,
      isHardwareAccelerated: h265Supported,
      reason: h265Supported
        ? undefined
        : cachedH265Reason || "当前环境未启用平台 HEVC 硬解或浏览器暂不支持",
    },
  ];
}

export interface ActiveScreenShare {
  track: any;
  audioTrack?: any;
  participantIdentity: string;
  isLocal: boolean;
  preset?: string;
  resolution?: string;
  frameRate?: number;
  codec?: string;
}

interface RemoteAudioTrackEntry {
  trackId: string;
  source: string;
  track: any;
  element: HTMLAudioElement;
  sourceNode?: MediaStreamAudioSourceNode;
  gainNode?: GainNode;
  analyserNode?: AnalyserNode;
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
  public connectionStatus: VoiceConnectionStatus = "disconnected";
  public currentRoomName: string | null = null;
  private onConnectionStatusChangedCallbacks: Set<
    (status: VoiceConnectionStatus) => void
  > = new Set();

  // 本地推流音轨
  private localAudioPublication: LocalTrackPublication | null = null;
  private currentAudioBitrate: number = 64000;
  private negotiatedE2EEKey: Uint8Array | null = null;

  public setNegotiatedE2EEKey(key: Uint8Array | null): void {
    this.negotiatedE2EEKey = key ? new Uint8Array(key) : null;
  }

  // 远端单例 Web Audio 回放图谱与软压限混音器 (避免多路超额放大削波与多 AudioContext 耗尽崩溃)
  private playbackAudioContext: AudioContext | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterGainNode: GainNode | null = null;
  private masterVolume: number = 100;

  // 音频播放与系统中断状态管理 (支持 WebKit "interrupted" 状态捕获与生命周期唤醒)
  private audioPlaybackStatus: AudioPlaybackStatus = {
    canPlay: true,
    isInterrupted: false,
  };
  private onAudioPlaybackStatusChangedCallbacks: Set<
    (status: AudioPlaybackStatus) => void
  > = new Set();
  private isLifecycleListenersBound: boolean = false;

  // 用户音量记忆持久化缓存 (identity -> volumePercent)
  private userVolumeCache: Map<string, number> = new Map();

  // 远端音频控制: identity -> ParticipantAudioControl (支持每个成员独立管理麦克风与屏幕伴音多路音轨)
  private participantAudioMap: Map<string, ParticipantAudioControl> = new Map();

  // 活跃讲话者集合 (Active Speakers) - SFU 信令源与本地 Web Audio 能量源的双源融合
  private activeSpeakers: Set<string> = new Set();
  private sfuActiveSpeakers: Set<string> = new Set();
  private localActiveSpeakers: Set<string> = new Set();
  private remoteSpeakingStates: Map<
    string,
    { isSpeaking: boolean; lastActive: number }
  > = new Map();
  private remoteEnergyTimer: any = null;

  // 网络状态监控: identity -> NetworkStats
  private networkStatsMap: Map<string, NetworkStats> = new Map();
  private statsTimer: any = null;
  private lastValidLocalRtt: { rtt: number; timestamp: number } | null = null;
  private lastValidLocalLoss: { loss: number; timestamp: number } | null = null;
  private localRttHistory: { timestamp: number; rtt: number }[] = [];

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
  private onDisconnectedCallbacks: Set<(reason?: any) => void> = new Set();

  // 屏幕分享推流与订阅状态 (支持多路屏幕分享映射: identity -> ActiveScreenShare)
  private localScreenVideoTrack: any = null;
  private localScreenAudioTrack: any = null;
  private localScreenStream: MediaStream | null = null;
  public localScreenShare: ActiveScreenShare | null = null;
  public isSwitchingRoom: boolean = false;
  public activeScreenShare: ActiveScreenShare | null = null;
  public screenSharesMap: Map<string, ActiveScreenShare> = new Map();
  private watchedScreenParticipants = new Set<string>();

  public setScreenWatching(identity: string, watching: boolean): void {
    if (watching) this.watchedScreenParticipants.add(identity);
    else this.watchedScreenParticipants.delete(identity);
    const participant = this.room?.remoteParticipants.get(identity);
    participant?.trackPublications.forEach((publication) => {
      if (
        publication.source === Track.Source.ScreenShare ||
        publication.source === Track.Source.ScreenShareAudio
      ) {
        publication.setSubscribed(watching);
      }
    });
  }
  private onScreenShareChangedCallbacks: Set<
    (share: ActiveScreenShare | null) => void
  > = new Set();
  private onScreenSharesChangedCallbacks: Set<
    (shares: Map<string, ActiveScreenShare>) => void
  > = new Set();

  // 摄像头视频推流与订阅状态 (identity -> video track)
  public localCameraTrack: any = null;
  public cameraTracksMap: Map<string, any> = new Map();
  public selectedCameraDeviceId: string =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("tescord_selected_camera_id") || "default"
      : "default";
  private onCameraTracksChangedCallbacks: Set<
    (tracks: Map<string, any>) => void
  > = new Set();
  private onActiveCameraChangedCallbacks: Set<(deviceId: string) => void> =
    new Set();

  // 麦克风音频输入设备状态
  public selectedAudioInputDeviceId: string =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("tescord_selected_audio_input_id") || "default"
      : "default";
  private onActiveAudioInputChangedCallbacks: Set<(deviceId: string) => void> =
    new Set();

  // 扬声器/耳机音频输出设备状态
  public selectedAudioOutputDeviceId: string =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("tescord_selected_audio_output_id") || "default"
      : "default";
  private onActiveAudioOutputChangedCallbacks: Set<(deviceId: string) => void> =
    new Set();

  constructor() {
    // 读取持久化的用户音量与全局输出音量
    try {
      if (typeof localStorage !== "undefined") {
        const savedVols = localStorage.getItem("tescord_user_volumes");
        if (savedVols) {
          const parsed = JSON.parse(savedVols);
          for (const [k, v] of Object.entries(parsed)) {
            this.userVolumeCache.set(k, Number(v));
          }
        }
        const savedMaster = localStorage.getItem("tescord_master_volume");
        if (savedMaster !== null) {
          this.masterVolume = clampVolume(Number(savedMaster));
        }
      }
    } catch (e) {
      console.warn(
        "Failed to load user volumes or master volume from localStorage:",
        e,
      );
    }

    // 监听 AudioEngine 底层流重构或热换流事件，通话中自动热替换麦克风推流轨
    audioEngine.onStreamChange(async (stream) => {
      if (this.room && this.isConnected) {
        console.log(
          "🔄 检测到麦克风音频流变更，自动热同步 LiveKit 麦克风推流轨",
        );
        await this.publishMicrophoneStream(stream, this.currentAudioBitrate);
      }
    });
  }

  // 视频编码器、双编码降级与自定义码率设置 (H.264 / AV1 / VP9 / VP8 / H.265)
  public preferredVideoCodec: VideoCodecType =
    typeof localStorage !== "undefined"
      ? (localStorage.getItem(
          "tescord_preferred_video_codec",
        ) as VideoCodecType) || "h264"
      : "h264";
  public enableBackupCodec: boolean =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("tescord_enable_backup_codec") !== "false"
      : true;
  public customBitrate: number | null =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("tescord_custom_video_bitrate")
      ? Number(localStorage.getItem("tescord_custom_video_bitrate"))
      : null;
  private onVideoSettingsChangedCallbacks: Set<() => void> = new Set();

  /**
   * 动态探测并解析可用的有效视频编码器：若请求的编码器不被当前硬件/浏览器支持，自动平滑回退
   */
  public resolveEffectiveVideoCodec(
    requestedCodec?: VideoCodecType,
  ): VideoCodecType {
    const target = requestedCodec || this.preferredVideoCodec || "h264";
    const caps = detectSupportedVideoCodecs();
    const match = caps.find((c) => c.codec === target);
    if (match && match.supported) {
      return target;
    }
    // 回退尝试 H.264，否则终极回退 VP8
    const h264 = caps.find((c) => c.codec === "h264");
    if (h264 && h264.supported) {
      console.warn(`⚠️ 目标视频编码 [${target}] 不受支持，已安全降级为 H.264`);
      return "h264";
    }
    console.warn(`⚠️ 目标视频编码 [${target}] 不受支持，已安全降级为 VP8`);
    return "vp8";
  }

  public setPreferredVideoCodec(codec: VideoCodecType) {
    this.preferredVideoCodec = codec;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tescord_preferred_video_codec", codec);
    }
    this.notifyVideoSettingsChanged();
  }

  public setEnableBackupCodec(enabled: boolean) {
    this.enableBackupCodec = enabled;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tescord_enable_backup_codec", String(enabled));
    }
    this.notifyVideoSettingsChanged();
  }

  public setCustomBitrate(bitrate: number | null) {
    this.customBitrate = bitrate;
    if (typeof localStorage !== "undefined") {
      if (bitrate !== null) {
        localStorage.setItem("tescord_custom_video_bitrate", String(bitrate));
      } else {
        localStorage.removeItem("tescord_custom_video_bitrate");
      }
    }
    this.notifyVideoSettingsChanged();
  }

  public onVideoSettingsChange(callback: () => void): () => void {
    this.onVideoSettingsChangedCallbacks.add(callback);
    callback();
    return () => {
      this.onVideoSettingsChangedCallbacks.delete(callback);
    };
  }

  private notifyVideoSettingsChanged() {
    this.onVideoSettingsChangedCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.warn("LiveKit video settings callback error:", err);
      }
    });
  }

  // 1. 初始化或获取共享的音频混音上下文 (含软压限器 Soft Limiter)
  private getOrCreatePlaybackContext(): AudioContext {
    if (
      !this.playbackAudioContext ||
      this.playbackAudioContext.state === "closed"
    ) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.playbackAudioContext = new AudioContextClass({ sampleRate: 48000 });
      this.playbackAudioContext.addEventListener(
        "statechange",
        this.handlePlaybackContextStateChange,
      );

      // 构建广播级宽动态压限器 (DynamicsCompressorNode)
      // 具备 12dB 宽软拐点与 3.5:1 柔和斜率，提供充沛的 200% (+6dB) 动态提升空间，同时防止数字削波破音
      this.masterCompressor =
        this.playbackAudioContext.createDynamicsCompressor();
      this.masterCompressor.threshold.setValueAtTime(
        -2.0,
        this.playbackAudioContext.currentTime,
      ); // -2.0 dBFS
      this.masterCompressor.knee.setValueAtTime(
        12.0,
        this.playbackAudioContext.currentTime,
      ); // 12dB 宽软拐点 (Soft Knee)
      this.masterCompressor.ratio.setValueAtTime(
        3.5,
        this.playbackAudioContext.currentTime,
      ); // 3.5:1 柔和压限，避免 200% 大音量时被砖墙削平
      this.masterCompressor.attack.setValueAtTime(
        0.003,
        this.playbackAudioContext.currentTime,
      ); // 3ms 瞬态响应
      this.masterCompressor.release.setValueAtTime(
        0.1,
        this.playbackAudioContext.currentTime,
      ); // 100ms 平滑释放

      // 全局母带输出音量控制 (Master Gain Node): 0% ~ 200% (0.0x ~ 2.0x)
      this.masterGainNode = this.playbackAudioContext.createGain();
      this.masterGainNode.gain.setValueAtTime(
        this.masterVolume / 100,
        this.playbackAudioContext.currentTime,
      );

      // 串联: masterCompressor -> masterGainNode -> destination
      this.masterCompressor.connect(this.masterGainNode);
      this.masterGainNode.connect(this.playbackAudioContext.destination);

      if (
        this.selectedAudioOutputDeviceId &&
        this.selectedAudioOutputDeviceId !== "default" &&
        typeof (this.playbackAudioContext as any).setSinkId === "function"
      ) {
        (this.playbackAudioContext as any)
          .setSinkId(this.selectedAudioOutputDeviceId)
          .catch((e: any) =>
            console.warn("[LiveKit] AudioContext setSinkId failed:", e),
          );
      }
    }

    if (this.playbackAudioContext.state === "suspended") {
      this.playbackAudioContext.resume().catch(() => {});
    }

    return this.playbackAudioContext;
  }

  public setMasterVolume(volumePercent: number) {
    const clamped = clampVolume(volumePercent);
    this.masterVolume = clamped;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("tescord_master_volume", String(clamped));
      }
    } catch {}
    if (this.masterGainNode && this.playbackAudioContext) {
      this.masterGainNode.gain.setValueAtTime(
        clamped / 100,
        this.playbackAudioContext.currentTime,
      );
    }
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  public setConnectionStatus(status: VoiceConnectionStatus) {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      this.isConnected = status === "connected";
      this.onConnectionStatusChangedCallbacks.forEach((cb) => {
        try {
          cb(status);
        } catch (err) {
          console.warn("LiveKit connectionStatus callback error:", err);
        }
      });
    }
  }

  public getConnectionStatus(): VoiceConnectionStatus {
    return this.connectionStatus;
  }

  public onConnectionStatusChange(
    callback: (status: VoiceConnectionStatus) => void,
  ): () => void {
    this.onConnectionStatusChangedCallbacks.add(callback);
    callback(this.connectionStatus);
    return () => {
      this.onConnectionStatusChangedCallbacks.delete(callback);
    };
  }

  async joinRoom(
    url: string,
    token: string,
    roomName: string,
    audioStream?: MediaStream | null,
    bitrate: number = 64000,
    requireE2EE: boolean = false,
  ): Promise<boolean> {
    try {
      if (requireE2EE && !this.negotiatedE2EEKey) {
        throw new Error("E2EE key is required for this media room");
      }
      await this.leaveRoom(true);
      this.currentAudioBitrate = bitrate;
      this.currentRoomName = roomName;
      this.setConnectionStatus("connecting");

      // 预先激活回放音频上下文
      this.getOrCreatePlaybackContext();

      // 判断是否处于 E2E 测试 Mock Token 环境
      const isMock =
        token.startsWith("mock_") ||
        url.includes("mock") ||
        (typeof window !== "undefined" && (window as any).__MOCK_LIVEKIT__);

      if (isMock) {
        // 在 E2E Mock 模式下模拟短暂握手过程 (60ms)，便于 UI 状态过渡与自动化断言
        await new Promise((resolve) => setTimeout(resolve, 60));
        this.isConnected = true;
        this.setConnectionStatus("connected");
        this.bindLifecycleListeners();
        this.startNetworkStatsPolling();
        this.notifyState(true);
        return true;
      }

      const defaultCodec = this.resolveEffectiveVideoCodec(
        this.preferredVideoCodec,
      );

      let e2ee:
        { keyProvider: ExternalE2EEKeyProvider; worker: Worker } | undefined;
      if (this.negotiatedE2EEKey) {
        const keyProvider = new ExternalE2EEKeyProvider();
        await keyProvider.setKey(this.negotiatedE2EEKey.buffer.slice(0));
        e2ee = { keyProvider, worker: new LiveKitE2EEWorker() };
      }
      this.room = new Room({
        adaptiveStream: false,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        publishDefaults: {
          videoCodec: defaultCodec as any,
          backupCodec: this.enableBackupCodec ? { codec: "vp8" } : false,
          simulcast: true,
        },
        ...(e2ee ? { e2ee } : {}),
      });

      this.setupRoomEvents();

      const targetUrl = resolveLiveKitUrl(url);
      await this.room.connect(targetUrl, token);
      this.room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (
            publication.source === Track.Source.ScreenShare ||
            publication.source === Track.Source.ScreenShareAudio
          ) {
            publication.setSubscribed(
              this.watchedScreenParticipants.has(participant.identity),
            );
          }
        });
      });
      if (e2ee) await this.room.setE2EEEnabled(true);
      this.isConnected = true;
      this.setConnectionStatus("connected");

      // 若提供了本地麦克风音频流，立即执行高品质 Opus 推流
      if (audioStream) {
        const published = await this.publishMicrophoneStream(
          audioStream,
          this.currentAudioBitrate,
        );
        if (!published)
          throw new Error("LiveKit microphone track publication failed");
      }

      this.startNetworkStatsPolling();
      this.notifyState(true);

      return true;
    } catch (err) {
      this.leaveRoom();
      console.error(
        "LiveKit SFU connect failed (请确保 7880 端口 LiveKit 服务已启动):",
        err,
      );
      this.isConnected = false;
      this.currentRoomName = null;
      this.setConnectionStatus("disconnected");
      this.notifyState(false);
      return false;
    }
  }

  // 2. 发布麦克风推流 (支持 16kbps ~ 128kbps Opus 编码码率可配)
  async publishMicrophoneStream(
    stream: MediaStream,
    bitrate: number = 64000,
  ): Promise<boolean> {
    if (!this.room || !this.isConnected) return false;

    this.currentAudioBitrate = bitrate;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return false;

    try {
      // 1. 若当前发布的底层 MediaStreamTrack 已经是一致且处于活跃状态的实例，无需重复处理
      if (
        this.localAudioPublication?.track &&
        (this.localAudioPublication.track as any).mediaStreamTrack ===
          audioTrack &&
        audioTrack.readyState === "live"
      ) {
        return true;
      }

      // 2. 优先利用 WebRTC RTCRtpSender.replaceTrack 进行平滑热替换 (Zero-glitch hot swap)
      if (this.localAudioPublication?.track) {
        const localTrack = this.localAudioPublication.track;
        if (typeof (localTrack as any).replaceTrack === "function") {
          try {
            await (localTrack as any).replaceTrack(audioTrack);
            console.log(
              `🎙️ 成功通过 replaceTrack 无缝热替换麦克风音轨 (Opus ${bitrate / 1000}kbps)`,
            );
            return true;
          } catch (replaceErr) {
            console.warn(
              "LiveKit replaceTrack 失败，回退至 unpublish/publish 重建:",
              replaceErr,
            );
          }
        }

        // 3. 兜底策略：取消发布旧音轨
        try {
          await this.room.localParticipant.unpublishTrack(
            this.localAudioPublication.track!,
          );
        } catch (unpubErr) {
          console.warn("LiveKit unpublishTrack error:", unpubErr);
        }
        this.localAudioPublication = null;
      }

      // 4. 正式发布新音轨
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
      return true;
    } catch (e) {
      console.warn("LiveKit publishTrack error:", e);
      return false;
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

    // Screen video and screen audio are selected explicitly by each viewer.
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (
        publication.source === Track.Source.ScreenShare ||
        publication.source === Track.Source.ScreenShareAudio
      ) {
        publication.setSubscribed(
          this.watchedScreenParticipants.has(participant.identity),
        );
      }
    });

    // 4.1 远端音视频轨订阅 (含屏幕分享与摄像头)
    this.room.on(
      RoomEvent.TrackSubscribed,
      (track, publication, participant) => {
        if (
          (publication.source === Track.Source.ScreenShare ||
            publication.source === Track.Source.ScreenShareAudio) &&
          !this.watchedScreenParticipants.has(participant.identity)
        ) {
          publication.setSubscribed(false);
          return;
        }
        if (track.kind === Track.Kind.Audio) {
          this.handleRemoteAudioSubscribed(track, participant);
        } else if (
          track.kind === Track.Kind.Video &&
          (track.source === Track.Source.ScreenShare ||
            publication.source === Track.Source.ScreenShare ||
            publication.trackName?.includes("screen"))
        ) {
          const pubCodec = (
            publication.mimeType ||
            (publication as any).videoCodec ||
            ""
          )
            .replace(/^video\//i, "")
            .toUpperCase();

          const shareInfo: ActiveScreenShare = {
            track,
            participantIdentity: participant.identity,
            isLocal: false,
            resolution: publication.dimensions
              ? `${publication.dimensions.width}x${publication.dimensions.height}`
              : "1080p (Simulcast)",
            frameRate: 60,
            codec: pubCodec || undefined,
          };
          this.screenSharesMap.set(participant.identity, shareInfo);
          if (!this.activeScreenShare || this.activeScreenShare.isLocal) {
            this.activeScreenShare = shareInfo;
            this.notifyScreenShareChanged();
          }
          this.notifyScreenSharesChanged();
        } else if (
          track.kind === Track.Kind.Video &&
          (track.source === Track.Source.Camera ||
            publication.source === Track.Source.Camera ||
            publication.trackName?.includes("camera"))
        ) {
          this.cameraTracksMap.set(participant.identity, track);
          this.notifyCameraTracksChanged();
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
        } else if (track.kind === Track.Kind.Video) {
          if (this.screenSharesMap.has(participant.identity)) {
            this.screenSharesMap.delete(participant.identity);
            this.activeScreenShare =
              this.screenSharesMap.values().next().value || null;
            this.notifyScreenSharesChanged();
            this.notifyScreenShareChanged();
          }
          if (this.cameraTracksMap.get(participant.identity) === track) {
            this.cameraTracksMap.delete(participant.identity);
            this.notifyCameraTracksChanged();
          }
        }
      },
    );

    // 4.2.1 远端音视频轨取消发布 (Host 停止推流/摄像头，主动释放轨道映射)
    this.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      if (publication.kind === Track.Kind.Video) {
        if (this.screenSharesMap.has(participant.identity)) {
          this.screenSharesMap.delete(participant.identity);
          this.activeScreenShare =
            this.screenSharesMap.values().next().value || null;
          this.notifyScreenSharesChanged();
          this.notifyScreenShareChanged();
        }
        if (this.cameraTracksMap.has(participant.identity)) {
          this.cameraTracksMap.delete(participant.identity);
          this.notifyCameraTracksChanged();
        }
      }
    });

    // 4.3 活跃讲话者监听 (Active Speakers)
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const activeIds = speakers.map((s) => s.identity);
      this.sfuActiveSpeakers = new Set(activeIds);
      this.syncCombinedActiveSpeakers();
    });

    // 4.4 远端成员断开连接
    this.room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        if (this.screenSharesMap.has(participant.identity)) {
          this.screenSharesMap.delete(participant.identity);
          this.activeScreenShare =
            this.screenSharesMap.values().next().value || null;
          this.notifyScreenSharesChanged();
          this.notifyScreenShareChanged();
        }
        if (this.cameraTracksMap.has(participant.identity)) {
          this.cameraTracksMap.delete(participant.identity);
          this.notifyCameraTracksChanged();
        }
        this.handleRemoteAudioUnsubscribed(participant.identity);
        this.networkStatsMap.delete(participant.identity);
        this.sfuActiveSpeakers.delete(participant.identity);
        this.localActiveSpeakers.delete(participant.identity);
        this.remoteSpeakingStates.delete(participant.identity);
        this.syncCombinedActiveSpeakers();
        this.onNetworkStatsChangedCallbacks.forEach((cb) =>
          cb(this.networkStatsMap),
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

    // 4.6 房间连接成功与重连生命周期
    this.room.on(RoomEvent.Connected, () => {
      this.isConnected = true;
      this.setConnectionStatus("connected");
      this.bindLifecycleListeners();
      this.notifyState(true);
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      this.setConnectionStatus("reconnecting");
    });

    this.room.on(RoomEvent.Reconnected, () => {
      this.isConnected = true;
      this.setConnectionStatus("connected");
      this.bindLifecycleListeners();
      this.notifyState(true);
      this.attemptSilentRecovery();
    });

    // 4.7 音频播放能力 / Autoplay 与系统中断状态感知
    this.room.on(RoomEvent.AudioPlaybackStatusChanged, (playStatus) => {
      console.info("[LiveKit] AudioPlaybackStatusChanged event:", playStatus);
      const canPlay = this.room?.canPlaybackAudio ?? true;
      if (!canPlay) {
        this.setAudioPlaybackStatus({ canPlay: false, isInterrupted: true });
      } else {
        const isRunning =
          !this.playbackAudioContext ||
          this.playbackAudioContext.state === "running";
        if (isRunning) {
          this.setAudioPlaybackStatus({
            canPlay: true,
            isInterrupted: false,
            error: undefined,
          });
        }
      }
    });

    // 4.8 房间断开
    this.room.on(RoomEvent.Disconnected, (reason?: any) => {
      this.cleanup();
      this.isConnected = false;
      this.currentRoomName = null;
      this.setConnectionStatus("disconnected");
      this.notifyState(false);
      if (!this.isSwitchingRoom) {
        this.onDisconnectedCallbacks.forEach((cb) => cb(reason));
      }
    });
  }

  private handleRemoteAudioSubscribed(
    track: any,
    participant: RemoteParticipant,
  ) {
    const identity = participant.identity;
    const audioElement = track.attach() as HTMLAudioElement;

    // 路由远端音频输出设备
    const outputId = this.getAudioOutputDeviceId();
    if (
      outputId &&
      outputId !== "default" &&
      typeof (audioElement as any).setSinkId === "function"
    ) {
      (audioElement as any).setSinkId(outputId).catch((err: any) => {
        console.warn(
          `[LiveKit] Failed to setSinkId on audio element for ${identity}:`,
          err,
        );
      });
    }

    // 优先读取本地持久化的音量记忆
    const persistentVol = this.userVolumeCache.get(identity) ?? 100;

    let ctrl = this.participantAudioMap.get(identity);
    if (!ctrl) {
      ctrl = {
        identity,
        volume: persistentVol,
        muted: false,
        tracks: new Map(),
      };
      this.participantAudioMap.set(identity, ctrl);
    } else if (this.userVolumeCache.has(identity)) {
      ctrl.volume = persistentVol;
    }

    const trackId =
      track.sid ||
      track.mediaStreamTrack?.id ||
      `${identity}_${track.source || "audio"}_${Date.now()}`;

    let gainNode: GainNode | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;
    let analyserNode: AnalyserNode | undefined;

    try {
      // 提取底层的真实 MediaStreamTrack 节点
      const mediaTrack: MediaStreamTrack | undefined =
        track.mediaStreamTrack || track.track;
      if (mediaTrack) {
        const ctx = this.getOrCreatePlaybackContext();
        const mediaStream = new MediaStream([mediaTrack]);
        sourceNode = ctx.createMediaStreamSource(mediaStream);
        gainNode = ctx.createGain();

        // 挂载高灵敏度 AnalyserNode 进行实时本地远端音量电平分析，彻底解决 Chromium 合成音轨缺失 RFC 6464 音频电平扩展头导致 SFU 不发信令的问题
        try {
          analyserNode = ctx.createAnalyser();
          analyserNode.fftSize = 256;
          analyserNode.smoothingTimeConstant = 0.2;
          sourceNode.connect(analyserNode);
        } catch (analyserErr) {
          console.warn(
            `[LiveKit] Failed to connect remote AnalyserNode for ${identity}:`,
            analyserErr,
          );
        }

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
      analyserNode,
    });

    if (analyserNode) {
      this.startRemoteAudioEnergyMonitoring();
    }
  }

  private handleRemoteAudioUnsubscribed(identity: string, track?: any) {
    const ctrl = this.participantAudioMap.get(identity);
    if (!ctrl) return;

    const trackId = track?.sid || track?.mediaStreamTrack?.id;
    if (trackId && ctrl.tracks.has(trackId)) {
      const entry = ctrl.tracks.get(trackId)!;
      if (entry.analyserNode) {
        try {
          entry.analyserNode.disconnect();
        } catch {}
      }
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
        this.localActiveSpeakers.delete(identity);
        this.remoteSpeakingStates.delete(identity);
        this.syncCombinedActiveSpeakers();
      }
    } else {
      // 未指定 track 时，移除该成员名下的全部音轨 (如成员断开房间)
      ctrl.tracks.forEach((entry) => {
        if (entry.analyserNode) {
          try {
            entry.analyserNode.disconnect();
          } catch {}
        }
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
      this.localActiveSpeakers.delete(identity);
      this.remoteSpeakingStates.delete(identity);
      this.syncCombinedActiveSpeakers();
    }

    if (this.participantAudioMap.size === 0) {
      this.stopRemoteAudioEnergyMonitoring();
    }
  }

  // 5. 多路远端语音独立音量控制 (0% ~ 200%)
  setParticipantVolume(identity: string, volumePercent: number) {
    const clampedVolume = clampVolume(volumePercent);

    // 写入持久化缓存与 localStorage
    this.userVolumeCache.set(identity, clampedVolume);
    try {
      useSettingsStore.getState().setUserVolume(identity, clampedVolume);
    } catch (e) {
      console.warn("Failed to sync user volume to useSettingsStore:", e);
    }
    try {
      if (typeof localStorage !== "undefined") {
        const obj: Record<string, number> = {};
        this.userVolumeCache.forEach((v, k) => {
          obj[k] = v;
        });
        localStorage.setItem("tescord_user_volumes", JSON.stringify(obj));
      }
    } catch (e) {
      console.warn("Failed to persist user volume to localStorage:", e);
    }

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
    if (this.userVolumeCache.has(identity)) {
      return this.userVolumeCache.get(identity)!;
    }
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

      // 6.1 获取真实本人网络健康与音视频统计指标
      let localRtt: number | undefined = undefined;
      let localLoss: number | undefined;
      let localJitter: number | undefined;
      let localBitrate: number | undefined;

      let localAudioCodec: string | undefined;
      let localVideoCodec: string | undefined;
      let localVideoResolution: string | undefined;
      let localVideoFps: number | undefined;
      let localVideoBitrate: number | undefined = undefined;
      let totalAudioBytesSent = 0;
      let totalVideoBytesSent = 0;

      // 缓存远端轨道的统计信息：trackId -> { packetsLost, packetsReceived, jitter }
      const remoteTrackStats = new Map<
        string,
        { packetsLost: number; packetsReceived: number; jitter?: number }
      >();

      if (this.room) {
        try {
          const pcManager = (this.room as any).engine?.pcManager;
          if (pcManager) {
            const [pubReport, subReport] = (await Promise.all([
              pcManager.publisher?.getStats() as Promise<any>,
              pcManager.subscriber?.getStats() as Promise<any>,
            ])) as [any, any];

            // 1. 解析 Publisher (上行推流) 统计报告
            if (pubReport) {
              const codecMap = new Map<string, string>();
              let selectedCandidatePairId = "";
              pubReport.forEach((stat: any) => {
                if (stat.type === "codec" && stat.mimeType) {
                  codecMap.set(stat.id, stat.mimeType);
                }
                if (stat.type === "transport" && stat.selectedCandidatePairId) {
                  selectedCandidatePairId = stat.selectedCandidatePairId;
                }
              });

              pubReport.forEach((stat: any) => {
                // 1.1 物理链路 ICE Candidate Pair RTT
                if (
                  stat.type === "candidate-pair" &&
                  (selectedCandidatePairId
                    ? stat.id === selectedCandidatePairId
                    : stat.nominated && stat.state === "succeeded")
                ) {
                  if (typeof stat.currentRoundTripTime === "number") {
                    localRtt = Math.round(stat.currentRoundTripTime * 1000);
                  }
                }

                // 1.2 SFU 接收端通过 RTCP 报告回传的推流质量
                if (stat.type === "remote-inbound-rtp") {
                  if (
                    typeof stat.roundTripTime === "number" &&
                    stat.roundTripTime > 0
                  ) {
                    localRtt = Math.round(stat.roundTripTime * 1000);
                  }
                  if (typeof stat.fractionLost === "number") {
                    localLoss = +(stat.fractionLost * 100).toFixed(1);
                  }
                  if (typeof stat.jitter === "number") {
                    localJitter = +(stat.jitter * 1000).toFixed(1);
                  }
                } else if (
                  stat.type === "outbound-rtp" &&
                  stat.kind === "video"
                ) {
                  if (stat.codecId && codecMap.has(stat.codecId)) {
                    localVideoCodec = codecMap
                      .get(stat.codecId)!
                      .replace(/^video\//i, "")
                      .toUpperCase();
                  }
                  if (stat.frameWidth && stat.frameHeight) {
                    localVideoResolution = `${stat.frameWidth}x${stat.frameHeight}`;
                  }
                  if (stat.framesPerSecond) {
                    localVideoFps = Math.round(stat.framesPerSecond);
                  }
                  totalVideoBytesSent += stat.bytesSent || 0;
                } else if (
                  stat.type === "outbound-rtp" &&
                  stat.kind === "audio"
                ) {
                  const negotiatedCodec = stat.codecId
                    ? codecMap.get(stat.codecId)
                    : undefined;
                  if (negotiatedCodec && !/red|cn/i.test(negotiatedCodec)) {
                    localAudioCodec = negotiatedCodec.replace(/^audio\//i, "");
                  }
                  totalAudioBytesSent += stat.bytesSent || 0;
                }
              });

              const audioRate = bitrateCalculator.compute(
                `livekit-network-audio-${localIdentity}`,
                totalAudioBytesSent,
                0,
              );
              const videoRate = bitrateCalculator.compute(
                `livekit-network-video-${localIdentity}`,
                totalVideoBytesSent,
                0,
              );
              if (totalAudioBytesSent > 0 && audioRate.uploadBps > 0) {
                localBitrate = Math.round(audioRate.uploadBps / 1000);
              }
              if (totalVideoBytesSent > 0 && videoRate.uploadBps > 0) {
                localVideoBitrate = Math.round(videoRate.uploadBps / 1000);
              }
            }

            // 2. 解析 Subscriber (下行拉流) 统计报告
            if (subReport) {
              let subSelectedPairId = "";
              subReport.forEach((stat: any) => {
                if (stat.type === "transport" && stat.selectedCandidatePairId) {
                  subSelectedPairId = stat.selectedCandidatePairId;
                }
              });

              subReport.forEach((stat: any) => {
                // 若推流侧未生成有效 candidate-pair (例如麦克风静音)，从拉流侧提取物理 ICE RTT
                if (
                  localRtt === undefined &&
                  stat.type === "candidate-pair" &&
                  (subSelectedPairId
                    ? stat.id === subSelectedPairId
                    : stat.nominated && stat.state === "succeeded")
                ) {
                  if (typeof stat.currentRoundTripTime === "number") {
                    localRtt = Math.round(stat.currentRoundTripTime * 1000);
                  }
                }

                if (stat.type === "inbound-rtp" && stat.trackIdentifier) {
                  remoteTrackStats.set(stat.trackIdentifier, {
                    packetsLost: stat.packetsLost || 0,
                    packetsReceived: stat.packetsReceived || 0,
                    jitter:
                      typeof stat.jitter === "number"
                        ? +(stat.jitter * 1000).toFixed(1)
                        : undefined,
                  });
                }
              });
            }
          }

          // 若尚未生成有效 RTCP RTT，平滑使用 LiveKit 实时信令 RTT 测量
          if (localRtt === undefined) {
            const signalRtt = (this.room as any).engine?.client?.rtt;
            if (typeof signalRtt === "number" && signalRtt > 0) {
              localRtt = Math.round(signalRtt);
            }
          }
        } catch (err) {
          console.warn("[LiveKit] Failed to collect WebRTC getStats:", err);
        }
      }

      // 保持与平滑 RTT / PacketLoss 样本，避免因单次 RTCP 空窗造成数值在毫秒与暂无数据之间跳变
      if (localRtt !== undefined) {
        if (
          this.lastValidLocalRtt &&
          now - this.lastValidLocalRtt.timestamp < 10_000
        ) {
          localRtt = Math.round(
            this.lastValidLocalRtt.rtt * 0.3 + localRtt * 0.7,
          );
        }
        this.lastValidLocalRtt = { rtt: localRtt, timestamp: now };
      } else if (
        this.isConnected &&
        this.lastValidLocalRtt &&
        now - this.lastValidLocalRtt.timestamp < 10_000
      ) {
        localRtt = this.lastValidLocalRtt.rtt;
      }

      if (localLoss !== undefined) {
        this.lastValidLocalLoss = { loss: localLoss, timestamp: now };
      } else if (
        this.isConnected &&
        this.lastValidLocalLoss &&
        now - this.lastValidLocalLoss.timestamp < 10_000
      ) {
        localLoss = this.lastValidLocalLoss.loss;
      }

      const finalLocalRtt =
        localRtt !== undefined ? Math.max(1, localRtt) : undefined;

      // 持续更新本地最近 30 个 RTT 历史记录
      if (finalLocalRtt !== undefined) {
        this.localRttHistory = [
          ...this.localRttHistory.slice(-29),
          { timestamp: now, rtt: finalLocalRtt },
        ];
      }

      const quality =
        finalLocalRtt !== undefined && localLoss !== undefined
          ? evaluateNetworkQuality(finalLocalRtt, localLoss)
          : "unknown";

      this.networkStatsMap.set(localIdentity, {
        identity: localIdentity,
        rtt: finalLocalRtt,
        packetLoss: localLoss,
        jitter:
          localJitter !== undefined ? Math.max(0, localJitter) : undefined,
        bitrate: localBitrate,
        codec: localAudioCodec,
        videoCodec: localVideoCodec,
        videoResolution: localVideoResolution,
        videoFramerate: localVideoFps,
        videoBitrate: localVideoBitrate,
        quality,
        timestamp: now,
      });

      // 6.2 遍历远端参与者指标 (结合下行 track 实际统计与质量评分)
      if (this.room) {
        this.room.remoteParticipants.forEach((p) => {
          let remoteLoss: number | undefined;
          let remoteJitter: number | undefined;

          // 查找该参与者的音视频 Track 实际接收指标
          let totalLost = 0;
          let totalRecv = 0;
          let foundTrack = false;

          p.trackPublications.forEach((pub) => {
            const trackId = pub.track?.mediaStreamTrack?.id || pub.trackSid;
            if (trackId && remoteTrackStats.has(trackId)) {
              const s = remoteTrackStats.get(trackId)!;
              totalLost += s.packetsLost;
              totalRecv += s.packetsReceived;
              remoteJitter = s.jitter;
              foundTrack = true;
            }
          });

          if (foundTrack && totalLost + totalRecv > 0) {
            remoteLoss = +((totalLost / (totalLost + totalRecv)) * 100).toFixed(
              1,
            );
          }

          const pQuality =
            p.connectionQuality === ConnectionQuality.Excellent
              ? "excellent"
              : p.connectionQuality === ConnectionQuality.Good
                ? "good"
                : p.connectionQuality === ConnectionQuality.Poor
                  ? "poor"
                  : "unknown";

          this.networkStatsMap.set(p.identity, {
            identity: p.identity,
            rtt: undefined,
            packetLoss: remoteLoss,
            jitter: remoteJitter,
            bitrate: undefined,
            codec: undefined,
            videoCodec: undefined,
            videoResolution: undefined,
            videoFramerate: undefined,
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

  getLocalRttHistory(): { timestamp: number; rtt: number }[] {
    return [...this.localRttHistory];
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

  getAudioInputDeviceId(): string {
    return (
      audioEngine.config.inputDeviceId ||
      this.selectedAudioInputDeviceId ||
      "default"
    );
  }

  onActiveAudioInputChange(callback: (deviceId: string) => void): () => void {
    this.onActiveAudioInputChangedCallbacks.add(callback);
    callback(this.getAudioInputDeviceId());
    return () => {
      this.onActiveAudioInputChangedCallbacks.delete(callback);
    };
  }

  private notifyActiveAudioInputChanged() {
    const activeId = this.getAudioInputDeviceId();
    this.onActiveAudioInputChangedCallbacks.forEach((cb) => {
      try {
        cb(activeId);
      } catch (err) {
        console.warn("Active audio input callback error:", err);
      }
    });
  }

  async switchAudioInputDevice(deviceId: string): Promise<boolean> {
    this.selectedAudioInputDeviceId = deviceId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tescord_selected_audio_input_id", deviceId);
    }
    this.notifyActiveAudioInputChanged();

    // 联动 AudioEngine 热换流
    const stream = await audioEngine.switchInputDevice(deviceId);
    if (stream && this.room && this.isConnected) {
      await this.publishMicrophoneStream(stream, this.currentAudioBitrate);
    }
    return true;
  }

  getAudioOutputDeviceId(): string {
    return this.selectedAudioOutputDeviceId || "default";
  }

  onActiveAudioOutputChange(callback: (deviceId: string) => void): () => void {
    this.onActiveAudioOutputChangedCallbacks.add(callback);
    callback(this.getAudioOutputDeviceId());
    return () => {
      this.onActiveAudioOutputChangedCallbacks.delete(callback);
    };
  }

  private notifyActiveAudioOutputChanged() {
    const activeId = this.getAudioOutputDeviceId();
    this.onActiveAudioOutputChangedCallbacks.forEach((cb) => {
      try {
        cb(activeId);
      } catch (err) {
        console.warn("Active audio output callback error:", err);
      }
    });
  }

  async switchAudioOutputDevice(deviceId: string): Promise<boolean> {
    this.selectedAudioOutputDeviceId = deviceId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tescord_selected_audio_output_id", deviceId);
    }
    this.notifyActiveAudioOutputChanged();

    const targetSink = deviceId === "default" ? "" : deviceId;

    // 1. 设置 Web Audio PlaybackContext 的 sinkId
    if (
      this.playbackAudioContext &&
      typeof (this.playbackAudioContext as any).setSinkId === "function"
    ) {
      try {
        await (this.playbackAudioContext as any).setSinkId(targetSink);
      } catch (e) {
        console.warn(
          "[LiveKit] Failed to setSinkId on playbackAudioContext:",
          e,
        );
      }
    }

    // 2. 遍历所有附加的远端音频元素并设置 sinkId
    for (const ctrl of this.participantAudioMap.values()) {
      for (const trackEntry of ctrl.tracks.values()) {
        if (
          trackEntry.element &&
          typeof (trackEntry.element as any).setSinkId === "function"
        ) {
          try {
            await (trackEntry.element as any).setSinkId(targetSink);
          } catch (e) {
            console.warn("[LiveKit] Failed to setSinkId on audioElement:", e);
          }
        }
      }
    }

    // 3. 同步 LiveKit room 的 active device（若支持）
    if (
      this.room &&
      typeof (this.room as any).switchActiveDevice === "function"
    ) {
      try {
        await (this.room as any).switchActiveDevice("audiooutput", targetSink);
      } catch (e) {
        console.warn(
          "[LiveKit] room.switchActiveDevice audiooutput failed:",
          e,
        );
      }
    }

    // 4. 同步提示音管理器
    await soundManager.setSinkId(deviceId);

    return true;
  }

  getCameraDeviceId(): string {
    return this.selectedCameraDeviceId;
  }

  onActiveCameraChange(callback: (deviceId: string) => void): () => void {
    this.onActiveCameraChangedCallbacks.add(callback);
    callback(this.selectedCameraDeviceId);
    return () => {
      this.onActiveCameraChangedCallbacks.delete(callback);
    };
  }

  private notifyActiveCameraChanged() {
    this.onActiveCameraChangedCallbacks.forEach((cb) => {
      try {
        cb(this.selectedCameraDeviceId);
      } catch (err) {
        console.warn("Active camera callback error:", err);
      }
    });
  }

  async switchCameraDevice(deviceId: string): Promise<boolean> {
    this.selectedCameraDeviceId = deviceId;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("tescord_selected_camera_id", deviceId);
    }
    this.notifyActiveCameraChanged();

    const identity = this.room?.localParticipant?.identity || "local";
    const isCurrentlyActive =
      !!this.cameraTracksMap.get(identity) || !!this.localCameraTrack;

    if (isCurrentlyActive) {
      if (this.room && this.isConnected) {
        try {
          if (typeof (this.room as any).switchActiveDevice === "function") {
            await (this.room as any).switchActiveDevice(
              "videoinput",
              deviceId === "default" ? "" : deviceId,
            );
          } else {
            await this.room.localParticipant.setCameraEnabled(false);
            const cameraOptions: any =
              deviceId && deviceId !== "default"
                ? { deviceId: { exact: deviceId } }
                : undefined;
            await this.room.localParticipant.setCameraEnabled(
              true,
              cameraOptions,
            );
          }
          const pub = this.room.localParticipant.getTrackPublication(
            Track.Source.Camera,
          );
          this.localCameraTrack = pub?.videoTrack || null;
        } catch (e) {
          console.warn("LiveKit switchActiveDevice error, falling back:", e);
        }
      }

      // Fallback 模式或本地流更新
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          if (this.localCameraTrack && (!this.room || !this.isConnected)) {
            if (typeof this.localCameraTrack.stop === "function") {
              this.localCameraTrack.stop();
            }
            const videoConstraints: any =
              deviceId && deviceId !== "default"
                ? { deviceId: { exact: deviceId } }
                : true;
            const stream = await navigator.mediaDevices.getUserMedia({
              video: videoConstraints,
            });
            this.localCameraTrack = stream.getVideoTracks()[0] || null;
          }
        } catch (e) {
          console.warn("Fallback switch camera getUserMedia error:", e);
        }
      }

      if (this.localCameraTrack) {
        this.cameraTracksMap.set(identity, this.localCameraTrack);
      } else {
        this.cameraTracksMap.delete(identity);
      }
      this.notifyCameraTracksChanged();
    }
    return true;
  }

  async setCameraEnabled(
    enabled: boolean,
    deviceId?: string,
  ): Promise<boolean> {
    const targetDeviceId = deviceId || this.selectedCameraDeviceId;
    if (deviceId && deviceId !== this.selectedCameraDeviceId) {
      this.selectedCameraDeviceId = deviceId;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("tescord_selected_camera_id", deviceId);
      }
      this.notifyActiveCameraChanged();
    }

    if (this.room && this.isConnected) {
      try {
        const cameraOptions: any =
          targetDeviceId && targetDeviceId !== "default"
            ? { deviceId: { exact: targetDeviceId } }
            : undefined;
        const effectiveCodec = this.resolveEffectiveVideoCodec(
          this.preferredVideoCodec,
        );
        const publishOptions: any = {
          videoCodec: effectiveCodec as any,
          backupCodec: this.enableBackupCodec ? { codec: "vp8" } : false,
          simulcast: true,
        };
        await this.room.localParticipant.setCameraEnabled(
          enabled,
          cameraOptions,
          publishOptions,
        );
        const pub = this.room.localParticipant.getTrackPublication(
          Track.Source.Camera,
        );
        this.localCameraTrack = pub?.videoTrack || null;
      } catch (e) {
        console.warn("LiveKit camera toggle:", e);
      }
    }

    // 若当前未建立 LiveKit SFU 媒体连接 (如单机离线模式或 E2E 测试环境)，通过原生 getUserMedia 获取本地视频流
    if (
      enabled &&
      !this.localCameraTrack &&
      navigator.mediaDevices?.getUserMedia
    ) {
      try {
        const videoConstraints: any =
          targetDeviceId && targetDeviceId !== "default"
            ? { deviceId: { exact: targetDeviceId } }
            : true;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
        });
        this.localCameraTrack = stream.getVideoTracks()[0] || null;
      } catch (e) {
        console.warn("Local camera fallback getUserMedia error:", e);
      }
    } else if (
      !enabled &&
      this.localCameraTrack &&
      (!this.room || !this.isConnected)
    ) {
      try {
        if (typeof this.localCameraTrack.stop === "function") {
          this.localCameraTrack.stop();
        }
      } catch {}
      this.localCameraTrack = null;
    }

    const identity = this.room?.localParticipant?.identity || "local";
    if (this.localCameraTrack && enabled) {
      this.cameraTracksMap.set(identity, this.localCameraTrack);
    } else {
      this.cameraTracksMap.delete(identity);
      this.localCameraTrack = null;
    }
    this.notifyCameraTracksChanged();
    return true;
  }

  onCameraTracksChange(
    callback: (tracks: Map<string, any>) => void,
  ): () => void {
    this.onCameraTracksChangedCallbacks.add(callback);
    callback(new Map(this.cameraTracksMap));
    return () => {
      this.onCameraTracksChangedCallbacks.delete(callback);
    };
  }

  private notifyCameraTracksChanged() {
    const copy = new Map(this.cameraTracksMap);
    this.onCameraTracksChangedCallbacks.forEach((cb) => {
      try {
        cb(copy);
      } catch (err) {
        console.warn("LiveKit camera tracks callback error:", err);
      }
    });
  }

  getCameraTrack(identity: string): any {
    return this.cameraTracksMap.get(identity) || null;
  }

  // 8. 阶段四：屏幕分享推流、Simulcast 与分辨率控制
  async startScreenShareWithStream(
    stream: MediaStream,
    options?: ScreenShareOptions,
  ): Promise<boolean> {
    try {
      await this.stopScreenShare();
      this.localScreenStream = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return false;

      const presetKey = options?.preset || "1080p60";
      const preset =
        SCREEN_SHARE_PRESETS[presetKey] || SCREEN_SHARE_PRESETS["1080p60"];

      const targetCodec =
        options?.videoCodec || this.preferredVideoCodec || "h264";
      const effectiveCodec = this.resolveEffectiveVideoCodec(targetCodec);
      const targetBitrate =
        options?.customBitrate &&
        options.customBitrate >= MIN_CUSTOM_BITRATE &&
        options.customBitrate <= MAX_CUSTOM_BITRATE
          ? options.customBitrate
          : this.customBitrate &&
              this.customBitrate >= MIN_CUSTOM_BITRATE &&
              this.customBitrate <= MAX_CUSTOM_BITRATE
            ? this.customBitrate
            : preset.bitrate;

      const localIdentity = this.room?.localParticipant?.identity || "local";

      // 若当前未建立 LiveKit SFU 媒体连接 (如单机离线模式或 E2E 测试环境)，直接通过本地 MediaStreamTrack 维护状态
      if (!this.room || !this.isConnected) {
        this.localScreenVideoTrack = videoTrack;
        videoTrack.onended = () => {
          this.stopScreenShare();
        };

        const shareInfo: ActiveScreenShare = {
          track: videoTrack,
          participantIdentity: localIdentity,
          isLocal: true,
          preset: presetKey,
          resolution: `${preset.width}x${preset.height}`,
          frameRate: preset.frameRate,
          codec: effectiveCodec.toUpperCase(),
        };

        this.screenSharesMap.set(localIdentity, shareInfo);
        this.activeScreenShare = shareInfo;
        this.notifyScreenSharesChanged();
        this.notifyScreenShareChanged();
        return true;
      }

      // 开启 detail 细节优先提示，优化屏幕高频文字与代码清晰度，避免抗锯齿过度模糊
      if ("contentHint" in videoTrack) {
        (videoTrack as any).contentHint = "detail";
      }

      // 发布屏幕视频轨 (启用 Simulcast 多清晰度广播与指定编码格式)
      // 显式传入 screenShareEncoding，修复 livekit-client 在屏幕分享场景下忽略 videoEncoding 的底层缺陷
      await this.room.localParticipant.publishTrack(videoTrack, {
        name: "screen-share-video",
        source: Track.Source.ScreenShare,
        simulcast: options?.simulcast !== false,
        videoCodec: effectiveCodec as any,
        backupCodec: this.enableBackupCodec ? { codec: "vp8" } : false,
        videoEncoding: {
          maxBitrate: targetBitrate,
          maxFramerate: preset.frameRate,
        },
        screenShareEncoding: {
          maxBitrate: targetBitrate,
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

      // 麦克风与屏幕伴音使用独立双轨推流，互不干扰，麦克风保持正常推流状态

      // 当用户在系统层或浏览器浮动条点击“停止共享”时，自动联动清理
      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      const shareInfo: ActiveScreenShare = {
        track: videoTrack,
        audioTrack: this.localScreenAudioTrack,
        participantIdentity: this.room.localParticipant.identity,
        isLocal: true,
        preset: presetKey,
        resolution: `${preset.width}x${preset.height}`,
        frameRate: preset.frameRate,
        codec: effectiveCodec.toUpperCase(),
      };

      this.localScreenShare = shareInfo;
      this.screenSharesMap.set(this.room.localParticipant.identity, shareInfo);
      if (!this.activeScreenShare) {
        this.activeScreenShare = shareInfo;
        this.notifyScreenShareChanged();
      }

      this.notifyScreenSharesChanged();
      return true;
    } catch (err) {
      console.warn("Failed to publish screen share stream:", err);
      return false;
    }
  }

  async stopScreenShare() {
    try {
      if (this.room && this.isConnected) {
        if (this.localScreenVideoTrack) {
          await this.room.localParticipant
            .unpublishTrack(this.localScreenVideoTrack)
            .catch((err) =>
              console.warn("Unpublish screen video track error:", err),
            );
        }
        if (this.localScreenAudioTrack) {
          await this.room.localParticipant
            .unpublishTrack(this.localScreenAudioTrack)
            .catch((err) =>
              console.warn("Unpublish screen audio track error:", err),
            );
        }
      }
    } catch (e) {
      console.warn("Stop screen share error:", e);
    } finally {
      // 必须无条件停止底层物理 Track 并释放硬件捕获资源
      if (this.localScreenVideoTrack) {
        try {
          this.localScreenVideoTrack.stop();
        } catch {}
        this.localScreenVideoTrack = null;
      }
      if (this.localScreenAudioTrack) {
        try {
          this.localScreenAudioTrack.stop();
        } catch {}
        this.localScreenAudioTrack = null;
      }
      if (this.localScreenStream) {
        try {
          this.localScreenStream.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {}
          });
        } catch {}
        this.localScreenStream = null;
      }
    }

    // 恢复麦克风独立推流
    if (this.localAudioPublication?.track) {
      try {
        this.localAudioPublication.track.unmute();
      } catch {}
    }

    audioMixer.cleanup();

    this.localScreenShare = null;
    const localIdentity = this.room?.localParticipant?.identity || "local";
    this.screenSharesMap.delete(localIdentity);

    if (
      this.activeScreenShare?.isLocal ||
      this.activeScreenShare?.participantIdentity === localIdentity
    ) {
      this.activeScreenShare =
        this.screenSharesMap.values().next().value || null;
      this.notifyScreenShareChanged();
    }
    this.notifyScreenSharesChanged();
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

  onScreenSharesChange(
    callback: (shares: Map<string, ActiveScreenShare>) => void,
  ): () => void {
    this.onScreenSharesChangedCallbacks.add(callback);
    callback(new Map(this.screenSharesMap));
    return () => {
      this.onScreenSharesChangedCallbacks.delete(callback);
    };
  }

  private notifyScreenSharesChanged() {
    const copy = new Map(this.screenSharesMap);
    this.onScreenSharesChangedCallbacks.forEach((cb) => {
      try {
        cb(copy);
      } catch (err) {
        console.warn("Screen shares map callback error:", err);
      }
    });
  }

  getScreenShare(identity: string): ActiveScreenShare | null {
    return this.screenSharesMap.get(identity) || null;
  }

  get isSharingScreen(): boolean {
    return Boolean(
      this.localScreenVideoTrack ||
      this.localScreenShare ||
      this.activeScreenShare?.isLocal,
    );
  }

  getLocalScreenVideoTrack(): any {
    return this.localScreenVideoTrack;
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
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
          audio: audioConstraints,
          // @ts-ignore
          systemAudio: "include",
          // @ts-ignore
          selfBrowserSurface: "exclude",
        });
        return this.startScreenShareWithStream(stream);
      } catch (err: any) {
        if (
          err?.name === "NotReadableError" ||
          err?.name === "TrackStartError" ||
          err?.name === "OverconstrainedError" ||
          (typeof err?.message === "string" &&
            err.message.toLowerCase().includes("audio"))
        ) {
          try {
            console.warn("⚠️ 伴音采集失败，自动降级为仅画面推流:", err);
            const videoOnlyStream =
              await navigator.mediaDevices.getDisplayMedia({
                video: {
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                  frameRate: { ideal: 60 },
                },
                audio: false,
              });
            return this.startScreenShareWithStream(videoOnlyStream);
          } catch (fallbackErr) {
            console.warn(
              "Screen share fallback request cancelled or error:",
              fallbackErr,
            );
            return false;
          }
        }
        console.warn("Screen share request cancelled or error:", err);
        return false;
      }
    } else {
      await this.stopScreenShare();
      return true;
    }
  }

  private syncCombinedActiveSpeakers() {
    const combined = new Set<string>([
      ...this.sfuActiveSpeakers,
      ...this.localActiveSpeakers,
    ]);

    let isDifferent = combined.size !== this.activeSpeakers.size;
    if (!isDifferent) {
      for (const id of combined) {
        if (!this.activeSpeakers.has(id)) {
          isDifferent = true;
          break;
        }
      }
    }

    if (isDifferent) {
      this.activeSpeakers = combined;
      const list = Array.from(combined);
      this.onActiveSpeakersChangedCallbacks.forEach((cb) => {
        try {
          cb(list);
        } catch (err) {
          console.error(
            "[LiveKit] onActiveSpeakersChange callback error:",
            err,
          );
        }
      });
    }
  }

  private startRemoteAudioEnergyMonitoring() {
    if (this.remoteEnergyTimer) return;

    const sampleBuffer = new Uint8Array(128); // 256 / 2
    this.remoteEnergyTimer = setInterval(() => {
      if (this.participantAudioMap.size === 0) {
        this.stopRemoteAudioEnergyMonitoring();
        return;
      }

      const now = Date.now();
      let hasChange = false;

      this.participantAudioMap.forEach((ctrl, identity) => {
        let maxAvgEnergy = 0;

        ctrl.tracks.forEach((entry) => {
          if (entry.analyserNode) {
            try {
              entry.analyserNode.getByteFrequencyData(sampleBuffer);
              let sum = 0;
              for (let i = 0; i < sampleBuffer.length; i++) {
                sum += sampleBuffer[i];
              }
              const avg = sum / sampleBuffer.length;
              if (avg > maxAvgEnergy) {
                maxAvgEnergy = avg;
              }
            } catch {}
          }
        });

        // 门限判断: avg >= 6 判定说话，辅以 250ms 滞后计时器 (Hangover) 滤除微弱停顿
        const ENERGY_THRESHOLD = 6;
        const HANGOVER_MS = 250;

        let state = this.remoteSpeakingStates.get(identity);
        if (!state) {
          state = { isSpeaking: false, lastActive: 0 };
          this.remoteSpeakingStates.set(identity, state);
        }

        if (maxAvgEnergy >= ENERGY_THRESHOLD) {
          state.lastActive = now;
          if (!state.isSpeaking) {
            state.isSpeaking = true;
            this.localActiveSpeakers.add(identity);
            hasChange = true;
          }
        } else {
          if (state.isSpeaking && now - state.lastActive > HANGOVER_MS) {
            state.isSpeaking = false;
            this.localActiveSpeakers.delete(identity);
            hasChange = true;
          }
        }
      });

      if (hasChange) {
        this.syncCombinedActiveSpeakers();
      }
    }, 35);
  }

  private stopRemoteAudioEnergyMonitoring() {
    if (this.remoteEnergyTimer) {
      clearInterval(this.remoteEnergyTimer);
      this.remoteEnergyTimer = null;
    }
    this.localActiveSpeakers.clear();
    this.remoteSpeakingStates.clear();
    this.syncCombinedActiveSpeakers();
  }

  async leaveRoom(isSwitching: boolean = false) {
    this.isSwitchingRoom = isSwitching;
    try {
      await this.stopScreenShare();
    } catch {}
    this.cleanup();
    this.watchedScreenParticipants.clear();
    if (this.room) {
      const roomToDisconnect = this.room;
      this.room = null;
      try {
        roomToDisconnect.removeAllListeners();
        await roomToDisconnect.disconnect();
      } catch (e) {
        console.warn("[LiveKit] Error disconnecting room:", e);
      }
    }
    this.isConnected = false;
    if (!isSwitching) {
      this.currentRoomName = null;
      this.setConnectionStatus("disconnected");
      this.notifyState(false);
    }
    if (isSwitching) {
      this.isSwitchingRoom = false;
    }
  }

  private cleanup() {
    this.stopRemoteAudioEnergyMonitoring();
    this.stopNetworkStatsPolling();
    this.networkStatsMap.clear();
    this.lastValidLocalRtt = null;
    this.lastValidLocalLoss = null;
    this.localRttHistory = [];
    this.sfuActiveSpeakers.clear();
    this.localActiveSpeakers.clear();
    this.remoteSpeakingStates.clear();
    this.activeSpeakers.clear();
    this.localScreenShare = null;
    if (this.activeScreenShare) {
      this.activeScreenShare = null;
      this.notifyScreenShareChanged();
    }
    this.screenSharesMap.clear();
    this.notifyScreenSharesChanged();
    this.cameraTracksMap.clear();
    this.localCameraTrack = null;
    this.notifyCameraTracksChanged();

    // 清理所有远端 Web Audio 节点与音轨
    this.participantAudioMap.forEach((ctrl) => {
      ctrl.tracks.forEach((entry) => {
        if (entry.analyserNode) {
          try {
            entry.analyserNode.disconnect();
          } catch {}
        }
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

    this.unbindLifecycleListeners();
    this.setAudioPlaybackStatus({
      canPlay: true,
      isInterrupted: false,
      error: undefined,
    });

    if (
      this.playbackAudioContext &&
      this.playbackAudioContext.state !== "closed"
    ) {
      try {
        this.playbackAudioContext.removeEventListener(
          "statechange",
          this.handlePlaybackContextStateChange,
        );
        this.playbackAudioContext.close();
      } catch {}
      this.playbackAudioContext = null;
    }

    this.localAudioPublication = null;
  }

  // ----------------------------------------------------
  // 音频播放与系统中断恢复 (iOS WebKit / 后台切换 / 休眠唤醒)
  // ----------------------------------------------------
  public getAudioPlaybackStatus(): AudioPlaybackStatus {
    return { ...this.audioPlaybackStatus };
  }

  public onAudioPlaybackStatusChange(
    callback: (status: AudioPlaybackStatus) => void,
  ): () => void {
    this.onAudioPlaybackStatusChangedCallbacks.add(callback);
    callback(this.getAudioPlaybackStatus());
    return () => {
      this.onAudioPlaybackStatusChangedCallbacks.delete(callback);
    };
  }

  private setAudioPlaybackStatus(status: Partial<AudioPlaybackStatus>) {
    const prev = this.audioPlaybackStatus;
    const next: AudioPlaybackStatus = { ...prev, ...status };
    if (
      prev.canPlay !== next.canPlay ||
      prev.isInterrupted !== next.isInterrupted ||
      prev.error !== next.error
    ) {
      this.audioPlaybackStatus = next;
      this.onAudioPlaybackStatusChangedCallbacks.forEach((cb) => {
        try {
          cb(next);
        } catch (e) {
          console.error("[LiveKit] onAudioPlaybackStatusChanged error:", e);
        }
      });
    }
  }

  private handlePlaybackContextStateChange = () => {
    if (!this.playbackAudioContext) return;
    const state = this.playbackAudioContext.state as string;
    console.info(`[LiveKit] playbackAudioContext statechange: ${state}`);
    if (
      this.isConnected &&
      (state === "suspended" || state === "interrupted")
    ) {
      this.setAudioPlaybackStatus({ isInterrupted: true, canPlay: false });
    } else if (state === "running") {
      if (this.audioPlaybackStatus.isInterrupted) {
        this.setAudioPlaybackStatus({
          isInterrupted: false,
          canPlay: true,
          error: undefined,
        });
      }
    }
  };

  private onVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible" && this.isConnected) {
      console.info(
        "[LiveKit] Page visible again, triggering silent audio recovery...",
      );
      void this.attemptSilentRecovery();
    }
  };

  private onPageShow = () => {
    if (this.isConnected) {
      console.info(
        "[LiveKit] pageshow event, triggering silent audio recovery...",
      );
      void this.attemptSilentRecovery();
    }
  };

  private onWindowFocus = () => {
    if (this.isConnected && this.audioPlaybackStatus.isInterrupted) {
      console.info(
        "[LiveKit] window focus, triggering silent audio recovery...",
      );
      void this.attemptSilentRecovery();
    }
  };

  private bindLifecycleListeners() {
    if (this.isLifecycleListenersBound || typeof window === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pageshow", this.onPageShow);
    window.addEventListener("focus", this.onWindowFocus);
    this.isLifecycleListenersBound = true;
  }

  private unbindLifecycleListeners() {
    if (!this.isLifecycleListenersBound || typeof window === "undefined")
      return;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pageshow", this.onPageShow);
    window.removeEventListener("focus", this.onWindowFocus);
    this.isLifecycleListenersBound = false;
  }

  /**
   * 尝试静默唤醒音频。
   * 当用户从其他应用切回或屏幕点亮时触发；
   * 若浏览器策略允许恢复则直接自愈，若被 Autoplay 拦截则标记 isInterrupted 呼出 UI 引导条。
   */
  public async attemptSilentRecovery(): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      const ok = await this.resumeAudio();
      return ok;
    } catch (err) {
      console.warn(
        "[LiveKit] attemptSilentRecovery blocked by browser/system:",
        err,
      );
      this.setAudioPlaybackStatus({ isInterrupted: true, canPlay: false });
      return false;
    }
  }

  /**
   * 恢复全链路音频能力 (用户点击横幅 / 任意触屏兜底 / 前台自愈)
   */
  public async resumeAudio(): Promise<boolean> {
    console.info("[LiveKit] resumeAudio invoked");
    let allOk = true;

    // 1. 恢复远端 Web Audio 软压限母带总线
    if (
      this.playbackAudioContext &&
      this.playbackAudioContext.state !== "closed"
    ) {
      const state = this.playbackAudioContext.state as string;
      if (state === "suspended" || state === "interrupted") {
        try {
          await this.playbackAudioContext.resume();
        } catch (e) {
          console.warn("[LiveKit] resume playbackAudioContext failed:", e);
          allOk = false;
        }
      }
    }

    // 2. 恢复本地麦克风采集 AudioEngine
    try {
      await audioEngine.resume();
    } catch (e) {
      console.warn("[LiveKit] resume audioEngine failed:", e);
    }

    // 3. 恢复 LiveKit 房间音频能力与 dummy audio 播放
    if (this.room) {
      try {
        if (typeof (this.room as any).startAudio === "function") {
          await (this.room as any).startAudio();
        }
      } catch (e) {
        console.warn("[LiveKit] room.startAudio() rejected:", e);
        allOk = false;
      }
    }

    // 4. 重试所有远端绑定的 HTMLAudioElement 播放
    this.participantAudioMap.forEach((ctrl) => {
      ctrl.tracks.forEach((entry) => {
        if (entry.element && entry.element.paused) {
          entry.element.play().catch(() => {});
        }
      });
    });

    const isRunning =
      !this.playbackAudioContext ||
      this.playbackAudioContext.state === "running";

    if (allOk && isRunning) {
      this.setAudioPlaybackStatus({
        canPlay: true,
        isInterrupted: false,
        error: undefined,
      });
      return true;
    } else {
      this.setAudioPlaybackStatus({ isInterrupted: true, canPlay: false });
      return false;
    }
  }

  public simulateInterruption(isInterrupted: boolean = true) {
    this.setAudioPlaybackStatus({ isInterrupted, canPlay: !isInterrupted });
  }

  onStateChange(callback: (connected: boolean) => void) {
    this.onRoomStateChangedCallbacks.add(callback);
    return () => {
      this.onRoomStateChangedCallbacks.delete(callback);
    };
  }

  onDisconnected(callback: (reason?: any) => void) {
    this.onDisconnectedCallbacks.add(callback);
    return () => {
      this.onDisconnectedCallbacks.delete(callback);
    };
  }

  private notifyState(connected: boolean) {
    this.onRoomStateChangedCallbacks.forEach((cb) => cb(connected));
  }

  async getStreamDetailedStats(
    targetIdentity?: string,
  ): Promise<StreamDetailedStats> {
    const isLocal =
      !targetIdentity ||
      targetIdentity === this.room?.localParticipant?.identity;
    const identity =
      targetIdentity || this.room?.localParticipant?.identity || "unknown";

    let mimeType = "未知";
    let videoInfo = "未知";
    let audioInfo = "未知";
    let encoder = "未知";
    let streamHost =
      (this.room as any)?.serverUrl ||
      (this.room as any)?.engine?.client?.serverUrl ||
      "未知";
    let connectionMode = "协商中";
    let protocol = "未知";
    let bufferLength = "未知";
    let decodedFrames: string | undefined = undefined;
    let rtt = "N/A";
    let packetLoss = "未知";
    let jitter = "未知";
    let ipVersion: "IPv4" | "IPv6" | undefined;
    let candidateType: "host" | "srflx" | "prflx" | "relay" | undefined;

    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let actualSendCodec: string | undefined;
    let actualReceiveCodec: string | undefined;
    let selectedPairFound = false;

    if (this.room) {
      try {
        const pcManager = (this.room as any).engine?.pcManager;
        if (pcManager) {
          const report = isLocal
            ? await pcManager.publisher?.getStats()
            : await pcManager.subscriber?.getStats();

          if (report) {
            interface CodecMeta {
              mimeType: string;
              payloadType?: number;
              sdpFmtpLine?: string;
              clockRate?: number;
              channels?: number;
            }
            const codecMap = new Map<string, CodecMeta>();
            let selectedCandidatePairId = "";

            const formatCodecLabel = (
              meta?: CodecMeta,
              kind: "video" | "audio" = "video",
            ) => {
              if (!meta || !meta.mimeType) return "";
              const name = meta.mimeType
                .replace(/^(video|audio)\//i, "")
                .toUpperCase();
              if (kind === "video") {
                const sub: string[] = [];
                if (meta.payloadType !== undefined)
                  sub.push(String(meta.payloadType));
                if (meta.sdpFmtpLine) sub.push(meta.sdpFmtpLine);
                return sub.length > 0 ? `${name} (${sub.join(", ")})` : name;
              } else {
                const parts: string[] = [];
                if (meta.clockRate)
                  parts.push(`${Math.round(meta.clockRate / 1000)}kHz`);
                if (meta.channels) parts.push(`${meta.channels}ch`);
                if (meta.payloadType !== undefined)
                  parts.push(`PT:${meta.payloadType}`);
                return parts.length > 0
                  ? `${name} (${parts.join(", ")})`
                  : name;
              }
            };

            report.forEach((stat: any) => {
              if (stat.type === "codec" && stat.mimeType) {
                codecMap.set(stat.id, {
                  mimeType: stat.mimeType,
                  payloadType: stat.payloadType,
                  sdpFmtpLine: stat.sdpFmtpLine,
                  clockRate: stat.clockRate,
                  channels: stat.channels,
                });
              }
              if (stat.type === "transport" && stat.selectedCandidatePairId) {
                selectedCandidatePairId = stat.selectedCandidatePairId;
              }
            });

            // 远端参与者下行轨道匹配 (防止多成员多视频轨道统计冲突)
            const targetTrackIds = new Set<string>();
            if (!isLocal && identity && this.room) {
              const remoteP = this.room.getParticipantByIdentity(identity);
              if (remoteP) {
                remoteP.trackPublications.forEach((pub: any) => {
                  const tid = pub.track?.mediaStreamTrack?.id || pub.trackSid;
                  if (tid) targetTrackIds.add(tid);
                });
              }
            }

            report.forEach((stat: any) => {
              // 1. ICE Candidate Pair 物理拓扑
              if (
                stat.type === "candidate-pair" &&
                (selectedCandidatePairId
                  ? stat.id === selectedCandidatePairId
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

                // 判断 IPv4 / IPv6
                const checkAddr =
                  remoteCand?.address || localCand?.address || "";
                if (checkAddr.includes(":") && !checkAddr.startsWith("fe80:")) {
                  ipVersion = "IPv6";
                } else {
                  ipVersion = "IPv4";
                }

                if (remoteCand?.candidateType) {
                  candidateType = remoteCand.candidateType;
                } else if (localCand?.candidateType) {
                  candidateType = localCand.candidateType;
                }

                // SFU 架构下绝不是 P2P Direct，明确标记为 SFU 服务端连接架构
                if (candidateType === "relay") {
                  connectionMode = `SFU Relay (${protocol} / TURN ${ipVersion})`;
                } else if (candidateType === "host") {
                  connectionMode = `SFU Direct (${protocol} / Host ${ipVersion})`;
                } else if (candidateType === "srflx") {
                  connectionMode = `SFU Direct (${protocol} / STUN ${ipVersion})`;
                } else if (candidateType) {
                  connectionMode = `SFU Direct (${protocol} / ${candidateType.toUpperCase()} ${ipVersion})`;
                }
              }

              // 2. 下行接收统计 (Inbound RTP)
              if (stat.type === "inbound-rtp") {
                const matchTrack =
                  targetTrackIds.size === 0 ||
                  (stat.trackIdentifier &&
                    targetTrackIds.has(stat.trackIdentifier));

                if (matchTrack) {
                  const meta = stat.codecId
                    ? codecMap.get(stat.codecId)
                    : undefined;
                  const negotiatedCodec = meta?.mimeType;
                  if (
                    negotiatedCodec &&
                    !/rtx|red|ulpfec|flexfec|cn/i.test(negotiatedCodec)
                  ) {
                    actualReceiveCodec = negotiatedCodec;
                    mimeType = negotiatedCodec;
                  }
                  if (stat.bytesReceived) {
                    totalBytesReceived += stat.bytesReceived;
                  }
                  if (stat.kind === "video") {
                    const codecLabel = formatCodecLabel(meta, "video");
                    const resFps =
                      stat.frameWidth && stat.frameHeight
                        ? stat.framesPerSecond
                          ? `${stat.frameWidth}x${stat.frameHeight}@${Math.round(stat.framesPerSecond)}fps`
                          : `${stat.frameWidth}x${stat.frameHeight}`
                        : "";
                    videoInfo =
                      [resFps, codecLabel].filter(Boolean).join(" · ") ||
                      "视频流接收中";

                    if (stat.framesDecoded !== undefined) {
                      decodedFrames = `${stat.framesDecoded} frames (${stat.framesDropped || 0} dropped)`;
                    }
                    if (typeof stat.jitter === "number") {
                      jitter = `${(stat.jitter * 1000).toFixed(1)}ms`;
                    }
                    if (
                      stat.jitterBufferDelay &&
                      stat.jitterBufferEmittedCount
                    ) {
                      const avgDelay =
                        (stat.jitterBufferDelay /
                          stat.jitterBufferEmittedCount) *
                        1000;
                      bufferLength = `${avgDelay.toFixed(1)}ms`;
                    }
                    if (typeof stat.fractionLost === "number") {
                      packetLoss = `${(stat.fractionLost * 100).toFixed(1)}%`;
                    }
                  } else if (stat.kind === "audio") {
                    const audioLabel = formatCodecLabel(meta, "audio");
                    audioInfo = audioLabel
                      ? `音频 (${audioLabel})`
                      : "音频轨道已接收";
                    if (videoInfo === "未知") videoInfo = "无视频轨道";
                    if (typeof stat.jitter === "number" && jitter === "未知") {
                      jitter = `${(stat.jitter * 1000).toFixed(1)}ms`;
                    }
                  }
                }
              }

              // 3. 上行推流统计 (Outbound RTP)
              if (stat.type === "outbound-rtp") {
                const meta = stat.codecId
                  ? codecMap.get(stat.codecId)
                  : undefined;
                const negotiatedCodec = meta?.mimeType;
                if (
                  negotiatedCodec &&
                  !/rtx|red|ulpfec|flexfec|cn/i.test(negotiatedCodec)
                ) {
                  actualSendCodec = negotiatedCodec;
                  mimeType = negotiatedCodec;
                }
                if (stat.bytesSent) {
                  totalBytesSent += stat.bytesSent;
                }
                if (stat.kind === "video") {
                  const parts: string[] = [];
                  if (stat.encoderImplementation)
                    parts.push(stat.encoderImplementation);
                  if (stat.scalabilityMode) parts.push(stat.scalabilityMode);
                  if (stat.powerEfficientEncoder !== undefined) {
                    parts.push(
                      stat.powerEfficientEncoder
                        ? "省电编码:是"
                        : "省电编码:否",
                    );
                  }
                  if (parts.length > 0) {
                    encoder = parts.join(" · ");
                  }
                  const codecLabel = formatCodecLabel(meta, "video");
                  const resFps =
                    stat.frameWidth && stat.frameHeight
                      ? stat.framesPerSecond
                        ? `${stat.frameWidth}x${stat.frameHeight}@${Math.round(stat.framesPerSecond)}fps`
                        : `${stat.frameWidth}x${stat.frameHeight}`
                      : "";
                  videoInfo =
                    [resFps, codecLabel].filter(Boolean).join(" · ") ||
                    "推流中";

                  if (stat.framesEncoded !== undefined) {
                    decodedFrames = `Encoded: ${stat.framesEncoded} frames${stat.retransmittedPacketsSent ? ` (${stat.retransmittedPacketsSent} retrans)` : ""}`;
                  }
                } else if (stat.kind === "audio") {
                  const audioLabel = formatCodecLabel(meta, "audio");
                  audioInfo = audioLabel
                    ? `音频 (${audioLabel})`
                    : "音频推流中";
                }
              }

              // 4. 推流端回传的 RTCP 统计 (Remote Inbound RTP - 用于本地推流端获取上行 RTT/丢包率/抖动)
              if (isLocal && stat.type === "remote-inbound-rtp") {
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
          }
        }
      } catch (e) {
        console.warn("Failed to get RTC detailed stream stats:", e);
      }
    }

    // 4. 精确计算瞬时上行与下行比特率
    const rateCalc = bitrateCalculator.compute(
      `livekit-${identity}`,
      totalBytesSent,
      totalBytesReceived,
    );

    const downloadBitrate =
      totalBytesSent + totalBytesReceived > 0
        ? isLocal
          ? rateCalc.uploadFormatted
          : rateCalc.downloadFormatted
        : "未知";
    const uploadBitrate =
      isLocal && totalBytesSent > 0 ? rateCalc.uploadFormatted : undefined;

    return {
      participantIdentity: identity,
      isLocal,
      mimeType,
      playerCore: "LiveKit WebRTC SFU Engine",
      videoInfo,
      audioInfo,
      encoder,
      streamHost,
      connectionMode,
      topology: "SFU_SERVER" as ConnectionTopology,
      protocol,
      bufferLength: isLocal ? "0.0ms (推流直出)" : bufferLength,
      decodedFrames: decodedFrames || "N/A",
      downloadBitrate,
      uploadBitrate,
      rawDownloadBitrateBps: isLocal
        ? rateCalc.uploadBps
        : rateCalc.downloadBps,
      rawUploadBitrateBps: isLocal ? rateCalc.uploadBps : undefined,
      totalBytesReceived,
      totalBytesSent,
      rtt,
      packetLoss,
      jitter,
      holePunchStatus: "SFU 服务端转发连通",
      ipVersion,
      candidateType,
      preferredVideoCodec: this.preferredVideoCodec,
      actualSendCodec,
      actualReceiveCodec,
      codecFallbackReason:
        (actualSendCodec || actualReceiveCodec) &&
        !(actualSendCodec || actualReceiveCodec)
          ?.toLowerCase()
          .includes(this.preferredVideoCodec.toLowerCase())
          ? "对端能力或浏览器协商导致编码降级"
          : undefined,
      transportVerified:
        selectedPairFound &&
        totalBytesSent + totalBytesReceived > 0 &&
        rateCalc.uploadBps + rateCalc.downloadBps > 0,
    };
  }
}

export const livekitService = new LiveKitService();

if (typeof window !== "undefined") {
  (window as any).__livekitService = livekitService;
}
