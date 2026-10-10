import { audioOutput } from "../../services/audioOutput.js";
import {
  audioDevices,
  audioDeviceLabel,
  type AudioDeviceEntry,
} from "../../services/audioDevices.js";
import { toast } from "../../stores/useToastStore.js";
import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  audioEngine,
  TripleABTestResult,
  QuadABTestResult,
} from "../../services/audioEngine.js";
import { NoiseSuppressionMode } from "@tescord/types";
import { livekitService } from "../../services/livekit.js";
import { cloudflareRealtimeService } from "../../services/cloudflare_realtime/index.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { VOICE_ENGINE } from "../../config.js";
import { Select } from "../ui/Select.js";
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
  Activity,
  Pause,
} from "lucide-react";

interface ComparisonTrackPlayerProps {
  title: string;
  badge: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  activeBorderColor: string;
  accentColor: string;
  description: string;
  url?: string | null;
  error?: string | null;
  isActive: boolean;
  onPlay: () => void;
  onStop: () => void;
}

const ComparisonTrackPlayer: React.FC<ComparisonTrackPlayerProps> = ({
  title,
  badge,
  badgeBg,
  badgeText,
  borderColor,
  activeBorderColor,
  accentColor,
  description,
  url,
  error,
  isActive,
  onPlay,
  onStop,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [level, setLevel] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const outputBindingRef = useRef<ReturnType<
    typeof audioOutput.register
  > | null>(null);
  useEffect(
    () => () => {
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      outputBindingRef.current?.dispose();
      void audioCtxRef.current?.close().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isActive) {
      if (!audioCtxRef.current) {
        try {
          const AudioContextClass =
            window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 128;
          analyser.smoothingTimeConstant = 0.3;
          const source = ctx.createMediaElementSource(audio);
          source.connect(analyser);
          const master = ctx.createGain();
          analyser.connect(master);
          outputBindingRef.current = audioOutput.register(ctx, master, {
            deafenable: false,
          });
          void outputBindingRef.current.ready.catch((error) =>
            console.warn("Comparison audio output failed", error),
          );
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
          sourceRef.current = source;
        } catch {
          // fallback
        }
      }

      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }

      audio.currentTime = 0;
      audio.play().catch(() => onStop());

      const dataArray = new Uint8Array(64);
      const updateLevel = () => {
        if (!analyserRef.current) {
          setLevel(Math.floor(Math.random() * 30 + 35));
        } else {
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const norm = Math.min(100, Math.round((avg / 255) * 160));
          setLevel(norm);
        }
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      animFrameRef.current = requestAnimationFrame(updateLevel);
    } else {
      audio.pause();
      audio.currentTime = 0;
      setLevel(0);
      setProgress(0);
      setCurrentTime(0);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isActive, onStop]);

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    const dur = audioRef.current.duration || 5;
    setCurrentTime(cur);
    setDuration(dur);
    setProgress(Math.min(100, (cur / dur) * 100));
  };

  const handleEnded = () => {
    onStop();
  };

  const formatTime = (secs: number) => {
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `0:0${s}.${ms}`;
  };

  const isAvailable = Boolean(url);

  return (
    <div
      className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
        isActive
          ? `${activeBorderColor} bg-[#1e1f22] ring-1 ring-white/10 shadow-lg`
          : `bg-[#2b2d31] ${borderColor} hover:border-[#4e5058]`
      }`}
    >
      {url && (
        <audio
          ref={audioRef}
          src={url}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          preload="auto"
          className="hidden"
        />
      )}

      {/* 头部：标题与特性徽章 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            {title}
          </span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${badgeBg} ${badgeText}`}
          >
            {isAvailable ? badge : "不可用"}
          </span>
        </div>
        <p className="text-[11px] text-discord-textMuted leading-relaxed mb-3">
          {description}
        </p>
      </div>

      {error ? (
        <div className="text-[10px] text-red-300 p-2 rounded bg-red-950/30 border border-red-800/30">
          {error}
        </div>
      ) : (
        <div className="space-y-2 mt-auto">
          {/* 电平指示器 (类似 Discord 麦克风测试) */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono">
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-400" />
                <span>动态响应电平</span>
              </span>
              <span>{isActive ? `${level}%` : "--"}</span>
            </div>
            <div className="h-2 w-full bg-[#18191c] rounded-full overflow-hidden relative shadow-inner p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  isActive
                    ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                    : "bg-gray-600/30"
                }`}
                style={{ width: `${isActive ? level : 0}%` }}
              />
            </div>
          </div>

          {/* 控制按钮与播放进度条 */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={!isAvailable}
              onClick={() => (isActive ? onStop() : onPlay())}
              className={`p-2 rounded-lg flex items-center justify-center transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isActive
                  ? "bg-rose-500 hover:bg-rose-600 text-white shadow"
                  : `${accentColor} text-white shadow hover:opacity-90`
              }`}
              title={isActive ? "停止播放" : "开始试听"}
            >
              {isActive ? (
                <Square className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>

            {/* 播放进度指示 */}
            <div className="flex-1 space-y-0.5">
              <div className="h-1.5 w-full bg-[#18191c] rounded-full overflow-hidden">
                <div
                  className="h-full bg-discord-brand transition-all duration-100 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-gray-400 font-mono">
                <span>{isActive ? formatTime(currentTime) : "0:00.0"}</span>
                <span>{duration > 0 ? formatTime(duration) : "0:05.0"}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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
  const [inputDevices, setInputDevices] = useState<AudioDeviceEntry[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceEntry[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>(
    livekitService.getAudioInputDeviceId() || "default",
  );
  const [selectedOutputId, setSelectedOutputId] = useState<string>(
    audioOutput.getState().deviceId,
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

  const outputVolume = useSettingsStore((state) => state.outputVolume);
  const setOutputVolume = useSettingsStore((state) => state.setOutputVolume);
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);
  const testToneRef = useRef<{
    context: AudioContext;
    oscillator: OscillatorNode;
    binding: ReturnType<typeof audioOutput.register>;
  } | null>(null);
  const stopTestSound = () => {
    const tone = testToneRef.current;
    testToneRef.current = null;
    if (!tone) return;
    tone.oscillator.onended = null;
    try {
      tone.oscillator.stop();
    } catch {
      /* Already ended. */
    }
    tone.oscillator.disconnect();
    tone.binding.dispose();
    void tone.context.close().catch(() => undefined);
    setIsPlayingTestSound(false);
  };
  useEffect(() => () => stopTestSound(), []);

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

  // 活跃播放的 A/B 降噪对比音轨 (互斥试听)
  const [activeComparisonTrack, setActiveComparisonTrack] = useState<
    "raw" | "rnnoise" | "dtln" | "dfn3" | null
  >(null);

  const refreshDevices = () => audioDevices.refresh();
  useEffect(() => {
    const unsubscribeDevices = audioDevices.subscribe((devices) => {
      setInputDevices(devices.inputs);
      setOutputDevices(devices.outputs);
      setCameraDevices(devices.cameras);
      const cameraId = livekitService.getCameraDeviceId();
      setSelectedCameraId(
        devices.cameras.some((device) => device.deviceId === cameraId)
          ? cameraId
          : devices.cameras[0]?.deviceId || "default",
      );
    });
    const unsubscribeInput = livekitService.onActiveAudioInputChange((id) => {
      setSelectedInputId(id);
      setConfig((previous) => ({ ...previous, inputDeviceId: id }));
      void audioDevices.refresh();
    });
    const unsubscribeOutput = audioOutput.subscribe((state) =>
      setSelectedOutputId(state.deviceId),
    );
    return () => {
      unsubscribeDevices();
      unsubscribeInput();
      unsubscribeOutput();
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

    // 监听前级输入真实物理电平（即使处于闭麦静音状态也能驱动电平测试条，不受静音影响）
    const cleanupSpeaking = audioEngine.onInputLevel((volume) => {
      setCurrentVolume(volume);
    });

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

  const handleInputChange = async (deviceId: string) => {
    try {
      if (!(await livekitService.switchAudioInputDevice(deviceId)))
        toast.error("errors:AUDIO_INPUT_SWITCH_FAILED");
    } catch {
      toast.error("errors:AUDIO_INPUT_SWITCH_FAILED");
    }
  };

  const handleOutputChange = async (deviceId: string) => {
    const result = await audioOutput.switchDevice(deviceId);
    if (!result.success) toast.error(`errors:${result.code}`);
    await audioDevices.refresh();
  };

  const handlePlayTestSound = async () => {
    if (testToneRef.current) {
      stopTestSound();
      return;
    }
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const master = context.createGain();
    const binding = audioOutput.register(context, master, {
      deafenable: false,
    });
    oscillator.connect(envelope).connect(master);
    const tone = { context, oscillator, binding };
    testToneRef.current = tone;
    setIsPlayingTestSound(true);
    try {
      await context.resume();
      await binding.ready;
      if (testToneRef.current !== tone) return;
      oscillator.frequency.setValueAtTime(440, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        880,
        context.currentTime + 0.3,
      );
      envelope.gain.setValueAtTime(0.35, context.currentTime);
      envelope.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + 0.8,
      );
      oscillator.onended = () => {
        if (testToneRef.current === tone) stopTestSound();
      };
      oscillator.start();
      oscillator.stop(context.currentTime + 0.8);
    } catch {
      if (testToneRef.current !== tone) return;
      stopTestSound();
      toast.error("errors:AUDIO_DEVICE_SWITCH_FAILED");
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
    setActiveComparisonTrack(null);
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

            <Select
              data-testid="audio-input-device"
              value={selectedInputId}
              onChange={(val) => handleInputChange(val)}
              options={
                inputDevices.length === 0
                  ? [
                      {
                        value: "default",
                        label: t("settings:audioVideo.defaultInputDevice"),
                      },
                    ]
                  : inputDevices.map((d, index) => ({
                      value: d.deviceId,
                      label: audioDeviceLabel(
                        d,
                        t("settings:audioVideo.defaultInputDevice"),
                        t("settings:audioVideo.inputDeviceIndex", {
                          index: index + 1,
                        }),
                      ),
                    }))
              }
              triggerClassName="py-2 text-xs border border-[#3f4147] rounded-lg"
            />

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

            <Select
              data-testid="audio-output-device"
              disabled={!audioOutput.supportsDeviceSelection()}
              value={selectedOutputId}
              onChange={(val) => handleOutputChange(val)}
              options={
                outputDevices.length === 0
                  ? [
                      {
                        value: "default",
                        label: t("settings:audioVideo.defaultOutputDevice"),
                      },
                    ]
                  : outputDevices.map((d, index) => ({
                      value: d.deviceId,
                      label: audioDeviceLabel(
                        d,
                        t("settings:audioVideo.defaultOutputDevice"),
                        t("settings:audioVideo.outputDeviceIndex", {
                          index: index + 1,
                        }),
                      ),
                    }))
              }
              triggerClassName="py-2 text-xs border border-[#3f4147] rounded-lg"
            />

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
                data-testid="audio-output-volume"
                value={outputVolume}
                onChange={(e) => setOutputVolume(Number(e.target.value))}
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
            <Select
              data-testid="camera-device-select"
              value={selectedCameraId}
              onChange={(val) => handleCameraChange(val)}
              options={
                cameraDevices.length === 0
                  ? [
                      {
                        value: "default",
                        label: t("settings:audioVideo.defaultCameraDevice"),
                      },
                    ]
                  : cameraDevices.map((d, index) => ({
                      value: d.deviceId,
                      label:
                        d.label ||
                        t("settings:audioVideo.cameraDeviceIndex", {
                          index: index + 1,
                        }),
                    }))
              }
              triggerClassName="py-2 text-xs border border-[#3f4147] rounded-lg"
            />
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
      </section>

      {/* 模块 4：高级音频与声学实验室 (折叠收纳，专业用户展开) */}
      <section className="border border-white/5 rounded-2xl bg-[#2b2d31] overflow-hidden transition-all shadow-sm">
        <button
          type="button"
          data-testid="advanced-audio-toggle-btn"
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
            {/* 基础声学算法开关 */}
            <div className="space-y-3">
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
                  data-testid="start-ab-test-btn"
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* 原始音轨 (Raw) */}
                    <ComparisonTrackPlayer
                      title={t("settings:audioVideo.abRawTrack", {
                        defaultValue: "原始输入 (Raw)",
                      })}
                      badge={t("settings:audioVideo.abContainsNoise", {
                        defaultValue: "保留底噪",
                      })}
                      badgeBg="bg-rose-500/20"
                      badgeText="text-rose-300"
                      borderColor="border-rose-500/20"
                      activeBorderColor="border-rose-500"
                      accentColor="bg-rose-600 hover:bg-rose-700"
                      description="未经过任何降噪处理的物理麦克风原始录音。"
                      url={abResult.rawUrl}
                      isActive={activeComparisonTrack === "raw"}
                      onPlay={() => setActiveComparisonTrack("raw")}
                      onStop={() => setActiveComparisonTrack(null)}
                    />

                    {/* RNNoise 经典神经网络 */}
                    <ComparisonTrackPlayer
                      title={t("settings:audioVideo.abRnnoiseTrack", {
                        defaultValue: "RNNoise 神经网络",
                      })}
                      badge={abResult.rnnoiseUrl ? "推荐日常" : "不可用"}
                      badgeBg="bg-discord-brand/20"
                      badgeText="text-discord-brand"
                      borderColor="border-discord-brand/20"
                      activeBorderColor="border-discord-brand"
                      accentColor="bg-discord-brand hover:bg-discord-brand-hover"
                      description="轻量级循环神经网络降噪，高效消除稳态风扇与空调底噪。"
                      url={abResult.rnnoiseUrl}
                      error={abResult.rnnoiseError}
                      isActive={activeComparisonTrack === "rnnoise"}
                      onPlay={() => setActiveComparisonTrack("rnnoise")}
                      onStop={() => setActiveComparisonTrack(null)}
                    />

                    {/* DTLN 深度净化 */}
                    <ComparisonTrackPlayer
                      title={t("settings:audioVideo.abDtlnTrack", {
                        defaultValue: "DTLN 深度学习",
                      })}
                      badge={abResult.dtlnUrl ? "键盘消音" : "不可用"}
                      badgeBg="bg-discord-green/20"
                      badgeText="text-discord-green"
                      borderColor="border-discord-green/20"
                      activeBorderColor="border-discord-green"
                      accentColor="bg-emerald-600 hover:bg-emerald-700"
                      description="双信号转换通道卷积神经网络，专克青轴敲击声与剧烈敲击噪音。"
                      url={abResult.dtlnUrl}
                      error={abResult.dtlnError}
                      isActive={activeComparisonTrack === "dtln"}
                      onPlay={() => setActiveComparisonTrack("dtln")}
                      onStop={() => setActiveComparisonTrack(null)}
                    />

                    {/* DFNv3 旗舰声学 */}
                    <ComparisonTrackPlayer
                      title={t("settings:audioVideo.abDfn3Track", {
                        defaultValue: "DFNv3 旗舰声学",
                      })}
                      badge={abResult.dfn3Url ? "全频高保真" : "不可用"}
                      badgeBg="bg-purple-500/20"
                      badgeText="text-purple-300"
                      borderColor="border-purple-500/20"
                      activeBorderColor="border-purple-500"
                      accentColor="bg-purple-600 hover:bg-purple-700"
                      description="DeepFilterNet 3 代旗舰声学，保留饱满人声泛音并深度净化复杂环境音。"
                      url={abResult.dfn3Url}
                      error={abResult.dfn3Error}
                      isActive={activeComparisonTrack === "dfn3"}
                      onPlay={() => setActiveComparisonTrack("dfn3")}
                      onStop={() => setActiveComparisonTrack(null)}
                    />
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
