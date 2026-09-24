import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, RotateCw, X } from "lucide-react";

export const UpdateNotificationBanner: React.FC = () => {
  const { t } = useTranslation(["common"]);
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (!window.electronAPI?.updater) return;

    const cleanup = window.electronAPI.updater.onUpdateReady((data) => {
      setReadyVersion(data.version);
      setIsDismissed(false);
    });

    return () => {
      cleanup?.();
    };
  }, []);

  if (!readyVersion || isDismissed) {
    return null;
  }

  const handleRestart = async () => {
    await window.electronAPI?.updater?.restartToApply();
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 animate-bounce-in max-w-sm rounded-2xl bg-[#2b2d31]/95 backdrop-blur-md border border-[#5865f2]/40 shadow-2xl p-4 text-white">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#5865f2] to-emerald-400 flex items-center justify-center shrink-0 shadow-md">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0 pr-1">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <span>
              {t("common:updater.readyTitle", { version: readyVersion })}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-[11px] text-gray-300 mt-1 leading-relaxed">
            {t("common:updater.readyDesc")}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleRestart}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#5865f2] hover:bg-[#4752c4] text-white transition-colors cursor-pointer shadow-sm"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>{t("common:updater.restartNow")}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              {t("common:updater.nextTime")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          title={t("common:updater.dismiss")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
