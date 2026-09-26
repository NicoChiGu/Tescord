import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  audioEngine,
  TripleABTestResult,
  QuadABTestResult,
} from "../../services/audioEngine.js";
import {
  NoiseSuppressionMode,
  VideoCodecType,
  CodecCapabilityInfo,
  MIN_CUSTOM_BITRATE,
  MAX_CUSTOM_BITRATE,
} from "@tescord/types";
import {
  livekitService,
  detectSupportedVideoCodecs,
  detectSupportedVideoCodecsAsync,
} from "../../services/livekit.js";
import { cloudflareRealtimeService } from "../../services/cloudflare_realtime/index.js";
import { VOICE_ENGINE } from "../../config.js";
import {
  Volume2,
  Mic,
  MicOff,
  Headphones,
  Sparkles,
  Cpu,
  Zap,
  Keyboard,
  Clock,
  Radio,
  Music,
  Sliders,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  CheckCircle2,
  VolumeX,
  Play,
  Square,
  HelpCircle,
  X,
  Check,
  Video,
  VideoOff,
  Camera,
  RefreshCw,
  Film,
  Layers,
  Gauge,
  Info,
  ShieldCheck,
} from "lucide-react";

interface AudioSettingsTabProps {
  isInCall?: boolean;
  initialSubSection?: "voice" | "video";
}

