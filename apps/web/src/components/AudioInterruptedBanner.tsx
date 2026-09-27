import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { VolumeX, Loader2, Play } from "lucide-react";
import { AudioPlaybackStatus } from "@tescord/types";
import { livekitService } from "../services/livekit";
import { cloudflareRealtimeService } from "../services/cloudflare_realtime";

export const AudioInterruptedBanner: React.FC = () => {
  const { t } = useTranslation("voice");
  const [livekitStatus, setLivekitStatus] = useState<AudioPlaybackStatus>(() =>
    livekitService.getAudioPlaybackStatus(),
  );
  const [cloudflareStatus, setCloudflareStatus] = useState<AudioPlaybackStatus>(
    () => cloudflareRealtimeService.getAudioPlaybackStatus(),
  );
  const [isResuming, setIsResuming] = useState(false);
  const isResumingRef = useRef(false);

  useEffect(() => {
    const unsubscribeLiveKit =
      livekitService.onAudioPlaybackStatusChange(setLivekitStatus);
    const unsubscribeCloudflare =
      cloudflareRealtimeService.onAudioPlaybackStatusChange(
        setCloudflareStatus,
      );
    return () => {
      unsubscribeLiveKit();
      unsubscribeCloudflare();
    };
  }, []);

  const isInterrupted =
    livekitStatus.isInterrupted || cloudflareStatus.isInterrupted;

  const handleResume = useCallback(async () => {
    if (isResumingRef.current) return;
    isResumingRef.current = true;
    setIsResuming(true);
    try {
      await Promise.all([
        livekitService.resumeAudio(),
        cloudflareRealtimeService.resumeAudio(),
      ]);
    } catch (err) {
      console.warn("[AudioInterruptedBanner] Resume error:", err);
    } finally {
      isResumingRef.current = false;
      setIsResuming(false);
    }
  }, []);

  // 全屏透明手势兜底：当音频处于中断状态时，用户轻触屏幕任意区域即可解锁 WebKit 音频上下文
  useEffect(() => {
    if (!isInterrupted) return;

    const onPassiveUserGesture = () => {
      void handleResume();
    };

    window.addEventListener("pointerdown", onPassiveUserGesture, {
      once: true,
      capture: true,
    });
    window.addEventListener("keydown", onPassiveUserGesture, {
      once: true,
      capture: true,
    });

    return () => {
      window.removeEventListener("pointerdown", onPassiveUserGesture, {
        capture: true,
      });
      window.removeEventListener("keydown", onPassiveUserGesture, {
        capture: true,
      });
    };
  }, [isInterrupted, handleResume]);

  if (!isInterrupted) {
    return null;
  }

  return (
    <aside
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={t("audioInterruption.bannerTitle")}
      className="relative z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-950/80 px-4 py-2.5 text-amber-100 shadow-md backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40 animate-pulse">
          <VolumeX className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold tracking-wide text-amber-200">
            {t("audioInterruption.bannerTitle")}
          </h4>
          <p className="line-clamp-1 text-xs text-amber-300/80 sm:line-clamp-none">
            {t("audioInterruption.bannerDesc")}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleResume}
          disabled={isResuming}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-slate-950 shadow-sm transition hover:bg-amber-400 active:scale-95 disabled:pointer-events-none disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-slate-900"
        >
          {isResuming ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t("audioInterruption.resuming")}</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{t("audioInterruption.resumeButton")}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};
