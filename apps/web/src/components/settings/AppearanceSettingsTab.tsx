import React from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Check, RotateCcw, Eye, Type } from "lucide-react";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { MessageDisplayMode } from "@tescord/types";

const FONT_SIZE_PRESETS = [13, 14, 15, 16, 18, 20];

export const AppearanceSettingsTab: React.FC = () => {
  const { t } = useTranslation(["settings", "common"]);

  const chatFontSize = useSettingsStore((s) => s.chatFontSize) ?? 16;
  const messageDisplayMode =
    useSettingsStore((s) => s.messageDisplayMode) ?? "cozy";

  const setChatFontSize = useSettingsStore((s) => s.setChatFontSize);
  const setMessageDisplayMode = useSettingsStore(
    (s) => s.setMessageDisplayMode,
  );

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
            "自定义消息展示模式与全站全局文字大小。",
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
                <span className="text-[9px] bg-[#5865f2] text-white px-1 py-0.2 rounded font-bold uppercase tracking-wider shrink-0">
                  {t("settings:appearance.previewBotTag", "BOT")}
                </span>
                <span
                  className="text-discord-textNormal truncate transition-all flex-1"
                  style={{ fontSize: `${chatFontSize}px` }}
                >
                  {t(
                    "settings:appearance.previewMessageCompact",
                    "这是紧凑排列下的单行消息展示效果，适合快速浏览高密度沟通记录。",
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 消息展示模式选择 (Message Display Mode) */}
      <div className="space-y-4">
        <label className="text-xs font-bold uppercase tracking-wider text-gray-400">
          {t("settings:appearance.displayMode", "消息展示模式")}
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  {t("settings:appearance.modeCozy", "舒适模式 (Cozy)")}
                </span>
              </div>
            </div>

            {/* 图元示意 */}
            <div className="w-full bg-[#1e1f22] p-2.5 rounded-lg border border-white/5 flex items-center gap-2.5 mb-2 select-none">
              <div className="w-6 h-6 rounded-full bg-gray-600/40 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="w-16 h-2 bg-gray-500/40 rounded" />
                <div className="w-full h-2 bg-gray-600/30 rounded" />
              </div>
            </div>

            <p className="text-xs text-gray-400 leading-relaxed mt-1">
              {t(
                "settings:appearance.modeCozyDesc",
                "现代经典布局，展示用户完整头像与多行间距，适合日常沉浸式交流。",
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

      {/* 全局文字大小 (Global Font Size) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <Type className="w-4 h-4 text-[#5865f2]" />
              <span>{t("settings:globalFontSize", "全局文字大小")}</span>
            </label>
            <p className="text-[11px] text-gray-400">
              {t(
                "settings:globalFontSizeDesc",
                "按比例动态缩放全软件文字与界面排版大小（基准 13px - 20px）",
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white bg-[#5865f2]/20 text-[#5865f2] px-2 py-0.5 rounded-md font-mono">
              {chatFontSize}px
            </span>
            {chatFontSize !== 16 && (
              <button
                type="button"
                data-testid="reset-font-size-btn"
                onClick={handleResetFontSize}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-white/5"
                title={t("settings:resetFontSize", "重置默认字号 (16px)")}
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t("settings:resetFontSize", "重置默认字号")}</span>
              </button>
            )}
          </div>
        </div>

        {/* 滑块与刻度指示 */}
        <div className="bg-[#2b2d31] p-4 sm:p-5 rounded-xl border border-white/5 space-y-4">
          <div className="relative">
            <input
              id="global-font-size-slider"
              type="range"
              min={13}
              max={20}
              step={1}
              value={chatFontSize}
              onChange={handleFontSizeChange}
              data-testid="global-font-size-slider"
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
    </div>
  );
};