export const AudioSettingsTab: React.FC<AudioSettingsTabProps> = ({
  isInCall = false,
  initialSubSection,
}) => {
  const { t } = useTranslation(["settings", "common"]);
  const [config, setConfig] = useState(audioEngine.config);
  const [currentVolume, setCurrentVolume] = useState(0);

  // 设备列表
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>(
    livekitService.getAudioInputDeviceId() || "default",
  );
  const [selectedOutputId, setSelectedOutputId] = useState<string>(
    config.outputDeviceId || "default",
  );
  const [selectedCameraId, setSelectedCameraId] = useState<string>(
    livekitService.getCameraDeviceId() || "default",
  );

  // 视频预览与测试状态
  const [isTestingVideo, setIsTestingVideo] = useState<boolean>(false);
  const [mirrorPreview, setMirrorPreview] = useState<boolean>(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const testVideoRef = useRef<HTMLVideoElement | null>(null);
  const testVideoStreamRef = useRef<MediaStream | null>(null);
  const videoSectionRef = useRef<HTMLDivElement | null>(null);

  // 输出音量与测试音频状态 (从 livekitService 读取持久化全局输出音量)
  const [outputVolume, setOutputVolume] = useState<number>(() =>
    (VOICE_ENGINE === "cloudflare_realtime" ? cloudflareRealtimeService : livekitService).getMasterVolume(),
  );
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  // 高级设置折叠状态 (默认收起，保持界面清爽)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // 按键录制状态
  const [isRecordingKeybind, setIsRecordingKeybind] = useState(false);

  // A/B 降噪录音对比小工具状态
  const [isABTesting, setIsABTesting] = useState(false);
  const [abCountdown, setABCountdown] = useState(5);
  const [abResult, setABResult] = useState<
    QuadABTestResult | TripleABTestResult | null
  >(null);
  const [abError, setABError] = useState<string | null>(null);
  const abAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abAbortRef.current?.abort(), []);
  const [noiseStatus, setNoiseStatus] = useState(() => ({
    ...audioEngine.noiseStatus,
  }));
  useEffect(
    () => () => {
      if (!abResult) return;
      for (const url of [
        abResult.rawUrl,
        abResult.rnnoiseUrl,
        abResult.dtlnUrl,
        abResult.dfn3Url,
      ]) {
        if (url) URL.revokeObjectURL(url);
      }
    },
    [abResult],
  );

  useEffect(() => {
    const timer = setInterval(
      () => setNoiseStatus({ ...audioEngine.noiseStatus }),
      250,
    );
    return () => clearInterval(timer);
  }, []);

  // 视频编解码器与硬件加速配置状态
  const [supportedCodecs, setSupportedCodecs] = useState<CodecCapabilityInfo[]>(
    () => detectSupportedVideoCodecs(),
  );
  const [preferredCodec, setPreferredCodec] = useState<VideoCodecType>(
    livekitService.preferredVideoCodec,
  );
  const [enableBackupCodec, setEnableBackupCodec] = useState<boolean>(
    livekitService.enableBackupCodec,
  );
  const [customBitrate, setCustomBitrate] = useState<number | null>(
    livekitService.customBitrate,
  );

  useEffect(() => {
    const unsub = livekitService.onVideoSettingsChange(() => {
      setPreferredCodec(livekitService.preferredVideoCodec);
      setEnableBackupCodec(livekitService.enableBackupCodec);
      setCustomBitrate(livekitService.customBitrate);
    });
    setSupportedCodecs(detectSupportedVideoCodecs());
    detectSupportedVideoCodecsAsync().then((codecs) => {
      setSupportedCodecs(codecs);
    });
    return () => unsub();
  }, []);

  const handleCodecSelect = (codec: VideoCodecType) => {
    setPreferredCodec(codec);
    livekitService.setPreferredVideoCodec(codec);
  };

  const handleBackupCodecToggle = (checked: boolean) => {
    setEnableBackupCodec(checked);
    livekitService.setEnableBackupCodec(checked);
  };

  const handleVideoBitrateChange = (val: number) => {
    setCustomBitrate(val);
    livekitService.setCustomBitrate(val);
  };

  const handleResetVideoBitrate = () => {
    setCustomBitrate(null);
    livekitService.setCustomBitrate(null);
  };

  // 1. 枚举系统音频与视频硬件设备
  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput");
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      const cameras = devices.filter((d) => d.kind === "videoinput");

      setInputDevices(inputs);
      setOutputDevices(outputs);
      setCameraDevices(cameras);

      const activeInputId = livekitService.getAudioInputDeviceId();
      if (activeInputId && inputs.some((i) => i.deviceId === activeInputId)) {
        setSelectedInputId(activeInputId);
      } else if (config.inputDeviceId) {
        setSelectedInputId(config.inputDeviceId);
      } else if (inputs.length > 0) {
        setSelectedInputId(inputs[0].deviceId);
      }

      if (config.outputDeviceId) {
        setSelectedOutputId(config.outputDeviceId);
      } else if (outputs.length > 0) {
        setSelectedOutputId(outputs[0].deviceId);
      }

      const activeCamId = livekitService.getCameraDeviceId();
      if (activeCamId && cameras.some((c) => c.deviceId === activeCamId)) {
        setSelectedCameraId(activeCamId);
      } else if (cameras.length > 0) {
        setSelectedCameraId(cameras[0].deviceId);
      }
    } catch (err) {
      console.warn("Failed to enumerate audio and video devices:", err);
    }
  };

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    const unsubAudioInput = livekitService.onActiveAudioInputChange((id) => {
      setSelectedInputId(id);
      setConfig((prev) => ({ ...prev, inputDeviceId: id }));
    });
    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        refreshDevices,
      );
      unsubAudioInput();
    };
  }, []);

  // initialSubSection 自动平滑滚动定位
  useEffect(() => {
    if (initialSubSection === "video" && videoSectionRef.current) {
      setTimeout(() => {
        videoSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    }
  }, [initialSubSection]);

  // 视频测试流清理与控制
  const stopVideoTest = () => {
    if (testVideoStreamRef.current) {
      testVideoStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      testVideoStreamRef.current = null;
    }
    if (testVideoRef.current) {
      testVideoRef.current.srcObject = null;
    }
    setIsTestingVideo(false);
  };

  const startVideoTest = async (deviceIdToUse?: string) => {
    try {
      setVideoError(null);
      stopVideoTest();

      const devId = deviceIdToUse || selectedCameraId;
      const constraints: MediaStreamConstraints = {
        video:
          devId && devId !== "default" ? { deviceId: { exact: devId } } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testVideoStreamRef.current = stream;
      setIsTestingVideo(true);

      // 请求权限成功后再次刷新设备列表以获取硬件真实 label 名称
      refreshDevices();

      if (testVideoRef.current) {
        testVideoRef.current.srcObject = stream;
        testVideoRef.current
          .play()
          .catch((e) => console.warn("video play:", e));
      }
    } catch (err: any) {
      console.warn("Failed to start camera test:", err);
      setVideoError(err?.message || t("settings:audioVideo.cameraAccessError"));
      stopVideoTest();
    }
  };

  const handleCameraChange = async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    await livekitService.switchCameraDevice(deviceId);
    if (VOICE_ENGINE === "cloudflare_realtime") {
      await cloudflareRealtimeService.switchCameraDevice(deviceId);
    }
    if (isTestingVideo) {
      await startVideoTest(deviceId);
    }
  };

  // 组件卸载时释放视频硬件占用
  useEffect(() => {
    return () => {
      if (testVideoStreamRef.current) {
        testVideoStreamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        testVideoStreamRef.current = null;
      }
    };
  }, []);

  // 2. 监听麦克风音量以驱动电平测试条
  useEffect(() => {
    setConfig(audioEngine.config);

    const cleanupSpeaking = audioEngine.onSpeakingChange(
      (_isSpeaking, volume) => {
        setCurrentVolume(volume);
      },
    );

    // 若麦克风当前未被激活 (用户尚未加入语音频道)，临时激活麦克风测试管线以驱动电平显示
    const wasAlreadyRunning = audioEngine.isMicrophoneActive();
    if (!wasAlreadyRunning) {
      audioEngine.initMicrophone().catch((err) => {
        console.warn(
          "AudioSettingsTab: Failed to temporarily init microphone level test:",
          err,
        );
      });
    }

    return () => {
      cleanupSpeaking();
      // 离开音频设置且不在语音通话中时，安全释放临时麦克风流
      if (!isInCall) {
        audioEngine.stop();
      }
      // 停止测试音频
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current = null;
      }
    };
  }, [isInCall]);

  // 3. 全局录制 PTT 按键
  useEffect(() => {
    if (!isRecordingKeybind) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const chosenKey = e.code;
      const newCfg = { ...config, pushToTalkKey: chosenKey };
      setConfig(newCfg);
      audioEngine.updateConfig({ pushToTalkKey: chosenKey });
      setIsRecordingKeybind(false);
    };

    window.addEventListener("keydown", handleKeyDown, {
      once: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isRecordingKeybind, config]);

  // 设备切换处理
  const handleInputChange = async (deviceId: string) => {
    setSelectedInputId(deviceId);
    const newCfg = { ...config, inputDeviceId: deviceId };
    setConfig(newCfg);
    await livekitService.switchAudioInputDevice(deviceId).catch((err) => {
      console.warn("Failed to switch audio input device:", err);
    });
  };

  const handleOutputChange = async (deviceId: string) => {
    setSelectedOutputId(deviceId);
    const newCfg = { ...config, outputDeviceId: deviceId };
    setConfig(newCfg);
    audioEngine.updateConfig({ outputDeviceId: deviceId });
    await livekitService.switchAudioOutputDevice(deviceId).catch((err) => {
      console.warn("Failed to switch audio output device:", err);
    });

    if (testAudioRef.current && (testAudioRef.current as any).setSinkId) {
      try {
        await (testAudioRef.current as any).setSinkId(deviceId);
      } catch (err) {
        console.warn("Failed to set audio output device (sinkId):", err);
      }
    }
  };

  // 测试扬声器输出声音
  const handlePlayTestSound = () => {
    if (isPlayingTestSound) {
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current.currentTime = 0;
      }
      setIsPlayingTestSound(false);
      return;
    }

    try {
      // 创建音频测试信号（生成平滑的双音调合成声音）
      const audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 音
      osc.frequency.exponentialRampToValueAtTime(
        880,
        audioCtx.currentTime + 0.3,
      ); // 滑音至 A5

      const calculatedGain = (outputVolume / 100) * 0.2;
      gain.gain.setValueAtTime(calculatedGain, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      setIsPlayingTestSound(true);

      osc.stop(audioCtx.currentTime + 0.8);
      setTimeout(() => {
        setIsPlayingTestSound(false);
        audioCtx.close().catch(() => {});
      }, 850);
    } catch (err) {
      console.warn("Exception during test sound playback:", err);
      setIsPlayingTestSound(false);
    }
  };

  const handleNoiseModeChange = (mode: NoiseSuppressionMode) => {
    const newCfg = {
      ...config,
      noiseSuppressionMode: mode,
      noiseSuppression: mode !== "off",
    };
    setConfig(newCfg);
    audioEngine.setNoiseSuppressionMode(mode);
  };

  const handleInputModeChange = (mode: "VAD" | "PTT") => {
    const isPTT = mode === "PTT";
    const newCfg = { ...config, inputMode: mode, pushToTalk: isPTT };
    setConfig(newCfg);
    audioEngine.updateConfig({ inputMode: mode, pushToTalk: isPTT });
  };

  const handleSensitivityChange = (val: number) => {
    const newCfg = { ...config, vadSensitivity: val };
    setConfig(newCfg);
    audioEngine.updateConfig({ vadSensitivity: val });
  };

  const handleReleaseDelayChange = (delay: number) => {
    const newCfg = { ...config, pushToTalkReleaseDelay: delay };
    setConfig(newCfg);
    audioEngine.updateConfig({ pushToTalkReleaseDelay: delay });
  };

  const handleBitrateChange = (bitrate: number) => {
    const newCfg = { ...config, audioBitrate: bitrate };
    setConfig(newCfg);
    audioEngine.updateConfig({ audioBitrate: bitrate });
    livekitService.setAudioBitrate(bitrate);
  };

  const handleToggle = (key: keyof typeof config) => {
    const nextVal = !config[key];
    const newCfg = { ...config, [key]: nextVal };
    setConfig(newCfg);
    audioEngine.updateConfig({ [key]: nextVal });
  };

  const handleManualGainChange = (gain: number) => {
    const newCfg = { ...config, manualGain: gain };
    setConfig(newCfg);
    audioEngine.updateConfig({ manualGain: gain });
  };

  const handleAgcGainRangeChange = (range: number) => {
    const newCfg = { ...config, agcGainRange: range };
    setConfig(newCfg);
    audioEngine.updateConfig({ agcGainRange: range });
  };

  const runABComparisonTest = async () => {
    const controller = new AbortController();
    abAbortRef.current = controller;
    try {
      setIsABTesting(true);
      setABCountdown(5);
      setABResult(null);
      setABError(null);

      const result = await audioEngine.recordTripleABComparison(
        5,
        (sec) => {
          setABCountdown(sec);
        },
        controller.signal,
      );

      setABResult(result);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("A/B test failed:", err);
      setABError(err?.message || t("settings:audioVideo.abErrorMsg"));
    } finally {
      if (abAbortRef.current === controller) abAbortRef.current = null;
      setIsABTesting(false);
    }
  };

  return (
    <div className="space-y-8 select-none">
      {/* 顶部标题栏 */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Volume2 className="w-6 h-6 text-discord-brand" />
          <span>{t("settings:audioVideo.title")}</span>
        </h2>
        <p className="text-xs text-discord-textMuted mt-1">
          {t("settings:audioVideo.subtitle")}
        </p>
      </div>

      {/* 模块 1：设备选择与音量调节 (日常最核心使用) */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          {t("settings:audioVideo.deviceSettings")}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#2b2d31] p-5 rounded-2xl border border-white/5 shadow-sm">
          {/* 麦克风输入设置 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-discord-brand" />
                <span>{t("settings:audioVideo.inputDeviceLabel")}</span>
              </label>
              <button
                type="button"
                onClick={refreshDevices}
                className="text-[11px] text-discord-brand hover:underline"
              >
                {t("settings:audioVideo.refreshList")}
              </button>
            </div>

            <select
              value={selectedInputId}
              onChange={(e) => handleInputChange(e.target.value)}
              className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-discord-brand transition cursor-pointer"
            >
              {inputDevices.length === 0 && (
                <option value="default">
                  {t("settings:audioVideo.defaultInputDevice")}
                </option>
              )}
              {inputDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label ||
                    t("settings:audioVideo.inputDeviceIndex", {
                      index: index + 1,
                    })}
                </option>
              ))}
            </select>

            {/* 输入音量/增益 */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{t("settings:audioVideo.inputVolume")}</span>
                <span className="font-mono text-white">
                  {config.manualGain ?? 100}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="200"
                value={config.manualGain ?? 100}
                onChange={(e) => handleManualGainChange(Number(e.target.value))}
                className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
              />
            </div>
          </div>

          {/* 扬声器输出设置 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <Headphones className="w-4 h-4 text-discord-brand" />
                <span>{t("settings:audioVideo.outputDeviceLabel")}</span>
              </label>
              <button
                type="button"
                onClick={handlePlayTestSound}
                className={`text-[11px] px-2 py-0.5 rounded transition flex items-center gap-1 font-semibold ${
                  isPlayingTestSound
                    ? "bg-discord-green text-black animate-pulse"
                    : "bg-discord-brand/20 text-discord-brand hover:bg-discord-brand/30"
                }`}
              >
                {isPlayingTestSound ? (
                  <>
                    <Square className="w-3 h-3" />
                    <span>{t("settings:audioVideo.ringing")}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>{t("settings:audioVideo.testSound")}</span>
                  </>
                )}
              </button>
            </div>

            <select
              value={selectedOutputId}
              onChange={(e) => handleOutputChange(e.target.value)}
              className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-discord-brand transition cursor-pointer"
            >
              {outputDevices.length === 0 && (
                <option value="default">
                  {t("settings:audioVideo.defaultOutputDevice")}
                </option>
              )}
              {outputDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label ||
                    t("settings:audioVideo.outputDeviceIndex", {
                      index: index + 1,
                    })}
                </option>
              ))}
            </select>

            {/* 输出音量 */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{t("settings:audioVideo.outputVolume")}</span>
                <span className="font-mono text-white">{outputVolume}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="200"
                value={outputVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setOutputVolume(val);
                  livekitService.setMasterVolume(val);
                  cloudflareRealtimeService.setMasterVolume(val);
                }}
                className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 模块 2：输入模式与麦克风测试 */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          {t("settings:audioVideo.inputModeTitle")}
        </h3>

        {/* 模式双选卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleInputModeChange("VAD")}
            className={`p-4 rounded-xl border flex items-start gap-3 text-left transition ${
              config.inputMode === "VAD" && !config.pushToTalk
                ? "border-discord-brand bg-discord-brand/10 text-white ring-1 ring-discord-brand/40 shadow-sm"
                : "border-white/5 bg-[#2b2d31] text-gray-300 hover:bg-[#35373c]"
            }`}
          >
            <div className="p-2 rounded-lg bg-[#1e1f22] text-discord-brand mt-0.5">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-white mb-0.5">
                {t("settings:audioVideo.vadTitle")}
              </div>
              <p className="text-xs text-discord-textMuted leading-relaxed">
                {t("settings:audioVideo.vadDesc")}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleInputModeChange("PTT")}
            className={`p-4 rounded-xl border flex items-start gap-3 text-left transition ${
              config.inputMode === "PTT" || config.pushToTalk
                ? "border-discord-brand bg-discord-brand/10 text-white ring-1 ring-discord-brand/40 shadow-sm"
                : "border-white/5 bg-[#2b2d31] text-gray-300 hover:bg-[#35373c]"
            }`}
          >
            <div className="p-2 rounded-lg bg-[#1e1f22] text-discord-brand mt-0.5">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-white mb-0.5">
                {t("settings:audioVideo.pttTitle")}
              </div>
              <p className="text-xs text-discord-textMuted leading-relaxed">
                {t("settings:audioVideo.pttDesc")}
              </p>
            </div>
          </button>
        </div>

        {/* 模式专属调校面板 */}
        {config.inputMode === "VAD" && !config.pushToTalk ? (
          /* 语音感应调校面板 */
          <div className="bg-[#2b2d31] p-5 rounded-2xl border border-white/5 space-y-3.5 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white">
                  {t("settings:audioVideo.vadSensitivity")}
                </span>
                <p className="text-[11px] text-discord-textMuted mt-0.5">
                  {t("settings:audioVideo.vadSensitivityDesc")}
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-discord-green bg-discord-green/10 px-2 py-0.5 rounded">
                {t("settings:audioVideo.vadThreshold")}: {config.vadSensitivity}
                %
              </span>
            </div>

            {/* 音量跳动条与门限对比 */}
            <div className="h-3.5 w-full bg-[#1e1f22] rounded-full overflow-hidden relative shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-75 rounded-full"
                style={{ width: `${currentVolume}%` }}
              />
              {/* 灵敏度门限红线 */}
              <div
                className="absolute top-0 bottom-0 w-1 bg-rose-500 z-10 shadow"
                style={{ left: `${config.vadSensitivity}%` }}
                title={t("settings:audioVideo.vadThresholdTooltip", {
                  value: config.vadSensitivity,
                })}
              />
            </div>

            {/* 滑块 */}
            <div className="space-y-1">
              <input
                type="range"
                min="0"
                max="100"
                value={config.vadSensitivity}
                onChange={(e) =>
                  handleSensitivityChange(Number(e.target.value))
                }
                className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
              />
              <div className="flex justify-between text-[10px] text-discord-textMuted">
                <span>{t("settings:audioVideo.vadSensitivityExtreme")}</span>
                <span>{t("settings:audioVideo.vadSensitivityMedium")}</span>
                <span>{t("settings:audioVideo.vadSensitivityLoud")}</span>
              </div>
            </div>
          </div>
        ) : (
          /* 按键说话专属调校面板 */
          <div className="bg-[#2b2d31] p-5 rounded-2xl border border-white/5 space-y-4 animate-fadeIn">
            <div>
              <label className="text-xs font-bold text-gray-300 mb-2 block">
                {t("settings:audioVideo.pttKeybindTitle")}
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsRecordingKeybind(true)}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold transition border shadow-sm ${
                    isRecordingKeybind
                      ? "bg-rose-500 text-white border-rose-500 animate-pulse"
                      : "bg-[#1e1f22] text-white border-[#3f4147] hover:border-discord-brand"
                  }`}
                >
                  {isRecordingKeybind
                    ? t("settings:audioVideo.pttRecording")
                    : t("settings:audioVideo.pttKeybindCurrent", {
                        key: config.pushToTalkKey || "Space",
                      })}
                </button>
                <span className="text-xs text-discord-textMuted">
                  {t("settings:audioVideo.pttKeybindTip")}
                </span>
              </div>
            </div>

            {/* 释放缓冲延迟 */}
            <div className="space-y-1.5 pt-2 border-t border-white/5">
              <div className="flex justify-between items-center text-xs text-gray-400">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{t("settings:audioVideo.pttReleaseDelayLabel")}</span>
                </span>
                <span className="text-white font-mono font-bold">
                  {config.pushToTalkReleaseDelay || 200} ms
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1000"
                step="50"
                value={config.pushToTalkReleaseDelay || 200}
                onChange={(e) =>
                  handleReleaseDelayChange(Number(e.target.value))
                }
                className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
              />
              <p className="text-[11px] text-discord-textMuted">
                {t("settings:audioVideo.pttReleaseDelayDesc")}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 模块 3：智能神经网络降噪 (通俗易懂卡片化) */}
      <section className="space-y-4">
        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            {t("settings:audioVideo.noiseSuppressionTitle")}
          </h3>
          <p className="text-xs text-discord-textMuted mt-1">
            {t("settings:audioVideo.noiseSuppressionSubtitle")}
          </p>
        </div>

        {/* 4 档卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 卡片 1: RNNoise 标准降噪 (推荐) */}
          <button
            type="button"
            onClick={() => handleNoiseModeChange("rnnoise")}
            className={`p-4 rounded-xl border flex flex-col justify-between text-left transition relative ${
              config.noiseSuppressionMode === "rnnoise" &&
              config.noiseSuppression
                ? "border-discord-brand bg-discord-brand/10 text-white ring-1 ring-discord-brand/40 shadow-sm"
                : "border-white/5 bg-[#2b2d31] text-gray-300 hover:bg-[#35373c]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-discord-brand" />
                  <span>{t("settings:audioVideo.rnnoiseTitle")}</span>
                </span>
                <span className="text-[9px] bg-discord-brand/20 text-discord-brand px-1.5 py-0.5 rounded font-bold">
                  {t("settings:audioVideo.badgeRecommended")}
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                {t("settings:audioVideo.rnnoiseDescDetailed")}
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              {t("settings:audioVideo.rnnoiseSuitable")}
            </div>
          </button>

          {/* 卡片 2: DTLN 消除机械键盘 (深度净化) */}
          <button
            type="button"
            onClick={() => handleNoiseModeChange("dtln")}
            className={`p-4 rounded-xl border flex flex-col justify-between text-left transition relative ${
              config.noiseSuppressionMode === "dtln" && config.noiseSuppression
                ? "border-discord-green bg-discord-green/10 text-white ring-1 ring-discord-green/40 shadow-sm"
                : "border-white/5 bg-[#2b2d31] text-gray-300 hover:bg-[#35373c]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-discord-green" />
                  <span>{t("settings:audioVideo.dtlnTitle")}</span>
                </span>
                <span className="text-[9px] bg-discord-green/20 text-discord-green px-1.5 py-0.5 rounded font-bold">
                  {t("settings:audioVideo.badgeKeyboard")}
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                {t("settings:audioVideo.dtlnDescDetailed")}
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              {t("settings:audioVideo.dtlnSuitable")}
            </div>
          </button>

          {/* 卡片 3: DFNv3 旗舰声学全频高保真 */}
          <button
            type="button"
            onClick={() => handleNoiseModeChange("dfn3")}
            className={`p-4 rounded-xl border flex flex-col justify-between text-left transition relative ${
              config.noiseSuppressionMode === "dfn3" && config.noiseSuppression
                ? "border-purple-500 bg-purple-500/10 text-white ring-1 ring-purple-500/40 shadow-sm"
                : "border-white/5 bg-[#2b2d31] text-gray-300 hover:bg-[#35373c]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Radio className="w-4 h-4 text-purple-400" />
                  <span>{t("settings:audioVideo.dfn3Title")}</span>
                </span>
                <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold">
                  {t("settings:audioVideo.badgeFullBand")}
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                {t("settings:audioVideo.dfn3DescDetailed")}
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              {t("settings:audioVideo.dfn3Suitable")}
            </div>
          </button>

          {/* 卡片 4: 关闭降噪 */}
          <button
            type="button"
            onClick={() => handleNoiseModeChange("off")}
            className={`p-4 rounded-xl border flex flex-col justify-between text-left transition relative ${
              config.noiseSuppressionMode === "off" || !config.noiseSuppression
                ? "border-rose-500 bg-rose-500/10 text-white ring-1 ring-rose-500/40 shadow-sm"
                : "border-white/5 bg-[#2b2d31] text-gray-300 hover:bg-[#35373c]"
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <VolumeX className="w-4 h-4 text-rose-400" />
                  <span>{t("settings:audioVideo.noiseOffTitle")}</span>
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                {t("settings:audioVideo.noiseOffDesc")}
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              {t("settings:audioVideo.noiseOffSuitable")}
            </div>
          </button>
        </div>
      </section>

      {/* 模块：视频设置 (摄像头选择与测试预览) */}
      <section ref={videoSectionRef} className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Video className="w-4 h-4 text-discord-brand" />
              <span>{t("settings:audioVideo.videoSectionTitle")}</span>
            </h3>
            <p className="text-xs text-discord-textMuted mt-1">
              {t("settings:audioVideo.videoSectionDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={refreshDevices}
            className="text-[11px] text-discord-brand hover:underline flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t("settings:audioVideo.refreshDevices")}</span>
          </button>
        </div>

        <div className="bg-[#2b2d31] p-5 rounded-2xl border border-white/5 shadow-sm space-y-5">
          {/* 摄像头设备下拉选择 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-discord-brand" />
              <span>{t("settings:audioVideo.cameraDeviceLabel")}</span>
            </label>
            <select
              data-testid="camera-device-select"
              value={selectedCameraId}
              onChange={(e) => handleCameraChange(e.target.value)}
              className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-discord-brand transition cursor-pointer"
            >
              {cameraDevices.length === 0 && (
                <option value="default">
                  {t("settings:audioVideo.defaultCameraDevice")}
                </option>
              )}
              {cameraDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label ||
                    t("settings:audioVideo.cameraDeviceIndex", {
                      index: index + 1,
                    })}
                </option>
              ))}
            </select>
          </div>

          {/* 视频预览视口与测试控制 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">
                {t("settings:audioVideo.videoPreviewTitle")}
              </span>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-white transition">
                <input
                  type="checkbox"
                  data-testid="camera-mirror-checkbox"
                  checked={mirrorPreview}
                  onChange={(e) => setMirrorPreview(e.target.checked)}
                  className="rounded border-[#3f4147] text-discord-brand focus:ring-0 bg-[#1e1f22]"
                />
                <span>{t("settings:audioVideo.mirrorPreview")}</span>
              </label>
            </div>

            {/* 16:9 黑底视频窗口 */}
            <div className="relative w-full max-w-xl aspect-video bg-[#1e1f22] rounded-xl overflow-hidden border border-[#3f4147] flex items-center justify-center shadow-inner">
              <video
                ref={testVideoRef}
                autoPlay
                playsInline
                muted
                data-testid="camera-test-video"
                className={`w-full h-full object-cover transition-transform duration-200 ${
                  mirrorPreview ? "-scale-x-100" : ""
                } ${isTestingVideo ? "block" : "hidden"}`}
              />

              {!isTestingVideo && (
                <div className="text-center p-6 space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-full bg-white/5 flex items-center justify-center text-gray-400">
                    <Camera className="w-6 h-6" />
                  </div>
                  <p className="text-xs text-gray-400">
                    {t("settings:audioVideo.videoPreviewPrompt")}
                  </p>
                </div>
              )}

              {videoError && (
                <div className="absolute inset-x-4 bottom-4 p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
                  <span>{videoError}</span>
                  <button
                    type="button"
                    onClick={() => setVideoError(null)}
                    className="text-white hover:text-rose-200 ml-2"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* 测试按钮 */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-discord-textMuted">
                {t("settings:audioVideo.videoPreviewNotice")}
              </span>
              {isTestingVideo ? (
                <button
                  type="button"
                  data-testid="stop-video-test-btn"
                  onClick={stopVideoTest}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{t("settings:audioVideo.stopVideoTest")}</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="start-video-test-btn"
                  onClick={() => startVideoTest()}
                  className="px-4 py-2 rounded-lg bg-discord-brand hover:bg-discord-brand-hover text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{t("settings:audioVideo.startVideoTest")}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 模块 3.2: 视频编码器与硬件加速配置 */}
        <div className="bg-[#2b2d31] p-5 rounded-2xl border border-white/5 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <Film className="w-4 h-4 text-discord-brand" />
                <span>{t("settings:audioVideo.videoCodecsTitle")}</span>
              </label>
              <p className="text-[11px] text-discord-textMuted">
                {t("settings:audioVideo.videoCodecsDesc")}
              </p>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
              Auto-Adaptive
            </span>
          </div>

          {/* 编码器选项网格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {supportedCodecs.map((item) => {
              const isSelected = preferredCodec === item.codec;
              const isAvailable = item.supported;
              const codecDesc = t(
                `settings:audioVideo.codec_${item.codec}_desc` as any,
                { defaultValue: item.description },
              );
              const codecReason = item.reason
                ? t(`settings:audioVideo.codec_${item.codec}_reason` as any, {
                    defaultValue: item.reason,
                  })
                : undefined;

              return (
                <button
                  key={item.codec}
                  type="button"
                  data-testid={`codec-option-${item.codec}`}
                  disabled={!isAvailable}
                  onClick={() => handleCodecSelect(item.codec)}
                  className={`p-3 rounded-xl border text-left transition relative flex flex-col justify-between ${
                    isSelected
                      ? "bg-discord-brand/10 border-discord-brand text-white shadow-sm"
                      : isAvailable
                        ? "bg-[#1e1f22] border-[#3f4147] text-gray-300 hover:border-gray-500 hover:bg-[#232428] cursor-pointer"
                        : "bg-[#1e1f22]/50 border-white/5 text-gray-500 cursor-not-allowed opacity-60"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        {item.label}
                        {isSelected && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-discord-brand" />
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        {item.isHardwareAccelerated && isAvailable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" />
                            {t("settings:audioVideo.badgeHwAccelerated")}
                          </span>
                        )}
                        {!isAvailable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-medium">
                            {t("settings:audioVideo.badgeUnsupported")}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-discord-textMuted">
                      {codecDesc}
                    </p>
                  </div>
                  {codecReason && !isAvailable && (
                    <div className="mt-2 text-[10px] text-amber-400/90 flex items-center gap-1 bg-amber-400/10 px-2 py-1 rounded">
                      <Info className="w-3 h-3 flex-shrink-0" />
                      <span>{codecReason}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* 双编码兜底策略 (Backup Codec) 开关 */}
          <div className="pt-2 border-t border-white/5 flex items-center justify-between">
            <div className="space-y-0.5 max-w-lg">
              <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>{t("settings:audioVideo.dualCodecTitle")}</span>
              </label>
              <p className="text-[11px] text-discord-textMuted">
                {t("settings:audioVideo.dualCodecDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                data-testid="enable-backup-codec-checkbox"
                checked={enableBackupCodec}
                onChange={(e) => handleBackupCodecToggle(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#3f4147] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-discord-brand"></div>
            </label>
          </div>

          {/* 专业自定义推流码率控制 (Target Bitrate) */}
          <div className="pt-2 border-t border-white/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                  <Gauge className="w-4 h-4 text-discord-brand" />
                  <span>{t("settings:audioVideo.customBitrateTitle")}</span>
                </label>
                <p className="text-[11px] text-discord-textMuted">
                  {t("settings:audioVideo.customBitrateDesc")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  data-testid="current-custom-bitrate-label"
                  className="text-xs font-mono font-bold text-discord-brand bg-discord-brand/10 px-2 py-0.5 rounded border border-discord-brand/20"
                >
                  {customBitrate
                    ? `${Math.round(customBitrate / 1000)} kbps`
                    : t("settings:audioVideo.bitrateAdaptive")}
                </span>
                {customBitrate && (
                  <button
                    type="button"
                    data-testid="reset-custom-bitrate-btn"
                    onClick={handleResetVideoBitrate}
                    className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded hover:bg-white/10 transition"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t("settings:audioVideo.reset")}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] text-gray-400 font-mono">500k</span>
              <input
                type="range"
                data-testid="custom-bitrate-slider"
                min={MIN_CUSTOM_BITRATE}
                max={MAX_CUSTOM_BITRATE}
                step={250_000}
                value={customBitrate || 3_000_000}
                onChange={(e) =>
                  handleVideoBitrateChange(Number(e.target.value))
                }
                className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
              />
              <span className="text-[10px] text-gray-400 font-mono">8000k</span>
            </div>
          </div>
        </div>
      </section>

      {/* 模块 4：高级音频与声学实验室 (折叠收纳，专业用户展开) */}
      <section className="border border-white/5 rounded-2xl bg-[#2b2d31] overflow-hidden transition-all shadow-sm">
        <button
          type="button"
          onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/5 transition"
        >
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-discord-brand" />
            <div>
              <span className="text-xs font-bold text-white">
                {t("settings:audioVideo.advancedAudioLabTitle")}
              </span>
              <p className="text-[11px] text-discord-textMuted">
                {t("settings:audioVideo.advancedAudioLabDesc")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>
              {isAdvancedOpen
                ? t("settings:audioVideo.collapse")
                : t("settings:audioVideo.expandAdvanced")}
            </span>
            {isAdvancedOpen ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </button>

        {isAdvancedOpen && (
          <div className="p-5 pt-2 border-t border-white/5 space-y-6 animate-fadeIn">
            {/* 4.1 传输码率 */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-discord-brand" />
                  <span>{t("settings:audioVideo.opusBitrateTitle")}</span>
                </span>
                <span className="text-xs font-mono text-discord-brand font-bold">
                  {config.audioBitrate / 1000} kbps
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: "16k", value: 16000, descKey: "bitrateLow" },
                  { label: "32k", value: 32000, descKey: "bitrateSmooth" },
                  { label: "64k", value: 64000, descKey: "bitrateRecommended" },
                  { label: "96k", value: 96000, descKey: "bitrateHd" },
                  { label: "128k", value: 128000, descKey: "bitrateLossless" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleBitrateChange(item.value)}
                    className={`py-2 px-1 rounded-lg border text-center transition ${
                      config.audioBitrate === item.value
                        ? "border-discord-brand bg-discord-brand/20 text-white font-bold"
                        : "border-[#383a40] bg-[#1e1f22] text-gray-400 hover:bg-[#35373c] hover:text-white"
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.label}</div>
                    <div className="text-[10px] text-gray-400 scale-90">
                      {t(`settings:audioVideo.${item.descKey}` as any)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 4.2 基础声学算法开关 */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              {/* 48kHz 立体声模式 */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-discord-brand" />
                    <span>{t("settings:audioVideo.hiFiMusicTitle")}</span>
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    {t("settings:audioVideo.hiFiMusicDesc")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle("highFidelityMusic")}
                  className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 shrink-0 ${
                    config.highFidelityMusic
                      ? "bg-discord-brand"
                      : "bg-[#1e1f22]"
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow transform transition duration-200 ${
                      config.highFidelityMusic
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 回声消除 AEC */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="text-xs font-semibold text-white">
                    {t("settings:audioVideo.echoCancellationTitle")}
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    {t("settings:audioVideo.echoCancellationDetail")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle("echoCancellation")}
                  className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 shrink-0 ${
                    config.echoCancellation
                      ? "bg-discord-brand"
                      : "bg-[#1e1f22]"
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow transform transition duration-200 ${
                      config.echoCancellation
                        ? "translate-x-5"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 自动增益 AGC */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="text-xs font-semibold text-white">
                    {t("settings:audioVideo.agcTitle")}
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    {t("settings:audioVideo.agcDetail")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle("autoGainControl")}
                  className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 shrink-0 ${
                    config.autoGainControl ? "bg-discord-brand" : "bg-[#1e1f22]"
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow transform transition duration-200 ${
                      config.autoGainControl ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* 开启 AGC 时展示增益上限调节 */}
              {config.autoGainControl && (
                <div className="bg-[#1e1f22] p-3 rounded-xl border border-white/5 space-y-2 mt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-300 font-semibold">
                      {t("settings:audioVideo.agcGainRangeTitle")}
                    </span>
                    <span className="font-mono text-discord-brand font-bold">
                      {config.agcGainRange ?? 18} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="6"
                    max="30"
                    step="1"
                    value={config.agcGainRange ?? 18}
                    onChange={(e) =>
                      handleAgcGainRangeChange(Number(e.target.value))
                    }
                    className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                  />
                  <div className="flex justify-between text-[10px] text-discord-textMuted">
                    <span>{t("settings:audioVideo.agcGainConservative")}</span>
                    <span>{t("settings:audioVideo.agcGainBalanced")}</span>
                    <span>{t("settings:audioVideo.agcGainAggressive")}</span>
                  </div>
                </div>
              )}
            </div>

            <p
              className="text-[11px] text-discord-textMuted"
              data-testid="noise-engine-status"
            >
              实际降噪：{noiseStatus.effectiveMode} · {noiseStatus.backend} ·{" "}
              {noiseStatus.phase}
              {noiseStatus.reason ? `（${noiseStatus.reason}）` : ""}
              {noiseStatus.processingP95Ms !== undefined
                ? ` · 推理 P95 ${noiseStatus.processingP95Ms.toFixed(1)} ms · 队列 ${noiseStatus.queueMs?.toFixed(1) ?? "-"} ms`
                : ""}
              {noiseStatus.capture?.warnings.length
                ? ` · 采集提示：${noiseStatus.capture.warnings.join("、")}`
                : ""}
            </p>
            {/* 4.3 同一段录音的四轨试听 */}
            <div className="bg-[#1e1f22] p-4 rounded-xl border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-discord-brand" />
                  <span className="text-xs font-bold text-white">
                    {t("settings:audioVideo.abLabTitle")}
                  </span>
                </div>
                {abResult && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-discord-brand/20 text-discord-brand px-2 py-0.5 rounded-full font-bold">
                      RNNoise {abResult.rnnoiseUrl ? "可试听" : "不可用"}
                    </span>
                    <span className="text-[10px] bg-discord-green/20 text-discord-green px-2 py-0.5 rounded-full font-bold">
                      DTLN {abResult.dtlnUrl ? "可试听" : "不可用"}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-discord-textMuted">
                {t("settings:audioVideo.abLabDesc")}
              </p>

              {abError && (
                <div className="bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs p-2.5 rounded-lg flex items-center justify-between">
                  <span>{abError}</span>
                  <button
                    type="button"
                    onClick={() => setABError(null)}
                    className="p-0.5 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {!isABTesting && !abResult && (
                <button
                  type="button"
                  onClick={runABComparisonTest}
                  className="w-full py-2.5 rounded-lg bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold transition flex items-center justify-center gap-2 shadow"
                >
                  <Mic className="w-4 h-4" />
                  <span>{t("settings:audioVideo.abStartBtn")}</span>
                </button>
              )}

              {isABTesting && (
                <div className="bg-[#2b2d31] p-4 rounded-lg flex flex-col items-center justify-center border border-discord-brand/40">
                  <div className="w-8 h-8 rounded-full border-2 border-discord-brand/20 border-t-discord-brand animate-spin mb-2" />
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>{t("settings:audioVideo.abRecordingPrompt")}</span>
                    <span className="text-discord-green">({abCountdown}s)</span>
                  </div>
                  <div className="w-40 h-1 bg-[#1e1f22] rounded-full overflow-hidden mt-2.5">
                    <div
                      className="h-full bg-discord-brand transition-all duration-1000"
                      style={{ width: `${((5 - abCountdown) / 5) * 100}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => abAbortRef.current?.abort()}
                    className="mt-2 text-[11px] text-gray-400 hover:text-white"
                  >
                    取消试听
                  </button>
                </div>
              )}

              {abResult && (
                <div className="space-y-3 animate-fadeIn">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {/* 原始音轨 */}
                    <div className="bg-[#2b2d31] p-2.5 rounded-lg border border-white/5">
                      <div className="text-[11px] font-bold text-gray-400 mb-1 flex items-center justify-between">
                        <span>{t("settings:audioVideo.abRawTrack")}</span>
                        <span className="text-[10px] text-rose-400">
                          {t("settings:audioVideo.abContainsNoise")}
                        </span>
                      </div>
                      <audio
                        src={abResult.rawUrl}
                        controls
                        className="w-full h-7 outline-none"
                      />
                    </div>

                    {/* RNNoise */}
                    <div className="bg-[#2b2d31] p-2.5 rounded-lg border border-discord-brand/40">
                      <div className="text-[11px] font-bold text-discord-brand mb-1 flex items-center justify-between">
                        <span>{t("settings:audioVideo.abRnnoiseTrack")}</span>
                        <span className="text-[10px] bg-discord-brand/20 px-1 rounded">
                          {abResult.rnnoiseUrl ? "可试听" : "不可用"}
                        </span>
                      </div>
                      <audio
                        src={abResult.rnnoiseUrl ?? undefined}
                        controls
                        className="w-full h-7 outline-none"
                      />
                      {abResult.rnnoiseError && (
                        <p className="text-[10px] text-red-300 break-words">
                          {abResult.rnnoiseError}
                        </p>
                      )}
                    </div>

                    {/* DTLN */}
                    <div className="bg-[#2b2d31] p-2.5 rounded-lg border border-discord-green/40">
                      <div className="text-[11px] font-bold text-discord-green mb-1 flex items-center justify-between">
                        <span>{t("settings:audioVideo.abDtlnTrack")}</span>
                        <span className="text-[10px] bg-discord-green/20 px-1 rounded">
                          {abResult.dtlnUrl ? "可试听" : "不可用"}
                        </span>
                      </div>
                      <audio
                        src={abResult.dtlnUrl ?? undefined}
                        controls
                        className="w-full h-7 outline-none"
                      />
                      {abResult.dtlnError && (
                        <p className="text-[10px] text-red-300 break-words">
                          {abResult.dtlnError}
                        </p>
                      )}
                    </div>

                    {/* DFNv3 */}
                    <div className="bg-[#2b2d31] p-2.5 rounded-lg border border-purple-500/40">
                      <div className="text-[11px] font-bold text-purple-400 mb-1 flex items-center justify-between">
                        <span>{t("settings:audioVideo.abDfn3Track")}</span>
                        <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1 rounded">
                          {abResult.dfn3Url ? "可试听" : "不可用"}
                        </span>
                      </div>
                      <audio
                        src={abResult.dfn3Url ?? undefined}
                        controls
                        className="w-full h-7 outline-none"
                      />
                      {abResult.dfn3Error && (
                        <p className="text-[10px] text-red-300 break-words">
                          {abResult.dfn3Error}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={runABComparisonTest}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-white rounded bg-[#2b2d31] hover:bg-[#35373c] transition flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{t("settings:audioVideo.abReRecordBtn")}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
