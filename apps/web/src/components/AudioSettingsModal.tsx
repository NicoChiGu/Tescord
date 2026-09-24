import React, { useState, useEffect, useRef } from "react";
import {
  audioEngine,
  ABTestResult,
  TripleABTestResult,
  QuadABTestResult,
} from "../services/audioEngine.js";
import { NoiseSuppressionMode } from "@tescord/types";
import { livekitService } from "../services/livekit.js";
import {
  Sparkles,
  X,
  Volume2,
  Mic,
  Music,
  Radio,
  Sliders,
  Play,
  RotateCcw,
  CheckCircle2,
  Cpu,
  Keyboard,
  Clock,
  Zap,
  ShieldCheck,
} from "lucide-react";

interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInCall?: boolean;
}

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({
  isOpen,
  onClose,
  isInCall = false,
}) => {
  const [config, setConfig] = useState(audioEngine.config);
  const [noiseStatus, setNoiseStatus] = useState(() => ({
    ...audioEngine.noiseStatus,
  }));
  const [currentVolume, setCurrentVolume] = useState(0);

  // 按键录制状态
  const [isRecordingKeybind, setIsRecordingKeybind] = useState(false);

  // A/B 降噪录音对比小工具状态 (升级为四轨并排对比)
  const [isABTesting, setIsABTesting] = useState(false);
  const [abCountdown, setABCountdown] = useState(5);
  const [abResult, setABResult] = useState<
    QuadABTestResult | TripleABTestResult | null
  >(null);
  const [abError, setABError] = useState<string | null>(null);
  const abAbortRef = useRef<AbortController | null>(null);
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
    if (!isOpen) return;
    const statusTimer = setInterval(
      () => setNoiseStatus({ ...audioEngine.noiseStatus }),
      250,
    );

    // 同步最新引擎配置
    setConfig(audioEngine.config);

    // 监听音量变动以驱动音量测试柱状条
    const cleanupSpeaking = audioEngine.onSpeakingChange(
      (_isSpeaking, volume) => {
        setCurrentVolume(volume);
      },
    );

    // 若麦克风当前未被激活 (用户尚未加入语音频道)，临时激活麦克风测试管线以驱动电平显示
    const wasAlreadyRunning = audioEngine.isMicrophoneActive();
    if (!wasAlreadyRunning) {
      audioEngine.initMicrophone().catch((err) => {
        console.warn("AudioSettingsModal: 临时激活麦克风电平测试失败:", err);
      });
    }

    return () => {
      abAbortRef.current?.abort();
      clearInterval(statusTimer);
      cleanupSpeaking();
      // 关闭设置弹窗时：如果用户并未加入语音频道 (非通话中)，安全释放临时测试麦克风流
      if (!isInCall) {
        audioEngine.stop();
      }
    };
  }, [isOpen, isInCall]);

  // 全局录制 PTT 按键
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

  // ESC 键监听关闭弹窗
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRecordingKeybind) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isRecordingKeybind]);

  if (!isOpen) return null;

  const handleNoiseModeChange = (mode: NoiseSuppressionMode) => {
    const newCfg = {
      ...config,
      noiseSuppressionMode: mode,
      noiseSuppression: mode !== "off",
    };
    setConfig(newCfg);
    audioEngine.setNoiseSuppressionMode(mode);
  };

  const handleToggle = (key: keyof typeof config) => {
    const nextVal = !config[key];
    const newCfg = { ...config, [key]: nextVal };
    setConfig(newCfg);
    audioEngine.updateConfig({ [key]: nextVal });
  };

  const handleSensitivityChange = (val: number) => {
    const newCfg = { ...config, vadSensitivity: val };
    setConfig(newCfg);
    audioEngine.updateConfig({ vadSensitivity: val });
  };

  const handleInputModeChange = (mode: "VAD" | "PTT") => {
    const isPTT = mode === "PTT";
    const newCfg = { ...config, inputMode: mode, pushToTalk: isPTT };
    setConfig(newCfg);
    audioEngine.updateConfig({ inputMode: mode, pushToTalk: isPTT });
  };

  const handleBitrateChange = (bitrate: number) => {
    const newCfg = { ...config, audioBitrate: bitrate };
    setConfig(newCfg);
    audioEngine.updateConfig({ audioBitrate: bitrate });
    livekitService.setAudioBitrate(bitrate);
  };

  const handleReleaseDelayChange = (delay: number) => {
    const newCfg = { ...config, pushToTalkReleaseDelay: delay };
    setConfig(newCfg);
    audioEngine.updateConfig({ pushToTalkReleaseDelay: delay });
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
      setABError(err?.message || "录音对比测试失败，请检查麦克风权限与设备");
    } finally {
      if (abAbortRef.current === controller) abAbortRef.current = null;
      setIsABTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm select-none animate-fadeIn">
      <div className="bg-[#313338] w-full max-w-xl rounded-2xl shadow-2xl border border-[#3f4147] overflow-hidden flex flex-col max-h-[85vh]">
        {/* 标题 */}
        <div className="px-6 py-4 border-b border-[#2b2d31] flex items-center justify-between bg-[#2b2d31]/60">
          <div className="flex items-center space-x-2.5">
            <Volume2 className="w-5 h-5 text-discord-brand" />
            <h3 className="text-lg font-bold text-discord-textHeader">
              语音引擎与 RNNoise AI 降噪控制中心
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 text-discord-textMuted hover:text-white rounded-lg hover:bg-[#35373c] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 选项内容滚动区 */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* 降噪引擎选择器 */}
          <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-discord-green" />
                <span className="text-sm font-bold text-discord-textHeader">
                  降噪引擎
                </span>
              </div>
              <span className="text-[10px] bg-discord-green/20 text-discord-green px-2 py-0.5 rounded-full font-bold flex items-center space-x-1">
                <Cpu className="w-3 h-3" />
                <span>
                  {config.noiseSuppressionMode === "dfn3"
                    ? "DeepFilterNet3 · 48 kHz"
                    : config.noiseSuppressionMode === "dtln"
                      ? "DTLN · 16 kHz 双阶段"
                      : config.noiseSuppressionMode === "off" ||
                          !config.noiseSuppression
                        ? "直通模式 (未降噪)"
                        : "RNNoise · 48 kHz"}
                </span>
              </span>
            </div>

            <p className="text-xs text-discord-textMuted mb-3 leading-relaxed">
              每次只启用一种降噪模型。浏览器使用本地 WASM，Electron
              使用独立原生进程；不同噪声下的效果请以试听为准。
            </p>

            {/* 4 档分段卡片选择器 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {/* 模式 1: 关闭 */}
              <button
                type="button"
                onClick={() => handleNoiseModeChange("off")}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between ${
                  config.noiseSuppressionMode === "off" ||
                  !config.noiseSuppression
                    ? "border-discord-danger bg-discord-danger/10 text-white shadow-sm"
                    : "border-[#383a40] bg-[#1e1f22] text-discord-textNormal hover:bg-[#35373c]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs">直通原声 (未降噪)</span>
                    {(config.noiseSuppressionMode === "off" ||
                      !config.noiseSuppression) && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-discord-danger" />
                    )}
                  </div>
                  <p className="text-[10px] text-discord-textMuted">
                    原始麦克风直通，适合安静录音室或硬件声卡降噪
                  </p>
                </div>
              </button>

              {/* 模式 2: RNNoise 标准轻量 */}
              <button
                type="button"
                onClick={() => handleNoiseModeChange("rnnoise")}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between ${
                  config.noiseSuppressionMode === "rnnoise" &&
                  config.noiseSuppression
                    ? "border-discord-brand bg-discord-brand/10 text-white shadow-sm"
                    : "border-[#383a40] bg-[#1e1f22] text-discord-textNormal hover:bg-[#35373c]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs">RNNoise 标准轻量</span>
                    {config.noiseSuppressionMode === "rnnoise" &&
                      config.noiseSuppression && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-discord-brand" />
                      )}
                  </div>
                  <p className="text-[10px] text-discord-textMuted">
                    48 kHz 轻量实时降噪，适合日常语音通话
                  </p>
                </div>
              </button>

              {/* 模式 3: DTLN 双阶段降噪 */}
              <button
                type="button"
                onClick={() => handleNoiseModeChange("dtln")}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between relative overflow-hidden ${
                  config.noiseSuppressionMode === "dtln" &&
                  config.noiseSuppression
                    ? "border-discord-green bg-discord-green/10 text-white shadow-sm ring-1 ring-discord-green/30"
                    : "border-[#383a40] bg-[#1e1f22] text-discord-textNormal hover:bg-[#35373c]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs flex items-center space-x-1">
                      <span>DTLN 深度净化</span>
                    </span>
                    <span className="text-[9px] bg-discord-green text-black px-1.5 py-0.2 rounded font-bold">
                      16k 双阶段
                    </span>
                  </div>
                  <p className="text-[10px] text-discord-textMuted">
                    双阶段 LSTM，经重采样接入 48 kHz 通话
                  </p>
                </div>
              </button>

              {/* 模式 4: DeepFilterNet3 */}
              <button
                type="button"
                onClick={() => handleNoiseModeChange("dfn3")}
                className={`p-3 rounded-lg border text-left transition flex flex-col justify-between relative overflow-hidden ${
                  config.noiseSuppressionMode === "dfn3" &&
                  config.noiseSuppression
                    ? "border-purple-500 bg-purple-500/10 text-white shadow-sm ring-1 ring-purple-500/30"
                    : "border-[#383a40] bg-[#1e1f22] text-discord-textNormal hover:bg-[#35373c]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs flex items-center space-x-1">
                      <span>DeepFilterNet3</span>
                    </span>
                    <span className="text-[9px] bg-purple-500 text-white px-1.5 py-0.2 rounded font-bold">
                      48k全频
                    </span>
                  </div>
                  <p className="text-[10px] text-discord-textMuted">
                    48 kHz 复数深度滤波，默认最大衰减 12 dB
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* 2. 输入模式选择：语音感应 (VAD) vs 按键说话 (PTT) */}
          <div>
            <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2.5">
              输入模式 (Input Mode)
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* 语音感应 */}
              <button
                onClick={() => handleInputModeChange("VAD")}
                className={`p-3.5 rounded-xl border flex flex-col items-start text-left transition ${
                  config.inputMode === "VAD" && !config.pushToTalk
                    ? "border-discord-brand bg-discord-brand/10 text-white shadow-sm"
                    : "border-[#383a40] bg-[#2b2d31] text-discord-textNormal hover:bg-[#35373c]"
                }`}
              >
                <div className="flex items-center space-x-2 mb-1">
                  <Mic className="w-4 h-4 text-discord-brand" />
                  <span className="font-bold text-sm">语音感应 (VAD)</span>
                </div>
                <span className="text-[11px] text-discord-textMuted">
                  声波智能判定，音量低于门限时自动静音断流
                </span>
              </button>

              {/* 按键说话 */}
              <button
                onClick={() => handleInputModeChange("PTT")}
                className={`p-3.5 rounded-xl border flex flex-col items-start text-left transition ${
                  config.inputMode === "PTT" || config.pushToTalk
                    ? "border-discord-brand bg-discord-brand/10 text-white shadow-sm"
                    : "border-[#383a40] bg-[#2b2d31] text-discord-textNormal hover:bg-[#35373c]"
                }`}
              >
                <div className="flex items-center space-x-2 mb-1">
                  <Keyboard className="w-4 h-4 text-discord-brand" />
                  <span className="font-bold text-sm">按键说话 (PTT)</span>
                </div>
                <span className="text-[11px] text-discord-textMuted">
                  按住指定快捷键开麦，支持桌面端全局热键
                </span>
              </button>
            </div>
          </div>

          {/* 3. 按键说话细节配置 (当 PTT 激活时展示) */}
          {(config.inputMode === "PTT" || config.pushToTalk) && (
            <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-4 animate-fadeIn">
              <div>
                <label className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-1.5 block">
                  开麦快捷键 (Push-To-Talk Keybind)
                </label>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => setIsRecordingKeybind(true)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition border ${
                      isRecordingKeybind
                        ? "bg-discord-danger text-white border-discord-danger animate-pulse"
                        : "bg-[#1e1f22] text-discord-textHeader border-[#3f4147] hover:border-discord-brand"
                    }`}
                  >
                    {isRecordingKeybind
                      ? "请按下要绑定的按键..."
                      : `当前绑定: [ ${config.pushToTalkKey || "Space"} ]`}
                  </button>
                  <span className="text-xs text-discord-textMuted">
                    点击按钮后直接敲击键盘按键即可完成录制
                  </span>
                </div>
              </div>

              {/* 释放缓冲延迟 */}
              <div>
                <div className="flex justify-between items-center text-xs text-discord-textMuted mb-1.5 font-medium">
                  <span className="flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>按键释放延迟 (PTT Release Delay)</span>
                  </span>
                  <span className="text-white font-bold">
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
                <p className="text-[11px] text-discord-textMuted mt-1">
                  松开按键后继续维持麦克风上行传输的时间，防止说话句尾吞字。
                </p>
              </div>
            </div>
          )}

          {/* 4. 语音感应门限实时测试 (当 VAD 激活时展示) */}
          {config.inputMode === "VAD" && !config.pushToTalk && (
            <div>
              <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2 flex items-center justify-between">
                <span className="flex items-center space-x-1.5">
                  <Mic className="w-4 h-4 text-discord-brand" />
                  <span>自适应麦克风门限感知 (VAD Sensitivity)</span>
                </span>
                <span className="text-white font-bold">
                  {config.vadSensitivity}%
                </span>
              </div>

              {/* 音量柱状实时可视化 */}
              <div className="h-3 w-full bg-[#1e1f22] rounded-full overflow-hidden relative mb-2.5">
                <div
                  className="h-full bg-discord-green transition-all duration-75 rounded-full"
                  style={{ width: `${currentVolume}%` }}
                />
                {/* 灵敏度门限红线 */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-discord-danger z-10"
                  style={{ left: `${config.vadSensitivity}%` }}
                  title="低于此门限判定为静音，阻断网络上行"
                />
              </div>

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
              <p className="text-[11px] text-discord-textMuted mt-1">
                声波超过红线时系统判定为正在讲话并推送网络流；低于红线时启用滞后闭环静音，彻底消除环境杂音。
              </p>
            </div>
          )}

          {/* 5. 麦克风音频推流码率配置 (Opus Bitrate 16kbps ~ 128kbps) */}
          <div>
            <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center space-x-1.5">
                <Radio className="w-4 h-4 text-discord-brand" />
                <span>Opus 音频推流比特率 (Dynamic Bitrate)</span>
              </span>
              <span className="text-white font-bold">
                {config.audioBitrate / 1000} kbps
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "16kbps", value: 16000, desc: "节流" },
                { label: "32kbps", value: 32000, desc: "标准" },
                { label: "64kbps", value: 64000, desc: "推荐" },
                { label: "96kbps", value: 96000, desc: "高清" },
                { label: "128kbps", value: 128000, desc: "无损" },
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => handleBitrateChange(item.value)}
                  className={`py-2 px-1 rounded-lg border text-center transition ${
                    config.audioBitrate === item.value
                      ? "border-discord-brand bg-discord-brand/20 text-white font-bold"
                      : "border-[#383a40] bg-[#2b2d31] text-discord-textMuted hover:bg-[#35373c] hover:text-white"
                  }`}
                >
                  <div className="text-xs font-semibold">{item.label}</div>
                  <div className="text-[10px] text-discord-textMuted scale-90">
                    {item.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 6. 高级声学选项 */}
          <div className="space-y-3 pt-3 border-t border-[#3f4147]">
            {/* 48kHz 高保真立体声音乐模式 */}
            <div className="flex items-center justify-between py-1">
              <div className="flex items-start space-x-2.5">
                <Music className="w-4 h-4 text-discord-brand mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-discord-textHeader">
                    48kHz 高保真音乐电台模式
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    直通输出双声道，关闭回声消除与 AI
                    降噪，适合乐器吉他伴奏或电台直播
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleToggle("highFidelityMusic")}
                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 flex-shrink-0 ${
                  config.highFidelityMusic
                    ? "bg-discord-brand"
                    : "bg-discord-sidebar"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow transform transition duration-200 ${
                    config.highFidelityMusic ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* 回声消除 AEC */}
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-semibold text-discord-textHeader">
                  回声消除 (AEC)
                </div>
                <div className="text-[11px] text-discord-textMuted">
                  防止扬声器外放声音回录进麦克风引发啸叫
                </div>
              </div>
              <button
                onClick={() => handleToggle("echoCancellation")}
                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 flex-shrink-0 ${
                  config.echoCancellation
                    ? "bg-discord-brand"
                    : "bg-discord-sidebar"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow transform transition duration-200 ${
                    config.echoCancellation ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* 自动增益 AGC */}
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-semibold text-discord-textHeader">
                  自动增益控制 (AGC)
                </div>
                <div className="text-[11px] text-discord-textMuted">
                  自动平衡轻声细语与大声喊叫的声音输出动态
                </div>
              </div>
              <button
                onClick={() => handleToggle("autoGainControl")}
                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition duration-200 flex-shrink-0 ${
                  config.autoGainControl
                    ? "bg-discord-brand"
                    : "bg-discord-sidebar"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow transform transition duration-200 ${
                    config.autoGainControl ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* 依据自动增益控制状态呈现对应调节滑块 */}
            {!config.autoGainControl ? (
              /* 关闭 AGC: 手动输入增益滑块 (0% ~ 200%) */
              <div className="bg-[#2b2d31]/60 p-3 rounded-lg border border-[#383a40] space-y-2 mt-2 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-discord-textHeader">
                    手动麦克风输入增益
                  </span>
                  <span className="text-xs font-mono font-bold text-discord-brand">
                    {config.manualGain ?? 100}% (
                    {((config.manualGain ?? 100) / 100).toFixed(2)}x)
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="1"
                  value={config.manualGain ?? 100}
                  onChange={(e) =>
                    handleManualGainChange(Number(e.target.value))
                  }
                  className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                />
                <div className="flex justify-between text-[10px] text-discord-textMuted">
                  <span>0% (静音)</span>
                  <span>100% (标准原声)</span>
                  <span>200% (2倍放大)</span>
                </div>
                <p className="text-[11px] text-discord-textMuted">
                  关闭自动增益后，您可以通过上方滑块精确调节麦克风的物理拾音增益倍数。
                </p>
              </div>
            ) : (
              /* 开启 AGC: 自动增益动态范围上限限制 (6 ~ 30 dB) */
              <div className="bg-[#2b2d31]/60 p-3 rounded-lg border border-[#383a40] space-y-2 mt-2 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-discord-textHeader">
                    自动增益动态提升上限 (AGC Dynamic Range)
                  </span>
                  <span className="text-xs font-mono font-bold text-discord-brand">
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
                  className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                />
                <div className="flex justify-between text-[10px] text-discord-textMuted">
                  <span>6 dB (极净底噪 / 保守)</span>
                  <span>18 dB (均衡推荐)</span>
                  <span>30 dB (微弱耳语拾取 / 激进)</span>
                </div>
                <p className="text-[11px] text-discord-textMuted">
                  限制自动增益对微弱环境音的最大提升上限，避免无声时房间空调声或键盘底噪被过度放大。
                </p>
              </div>
            )}
          </div>

          <p
            className="text-xs text-discord-textMuted"
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
          {/* 7. 同一段录音的四轨试听 */}
          <div className="bg-[#232428] p-4 rounded-xl border border-[#383a40]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-discord-brand" />
                <span className="text-sm font-bold text-discord-textHeader">
                  AI 降噪前后效果四轨录音试听对比
                </span>
              </div>
              {abResult && (
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] bg-discord-brand/20 text-discord-brand px-2 py-0.5 rounded-full font-bold">
                    RNNoise {abResult.rnnoiseUrl ? "可试听" : "不可用"}
                  </span>
                  <span className="text-[11px] bg-discord-green/20 text-discord-green px-2 py-0.5 rounded-full font-bold">
                    DTLN {abResult.dtlnUrl ? "可试听" : "不可用"}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-discord-textMuted mb-3">
              先录制同一段 5 秒原声，再分别交给 RNNoise、DTLN 和 DeepFilterNet3
              处理。系统会估计并校正可辨认的起点；平稳或微弱声音可能无法可靠对齐。
            </p>

            {abError && (
              <div className="bg-discord-danger/20 border border-discord-danger/40 text-red-300 text-xs p-3 rounded-lg mb-3 flex items-center justify-between animate-fadeIn">
                <span>{abError}</span>
                <button
                  onClick={() => setABError(null)}
                  className="p-1 hover:text-white rounded ml-2"
                  title="关闭"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {!isABTesting && !abResult && (
              <button
                type="button"
                onClick={runABComparisonTest}
                className="w-full py-2.5 rounded-lg bg-discord-brand hover:bg-discord-brand-hover text-white text-sm font-semibold transition flex items-center justify-center space-x-2 shadow-md"
              >
                <Mic className="w-4 h-4" />
                <span>开始 5 秒环境与键盘杂音多轨录音测试</span>
              </button>
            )}

            {isABTesting && (
              <div className="bg-[#1e1f22] p-4 rounded-lg flex flex-col items-center justify-center border border-discord-brand/40">
                <div className="w-10 h-10 rounded-full border-4 border-discord-brand/20 border-t-discord-brand animate-spin mb-2" />
                <div className="text-sm font-bold text-white flex items-center space-x-1.5">
                  <span>请尝试敲击机械键盘、吹气或说话...</span>
                  <span className="text-discord-green">({abCountdown}s)</span>
                </div>
                <div className="w-48 h-1.5 bg-[#2b2d31] rounded-full overflow-hidden mt-3">
                  <div
                    className="h-full bg-discord-brand transition-all duration-1000"
                    style={{ width: `${((5 - abCountdown) / 5) * 100}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => abAbortRef.current?.abort()}
                  className="mt-3 text-xs text-discord-textMuted hover:text-white"
                >
                  取消试听
                </button>
              </div>
            )}

            {abResult && (
              <div className="space-y-3 pt-1 animate-fadeIn">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* 1. 原始音频 */}
                  <div className="bg-[#1e1f22] p-3 rounded-lg border border-[#313338]">
                    <div className="text-xs font-bold text-discord-textMuted mb-1.5 flex items-center justify-between">
                      <div className="flex items-center space-x-1">
                        <Volume2 className="w-3.5 h-3.5 text-discord-danger" />
                        <span>原始未滤音轨</span>
                      </div>
                      <span className="text-[10px] text-discord-textMuted">
                        含敲击爆音
                      </span>
                    </div>
                    <audio
                      src={abResult.rawUrl}
                      controls
                      className="w-full h-8 outline-none"
                    />
                  </div>

                  {/* 2. RNNoise 降噪 */}
                  <div className="bg-[#1e1f22] p-3 rounded-lg border border-discord-brand/30">
                    <div className="text-xs font-bold text-discord-brand mb-1.5 flex items-center justify-between">
                      <div className="flex items-center space-x-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>RNNoise 滤噪</span>
                      </div>
                      <span className="text-[10px] bg-discord-brand/20 px-1.5 py-0.2 rounded font-bold">
                        {abResult.rnnoiseUrl ? "可试听" : "不可用"}
                      </span>
                    </div>
                    <audio
                      src={abResult.rnnoiseUrl ?? undefined}
                      controls
                      className="w-full h-8 outline-none"
                    />
                    {abResult.rnnoiseError && (
                      <p className="text-[10px] text-red-300 break-words">
                        {abResult.rnnoiseError}
                      </p>
                    )}
                  </div>

                  {/* 3. DTLN 深度降噪 */}
                  <div className="bg-[#1e1f22] p-3 rounded-lg border border-discord-green/40 ring-1 ring-discord-green/20">
                    <div className="text-xs font-bold text-discord-green mb-1.5 flex items-center justify-between">
                      <div className="flex items-center space-x-1">
                        <Zap className="w-3.5 h-3.5" />
                        <span>DTLN 深度净化</span>
                      </div>
                      <span className="text-[10px] bg-discord-green/20 text-discord-green px-1.5 py-0.2 rounded font-bold">
                        {abResult.dtlnUrl ? "可试听" : "不可用"}
                      </span>
                    </div>
                    <audio
                      src={abResult.dtlnUrl ?? undefined}
                      controls
                      className="w-full h-8 outline-none"
                    />
                    {abResult.dtlnError && (
                      <p className="text-[10px] text-red-300 break-words">
                        {abResult.dtlnError}
                      </p>
                    )}
                  </div>

                  {/* 4. DFNv3 旗舰全频降噪 */}
                  <div className="bg-[#1e1f22] p-3 rounded-lg border border-purple-500/40 ring-1 ring-purple-500/20">
                    <div className="text-xs font-bold text-purple-400 mb-1.5 flex items-center justify-between">
                      <div className="flex items-center space-x-1">
                        <Radio className="w-3.5 h-3.5" />
                        <span>DFNv3 旗舰全频</span>
                      </div>
                      <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded font-bold">
                        {abResult.dfn3Url ? "可试听" : "不可用"}
                      </span>
                    </div>
                    <audio
                      src={abResult.dfn3Url ?? undefined}
                      controls
                      className="w-full h-8 outline-none"
                    />
                    {abResult.dfn3Error && (
                      <p className="text-[10px] text-red-300 break-words">
                        {abResult.dfn3Error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center pt-1">
                  <span className="text-[11px] text-discord-green flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>仅比较试听结果；此录音不计算信噪比提升</span>
                  </span>
                  <button
                    type="button"
                    onClick={runABComparisonTest}
                    className="px-3 py-1.5 text-xs text-discord-textMuted hover:text-white rounded bg-[#2b2d31] hover:bg-[#35373c] transition flex items-center space-x-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>重新录制对比</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="bg-[#2b2d31] px-6 py-3.5 border-t border-[#383a40] flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg bg-discord-brand text-white text-sm font-semibold hover:bg-discord-brand-hover transition shadow-md"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
