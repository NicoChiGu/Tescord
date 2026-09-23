import React, { useState, useEffect, useRef } from "react";
import { audioEngine, TripleABTestResult } from "../../services/audioEngine.js";
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
    livekitService.getMasterVolume(),
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
  const [abResult, setABResult] = useState<TripleABTestResult | null>(null);
  const [abError, setABError] = useState<string | null>(null);

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
      console.warn("枚举音频与视频硬件设备失败:", err);
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
      console.warn("启动摄像头测试失败:", err);
      setVideoError(err?.message || "无法访问摄像头，请检查系统权限或设备占用");
      stopVideoTest();
    }
  };

  const handleCameraChange = async (deviceId: string) => {
    setSelectedCameraId(deviceId);
    await livekitService.switchCameraDevice(deviceId);
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
        console.warn("AudioSettingsTab: 临时激活麦克风电平测试失败:", err);
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
      console.warn("切换输入设备失败:", err);
    });
  };

  const handleOutputChange = async (deviceId: string) => {
    setSelectedOutputId(deviceId);
    const newCfg = { ...config, outputDeviceId: deviceId };
    setConfig(newCfg);
    audioEngine.updateConfig({ outputDeviceId: deviceId });
    await livekitService.switchAudioOutputDevice(deviceId).catch((err) => {
      console.warn("切换输出设备失败:", err);
    });

    if (testAudioRef.current && (testAudioRef.current as any).setSinkId) {
      try {
        await (testAudioRef.current as any).setSinkId(deviceId);
      } catch (err) {
        console.warn("设置音频输出设备失败:", err);
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
      console.warn("播放测试声音异常:", err);
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
    try {
      setIsABTesting(true);
      setABCountdown(5);
      setABResult(null);
      setABError(null);

      const result = await audioEngine.recordTripleABComparison(5, (sec) => {
        setABCountdown(sec);
      });

      setABResult(result);
    } catch (err: any) {
      console.error("A/B test failed:", err);
      setABError(err?.message || "录音对比测试失败，请检查麦克风权限与设备");
    } finally {
      setIsABTesting(false);
    }
  };

  return (
    <div className="space-y-8 select-none">
      {/* 顶部标题栏 */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Volume2 className="w-6 h-6 text-discord-brand" />
          <span>语音与视频设置 (RNNoise 智能降噪控制中心)</span>
        </h2>
        <p className="text-xs text-discord-textMuted mt-1">
          配置您的输入/输出音频硬件设备、麦克风灵敏度、智能神经网络降噪以及摄像头画面。
        </p>
      </div>

      {/* 模块 1：设备选择与音量调节 (日常最核心使用) */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          设备设置
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#2b2d31] p-5 rounded-2xl border border-white/5 shadow-sm">
          {/* 麦克风输入设置 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-discord-brand" />
                <span>输入设备 (麦克风)</span>
              </label>
              <button
                type="button"
                onClick={refreshDevices}
                className="text-[11px] text-discord-brand hover:underline"
              >
                刷新列表
              </button>
            </div>

            <select
              value={selectedInputId}
              onChange={(e) => handleInputChange(e.target.value)}
              className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-discord-brand transition cursor-pointer"
            >
              {inputDevices.length === 0 && (
                <option value="default">默认系统麦克风</option>
              )}
              {inputDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label || `麦克风设备 ${index + 1}`}
                </option>
              ))}
            </select>

            {/* 输入音量/增益 */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>输入音量</span>
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
                <span>输出设备 (耳机/扬声器)</span>
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
                    <span>响铃中...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>试听声音</span>
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
                <option value="default">默认系统扬声器</option>
              )}
              {outputDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label || `音频输出设备 ${index + 1}`}
                </option>
              ))}
            </select>

            {/* 输出音量 */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>输出音量</span>
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
          输入模式与麦克风测试
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
                语音感应 (VAD)
              </div>
              <p className="text-xs text-discord-textMuted leading-relaxed">
                无需按键，当检测到您说话时自动开麦；低于设定门限时自动静音断流。
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
                按键说话 (PTT)
              </div>
              <p className="text-xs text-discord-textMuted leading-relaxed">
                按住快捷键说话，松开即闭麦。适合嘈杂游戏场景或公共网络环境。
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
                  麦克风灵敏度电平检测
                </span>
                <p className="text-[11px] text-discord-textMuted mt-0.5">
                  对着麦克风正常说话，绿色电平超过门限线时系统将开麦发言。
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-discord-green bg-discord-green/10 px-2 py-0.5 rounded">
                门限: {config.vadSensitivity}%
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
                title={`门限设定值: ${config.vadSensitivity}%`}
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
                <span>0% (极度灵敏)</span>
                <span>50% (适中)</span>
                <span>100% (仅大声说话)</span>
              </div>
            </div>
          </div>
        ) : (
          /* 按键说话专属调校面板 */
          <div className="bg-[#2b2d31] p-5 rounded-2xl border border-white/5 space-y-4 animate-fadeIn">
            <div>
              <label className="text-xs font-bold text-gray-300 mb-2 block">
                设置开麦快捷键
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
                    ? "请在键盘上按下目标按键..."
                    : `快捷键：[ ${config.pushToTalkKey || "Space"} ]`}
                </button>
                <span className="text-xs text-discord-textMuted">
                  点击左侧按钮后，直接轻敲键盘上的任意按键即可完成绑定（支持空格、Ctrl、Caps等）。
                </span>
              </div>
            </div>

            {/* 释放缓冲延迟 */}
            <div className="space-y-1.5 pt-2 border-t border-white/5">
              <div className="flex justify-between items-center text-xs text-gray-400">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>按键释放缓冲延迟</span>
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
                松开按键后麦克风继续保持开启的微秒数，有效防止讲完一句话结尾被生硬掐断。
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 模块 3：智能神经网络降噪 (通俗易懂卡片化) */}
      <section className="space-y-4">
        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
            AI 智能降噪 (RNNoise 神经网络深度降噪)
          </h3>
          <p className="text-xs text-discord-textMuted mt-1">
            采用前沿神经网络模型在您本地声卡流水线中直接消除噪音，不上传任何音频，100%
            离线保护隐私。
          </p>
        </div>

        {/* 3 档卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                  <span>RNNoise 标准轻量</span>
                </span>
                <span className="text-[9px] bg-discord-brand/20 text-discord-brand px-1.5 py-0.5 rounded font-bold">
                  推荐
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                RNNoise WASM 480分帧神经网络。极低 CPU
                消耗，强力消除空调、电风扇、电脑主机风噪等恒定环境杂音。
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              适合绝大部分日常开黑与会议
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
                  <span>DTLN 深度净化</span>
                </span>
                <span className="text-[9px] bg-discord-green/20 text-discord-green px-1.5 py-0.5 rounded font-bold">
                  消键盘音
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                DTLN 双流 LSTM
                深度网络。专门识别并削减机械键盘青轴打字声、敲桌子及不规则突发杂音。
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              适合重度打字员与激战玩家
            </div>
          </button>

          {/* 卡片 3: 关闭降噪 */}
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
                  <span>直通原声 (未降噪)</span>
                </span>
              </div>
              <p className="text-[11px] text-discord-textMuted leading-relaxed">
                直通模式
                (未降噪)，不执行任何软件算法降噪，麦克风声音原汁原味直通传输。
              </p>
            </div>
            <div className="mt-3 text-[10px] text-gray-400 font-medium">
              适合自带专业硬件降噪的独立外置声卡
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
              <span>视频设置 (Video Settings)</span>
            </h3>
            <p className="text-xs text-discord-textMuted mt-1">
              选择并在本地测试您的视频采集设备，确保视频通话时视角与光线处于最佳状态。
            </p>
          </div>
          <button
            type="button"
            onClick={refreshDevices}
            className="text-[11px] text-discord-brand hover:underline flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>刷新设备</span>
          </button>
        </div>

        <div className="bg-[#2b2d31] p-5 rounded-2xl border border-white/5 shadow-sm space-y-5">
          {/* 摄像头设备下拉选择 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-discord-brand" />
              <span>摄像头设备 (Camera)</span>
            </label>
            <select
              data-testid="camera-device-select"
              value={selectedCameraId}
              onChange={(e) => handleCameraChange(e.target.value)}
              className="w-full bg-[#1e1f22] border border-[#3f4147] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-discord-brand transition cursor-pointer"
            >
              {cameraDevices.length === 0 && (
                <option value="default">默认系统摄像头</option>
              )}
              {cameraDevices.map((d, index) => (
                <option key={d.deviceId || index} value={d.deviceId}>
                  {d.label || `摄像头设备 ${index + 1}`}
                </option>
              ))}
            </select>
          </div>

          {/* 视频预览视口与测试控制 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300">
                视频预览 (Video Preview)
              </span>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400 hover:text-white transition">
                <input
                  type="checkbox"
                  data-testid="camera-mirror-checkbox"
                  checked={mirrorPreview}
                  onChange={(e) => setMirrorPreview(e.target.checked)}
                  className="rounded border-[#3f4147] text-discord-brand focus:ring-0 bg-[#1e1f22]"
                />
                <span>镜像画面</span>
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
                    点击下方按钮测试您的摄像头，确认取景画面与照明效果
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
                测试流仅在本地窗口呈现，不会向当前频道广播任何视频数据
              </span>
              {isTestingVideo ? (
                <button
                  type="button"
                  data-testid="stop-video-test-btn"
                  onClick={stopVideoTest}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>停止测试</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="start-video-test-btn"
                  onClick={() => startVideoTest()}
                  className="px-4 py-2 rounded-lg bg-discord-brand hover:bg-discord-brand-hover text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>测试视频</span>
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
                <span>推流编码格式与硬件加速 (Video Codecs)</span>
              </label>
              <p className="text-[11px] text-discord-textMuted">
                为摄像头与屏幕共享设置默认视频编码器。系统已动态探测本地硬件编解码支持能力。
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
                            硬编加速
                          </span>
                        )}
                        {!isAvailable && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-medium">
                            暂不支持
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-discord-textMuted">
                      {item.description}
                    </p>
                  </div>
                  {item.reason && !isAvailable && (
                    <div className="mt-2 text-[10px] text-amber-400/90 flex items-center gap-1 bg-amber-400/10 px-2 py-1 rounded">
                      <Info className="w-3 h-3 flex-shrink-0" />
                      <span>{item.reason}</span>
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
                <span>启用 VP8 双编码兜底降级 (Dual-Codec Fallback)</span>
              </label>
              <p className="text-[11px] text-discord-textMuted">
                当您以 AV1、H.264 或 HEVC 推流时，系统底层同时推送一份轻量 VP8
                备用流。若观众设备不支持高级格式，自动无缝切换至备用流，绝不黑屏。
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
                  <span>自定义目标推流码率 (Target Bitrate)</span>
                </label>
                <p className="text-[11px] text-discord-textMuted">
                  覆盖默认画质档位预设码率。AV1/HEVC 建议 1500~3000 kbps，H.264
                  电竞推流建议 4000~6000 kbps。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  data-testid="current-custom-bitrate-label"
                  className="text-xs font-mono font-bold text-discord-brand bg-discord-brand/10 px-2 py-0.5 rounded border border-discord-brand/20"
                >
                  {customBitrate
                    ? `${Math.round(customBitrate / 1000)} kbps`
                    : "跟随预设 (自适应)"}
                </span>
                {customBitrate && (
                  <button
                    type="button"
                    data-testid="reset-custom-bitrate-btn"
                    onClick={handleResetVideoBitrate}
                    className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded hover:bg-white/10 transition"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>重置</span>
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
                高级音频设置与降噪实验室
              </span>
              <p className="text-[11px] text-discord-textMuted">
                包含 Opus 传输码率、回声消除、48kHz 高保真立体声及三轨 A/B/C
                降噪对比测试
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>{isAdvancedOpen ? "收起" : "展开高级选项"}</span>
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
                  <span>Opus 音频推流码率</span>
                </span>
                <span className="text-xs font-mono text-discord-brand font-bold">
                  {config.audioBitrate / 1000} kbps
                </span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: "16k", value: 16000, desc: "节流" },
                  { label: "32k", value: 32000, desc: "流畅" },
                  { label: "64k", value: 64000, desc: "推荐" },
                  { label: "96k", value: 96000, desc: "高清" },
                  { label: "128k", value: 128000, desc: "无损" },
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
                      {item.desc}
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
                    <span>48kHz 高保真音乐电台模式</span>
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    直通输出双声道，关闭系统回声消除与降噪，适合乐器吉他演奏或电台直播
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
                    回声消除 (AEC)
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    防止电脑扬声器声音被麦克风重复录入引发刺耳啸叫
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
                    自动增益控制 (AGC)
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    自动动态平衡小声耳语与大声喊叫时的输出音量
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
                      自动增益提升上限 (AGC Gain Range)
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
                    <span>6 dB (保守)</span>
                    <span>18 dB (均衡推荐)</span>
                    <span>30 dB (激进)</span>
                  </div>
                </div>
              )}
            </div>

            {/* 4.3 三轨 A/B/C 录音降噪对比实验室 */}
            <div className="bg-[#1e1f22] p-4 rounded-xl border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-discord-brand" />
                  <span className="text-xs font-bold text-white">
                    AI 降噪前后效果三轨录音试听对比
                  </span>
                </div>
                {abResult && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-discord-brand/20 text-discord-brand px-2 py-0.5 rounded-full font-bold">
                      RNNoise +{abResult.rnnoiseDbReduction} dB
                    </span>
                    <span className="text-[10px] bg-discord-green/20 text-discord-green px-2 py-0.5 rounded-full font-bold">
                      DTLN +{abResult.dtlnDbReduction} dB
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-discord-textMuted">
                一键录制 5 秒音频，系统将同步采集「原始原声」、「RNNoise
                滤噪」和「DTLN 深度消键盘音」三条音轨，供您同屏试听对比效果。
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
                  <span>开始 5 秒环境与键盘杂音多轨录音测试</span>
                </button>
              )}

              {isABTesting && (
                <div className="bg-[#2b2d31] p-4 rounded-lg flex flex-col items-center justify-center border border-discord-brand/40">
                  <div className="w-8 h-8 rounded-full border-2 border-discord-brand/20 border-t-discord-brand animate-spin mb-2" />
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>请敲击键盘、摩擦桌面或说话测试...</span>
                    <span className="text-discord-green">({abCountdown}s)</span>
                  </div>
                  <div className="w-40 h-1 bg-[#1e1f22] rounded-full overflow-hidden mt-2.5">
                    <div
                      className="h-full bg-discord-brand transition-all duration-1000"
                      style={{ width: `${((5 - abCountdown) / 5) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {abResult && (
                <div className="space-y-3 animate-fadeIn">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {/* 原始音轨 */}
                    <div className="bg-[#2b2d31] p-2.5 rounded-lg border border-white/5">
                      <div className="text-[11px] font-bold text-gray-400 mb-1 flex items-center justify-between">
                        <span>原始未过滤</span>
                        <span className="text-[10px] text-rose-400">
                          含环境音
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
                        <span>RNNoise 滤噪</span>
                        <span className="text-[10px] bg-discord-brand/20 px-1 rounded">
                          +{abResult.rnnoiseDbReduction} dB
                        </span>
                      </div>
                      <audio
                        src={abResult.rnnoiseUrl}
                        controls
                        className="w-full h-7 outline-none"
                      />
                    </div>

                    {/* DTLN */}
                    <div className="bg-[#2b2d31] p-2.5 rounded-lg border border-discord-green/40">
                      <div className="text-[11px] font-bold text-discord-green mb-1 flex items-center justify-between">
                        <span>DTLN 深度消键盘</span>
                        <span className="text-[10px] bg-discord-green/20 px-1 rounded">
                          +{abResult.dtlnDbReduction} dB
                        </span>
                      </div>
                      <audio
                        src={abResult.dtlnUrl}
                        controls
                        className="w-full h-7 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={runABComparisonTest}
                      className="px-3 py-1 text-xs text-gray-400 hover:text-white rounded bg-[#2b2d31] hover:bg-[#35373c] transition flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>重新录制对比</span>
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
