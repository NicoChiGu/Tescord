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
} from "lucide-react";
import {
  DesktopSource,
  SCREEN_SHARE_PRESETS,
  ScreenSharePreset,
} from "@tescord/types";

interface ScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartShare: (
    sourceId: string | null,
    presetId: string,
    captureAudio: boolean,
  ) => void;
}

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({
  isOpen,
  onClose,
  onStartShare,
}) => {
  const [activeTab, setActiveTab] = useState<"screens" | "windows">("screens");
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>("1080p60");
  const [captureAudio, setCaptureAudio] = useState(true);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const isElectron = !!window.electronAPI?.getDesktopSources;

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

  if (!isOpen) return null;

  const screens = sources.filter((s) => s.type === "screen");
  const windows = sources.filter((s) => s.type === "window");
  const displaySources = activeTab === "screens" ? screens : windows;

  const handleGoLive = () => {
    onStartShare(selectedSourceId, selectedPreset, captureAudio);
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
              屏幕与应用直播分享 (LiveKit Simulcast)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-discord-textMuted hover:text-white rounded-lg transition"
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
                  <span>全屏幕 ({screens.length})</span>
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
                  <span>应用程序窗口 ({windows.length})</span>
                </button>
              </div>

              {/* 源卡片网格列表 */}
              {isLoadingSources ? (
                <div className="h-44 flex items-center justify-center text-discord-textMuted">
                  <div className="w-6 h-6 border-2 border-discord-brand border-t-transparent rounded-full animate-spin mr-2" />
                  <span>正在扫描本地显示屏与窗口...</span>
                </div>
              ) : displaySources.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-discord-textMuted text-sm">
                  暂未检测到活动的应用程序窗口
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
                  浏览器直连模式
                </div>
                点击“开始直播”后，浏览器将弹出系统原生的屏幕/窗口选择向导。在
                Tescord Electron 桌面端可获得更低延迟和游戏独占伴音混音体验。
              </div>
            </div>
          )}

          {/* 直播清晰度预设选择器 (Simulcast 支持) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-discord-textMuted uppercase flex items-center justify-between">
              <span>直播画质预设 (Simulcast 自适应码率)</span>
              <span className="text-discord-brand lowercase font-normal flex items-center space-x-1">
                <Layers className="w-3.5 h-3.5" />
                <span>三级动态码率广播</span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {Object.values(SCREEN_SHARE_PRESETS).map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset.id)}
                    className={`cursor-pointer p-3 rounded-xl border transition flex flex-col justify-between ${
                      isSelected
                        ? "bg-discord-brand/10 border-discord-brand text-white"
                        : "bg-[#2b2d31] border-[#383a40] text-discord-textMuted hover:border-[#474950] hover:text-white"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-xs text-white">
                        {preset.name}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/30 text-discord-brand">
                        {preset.bitrate / 1_000_000} Mbps
                      </span>
                    </div>
                    <div className="text-[11px] text-discord-textMuted">
                      {preset.description}
                    </div>
                  </div>
                );
              })}
            </div>
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
                  <span>分享系统伴音 / 游戏音频</span>
                  <span className="text-[10px] text-discord-green bg-discord-green/15 px-1.5 py-0.2 rounded font-normal">
                    立体声混音直通
                  </span>
                </div>
                <div className="text-[11px] text-discord-textMuted">
                  将电脑正在播放的游戏声音与麦克风声音在客户端混合广播
                </div>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
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
            <span>超低延迟 WebRTC 媒体引擎</span>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-discord-textMuted hover:text-white transition"
            >
              取消
            </button>
            <button
              onClick={handleGoLive}
              className="px-6 py-2 rounded-xl text-sm font-semibold bg-discord-brand hover:bg-discord-brand-hover text-white transition shadow-lg flex items-center space-x-1.5"
            >
              <Monitor className="w-4 h-4" />
              <span>开始直播</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
