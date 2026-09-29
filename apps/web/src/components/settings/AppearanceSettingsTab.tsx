import React from "react";
import { useTranslation } from "react-i18next";
import {
  Monitor,
  Check,
  RotateCcw,
  Keyboard,
  Eye,
  Type,
  Maximize2,
} from "lucide-react";
import {
  useSettingsStore,
  applyChatFontSize,
  applyZoomFactor,
} from "../../stores/useSettingsStore.js";
import { MessageDisplayMode } from "@tescord/types";

const FONT_SIZE_PRESETS = [12, 14, 15, 16, 18, 20];
const ZOOM_PRESETS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5];

export const AppearanceSettingsTab: React.FC = () => {
  const { t } = useTranslation(["settings", "common"]);

  const chatFontSize = useSettingsStore((s) => s.chatFontSize) ?? 16;
  const messageDisplayMode =
    useSettingsStore((s) => s.messageDisplayMode) ?? "cozy";
  const zoomFactor = useSettingsStore((s) => s.zoomFactor) ?? 1.0;

  const setChatFontSize = useSettingsStore((s) => s.setChatFontSize);
  const setMessageDisplayMode = useSettingsStore(
    (s) => s.setMessageDisplayMode,
  );
  const setZoomFactor = useSettingsStore((s) => s.setZoomFactor);

  const handleDisplayModeSelect = (mode: MessageDisplayMode) => {
    setMessageDisplayMode(mode);
  };

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const size = parseInt(e.target.value, 10);
    if (!Number.isNaN(size)) {
      setChatFontSize(size);
    }
  };

  const handleResetFontSize = () => {
    setChatFontSize(16);
  };

  const handleResetZoom = () => {
    setZoomFactor(1.0);
  };

  return (
    <div
      className="space-y-8 max-w-4xl pb-10"
      data-testid="appearance-settings-tab"
    >
      {/* 头部标题与描述 */}
      <div className="border-b border-white/5 pb-5">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Monitor className="w-6 h-6 text-[#5865f2]" />
          <span>{t("settings:appearance.title", "外观与排版设置")}</span>
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          {t(
            "settings:appearance.description",
            "自定义聊天展示模式、字体大小与全界面视口缩放比例。",
          )}
        </p>
      </div>

      {/* 实时效果预览卡片 (Live Preview Card) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-[#5865f2]" />
            <span>{t("settings:appearance.previewTitle", "实时效果预览")}</span>
          </label>
          <span className="text-[11px] font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">
            {chatFontSize}px •{" "}
            {messageDisplayMode === "compact" ? "Compact" : "Cozy"}
          </span>
        </div>

        <div className="bg-[#1e1f22] border border-[#2b2d31] rounded-2xl p-4 sm:p-5 shadow-inner transition-all select-none">
          {messageDisplayMode === "cozy" ? (
            /* Cozy 模式预览：头像 + 多行排版 */
            <div className="flex items-start space-x-3.5">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#5865f2] to-indigo-400 flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0 mt-0.5">
                🤖
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white text-sm">
                    {t("settings:appearance.previewBot", "系统小助手")}
                  </span>
                  <span className="text-[10px] bg-[#5865f2] text-white px-1 py-0.2 rounded font-bold uppercase tracking-wider">
                    {t("settings:appearance.previewBotTag", "BOT")}
                  </span>
                  <span className="text-[11px] text-discord-textMuted">
                    12:30
                  </span>
                </div>
                <div
                  className="mt-1 text-discord-textNormal break-words transition-all"
                  style={{
                    fontSize: `${chatFontSize}px`,
                    lineHeight: `${((chatFontSize * 1.375) / 16).toFixed(3)}rem`,
                  }}
                >
                  <p>
                    {t(
                      "settings:appearance.previewMessage",
                      "欢迎使用 Tescord！这是为您实时呈现的排版与字号预览效果。",
                    )}
                    <span className="inline-block px-1.5 py-0.5 rounded bg-[#5865f2]/20 text-[#5865f2] font-medium text-[0.875em] mx-1">
                      {t("settings:appearance.previewMention", "@everyone")}
                    </span>
                  </p>
                  <div className="mt-2 bg-[#2b2d31] p-2.5 rounded-lg border border-[#383a40] font-mono text-[0.85em] text-emerald-400">
                    {t(
                      "settings:appearance.previewCode",
                      "const tescord = { privacy: 'first', webrtc: 'mesh/sfu' };",
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Compact 模式预览：单行流式排版 */
            <div className="flex flex-col ml-0.5">
              <div className="flex items-baseline space-x-2 overflow-hidden">
                <span className="text-[11px] text-discord-textMuted select-none shrink-0 font-mono">
                  [12:30]
                </span>
                <span className="font-semibold text-white text-sm shrink-0">
                  {t("settings:appearance.previewBot", "系统小助手")}
                </span>
                <span className="text-[10px] bg-[#5865f2] text-white px-1 py-0.2 rounded font-bold uppercase tracking-wider shrink-0">
                  {t("settings:appearance.previewBotTag", "BOT")}
                </span>
                <span className="text-discord-textMuted select-none mr-0.5 shrink-0">
                  :
                </span>
                <div
                  className="text-discord-textNormal transition-all flex-1 min-w-0"
                  style={{
                    fontSize: `${chatFontSize}px`,
                    lineHeight: `${((chatFontSize * 1.375) / 16).toFixed(3)}rem`,
                  }}
                >
                  <span>
                    {t(
                      "settings:appearance.previewMessage",
                      "欢迎使用 Tescord！这是为您实时呈现的排版与字号预览效果。",
                    )}
                  </span>
                  <span className="inline-block px-1 py-0.2 rounded bg-[#5865f2]/20 text-[#5865f2] font-medium text-[0.875em] mx-1">
                    {t("settings:appearance.previewMention", "@everyone")}
                  </span>
                </div>
              </div>
              <div
                className="mt-1.5 ml-14 bg-[#2b2d31] p-2 rounded-lg border border-[#383a40] font-mono text-[0.85em] text-emerald-400"
                style={{
                  fontSize: `${chatFontSize}px`,
                }}
              >
                {t(
                  "settings:appearance.previewCode",
                  "const tescord = { privacy: 'first', webrtc: 'mesh/sfu' };",
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 消息展示模式 (Message Display Mode) */}
      <div className="space-y-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-400">
          {t("settings:appearance.displayMode", "消息展示模式")}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Cozy 舒适模式 */}
          <button
            type="button"
            data-testid="mode-cozy-btn"
            onClick={() => handleDisplayModeSelect("cozy")}
            className={`relative flex flex-col p-4 rounded-xl border text-left transition-all group ${
              messageDisplayMode === "cozy"
                ? "bg-[#5865f2]/10 border-[#5865f2] ring-1 ring-[#5865f2]"
                : "bg-[#2b2d31] border-white/5 hover:bg-white/5 hover:border-white/10"
            }`}
          >
            <div className="flex items-center justify-between w-full mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                    messageDisplayMode === "cozy"
                      ? "border-[#5865f2] bg-[#5865f2]"
                      : "border-gray-500 bg-transparent"
                  }`}
                >
                  {messageDisplayMode === "cozy" && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
                <span className="text-sm font-bold text-white">
                  {t("settings:appearance.modeCozy", "普通模式 (Cozy)")}
                </span>
              </div>
              {messageDisplayMode === "cozy" && (
                <span className="text-[10px] font-medium bg-[#5865f2]/20 text-[#5865f2] px-2 py-0.5 rounded-full">
                  {t("settings:appearance.defaultBadge", "默认")}
                </span>
              )}
            </div>

            {/* 图元示意 */}
            <div className="w-full bg-[#1e1f22] p-2.5 rounded-lg border border-white/5 flex items-center gap-2 mb-2 select-none">
              <div className="w-6 h-6 rounded-full bg-[#5865f2]/40 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="w-16 h-2 bg-gray-500/40 rounded" />
                <div className="w-32 h-2 bg-gray-600/30 rounded" />
              </div>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed mt-1">
              {t(
                "settings:appearance.modeCozyDesc",
                "展示完整头像与独立标题行，舒适宽松，适合日常沟通与阅读。",
              )}
            </p>
          </button>

          {/* Compact 紧凑模式 */}
          <button
            type="button"
            data-testid="mode-compact-btn"
            onClick={() => handleDisplayModeSelect("compact")}
            className={`relative flex flex-col p-4 rounded-xl border text-left transition-all group ${
              messageDisplayMode === "compact"
                ? "bg-[#5865f2]/10 border-[#5865f2] ring-1 ring-[#5865f2]"
                : "bg-[#2b2d31] border-white/5 hover:bg-white/5 hover:border-white/10"
            }`}
          >
            <div className="flex items-center justify-between w-full mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                    messageDisplayMode === "compact"
                      ? "border-[#5865f2] bg-[#5865f2]"
                      : "border-gray-500 bg-transparent"
                  }`}
                >
                  {messageDisplayMode === "compact" && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
                <span className="text-sm font-bold text-white">
                  {t("settings:appearance.modeCompact", "紧凑模式 (Compact)")}
                </span>
              </div>
            </div>

            {/* 图元示意 */}
            <div className="w-full bg-[#1e1f22] p-2.5 rounded-lg border border-white/5 flex items-center gap-2 mb-2 select-none">
              <div className="w-8 h-2 bg-gray-600/40 rounded shrink-0" />
              <div className="w-12 h-2 bg-gray-500/40 rounded shrink-0" />
              <div className="flex-1 h-2 bg-gray-600/30 rounded" />
            </div>

            <p className="text-xs text-gray-400 leading-relaxed mt-1">
              {t(
                "settings:appearance.modeCompactDesc",
                "隐藏大头像并单行紧凑排列，最大化同屏消息数量与信息密度。",
              )}
            </p>
          </button>
        </div>
      </div>

      {/* 聊天字体大小 (Chat Font Scaling) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <Type className="w-4 h-4 text-[#5865f2]" />
            <span>{t("settings:appearance.chatFontSize", "聊天字体大小")}</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white bg-[#5865f2]/20 text-[#5865f2] px-2 py-0.5 rounded-md font-mono">
              {t("settings:appearance.fontSizePx", {
                size: chatFontSize,
                defaultValue: `${chatFontSize} 像素`,
              })}
            </span>
            {chatFontSize !== 16 && (
              <button
                type="button"
                data-testid="reset-font-size-btn"
                onClick={handleResetFontSize}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-white/5"
                title={t(
                  "settings:appearance.resetToDefault",
                  "恢复默认 (16px)",
                )}
              >
                <RotateCcw className="w-3 h-3" />
                <span>
                  {t("settings:appearance.resetToDefault", "恢复默认 (16px)")}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* 滑块与刻度指示 */}
        <div className="bg-[#2b2d31] p-4 sm:p-5 rounded-xl border border-white/5 space-y-4">
          <div className="relative">
            <input
              type="range"
              min={12}
              max={20}
              step={1}
              value={chatFontSize}
              onChange={handleFontSizeChange}
              data-testid="chat-font-size-slider"
              className="w-full h-2 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-[#5865f2]"
            />
          </div>

          {/* 预设刻度按钮 */}
          <div className="flex justify-between items-center px-1">
            {FONT_SIZE_PRESETS.map((size) => {
              const isCurrent = chatFontSize === size;
              const isDefault = size === 16;
              return (
                <button
                  key={size}
                  type="button"
                  data-testid={`preset-font-${size}`}
                  onClick={() => setChatFontSize(size)}
                  className={`flex flex-col items-center gap-1 group py-1 px-1.5 rounded transition ${
                    isCurrent
                      ? "text-[#5865f2] font-bold"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  <span className="text-xs font-mono">{size}px</span>
                  {isDefault && (
                    <span
                      className={`text-[9px] px-1 rounded uppercase tracking-wider font-semibold ${
                        isCurrent
                          ? "bg-[#5865f2] text-white"
                          : "bg-white/10 text-gray-400 group-hover:text-white"
                      }`}
                    >
                      {t("settings:appearance.defaultBadge", "默认")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 界面视口缩放比例 (Zoom Level) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <Maximize2 className="w-4 h-4 text-[#5865f2]" />
              <span>
                {t("settings:appearance.zoomLevel", "客户端界面缩放")}
              </span>
            </label>
            <p className="text-[11px] text-gray-400">
              {t(
                "settings:appearance.zoomDesc",
                "等比缩放整个应用界面。该配置仅保存在本机设备上，不跨设备同步。",
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white bg-[#5865f2]/20 text-[#5865f2] px-2 py-0.5 rounded-md font-mono">
              {Math.round(zoomFactor * 100)}%
            </span>
            {zoomFactor !== 1.0 && (
              <button
                type="button"
                data-testid="reset-zoom-btn"
                onClick={handleResetZoom}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-white/5"
                title={t("settings:appearance.resetZoom", "重置缩放 (100%)")}
              >
                <RotateCcw className="w-3 h-3" />
                <span>
                  {t("settings:appearance.resetZoom", "重置缩放 (100%)")}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* 缩放预设网格 */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {ZOOM_PRESETS.map((factor) => {
            const isSelected = Math.abs(zoomFactor - factor) < 0.01;
            const isDefault = factor === 1.0;
            return (
              <button
                key={factor}
                type="button"
                data-testid={`zoom-option-${Math.round(factor * 100)}`}
                onClick={() => setZoomFactor(factor)}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  isSelected
                    ? "bg-[#5865f2] text-white border-[#5865f2] shadow-md shadow-[#5865f2]/30 font-bold"
                    : "bg-[#2b2d31] border-white/5 text-gray-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="text-sm font-mono font-semibold">
                  {Math.round(factor * 100)}%
                </span>
                {isDefault && (
                  <span
                    className={`text-[9px] mt-0.5 px-1 rounded uppercase font-semibold ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "text-gray-400 group-hover:text-white"
                    }`}
                  >
                    {t("settings:appearance.defaultBadge", "默认")}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 快捷键提示条 */}
        <div className="bg-[#1e1f22]/70 border border-white/5 rounded-xl p-3 flex items-center gap-2.5 text-xs text-gray-400">
          <Keyboard className="w-4 h-4 text-[#5865f2] shrink-0" />
          <span>
            {t(
              "settings:appearance.shortcutHint",
              "快捷键提示：可随时按 Ctrl + / Ctrl - 放大缩小，Ctrl 0 快速重置",
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
