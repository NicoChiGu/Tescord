import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Wrench, RefreshCw, Radio, ShieldAlert, LogOut, CheckCircle2 } from "lucide-react";
import { useMaintenanceStore } from "../../stores/useMaintenanceStore.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { API_BASE } from "../../config.js";

export const MaintenanceScreen: React.FC = () => {
  const { t, i18n } = useTranslation(["common"]);
  const { announcement, triggeredAt, clearMaintenance } = useMaintenanceStore();
  const { user, logout, openReauthModal } = useAuthStore();
  const [isChecking, setIsChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const handleManualCheck = async () => {
    setIsChecking(true);
    setCheckMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/health`, {
        cache: "no-store",
      });
      // 同时也尝试请求 /api/auth/me 确认当前业务是否解除维护
      const authRes = await fetch(`${API_BASE}/api/auth/me`, {
        headers: useAuthStore.getState().getAuthHeaders(),
        cache: "no-store",
      });

      if (authRes.status !== 503) {
        clearMaintenance();
        setCheckMessage(t("common:maintenance.restoring"));
      } else {
        setCheckMessage(t("common:maintenance.stillMaintenance"));
      }
    } catch {
      setCheckMessage(t("common:maintenance.networkChecking"));
    } finally {
      setTimeout(() => {
        setIsChecking(false);
      }, 600);
    }
  };

  const formattedTime = triggeredAt
    ? new Date(triggeredAt).toLocaleTimeString(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      data-testid="maintenance-screen"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090a0f]/95 backdrop-blur-xl select-none animate-in fade-in duration-300 px-4"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#2b2d31]/80 bg-[#1e1f22]/90 p-8 shadow-2xl backdrop-blur-2xl text-center">
        {/* 顶部背景装饰光斑 */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-amber-500/15 blur-3xl" />

        {/* 核心动态维护图标 */}
        <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-amber-500/20 animate-ping opacity-75 duration-1000" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/30 to-amber-600/10 border border-amber-500/40 shadow-inner">
            <Wrench className="h-10 w-10 text-amber-400 animate-pulse" />
          </div>
        </div>

        {/* 标题与状态 */}
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 border border-amber-500/20 text-xs font-medium text-amber-300 mb-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          {t("common:maintenance.badge")}
        </div>

        <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
          {t("common:maintenance.title")}
        </h2>

        <p className="text-sm text-[#949ba4] leading-relaxed mb-6">
          {t("common:maintenance.desc")}
        </p>

        {/* 公告气泡 */}
        {announcement && (
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-left">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-1">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("common:maintenance.adminAnnouncement")}</span>
            </div>
            <div className="text-sm text-[#dbdee1] whitespace-pre-wrap break-words">
              {announcement}
            </div>
            {formattedTime && (
              <div className="mt-2 text-[11px] text-[#949ba4]">
                {t("common:maintenance.startTime", { time: formattedTime })}
              </div>
            )}
          </div>
        )}

        {/* 实时 WebSocket 状态指示 */}
        <div className="mb-6 flex items-center justify-center gap-2 rounded-lg bg-[#111214]/60 px-4 py-2.5 border border-[#2b2d31]/50 text-xs text-[#949ba4]">
          <Radio className="h-4 w-4 text-emerald-400 animate-pulse" />
          <span>{t("common:maintenance.realtimeTip")}</span>
        </div>

        {/* 操作区 */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleManualCheck}
            disabled={isChecking}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865f2] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#4752c4] active:scale-[0.98] disabled:opacity-50 cursor-pointer shadow-md"
          >
            <RefreshCw
              className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`}
            />
            {isChecking
              ? t("common:maintenance.checking")
              : t("common:maintenance.checkBtn")}
          </button>

          {checkMessage && (
            <div className="text-xs text-amber-400/90 animate-in fade-in duration-200">
              {checkMessage}
            </div>
          )}

          {/* 切换用户 / 管理员登录 */}
          <div className="mt-2 flex items-center justify-between text-xs text-[#949ba4] px-1 pt-2 border-t border-[#2b2d31]/40">
            <span>
              {t("common:maintenance.currentAccount")}
              <span className="text-[#dbdee1] font-medium">
                {user?.username || t("common:maintenance.guest")}
              </span>
            </span>
            <button
              onClick={() => {
                logout();
              }}
              className="inline-flex items-center gap-1 text-[#949ba4] hover:text-[#f23f43] transition cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("common:maintenance.switchAccount")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
