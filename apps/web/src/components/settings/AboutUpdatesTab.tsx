import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Server,
  Zap,
  RotateCw,
  GitBranch,
  Sliders,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import {
  UpdateCheckResult,
  UpdateProgress,
  UpdaterConfig,
} from "@tescord/types";
import { useWhatsNewStore } from "../../stores/useWhatsNewStore.js";
import { CURRENT_APP_VERSION } from "../../data/changelogs.js";

export const AboutUpdatesTab: React.FC = () => {
  const { t } = useTranslation(["settings", "common"]);
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);
  const [config, setConfig] = useState<UpdaterConfig | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [isReadyToRestart, setIsReadyToRestart] = useState<boolean>(false);
  const [customProxyInput, setCustomProxyInput] = useState<string>("");
  const [proxySaveSuccess, setProxySaveSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isElectron = Boolean(window.electronAPI?.updater);

  useEffect(() => {
    if (!isElectron) return;

    // 1. 获取初始更新配置
    window.electronAPI?.updater?.getConfig().then((cfg) => {
      setConfig(cfg);
      setCustomProxyInput(cfg.customProxy || "");
    });

    // 2. 监听更新进度广播
    const removeProgressListener = window.electronAPI?.updater?.onProgress(
      (prog) => {
        setProgress(prog);
        if (prog.state === "ready") {
          setIsDownloading(false);
          setIsReadyToRestart(true);
        } else if (prog.state === "error") {
          setIsDownloading(false);
          setErrorMessage(
            prog.error || t("settings:updates.downloadFailed", "下载更新失败"),
          );
        }
      },
    );

    // 3. 监听就绪广播
    const removeReadyListener = window.electronAPI?.updater?.onUpdateReady(
      () => {
        setIsReadyToRestart(true);
        setIsDownloading(false);
      },
    );

    return () => {
      removeProgressListener?.();
      removeReadyListener?.();
    };
  }, [isElectron]);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.updater) return;
    setIsChecking(true);
    setErrorMessage(null);
    try {
      const res = await window.electronAPI.updater.checkForUpdates();
      setCheckResult(res);
      if (res.error && !res.enabled) {
        setErrorMessage(res.error);
      }
    } catch (err: any) {
      setErrorMessage(
        err.message || t("settings:updates.checkError", "更新检查遇到异常"),
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownloadAndApply = async () => {
    if (!window.electronAPI?.updater) return;
    setIsDownloading(true);
    setErrorMessage(null);
    try {
      const res = await window.electronAPI.updater.downloadAndApply();
      if (res.success) {
        setIsReadyToRestart(true);
      } else {
        setErrorMessage(
          res.error || t("settings:updates.applyFailed", "增量更新应用失败"),
        );
      }
    } catch (err: any) {
      setErrorMessage(
        err.message ||
          t("settings:updates.downloadDeltaFailed", "下载增量更新失败"),
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRestart = async () => {
    if (!window.electronAPI?.updater) return;
    await window.electronAPI.updater.restartToApply();
  };

  const handleSaveProxy = async () => {
    if (!window.electronAPI?.updater) return;
    try {
      await window.electronAPI.updater.setCustomProxy(customProxyInput.trim());
      setErrorMessage(null);
      setProxySaveSuccess(true);
      setTimeout(() => setProxySaveSuccess(false), 2000);
      const updated = await window.electronAPI.updater.getConfig();
      setConfig(updated);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("settings:updates.invalidProxy", "代理地址无效"),
      );
    }
  };

  if (!isElectron) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#5865f2]" />
            <span>
              {t("settings:updates.webEnvironmentTitle", "版本与环境 (About)")}
            </span>
          </h2>
          <p className="text-xs text-discord-textMuted mt-1">
            {t(
              "settings:updates.webEnvironmentDesc",
              "当前处于标准 Web 浏览器环境。客户端自动更新与 gh-proxy 加速仅在 Electron 桌面端生效。",
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-[#2b2d31] p-5 border border-white/5 text-gray-300 text-xs">
          <span>
            {t(
              "settings:updates.webDesktopTip",
              "您可通过下载并安装 Tescord 桌面客户端享受 Discord 拟态无边框窗口、独立进程音频低延迟优化与自动静默增量更新体验。",
            )}
          </span>
          <button
            type="button"
            data-testid="web-view-changelog-btn"
            onClick={() =>
              openWhatsNew({
                version: CURRENT_APP_VERSION,
                mode: "view",
              })
            }
            className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-[#5865f2] hover:bg-[#4752c4] text-white transition-all shadow-md cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t("settings:updates.viewChangelog", "查看更新公告")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl pb-10">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Zap className="w-6 h-6 text-[#5865f2]" />
          <span>
            {t("settings:updates.updatesTitle", "客户端版本与更新 (Updates)")}
          </span>
        </h2>
        <p className="text-xs text-discord-textMuted mt-1">
          {t(
            "settings:updates.updatesSubtitle",
            "Tescord 采用类 Discord 的双轨热更新机制，日常功能更新秒级无感生效，通过 gh-proxy 阶梯加速直连 GitHub Releases。",
          )}
        </p>
      </div>

      {/* 1. 当前版本信息卡片 */}
      <div className="rounded-2xl bg-[#2b2d31] p-5 border border-white/5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {t("settings:updates.activeVersion", "当前版本 (Active Version)")}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-white tracking-tight">
                v{config?.currentWebVersion || "0.1.0"}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-[#5865f2]/20 text-[#5865f2]">
                {t("settings:updates.hostShell", {
                  version: config?.currentHostVersion || "0.1.0",
                  defaultValue: `宿主壳 v${config?.currentHostVersion || "0.1.0"}`,
                })}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              data-testid="desktop-view-changelog-btn"
              onClick={() =>
                openWhatsNew({
                  version: config?.currentWebVersion || CURRENT_APP_VERSION,
                  mode: "view",
                })
              }
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-all shadow-sm cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#5865f2]" />
              <span>{t("settings:updates.viewChangelog", "查看更新公告")}</span>
            </button>

            <button
              type="button"
              onClick={handleCheckForUpdates}
              disabled={isChecking || isDownloading}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white transition-all shadow-md cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isChecking ? "animate-spin" : ""}`}
              />
              <span>
                {isChecking
                  ? t("settings:updates.checking", "正在检测更新...")
                  : t("settings:updates.checkUpdates", "检查更新")}
              </span>
            </button>
          </div>
        </div>

        {/* 仓库绑定状态与构建信息 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-[#1e1f22]/70 rounded-xl p-3 border border-white/5 flex items-center gap-3">
            <GitBranch className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-gray-400">
                {t("settings:updates.targetRepo", "GitHub 目标仓库")}
              </div>
              <div className="font-semibold text-white truncate">
                {config?.gitRepo
                  ? config.gitRepo
                  : t(
                      "settings:updates.notConfigured",
                      "未配置 (构建时未注入)",
                    )}
              </div>
            </div>
          </div>

          <div className="bg-[#1e1f22]/70 rounded-xl p-3 border border-white/5 flex items-center gap-3">
            <Server className="w-5 h-5 text-gray-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-gray-400">
                {t("settings:updates.serviceStatus", "更新服务状态")}
              </div>
              <div className="font-semibold truncate flex items-center gap-1.5">
                {config?.enabled ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-emerald-400">
                      {t("settings:updates.statusReady", "自动检测已就绪")}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-amber-400">
                      {t(
                        "settings:updates.statusDisabled",
                        "未启用 (无远程仓库)",
                      )}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 更新检测结果 / 就绪状态提示 */}
      {isReadyToRestart && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div>
              <div className="text-sm font-bold text-white">
                {t("settings:updates.readyTitle", "新版本已在本地解压就绪！")}
              </div>
              <div className="text-xs text-gray-300 mt-0.5">
                {t(
                  "settings:updates.readyDesc",
                  "增量包已成功校验并生效至本地，点击按钮立即体验新特性。",
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRestart}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-all cursor-pointer shadow-lg shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{t("settings:updates.restartNow", "立即重启应用")}</span>
          </button>
        </div>
      )}

      {/* 下载进度条 */}
      {isDownloading && progress && (
        <div className="rounded-2xl bg-[#2b2d31] p-5 border border-white/5 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">
              {progress.state === "extracting"
                ? t("settings:updates.extracting", "正在解压安装增量包...")
                : t("settings:updates.downloading", "正在下载增量更新...")}
            </span>
            <span className="font-bold text-[#5865f2]">
              {progress.percent}%
            </span>
          </div>
          <div className="w-full h-2 bg-[#1e1f22] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#5865f2] to-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* 检查结果反馈 */}
      {checkResult && !isReadyToRestart && !isDownloading && (
        <div className="rounded-2xl bg-[#2b2d31] p-5 border border-white/5 space-y-3">
          {checkResult.hasUpdate ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Download className="w-4 h-4 text-[#5865f2]" />
                  <span>
                    {t("settings:updates.foundVersion", {
                      version: checkResult.latestVersion,
                      defaultValue: `发现新版本: v${checkResult.latestVersion}`,
                    })}
                  </span>
                </div>
                {checkResult.isHostUpdateRequired ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-500/20 text-amber-300">
                    {t(
                      "settings:updates.requireFullInstaller",
                      "需要安装包更新",
                    )}
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-300">
                    {t("settings:updates.deltaUpdate", "增量免安装更新")}
                  </span>
                )}
              </div>

              {checkResult.manifest?.changelog && (
                <div className="text-xs text-gray-300 bg-[#1e1f22] rounded-xl p-3.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono border border-white/5">
                  {checkResult.manifest.changelog}
                </div>
              )}

              {checkResult.isHostUpdateRequired ? (
                <div className="flex items-center justify-between pt-2">
                  <div className="text-xs text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      {t(
                        "settings:updates.fullInstallerNotice",
                        "该版本包含原生底层改动，建议前往 Releases 下载完整安装包。",
                      )}
                    </span>
                  </div>
                  <a
                    href={`https://github.com/${config?.gitRepo}/releases/latest`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
                  >
                    <span>
                      {t("settings:updates.downloadInstaller", "下载安装包")}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleDownloadAndApply}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#5865f2] hover:bg-[#4752c4] text-white transition-all cursor-pointer shadow-md"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {t(
                        "settings:updates.downloadDelta",
                        "立即下载并应用增量更新 (5~15MB)",
                      )}
                    </span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>
                {t("settings:updates.upToDate", "当前已是最新版本，无需更新。")}
              </span>
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3.5 flex items-center gap-2.5 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 3. GitHub 代理加速与容灾设置 */}
      <div className="rounded-2xl bg-[#2b2d31] p-5 border border-white/5 space-y-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#5865f2]" />
          <h3 className="text-sm font-bold text-white">
            {t(
              "settings:updates.proxyConfigTitle",
              "GitHub Releases 加速代理配置",
            )}
          </h3>
        </div>
        <p className="text-xs text-discord-textMuted">
          {t(
            "settings:updates.proxyConfigDesc",
            "在网络受限或大陆环境下，客户端默认采用阶梯自动降级路由：优先走高速代理，失败平滑回退，保障更新绝不卡死。",
          )}
        </p>

        {/* 阶梯路由指示器 */}
        <div className="bg-[#1e1f22] rounded-xl p-3 border border-white/5 space-y-2 text-xs">
          <div className="flex items-center justify-between text-gray-300">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>
                {t("settings:updates.priority1", "第一优先级 (默认推荐)")}
              </span>
            </span>
            <code className="text-[11px] text-gray-400 font-mono">
              https://v6.gh-proxy.org/
            </code>
          </div>
          <div className="flex items-center justify-between text-gray-300">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <span>
                {t("settings:updates.priority2", "第二优先级 (备用镜像)")}
              </span>
            </span>
            <code className="text-[11px] text-gray-400 font-mono">
              https://gh-proxy.com/
            </code>
          </div>
          <div className="flex items-center justify-between text-gray-300">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-500" />
              <span>{t("settings:updates.fallback", "最终兜底")}</span>
            </span>
            <code className="text-[11px] text-gray-400 font-mono">
              {t("settings:updates.officialDirect", "GitHub 官方直连")}
            </code>
          </div>
        </div>

        {/* 自定义代理设置 */}
        <div className="space-y-2 pt-2">
          <label className="block text-xs font-semibold text-gray-300">
            {t("settings:updates.customProxy", "自定义代理前缀 (可选覆盖)")}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={customProxyInput}
              onChange={(e) => setCustomProxyInput(e.target.value)}
              placeholder={t(
                "settings:updates.proxyPlaceholder",
                "例如 https://gh-proxy.net/ 或留空采用默认阶梯",
              )}
              className="flex-1 bg-[#1e1f22] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2]"
            />
            <button
              type="button"
              onClick={handleSaveProxy}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              {proxySaveSuccess
                ? t("settings:updates.saved", "已保存！")
                : t("settings:updates.save", t("common:save", "保存"))}
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            {t(
              "settings:updates.customProxyTip",
              "若您部署了自建 gh-proxy 或其他反向代理加速镜像，可填写于此，系统将优先走您的专用通道。",
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
