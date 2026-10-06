import React from "react";
import { CheckCircle2, AlertCircle, Info, X, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToastStore, ToastType } from "../../../stores/useToastStore";

export const GlobalToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();
  const { t } = useTranslation(["settings", "common"]);

  if (toasts.length === 0) return null;

  const getIcon = (type: ToastType) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case "warning":
        return <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case "info":
      default:
        return <Info className="w-4 h-4 text-discord-brand shrink-0" />;
    }
  };

  const getBorderColor = (type: ToastType) => {
    switch (type) {
      case "success":
        return "border-emerald-500/30";
      case "warning":
        return "border-amber-500/30";
      case "error":
        return "border-rose-500/30";
      case "info":
      default:
        return "border-discord-brand/30";
    }
  };

  return (
    <div className="fixed top-[max(1.25rem,env(safe-area-inset-top))] left-3 right-3 sm:left-auto sm:right-5 z-[110] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="progress-toast"
          className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl bg-[#2b2d31]/95 text-white shadow-xl border ${getBorderColor(
            toast.type,
          )} backdrop-blur-md animate-in slide-in-from-top-2 fade-in duration-200`}
        >
          {toast.progress && toast.progress.phase !== "ready" ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            getIcon(toast.type)
          )}
          <div
            className="text-sm font-medium leading-snug flex-1 min-w-0"
            role="status"
            aria-live="polite"
          >
            {toast.key ? t(toast.key, toast.params) : toast.message}
            {toast.progress && toast.progress.phase === "downloading" && (
              <div className="mt-2">
                <div
                  className="h-1 rounded bg-white/10 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    toast.progress.total
                      ? Math.min(
                          100,
                          Math.floor(
                            (toast.progress.loaded / toast.progress.total) *
                              100,
                          ),
                        )
                      : undefined
                  }
                  aria-label={t("common:loading")}
                >
                  <div
                    className={`h-full bg-discord-brand ${toast.progress.total ? "transition-[width]" : "w-1/3 animate-pulse"}`}
                    style={
                      toast.progress.total
                        ? {
                            width: `${Math.min(100, (toast.progress.loaded / toast.progress.total) * 100)}%`,
                          }
                        : undefined
                    }
                  />
                </div>
                <div className="text-xs text-discord-textMuted mt-1 tabular-nums">
                  {(toast.progress.loaded / 1048576).toFixed(1)} MB
                  {toast.progress.total
                    ? ` / ${(toast.progress.total / 1048576).toFixed(1)} MB · ${Math.min(100, Math.floor((toast.progress.loaded / toast.progress.total) * 100))}%`
                    : ""}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label={t("common:close")}
            className="text-gray-400 hover:text-white p-0.5 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
