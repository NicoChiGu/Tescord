import React, { useState, useEffect, useRef } from "react";
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
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
}

export const StreamStatsHUD: React.FC<StreamStatsHUDProps> = ({
  participantIdentity,
  participantName = "媒体流",
  onClose,
  containerRef,
}) => {
  const [stats, setStats] = useState<StreamDetailedStats | null>(null);
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
    const text = [
      `[Tescord Media Stats - ${participantName}]`,
      `Topology: ${stats.topology}`,
      `Connection Type: ${stats.connectionMode}`,
      `Hole Punch Status: ${stats.holePunchStatus || "Connected"}`,
      `IP Version: ${stats.ipVersion || "IPv4"}`,
      `Mime Type: ${stats.mimeType}`,
      `Player Core: ${stats.playerCore}`,
      `Video Info: ${stats.videoInfo || "None"}`,
      `Audio Info: ${stats.audioInfo}`,
      `Encoder: ${stats.encoder}`,
      `Stream Host: ${stats.streamHost}`,
      `Protocol: ${stats.protocol}`,
      `Buffer Length: ${stats.bufferLength}`,
      `Decoded Frames: ${stats.decodedFrames}`,
      `Download Bitrate: ${stats.downloadBitrate}`,
      stats.uploadBitrate ? `Upload Bitrate: ${stats.uploadBitrate}` : null,
      `RTT: ${stats.rtt}`,
      `Packet Loss: ${stats.packetLoss}`,
      `Jitter: ${stats.jitter}`,
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
        title="按住标题栏可在卡片内自由拖拽"
      >
        <div className="flex items-center space-x-2">
          <GripHorizontal className="w-3.5 h-3.5 text-gray-400 opacity-70 hover:opacity-100 transition" />
          <Activity className="w-4 h-4 text-discord-green animate-pulse" />
          <span className="font-bold text-white text-[13px] tracking-wide">
            媒体属性与实时统计
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
            title="立即刷新数据"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-discord-brand" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white transition cursor-pointer"
            title="复制全部属性与统计"
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
            title="关闭面板"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 属性键值对表格 */}
      <div className="space-y-1.5 text-[11px] leading-relaxed max-h-[360px] overflow-y-auto pr-1">
        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">目标对象:</span>
          <span className="text-white text-right truncate font-sans">
            {participantName} ({stats?.isLocal ? "本地推流" : "远端拉流"})
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Mime Type:</span>
          <span className="text-discord-brand text-right break-all">
            {stats?.mimeType || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Player Core:</span>
          <span className="text-gray-300 text-right">
            {stats?.playerCore || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Video Info:</span>
          <span className="text-emerald-400 font-semibold text-right">
            {stats?.videoInfo || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Audio Info:</span>
          <span className="text-gray-300 text-right">
            {stats?.audioInfo || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Encoder:</span>
          <span className="text-gray-300 text-right truncate">
            {stats?.encoder || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Stream Host:</span>
          <span className="text-amber-400 text-right truncate">
            {stats?.streamHost || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">网络拓扑:</span>
          <span className="text-right font-semibold flex items-center gap-1 text-sky-400">
            <Network className="w-3 h-3 text-discord-brand" />
            <span>
              {stats?.topology === "SFU_SERVER"
                ? "LiveKit SFU (服务端转发)"
                : stats?.topology === "P2P_MESH"
                  ? "P2P Mesh (全网状直连)"
                  : stats?.topology === "P2P_DIRECT"
                    ? "P2P Direct (点对点打洞)"
                    : stats?.topology === "P2P_TREE_RELAY"
                      ? "P2P Tree Relay (树状中继)"
                      : stats?.topology || "未知"}
            </span>
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">连接架构:</span>
          <span
            className={`text-right font-semibold flex items-center gap-1 ${
              stats?.connectionMode.includes("P2P")
                ? "text-emerald-400"
                : "text-sky-400"
            }`}
          >
            <ShieldCheck className="w-3 h-3" />
            <span>{stats?.connectionMode || "未知"}</span>
          </span>
        </div>

        {stats?.holePunchStatus && (
          <div className="flex justify-between items-start gap-2">
            <span className="text-gray-400 flex-shrink-0">打洞状态:</span>
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
          <span className="text-gray-400 flex-shrink-0">IP 协议栈:</span>
          <span
            className={`text-right font-semibold flex items-center gap-1 ${
              stats?.ipVersion === "IPv6" ? "text-purple-400" : "text-blue-400"
            }`}
          >
            <Globe className="w-3 h-3" />
            <span>
              {stats?.ipVersion === "IPv6"
                ? "IPv6 (双栈优先)"
                : stats?.ipVersion === "IPv4"
                  ? "IPv4 (单栈)"
                  : "未知"}
            </span>
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">传输协议:</span>
          <span className="text-gray-300 text-right">
            {stats?.protocol || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Buffer / Jitter:</span>
          <span className="text-gray-300 text-right">
            {stats?.bufferLength || "未知"} / {stats?.jitter || "未知"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Decoded Frames:</span>
          <span className="text-gray-300 text-right">
            {stats?.decodedFrames || "N/A"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">下行/下载码率:</span>
          <span className="text-discord-brand font-semibold text-right">
            {stats?.downloadBitrate || "未知"}
          </span>
        </div>

        {stats?.uploadBitrate && (
          <div className="flex justify-between items-start gap-2">
            <span className="text-gray-400 flex-shrink-0">上行/推流码率:</span>
            <span className="text-indigo-400 font-semibold text-right">
              {stats.uploadBitrate}
            </span>
          </div>
        )}

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">物理 RTT / 延迟:</span>
          <span className="text-gray-300 text-right">
            {stats?.rtt || "N/A"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">丢包率 (Loss):</span>
          <span
            className={`text-right font-semibold ${
              stats?.packetLoss && parseFloat(stats.packetLoss) > 5
                ? "text-discord-danger"
                : "text-discord-green"
            }`}
          >
            {stats?.packetLoss || "未知"}
          </span>
        </div>
      </div>
    </div>
  );
};
