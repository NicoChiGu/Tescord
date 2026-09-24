import React, { useState, useEffect } from "react";
import {
  X,
  Monitor,
  Layout,
  Volume2,
  VolumeX,
  Sparkles,
  Layers,
  Check,
  AlertCircle,
  Film,
  Zap,
  Gauge,
  Sliders,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Server,
  Share2,
  Radio,
} from "lucide-react";
import {
  DesktopSource,
  SCREEN_SHARE_PRESETS,
  ScreenSharePreset,
  ScreenShareResolution,
  ScreenShareFps,
  RESOLUTION_OPTIONS,
  FPS_OPTIONS,
  getMaxAllowed16x9Resolution,
  isResolutionAllowed,
  getRecommendedBitrate,
  VideoCodecType,
  CodecCapabilityInfo,
  MIN_CUSTOM_BITRATE,
  MAX_CUSTOM_BITRATE,
  StreamTransmissionMode,
} from "@tescord/types";
import { useTranslation } from "react-i18next";
import {
  detectSupportedVideoCodecs,
  detectSupportedVideoCodecsAsync,
} from "../../services/livekit.js";
import {
  NATDetector,
  NATDetectionResult,
} from "../../services/p2p/NATDetector.js";

interface ScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartShare: (
    sourceId: string | null,
    presetId: string,
    captureAudio: boolean,
    videoCodec?: VideoCodecType,
    customBitrate?: number,
    transmissionMode?: StreamTransmissionMode,
  ) => void;
}

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({
  isOpen,
  onClose,
  onStartShare,
}) => {
  const { t } = useTranslation(["modals", "common", "admin", "errors"]);
  const [activeTab, setActiveTab] = useState<"screens" | "windows">("screens");
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] =
    useState<ScreenShareResolution>("1080p");
  const [selectedFps, setSelectedFps] = useState<ScreenShareFps>(60);
  const [captureAudio, setCaptureAudio] = useState(true);
  const isElectron = !!window.electronAPI?.getDesktopSources;
  const [isLoadingSources, setIsLoadingSources] = useState(isElectron);

  // 视频编码器与自定义码率状态
  const [supportedCodecs, setSupportedCodecs] = useState<CodecCapabilityInfo[]>(
    () => detectSupportedVideoCodecs(),
  );
  const [selectedCodec, setSelectedCodec] = useState<VideoCodecType | "auto">(
    "auto",
  );
  const [customBitrate, setCustomBitrate] = useState<number | null>(null);
  const [isAdvancedBitrateOpen, setIsAdvancedBitrateOpen] = useState(false);
  const [transmissionMode, setTransmissionMode] =
    useState<StreamTransmissionMode>("sfu");
  const [natInfo, setNatInfo] = useState<NATDetectionResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      NATDetector.detect().then((res) => setNatInfo(res));
      detectSupportedVideoCodecsAsync().then((codecs) => {
        setSupportedCodecs(codecs);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (isElectron) {
      setIsLoadingSources(true);
      window.electronAPI
        ?.getDesktopSources()
        .then((items) => {
          setSources(items);
          if (items.length > 0) {
            const screens = items.filter((s) => s.type === "screen");
            if (screens.length > 0) {
              setSelectedSourceId(screens[0].id);
            } else {
              setSelectedSourceId(items[0].id);
            }
          }
        })
        .catch((err) => {
          console.warn("Failed to get desktop sources:", err);
        })
        .finally(() => {
          setIsLoadingSources(false);
        });
    }
  }, [isOpen, isElectron]);

  const screens = sources.filter((s) => s.type === "screen");
  const windows = sources.filter((s) => s.type === "window");
  const displaySources = activeTab === "screens" ? screens : windows;
  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  // 根据当前选中的屏幕源物理尺寸 (或当前浏览器屏幕) 计算最大可用 16:9 标准分辨率
  const maxAllowedResolution = React.useMemo<ScreenShareResolution>(() => {
    let screenW = 1920;
    let screenH = 1080;

    if (selectedSource?.displayDimensions) {
      screenW = selectedSource.displayDimensions.width;
      screenH = selectedSource.displayDimensions.height;
    } else if (isElectron && sources.length > 0) {
      const firstScreen =
        sources.find((s) => s.type === "screen") || sources[0];
      if (firstScreen?.displayDimensions) {
        screenW = firstScreen.displayDimensions.width;
        screenH = firstScreen.displayDimensions.height;
      }
    } else if (typeof window !== "undefined" && window.screen) {
      const dpr = window.devicePixelRatio || 1;
      screenW = Math.round((window.screen.width || 1920) * dpr);
      screenH = Math.round((window.screen.height || 1080) * dpr);
    }

    return getMaxAllowed16x9Resolution(screenW, screenH);
  }, [selectedSource, sources, isElectron]);

  // 当屏幕源切换导致最大允许分辨率降低时，自动安全回退至当前屏幕允许的最大档位
  useEffect(() => {
    if (isElectron && (!selectedSourceId || isLoadingSources)) return;
    if (!isResolutionAllowed(selectedResolution, maxAllowedResolution)) {
      setSelectedResolution(maxAllowedResolution);
    }
  }, [
    maxAllowedResolution,
    selectedResolution,
    isElectron,
    selectedSourceId,
    isLoadingSources,
  ]);

  // 计算当前组合下的推荐码率与预设信息
  const recommendedBitrate = getRecommendedBitrate(
    selectedResolution,
    selectedFps,
  );
  const targetPresetId = `${selectedResolution}${selectedFps}`;
  const currentPresetInfo: ScreenSharePreset =
    SCREEN_SHARE_PRESETS[targetPresetId] || SCREEN_SHARE_PRESETS["1080p60"];

  if (!isOpen) return null;

  const handleGoLive = () => {
    const codecParam = selectedCodec === "auto" ? undefined : selectedCodec;
    onStartShare(
      selectedSourceId,
      targetPresetId,
      captureAudio,
      codecParam,
      customBitrate || undefined,
      transmissionMode,
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-[#313338] w-full max-w-2xl rounded-2xl border border-[#3f4147] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* 头部标题与关闭 */}
        <div className="px-6 py-4 border-b border-[#2b2d31] flex items-center justify-between bg-[#2b2d31]/70">
          <div className="flex items-center space-x-2">
            <Monitor className="w-5 h-5 text-discord-brand" />
            <h3 className="font-bold text-lg text-discord-textHeader">
              {t("modals:screenShare.title")}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-discord-textMuted hover:text-white rounded-lg transition"
            title={t("common:close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容主体 */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
          {/* Electron 独占：窗口与屏幕源切换选择器 */}
          {isElectron ? (
            <div className="space-y-3">
              <div className="flex space-x-2 border-b border-[#383a40] pb-2">
                <button
                  onClick={() => {
                    setActiveTab("screens");
                    if (screens.length > 0) setSelectedSourceId(screens[0].id);
                  }}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold text-sm transition ${
                    activeTab === "screens"
                      ? "bg-discord-brand text-white"
                      : "text-discord-textMuted hover:bg-[#2b2d31] hover:text-white"
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                  <span>
                    {t("modals:screenShare.tabsScreen")} ({screens.length})
                  </span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab("windows");
                    if (windows.length > 0) setSelectedSourceId(windows[0].id);
                  }}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold text-sm transition ${
                    activeTab === "windows"
                      ? "bg-discord-brand text-white"
                      : "text-discord-textMuted hover:bg-[#2b2d31] hover:text-white"
                  }`}
                >
                  <Layout className="w-4 h-4" />
                  <span>
                    {t("modals:screenShare.tabsWindow")} ({windows.length})
                  </span>
                </button>
              </div>

              {/* 源卡片网格列表 */}
              {isLoadingSources ? (
                <div className="h-44 flex items-center justify-center text-discord-textMuted">
                  <div className="w-6 h-6 border-2 border-discord-brand border-t-transparent rounded-full animate-spin mr-2" />
                  <span>{t("modals:screenShare.scanningSources")}</span>
                </div>
              ) : displaySources.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-discord-textMuted text-sm">
                  {t("modals:screenShare.noWindowsDetected")}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto custom-scrollbar p-1">
                  {displaySources.map((source) => {
                    const isSelected = selectedSourceId === source.id;
                    return (
                      <div
                        key={source.id}
                        onClick={() => setSelectedSourceId(source.id)}
                        className={`group cursor-pointer rounded-xl border-2 p-2 bg-[#2b2d31] transition relative flex flex-col ${
                          isSelected
                            ? "border-discord-brand ring-2 ring-discord-brand/30"
                            : "border-transparent hover:border-[#3f4147]"
                        }`}
                      >
                        <div className="relative w-full h-24 bg-black/40 rounded-lg overflow-hidden flex items-center justify-center mb-2">
                          <img
                            src={source.thumbnail}
                            alt={source.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition"
                          />
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 bg-discord-brand text-white p-1 rounded-full shadow">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-discord-textHeader truncate flex items-center space-x-1">
                          {source.appIcon && (
                            <img
                              src={source.appIcon}
                              alt="icon"
                              className="w-3.5 h-3.5 rounded flex-shrink-0"
                            />
                          )}
                          <span className="truncate">{source.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] flex items-start space-x-3 text-xs text-discord-textMuted">
              <AlertCircle className="w-5 h-5 text-discord-brand flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-white mb-1">
                  {t("modals:screenShare.browserDirectMode")}
                </div>
                {t("modals:screenShare.browserDirectDesc")}
              </div>
            </div>
          )}

          {/* 直播清晰度预设选择器 (Discord 风格矩阵解耦 + 16:9 物理尺寸硬禁用) */}
          <div className="space-y-3.5 bg-[#2b2d31] p-4 rounded-xl border border-[#383a40]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-discord-textMuted uppercase flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-discord-brand" />
                <span>{t("modals:screenShare.qualityTitle")}</span>
              </label>
              <span className="text-[11px] text-discord-brand bg-discord-brand/10 px-2 py-0.5 rounded font-mono font-medium border border-discord-brand/20">
                {t("modals:screenShare.maxSupported", {
                  res: maxAllowedResolution.toUpperCase(),
                })}
              </span>
            </div>

            {/* 1. 分辨率选择栏 (480p / 720p / 1080p / 1440p / 4k) */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-discord-textMuted flex items-center justify-between">
                <span>{t("modals:screenShare.resolution")}</span>
                <span className="text-[10px] text-gray-400">
                  {currentPresetInfo.width} × {currentPresetInfo.height} (16:9)
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {RESOLUTION_OPTIONS.map((opt) => {
                  const isSelected = selectedResolution === opt.id;
                  const isAllowed = isResolutionAllowed(
                    opt.id,
                    maxAllowedResolution,
                  );
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`resolution-btn-${opt.id}`}
                      disabled={!isAllowed}
                      onClick={() => setSelectedResolution(opt.id)}
                      title={
                        isAllowed
                          ? `${opt.label} - ${opt.width}x${opt.height}\n${opt.description}`
                          : `${t("modals:screenShare.exceedsScreen")} (${maxAllowedResolution.toUpperCase()})`
                      }
                      className={`py-2 px-1 rounded-lg border text-center transition flex flex-col items-center justify-center relative ${
                        isSelected
                          ? "bg-discord-brand text-white border-discord-brand shadow-sm font-semibold cursor-pointer"
                          : isAllowed
                            ? "bg-[#1e1f22] border-[#383a40] text-discord-textMuted hover:border-[#474950] hover:text-white cursor-pointer"
                            : "bg-[#1e1f22]/40 border-white/5 text-gray-600 cursor-not-allowed opacity-40"
                      }`}
                    >
                      <span className="text-xs font-medium">
                        {opt.id.toUpperCase()}
                      </span>
                      <span className="text-[9px] opacity-75">
                        {!isAllowed
                          ? t("modals:screenShare.exceedsScreen")
                          : `${opt.height}P`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. 帧率选择栏 (15fps / 30fps / 60fps) */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-discord-textMuted flex items-center justify-between">
                <span>{t("modals:screenShare.frameRate")}</span>
                <span className="text-[10px] text-gray-400">
                  {t("modals:screenShare.recommendedBitrate", {
                    mbps: (recommendedBitrate / 1_000_000).toFixed(1),
                  })}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {FPS_OPTIONS.map((fps) => {
                  const isSelected = selectedFps === fps;
                  return (
                    <button
                      key={fps}
                      type="button"
                      data-testid={`fps-btn-${fps}`}
                      onClick={() => setSelectedFps(fps)}
                      className={`py-1.5 px-3 rounded-lg border text-center transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        isSelected
                          ? "bg-discord-brand text-white border-discord-brand shadow-sm font-semibold"
                          : "bg-[#1e1f22] border-[#383a40] text-discord-textMuted hover:border-[#474950] hover:text-white"
                      }`}
                    >
                      <Zap
                        className={`w-3 h-3 ${isSelected ? "text-white" : "text-discord-brand"}`}
                      />
                      <span className="text-xs font-medium">{fps} FPS</span>
                      {fps === 60 && (
                        <span className="text-[9px] bg-discord-brand-hover px-1 py-0.2 rounded text-white font-normal">
                          {t("modals:screenShare.highFps")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 直播编码格式选择器 (H.264 / AV1 / VP9 / VP8 / HEVC) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-discord-textMuted uppercase flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-discord-brand" />
                <span>{t("modals:screenShare.codecTitle")}</span>
              </label>
              <button
                type="button"
                data-testid="toggle-custom-bitrate-btn"
                onClick={() => setIsAdvancedBitrateOpen(!isAdvancedBitrateOpen)}
                className="text-xs text-discord-brand hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Sliders className="w-3 h-3" />
                <span>
                  {isAdvancedBitrateOpen
                    ? t("modals:screenShare.collapseBitrate")
                    : t("modals:screenShare.customBitrate")}
                </span>
                {isAdvancedBitrateOpen ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>

            {/* 编码器选项按钮组 */}
            <div className="grid grid-cols-6 gap-1.5">
              {/* 自动 / 跟随全局 */}
              <button
                type="button"
                data-testid="modal-codec-auto"
                onClick={() => setSelectedCodec("auto")}
                className={`px-2 py-2 rounded-lg border text-center transition flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  selectedCodec === "auto"
                    ? "bg-discord-brand text-white border-discord-brand shadow-sm font-semibold"
                    : "bg-[#2b2d31] border-[#383a40] text-discord-textMuted hover:border-[#474950] hover:text-white"
                }`}
              >
                <span className="text-xs font-medium">
                  {t("modals:screenShare.autoCodec")}
                </span>
                <span className="text-[9px] opacity-80">
                  {t("modals:screenShare.followPreference")}
                </span>
              </button>

              {supportedCodecs.map((item) => {
                const isSelected = selectedCodec === item.codec;
                const isAvailable = item.supported;
                return (
                  <button
                    key={item.codec}
                    type="button"
                    data-testid={`modal-codec-${item.codec}`}
                    disabled={!isAvailable}
                    onClick={() => setSelectedCodec(item.codec)}
                    className={`px-2 py-2 rounded-lg border text-center transition flex flex-col items-center justify-center gap-0.5 relative ${
                      isSelected
                        ? "bg-discord-brand text-white border-discord-brand shadow-sm font-semibold cursor-pointer"
                        : isAvailable
                          ? "bg-[#2b2d31] border-[#383a40] text-discord-textMuted hover:border-[#474950] hover:text-white cursor-pointer"
                          : "bg-[#2b2d31]/40 border-white/5 text-gray-600 cursor-not-allowed opacity-50"
                    }`}
                  >
                    <span className="text-xs uppercase font-mono font-medium">
                      {item.codec}
                    </span>
                    <span className="text-[9px] opacity-80 truncate max-w-[65px]">
                      {item.isHardwareAccelerated
                        ? t("modals:screenShare.hwAccelerated")
                        : isAvailable
                          ? t("modals:screenShare.available")
                          : t("modals:screenShare.unsupported")}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 高级自定义码率折叠面板 */}
            {isAdvancedBitrateOpen && (
              <div className="bg-[#2b2d31] p-3 rounded-xl border border-[#383a40] space-y-2 animate-fadeIn">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-discord-textMuted flex items-center gap-1.5 font-medium">
                    <Gauge className="w-3.5 h-3.5 text-discord-brand" />
                    <span>{t("modals:screenShare.targetBitrate")}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid="modal-custom-bitrate-label"
                      className="font-mono text-xs font-bold text-discord-brand bg-discord-brand/10 px-2 py-0.5 rounded border border-discord-brand/20"
                    >
                      {customBitrate
                        ? `${Math.round(customBitrate / 1000)} kbps`
                        : `${Math.round(recommendedBitrate / 1000)} kbps`}
                    </span>
                    {customBitrate && (
                      <button
                        type="button"
                        onClick={() => setCustomBitrate(null)}
                        className="text-[11px] text-gray-400 hover:text-white flex items-center gap-0.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t("modals:screenShare.resetRecommended")}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-500 font-mono">
                    500k
                  </span>
                  <input
                    type="range"
                    data-testid="modal-custom-bitrate-slider"
                    min={MIN_CUSTOM_BITRATE}
                    max={MAX_CUSTOM_BITRATE}
                    step={250_000}
                    value={customBitrate || recommendedBitrate}
                    onChange={(e) => setCustomBitrate(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                  />
                  <span className="text-[10px] text-gray-500 font-mono">
                    25000k
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 传输分发模式（服务器 SFU / P2P 直连打洞） */}
          <div className="bg-[#2b2d31] p-3.5 rounded-xl border border-[#383a40] space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                <Radio className="w-4 h-4 text-discord-brand" />
                <span>{t("modals:screenShare.transmissionMode")}</span>
              </div>
              {natInfo && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-gray-400">
                    {t("modals:screenShare.localNetwork")}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono ${
                      natInfo.hasIPv6 || natInfo.natType === "FullCone"
                        ? "text-discord-green bg-discord-green/15 border border-discord-green/30"
                        : "text-amber-400 bg-amber-500/15 border border-amber-500/30"
                    }`}
                  >
                    {natInfo.hasIPv6
                      ? "IPv6 Direct (Fast)"
                      : `${natInfo.natType}`}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                data-testid="mode-sfu-btn"
                onClick={() => setTransmissionMode("sfu")}
                className={`p-3 rounded-lg border text-left transition-all ${
                  transmissionMode === "sfu"
                    ? "bg-discord-brand/15 border-discord-brand text-white shadow-sm"
                    : "bg-[#1e1f22] border-transparent text-gray-400 hover:bg-[#232428] hover:text-gray-300"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-discord-brand" />
                    <span>{t("modals:screenShare.sfuModeTitle")}</span>
                  </div>
                  <span className="text-[10px] bg-discord-brand/20 text-discord-brand px-1.5 py-0.2 rounded">
                    {t("modals:screenShare.recommendedBadge")}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1 leading-snug">
                  {t("modals:screenShare.sfuModeDesc")}
                </div>
              </button>

              <button
                type="button"
                data-testid="mode-p2p-btn"
                onClick={() => {
                  if (transmissionMode === "sfu") {
                    setTransmissionMode("p2p_direct");
                  }
                }}
                className={`p-3 rounded-lg border text-left transition-all ${
                  transmissionMode !== "sfu"
                    ? "bg-emerald-500/15 border-emerald-500 text-white shadow-sm"
                    : "bg-[#1e1f22] border-transparent text-gray-400 hover:bg-[#232428] hover:text-gray-300"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t("modals:screenShare.p2pModeTitle")}</span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.2 rounded">
                    {t("modals:screenShare.zeroServerTraffic")}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1 leading-snug">
                  {t("modals:screenShare.p2pModeDesc")}
                </div>
              </button>
            </div>

            {/* P2P 拓扑子选项 */}
            {transmissionMode !== "sfu" && (
              <div className="flex items-center gap-4 pt-1 border-t border-[#383a40]/60 text-xs">
                <span className="text-[11px] text-gray-400 font-medium">
                  {t("modals:screenShare.p2pStrategy")}
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="radio"
                    name="p2p_submode"
                    data-testid="p2p-submode-direct"
                    checked={transmissionMode === "p2p_direct"}
                    onChange={() => setTransmissionMode("p2p_direct")}
                    className="accent-emerald-400"
                  />
                  <span>{t("modals:screenShare.p2pMesh")}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="radio"
                    name="p2p_submode"
                    data-testid="p2p-submode-relay"
                    checked={transmissionMode === "p2p_relay"}
                    onChange={() => setTransmissionMode("p2p_relay")}
                    className="accent-emerald-400"
                  />
                  <span>{t("modals:screenShare.p2pTree")}</span>
                </label>
              </div>
            )}
          </div>

          {/* 系统伴音与混音设置 */}
          <div className="bg-[#2b2d31] p-3.5 rounded-xl border border-[#383a40] flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {captureAudio ? (
                <Volume2 className="w-5 h-5 text-discord-green" />
              ) : (
                <VolumeX className="w-5 h-5 text-discord-textMuted" />
              )}
              <div>
                <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <span>{t("modals:screenShare.shareAudioTitle")}</span>
                  <span className="text-[10px] text-discord-green bg-discord-green/15 px-1.5 py-0.2 rounded font-normal">
                    {t("modals:screenShare.stereoPassthrough")}
                  </span>
                </div>
                <div className="text-[11px] text-discord-textMuted">
                  {t("modals:screenShare.audioMixDesc")}
                </div>
                {!isElectron && (
                  <div className="text-[10px] text-amber-400/90 mt-1 flex items-center gap-1">
                    <span>{t("modals:screenShare.browserAudioTip")}</span>
                  </div>
                )}
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                data-testid="screen-share-audio-checkbox"
                checked={captureAudio}
                onChange={(e) => setCaptureAudio(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#1e1f22] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-discord-brand"></div>
            </label>
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="px-6 py-4 border-t border-[#2b2d31] flex justify-between items-center bg-[#2b2d31]/50">
          <div className="text-xs text-discord-textMuted flex items-center space-x-1">
            <Sparkles className="w-3.5 h-3.5 text-discord-brand" />
            <span>{t("modals:screenShare.webrtcEngine")}</span>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-discord-textMuted hover:text-white transition"
            >
              {t("common:cancel")}
            </button>
            <button
              data-testid="start-screen-share-confirm-btn"
              onClick={handleGoLive}
              className="px-6 py-2 rounded-xl text-sm font-semibold bg-discord-brand hover:bg-discord-brand-hover text-white transition shadow-lg flex items-center space-x-1.5"
            >
              <Monitor className="w-4 h-4" />
              <span>{t("modals:screenShare.startShare")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
