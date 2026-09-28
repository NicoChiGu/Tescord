import React from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Zap,
  CheckCircle2,
  Bug,
  RotateCw,
  ExternalLink,
  Calendar,
  Layers,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BaseModal } from "../ui/dialog/BaseModal.js";
import { useWhatsNewStore } from "../../stores/useWhatsNewStore.js";
import { getChangelogForVersion } from "../../data/changelogs.js";
import { ChangelogCategory } from "@tescord/types";

export const WhatsNewModal: React.FC = () => {
  const { t } = useTranslation(["modals", "common"]);
  const {
    isOpen,
    version,
    mode,
    changelogOverride,
    onRestartApply,
    closeWhatsNew,
  } = useWhatsNewStore();

  if (!isOpen) return null;

  const changelog = getChangelogForVersion(version);

  const handleRestart = async () => {
    if (onRestartApply) {
      await onRestartApply();
    } else if (window.electronAPI?.updater) {
      await window.electronAPI.updater.restartToApply();
    }
    closeWhatsNew();
  };

  const getCategoryMeta = (category: ChangelogCategory) => {
    switch (category) {
      case "features":
        return {
          label: t("modals:whatsNew.categories.features", "新增功能"),
          icon: <Sparkles className="w-3.5 h-3.5 text-emerald-400" />,
          pillClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        };
      case "improvements":
        return {
          label: t("modals:whatsNew.categories.improvements", "体验优化"),
          icon: <Zap className="w-3.5 h-3.5 text-indigo-400" />,
          pillClass: "bg-[#5865f2]/20 text-indigo-300 border-[#5865f2]/40",
        };
      case "fixes":
        return {
          label: t("modals:whatsNew.categories.fixes", "问题修复"),
          icon: <Bug className="w-3.5 h-3.5 text-amber-400" />,
          pillClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        };
      default:
        return {
          label: t("modals:whatsNew.categories.features", "新增功能"),
          icon: <Layers className="w-3.5 h-3.5 text-gray-400" />,
          pillClass: "bg-white/10 text-gray-300 border-white/15",
        };
    }
  };

  // 分类归档条目
  const groupedItems = {
    features: changelog.items.filter((item) => item.category === "features"),
    improvements: changelog.items.filter(
      (item) => item.category === "improvements",
    ),
    fixes: changelog.items.filter((item) => item.category === "fixes"),
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={closeWhatsNew}
      className="max-w-2xl p-0 overflow-hidden"
      showCloseButton={true}
    >
      <div data-testid="whats-new-modal" className="flex flex-col text-white">
        {/* 顶部拟态插画与光晕头部 */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#5865f2] via-[#6370f4] to-[#4752c4] p-6 pb-7 text-white select-none">
          {/* 拟态光晕装饰点 */}
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-8 -left-8 w-36 h-36 bg-indigo-900/40 rounded-full blur-xl pointer-events-none" />

          <div className="relative z-10 flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center shadow-lg shrink-0">
              <Sparkles className="w-6 h-6 text-white" />
            </div>

            <div className="flex-1 min-w-0 pr-6">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  data-testid="whats-new-version-badge"
                  className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white text-[#5865f2] shadow-sm tracking-wide"
                >
                  v{changelog.version}
                </span>
                {changelog.releaseDate && (
                  <span className="flex items-center gap-1 text-[11px] text-white/80 font-medium">
                    <Calendar className="w-3 h-3 opacity-80" />
                    <span>
                      {t("modals:whatsNew.releasedOn", {
                        date: changelog.releaseDate,
                        defaultValue: `发布于 ${changelog.releaseDate}`,
                      })}
                    </span>
                  </span>
                )}
              </div>
              <h2 className="text-xl font-extrabold text-white tracking-tight drop-shadow-sm">
                {t("modals:whatsNew.title", "更新公告与新功能")}
              </h2>
              <p className="text-xs text-white/85 mt-1 leading-relaxed">
                {t(
                  "modals:whatsNew.subtitle",
                  "探索 Tescord 的最新特性、性能提升与改进",
                )}
              </p>
            </div>
          </div>
        </div>

        {/* 核心内容区 */}
        <div className="p-6 max-h-[55vh] overflow-y-auto space-y-6 overscroll-contain">
          {changelogOverride ? (
            /* 远端动态 Markdown 降级渲染 */
            <div className="bg-[#2b2d31] rounded-2xl p-4 border border-white/5 text-gray-200 text-xs leading-relaxed font-sans prose prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {changelogOverride}
              </ReactMarkdown>
            </div>
          ) : (
            /* 结构化分类渲染 */
            <div className="space-y-6">
              {(
                ["features", "improvements", "fixes"] as ChangelogCategory[]
              ).map((cat) => {
                const items = groupedItems[cat];
                if (!items || items.length === 0) return null;
                const meta = getCategoryMeta(cat);

                return (
                  <div key={cat} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${meta.pillClass}`}
                      >
                        {meta.icon}
                        <span>{meta.label}</span>
                      </span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {items.map((item) => {
                        const itemTitle = item.titleKey
                          ? t(item.titleKey, item.rawTitle || "")
                          : item.rawTitle;
                        const itemDesc = item.descriptionKey
                          ? t(item.descriptionKey, item.rawDescription || "")
                          : item.rawDescription;

                        return (
                          <div
                            key={item.id}
                            className="rounded-xl bg-[#2b2d31]/80 hover:bg-[#2b2d31] border border-white/5 p-3.5 transition-colors"
                          >
                            <div className="flex items-start gap-2.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold text-white tracking-wide">
                                  {itemTitle}
                                </h4>
                                {itemDesc && (
                                  <p className="text-[11px] text-gray-300 mt-1 leading-relaxed">
                                    {itemDesc}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {changelog.items.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-xs">
                  {t(
                    "modals:whatsNew.emptyNotice",
                    "当前版本暂无可展示的更新说明条目。",
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部操作工具栏 */}
        <div className="px-6 py-4 bg-[#2b2d31]/60 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="w-full sm:w-auto">
            {changelog.releaseUrl && (
              <a
                href={changelog.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <span>
                  {t(
                    "modals:whatsNew.actions.viewFullReleases",
                    "在 GitHub 查看完整发行日志",
                  )}
                </span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            {mode === "ready_to_restart" ? (
              <>
                <button
                  type="button"
                  onClick={closeWhatsNew}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {t("modals:whatsNew.actions.later", "稍后")}
                </button>
                <button
                  type="button"
                  data-testid="whats-new-restart-btn"
                  onClick={handleRestart}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#5865f2] hover:bg-[#4752c4] text-white shadow-md transition-all cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>
                    {t(
                      "modals:whatsNew.actions.restartNow",
                      "立即重启并应用更新",
                    )}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="whats-new-got-it-btn"
                onClick={closeWhatsNew}
                className="w-full sm:w-auto px-5 py-2 rounded-xl text-xs font-bold bg-[#5865f2] hover:bg-[#4752c4] text-white shadow-md transition-all cursor-pointer"
              >
                {t("modals:whatsNew.actions.gotIt", "我知道了")}
              </button>
            )}
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
