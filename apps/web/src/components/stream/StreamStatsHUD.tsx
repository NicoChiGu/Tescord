import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { StreamDetailedStats } from "@tescord/types";
import { mediaStatsService } from "../../services/stats/MediaStatsService.js";
import {
  X,
  Copy,
  Check,
  Activity,
  ShieldCheck,
  RefreshCw,
  Network,
  Globe,
  GripHorizontal,
} from "lucide-react";

interface StreamStatsHUDProps {
  participantIdentity?: string;
  participantName?: string;
  isLocal?: boolean;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export const StreamStatsHUD: React.FC<StreamStatsHUDProps> = ({
  participantIdentity,
  participantName,
  isLocal: propIsLocal,
  onClose,
  containerRef,
}) => {
  const { t } = useTranslation("voice");
  const displayName = participantName || t("hud.mediaStream");
  const [stats, setStats] = useState<StreamDetailedStats | null>(null);
  const effectiveIsLocal = propIsLocal ?? stats?.isLocal ?? false;
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hudRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    hudX: number;
    hudY: number;
  }>({ pointerX: 0, pointerY: 0, hudX: 0, hudY: 0 });

  useEffect(() => {
    let isMounted = true;

    const fetchStats = async () => {
      try {
        const s = await mediaStatsService.getDetailedStats(participantIdentity);
        if (isMounted) {
          setStats(s);
        }
      } catch (e) {
        console.warn("Failed to update stream stats in HUD:", e);
      }
    };

    fetchStats();
    const timer = setInterval(fetchStats, 1000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [participantIdentity]);

  // 点击外部 (Click Outside) 与 ESC 键监听，失焦自动收起
  useEffect(() => {
    const handleDocumentPointerDown = (e: PointerEvent) => {
      if (isDraggingRef.current) return;
      if (hudRef.current && hudRef.current.contains(e.target as Node)) {
        return;
      }
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest?.('[data-testid="participant-stats-btn"]')) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true,
      );
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // 窗口大小变动时，确保已拖拽浮窗不会溢出容器
  useEffect(() => {
    if (!position || !hudRef.current) return;

    const handleResize = () => {
      if (!hudRef.current) return;
      const parentEl =
        containerRef?.current || (hudRef.current.offsetParent as HTMLElement);
      if (!parentEl) return;

      const parentRect = parentEl.getBoundingClientRect();
      const hudRect = hudRef.current.getBoundingClientRect();
      const padding = 8;
      const maxX = Math.max(
        padding,
        parentRect.width - hudRect.width - padding,
      );
      const maxY = Math.max(
        padding,
        parentRect.height - hudRect.height - padding,
      );

      setPosition((prev) => {
        if (!prev) return null;
        return {
          x: Math.min(Math.max(padding, prev.x), maxX),
          y: Math.min(Math.max(padding, prev.y), maxY),
        };
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [position, containerRef]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!hudRef.current) return;

    const hudEl = hudRef.current;
    const parentEl =
      containerRef?.current || (hudEl.offsetParent as HTMLElement);
    if (!parentEl) return;

    const parentRect = parentEl.getBoundingClientRect();
    const hudRect = hudEl.getBoundingClientRect();

    const currentX =
      position !== null ? position.x : hudRect.left - parentRect.left;
    const currentY =
      position !== null ? position.y : hudRect.top - parentRect.top;

    if (!position) {
      setPosition({ x: currentX, y: currentY });
    }

    isDraggingRef.current = true;
    const startData = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      hudX: currentX,
      hudY: currentY,
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current || !hudRef.current) return;

      const deltaX = ev.clientX - startData.pointerX;
      const deltaY = ev.clientY - startData.pointerY;

      const rawX = startData.hudX + deltaX;
      const rawY = startData.hudY + deltaY;

      const padding = 8;
      const minX = padding;
      const maxX = Math.max(minX, parentRect.width - hudRect.width - padding);
      const minY = padding;
      const maxY = Math.max(minY, parentRect.height - hudRect.height - padding);

      const clampedX = Math.min(Math.max(minX, rawX), maxX);
      const clampedY = Math.min(Math.max(minY, rawY), maxY);

      setPosition({ x: clampedX, y: clampedY });
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const handleCopy = async () => {
    if (!stats) return;
    const unknown = t("hud.unknown");
    const frameLabel = effectiveIsLocal
      ? t("hud.encodedFrames")
      : t("hud.decodedFrames");
    const text = [
      `[${t("hud.title")} - ${displayName}]`,
      `${t("hud.topology")}: ${stats.topology}`,
      `${t("hud.connectionMode")}: ${stats.connectionMode}`,
      `${t("hud.holePunchStatus")}: ${stats.holePunchStatus || unknown}`,
      `${t("hud.ipStack")}: ${stats.ipVersion || unknown}`,
      `${t("hud.mimeType")}: ${stats.mimeType || unknown}`,
      `${t("hud.playerCore")}: ${stats.playerCore || unknown}`,
      `${t("hud.videoInfo")}: ${stats.videoInfo || unknown}`,
      `${t("hud.audioInfo")}: ${stats.audioInfo || unknown}`,
      `${t("hud.encoder")}: ${stats.encoder || unknown}`,
      `${t("hud.streamHost")}: ${stats.streamHost || unknown}`,
      `${t("hud.protocol")}: ${stats.protocol || unknown}`,
      `${t("hud.bufferJitter")}: ${stats.bufferLength || unknown} / ${stats.jitter || unknown}`,
      `${frameLabel}: ${effectiveIsLocal ? stats.encodedFrames || unknown : stats.decodedFrames || unknown}`,
      `${t("hud.downloadBitrate")}: ${stats.downloadBitrate || unknown}`,
      stats.uploadBitrate
        ? `${t("hud.uploadBitrate")}: ${stats.uploadBitrate}`
        : null,
      `${t("hud.rtt")}: ${stats.rtt || unknown}`,
      `${t("hud.packetLoss")}: ${stats.packetLoss || unknown}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy stats text:", e);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      const s = await mediaStatsService.getDetailedStats(participantIdentity);
      setStats(s);
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  return (
    <div
      ref={hudRef}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={
        position
          ? {
              transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
              left: 0,
              top: 0,
            }
          : undefined
      }
      className={`absolute z-40 w-80 sm:w-96 bg-[#111214]/92 backdrop-blur-md border border-[#3f4147] rounded-xl shadow-2xl p-3.5 text-xs font-mono text-gray-200 select-text animate-fade-in ${
        !position ? "top-12 right-4" : ""
      }`}
    >
      {/* 顶部标题与操作栏 (支持拖拽) */}
      <div
        data-testid="stream-stats-drag-handle"
        onPointerDown={handlePointerDown}
        className="flex items-center justify-between pb-2 border-b border-[#2b2d31] mb-2.5 cursor-grab active:cursor-grabbing select-none"
        title={t("hud.dragHint")}
      >
        <div className="flex items-center space-x-2">
          <GripHorizontal className="w-3.5 h-3.5 text-gray-400 opacity-70 hover:opacity-100 transition" />
          <Activity className="w-4 h-4 text-discord-green animate-pulse" />
          <span className="font-bold text-white text-[13px] tracking-wide">
            {t("hud.title")}
          </span>
          <span className="text-[10px] bg-discord-brand/20 text-discord-brand px-1.5 py-0.2 rounded font-sans">
            HUD
          </span>
        </div>
        <div
          className="flex items-center space-x-1 cursor-default"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={handleManualRefresh}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white transition cursor-pointer"
            title={t("hud.refresh")}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-discord-brand" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white transition cursor-pointer"
            title={t("hud.copy")}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-discord-green" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-discord-danger/20 hover:text-discord-danger text-gray-400 transition cursor-pointer"
            title={t("hud.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 属性键值对表格 */}
      <div className="space-y-1.5 text-[11px] leading-relaxed max-h-[360px] overflow-y-auto pr-1">
        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.target")}:
          </span>
          <span className="text-white text-right truncate font-sans">
            {displayName} (
            {t(effectiveIsLocal ? "hud.localStream" : "hud.remoteStream")})
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.mimeType")}:
          </span>
          <span className="text-discord-brand text-right break-all">
            {stats?.mimeType || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.playerCore")}:
          </span>
          <span className="text-gray-300 text-right">
            {stats?.playerCore || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.videoInfo")}:
          </span>
          <span className="text-emerald-400 font-semibold text-right">
            {stats?.videoInfo || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.audioInfo")}:
          </span>
          <span className="text-gray-300 text-right">
            {stats?.audioInfo || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.encoder")}:
          </span>
          <span className="text-gray-300 text-right truncate">
            {stats?.encoder || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.streamHost")}:
          </span>
          <span className="text-amber-400 text-right truncate">
            {stats?.streamHost || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.topology")}:
          </span>
          <span className="text-right font-semibold flex items-center gap-1 text-sky-400">
            <Network className="w-3 h-3 text-discord-brand" />
            <span>
              {stats?.topology === "SFU_SERVER"
                ? t("hud.topologySfu")
                : stats?.topology === "P2P_MESH"
                  ? t("hud.topologyMesh")
                  : stats?.topology === "P2P_DIRECT"
                    ? t("hud.topologyDirect")
                    : stats?.topology === "P2P_TREE_RELAY"
                      ? t("hud.topologyRelay")
                      : stats?.topology || t("hud.unknown")}
            </span>
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.connectionMode")}:
          </span>
          <span
            className={`text-right font-semibold flex items-center gap-1 ${
              stats?.connectionMode.includes("P2P")
                ? "text-emerald-400"
                : "text-sky-400"
            }`}
          >
            <ShieldCheck className="w-3 h-3" />
            <span>{stats?.connectionMode || t("hud.unknown")}</span>
          </span>
        </div>

        {stats?.holePunchStatus && (
          <div className="flex justify-between items-start gap-2">
            <span className="text-gray-400 flex-shrink-0">
              {t("hud.holePunchStatus")}:
            </span>
            <span
              className={`text-right font-semibold ${
                stats.holePunchStatus.includes("重试")
                  ? "text-amber-400 animate-pulse"
                  : stats.holePunchStatus.includes("连通")
                    ? "text-emerald-400"
                    : "text-gray-300"
              }`}
            >
              {stats.holePunchStatus}
            </span>
          </div>
        )}

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.ipStack")}:
          </span>
          <span
            className={`text-right font-semibold flex items-center gap-1 ${
              stats?.ipVersion === "IPv6" ? "text-purple-400" : "text-blue-400"
            }`}
          >
            <Globe className="w-3 h-3" />
            <span>
              {stats?.ipVersion === "IPv6"
                ? t("hud.ipv6")
                : stats?.ipVersion === "IPv4"
                  ? t("hud.ipv4")
                  : t("hud.unknown")}
            </span>
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.protocol")}:
          </span>
          <span className="text-gray-300 text-right">
            {stats?.protocol || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.bufferJitter")}:
          </span>
          <span className="text-gray-300 text-right">
            {stats?.bufferLength || t("hud.unknown")} /{" "}
            {stats?.jitter || t("hud.unknown")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t(effectiveIsLocal ? "hud.encodedFrames" : "hud.decodedFrames")}:
          </span>
          <span className="text-gray-300 text-right">
            {(effectiveIsLocal
              ? stats?.encodedFrames || stats?.decodedFrames
              : stats?.decodedFrames) || t("hud.notAvailable")}
          </span>
        </div>

        {effectiveIsLocal ? (
          <div className="flex justify-between items-start gap-2">
            <span className="text-gray-400 flex-shrink-0">
              {t("hud.uploadBitrate")}:
            </span>
            <span className="text-indigo-400 font-semibold text-right">
              {stats?.uploadBitrate ||
                stats?.downloadBitrate ||
                t("hud.unknown")}
            </span>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start gap-2">
              <span className="text-gray-400 flex-shrink-0">
                {t("hud.downloadBitrate")}:
              </span>
              <span className="text-discord-brand font-semibold text-right">
                {stats?.downloadBitrate || t("hud.unknown")}
              </span>
            </div>
            {stats?.uploadBitrate && (
              <div className="flex justify-between items-start gap-2">
                <span className="text-gray-400 flex-shrink-0">
                  {t("hud.uploadBitrate")}:
                </span>
                <span className="text-indigo-400 font-semibold text-right">
                  {stats.uploadBitrate}
                </span>
              </div>
            )}
          </>
        )}

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">{t("hud.rtt")}:</span>
          <span className="text-gray-300 text-right">
            {stats?.rtt || t("hud.notAvailable")}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">
            {t("hud.packetLoss")}:
          </span>
          <span
            className={`text-right font-semibold ${
              stats?.packetLoss && parseFloat(stats.packetLoss) > 5
                ? "text-discord-danger"
                : "text-discord-green"
            }`}
          >
            {stats?.packetLoss || t("hud.unknown")}
          </span>
        </div>
      </div>
    </div>
  );
};
