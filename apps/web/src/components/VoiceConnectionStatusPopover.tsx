import React, { useState, useEffect, useRef } from "react";
import { Bug, ExternalLink, Lock, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Channel } from "@tescord/types";
import { useNetworkStats } from "../hooks/useNetworkStats.js";
import { livekitService } from "../services/livekit.js";
import { voiceMeshManager } from "../services/p2p/VoiceMeshManager.js";
import { VOICE_ENGINE } from "../config.js";
import { cloudflareRealtimeService } from "../services/cloudflare_realtime/index.js";
import { useAuthStore } from "../stores/useAuthStore.js";

interface VoiceConnectionStatusPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMoreStats: () => void;
  channel?: Channel | null;
}

interface PingSample {
  timeStr: string;
  rtt: number;
}

export const VoiceConnectionStatusPopover: React.FC<
  VoiceConnectionStatusPopoverProps
> = ({ isOpen, onClose, onOpenMoreStats, channel }) => {
  const { t } = useTranslation(["voice", "common"]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const localStats = useNetworkStats();
  const userId = useAuthStore((state) => state.user?.id);
  const [copied, setCopied] = useState(false);
  const [pingHistory, setPingHistory] = useState<PingSample[]>([]);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    setPingHistory([]);
  }, [channel?.id, userId]);

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // NetworkStats timestamps are samples, not proof of a current connection.
  const mediaConnected =
    VOICE_ENGINE === "cloudflare_realtime"
      ? cloudflareRealtimeService.status === "connected"
      : livekitService.isConnected;
  const statsAreFresh =
    !!channel?.id &&
    mediaConnected &&
    !!localStats &&
    Number.isFinite(localStats.timestamp) &&
    now - localStats.timestamp < 10_000 &&
    localStats.timestamp <= now + 1000;
  const meshActive =
    !!channel?.id && mediaConnected && voiceMeshManager.getIsMeshActive();
  const rttSource = meshActive
    ? t("voice:connectionPopover.rttSourceP2P")
    : t("voice:connectionPopover.rttSourceSfu");
  const currentRtt = (() => {
    if (meshActive) {
      const activeLat = voiceMeshManager.getActiveSpeakerOrMedianLatency(null);
      return activeLat.rtt > 0 ? Math.round(activeLat.rtt) : null;
    }
    if (statsAreFresh && localStats?.rtt && localStats.rtt > 0) {
      return Math.round(localStats.rtt);
    }
    return null;
  })();

  // 采样并推入历史队列
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      const d = new Date();
      const minutes = d.getMinutes().toString().padStart(2, "0");
      const seconds = d.getSeconds().toString().padStart(2, "0");
      if (currentRtt === null) {
        setPingHistory([]);
        return;
      }

      setPingHistory((prev) => {
        const next = [
          ...prev.slice(-14),
          { timeStr: `${minutes}:${seconds}`, rtt: currentRtt },
        ];
        return next;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen, currentRtt, channel?.id, userId]);

  // 点击外部和按 Esc 自动关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Canvas 绘制实时波形折线图
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 绘制深色网格刻度背景
    const rightMargin = 32;
    const chartWidth = width - rightMargin;
    const chartHeight = height - 16;
    const maxVal = 200;

    // 水平刻度线 (0, 100, 200)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
    ctx.lineWidth = 1;
    [0, 100, 200].forEach((val) => {
      const y = chartHeight - (val / maxVal) * (chartHeight - 8);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      // 纵坐标文字
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(val.toString(), width - 4, y + 3);
    });

    if (pingHistory.length < 2) return;

    // 计算折线各点坐标
    const points: { x: number; y: number }[] = [];
    const step = chartWidth / (pingHistory.length - 1);

    pingHistory.forEach((sample, idx) => {
      const x = idx * step;
      const clampedRtt = Math.min(Math.max(sample.rtt, 0), maxVal);
      const y = chartHeight - (clampedRtt / maxVal) * (chartHeight - 8);
      points.push({ x, y });
    });

    // 绘制半透明渐变区域
    const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    gradient.addColorStop(0, "rgba(88, 101, 242, 0.35)");
    gradient.addColorStop(1, "rgba(88, 101, 242, 0.0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineTo(chartWidth, chartHeight);
    ctx.lineTo(0, chartHeight);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 绘制折线
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = "#5865F2";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // 底部时间刻度文字
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    if (pingHistory.length >= 4) {
      const p1 = pingHistory[0];
      const p2 = pingHistory[Math.floor(pingHistory.length / 2)];
      const p3 = pingHistory[pingHistory.length - 1];
      ctx.fillText(p1.timeStr, 15, height - 2);
      ctx.fillText(p2.timeStr, chartWidth / 2, height - 2);
      ctx.fillText(p3.timeStr, chartWidth - 15, height - 2);
    }
  }, [isOpen, pingHistory]);

  if (!isOpen) return null;

  // 计算平均 RTT 和丢包率
  const avgRtt =
    pingHistory.length > 0
      ? Math.round(
          pingHistory.reduce((acc, cur) => acc + cur.rtt, 0) /
            pingHistory.length,
        )
      : currentRtt;
  const lastRtt =
    pingHistory.length > 0
      ? pingHistory[pingHistory.length - 1].rtt
      : currentRtt;
  const packetLossPercent =
    statsAreFresh && typeof localStats?.packetLoss === "number"
      ? localStats.packetLoss.toFixed(1)
      : null;

  const selectedPath = VOICE_ENGINE === "cloudflare_realtime"
    ? cloudflareRealtimeService.selectedCandidatePath
    : null;
  const connectionPath = VOICE_ENGINE === "cloudflare_realtime"
    ? selectedPath
      ? t(selectedPath.candidateType === "relay"
        ? "voice:connectionPopover.pathTurn"
        : "voice:connectionPopover.pathSfu", { protocol: selectedPath.protocol })
      : t("voice:connectionPopover.noData")
    : livekitService.currentRoomName || t("voice:connectionPopover.noData");

  // 复制诊断日志
  const handleCopyDebug = () => {
    const report = [
      `[Tescord WebRTC Diagnostic Report]`,
      `Timestamp: ${new Date().toISOString()}`,
      `Selected Path: ${connectionPath}`,
      `RTT Source: ${rttSource}`,
      `Average RTT: ${avgRtt === null ? "N/A" : `${avgRtt}ms`}`,
      `Last RTT: ${lastRtt === null ? "N/A" : `${lastRtt}ms`}`,
      `Packet Loss: ${packetLossPercent === null ? "N/A" : `${packetLossPercent}%`}`,
      `Voice Engine: ${VOICE_ENGINE}`,
      `Mesh Active: ${voiceMeshManager.getIsMeshActive()}`,
      `Fallback SFU: ${voiceMeshManager.getIsFallbackToSFU()}`,
    ].join("\n");

    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const msUnit = t("voice:connectionPopover.msUnit");
  const noData = t("voice:connectionPopover.noData");
  const e2eeActive =
    VOICE_ENGINE === "cloudflare_realtime" &&
    cloudflareRealtimeService.isE2EEActive;

  return (
    <div
      ref={popoverRef}
      data-testid="voice-connection-popover"
      className="absolute bottom-full left-0 mb-2 w-[340px] max-w-[calc(100vw-24px)] bg-[#2b2d31] border border-[#35373c] rounded-xl shadow-2xl z-50 overflow-hidden text-discord-textHeader font-sans animate-in fade-in zoom-in-95 duration-150 select-none"
    >
      {/* 顶部标头 */}
      <div className="pt-3.5 px-4 pb-2">
        <h3 className="text-sm font-bold text-[#5865F2] tracking-wide">
          {t("voice:connectionPopover.title")}
        </h3>
        <div className="h-0.5 w-9 bg-[#5865F2] rounded-full mt-1.5" />
      </div>

      <div className="px-4 pb-3 space-y-3">
        {/* 实时折线图 */}
        <div className="w-full h-24 bg-[#1e1f22]/90 rounded-lg p-1 relative border border-white/5 overflow-hidden">
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>

        {/* 服务器标识与核心指标 */}
        <div className="space-y-1.5 pt-0.5">
          <div className="text-sm font-bold text-white tracking-tight break-all">
            {connectionPath}
          </div>

          <div className="text-xs text-discord-textMuted space-y-0.5 leading-snug">
            <div className="flex items-center space-x-1">
              <span>{t("voice:connectionPopover.avgPing")} :</span>
              <strong className="text-white font-bold">
                {avgRtt === null ? noData : `${avgRtt} ${msUnit}`}
              </strong>
            </div>
            <div className="flex items-center space-x-1">
              <span>{t("voice:connectionPopover.lastPing")} :</span>
              <strong className="text-white font-bold">
                {lastRtt === null ? noData : `${lastRtt} ${msUnit}`}
              </strong>
            </div>
            <div className="flex items-center space-x-1">
              <span>{t(VOICE_ENGINE === "cloudflare_realtime" ? "voice:connectionPopover.uploadPacketLoss" : "voice:connectionPopover.packetLoss")} :</span>
              <strong className="text-white font-bold">
                {packetLossPercent === null ? noData : `${packetLossPercent}%`}
              </strong>
            </div>
            <div>{rttSource}</div>
          </div>
        </div>

        {/* 说明文案 */}
        <p className="text-[11px] text-discord-textMuted leading-relaxed">
          {currentRtt === null && packetLossPercent === null
            ? noData
            : (currentRtt ?? 0) >= 250 || Number(packetLossPercent ?? 0) > 10
              ? t("voice:connectionPopover.statusWarning")
              : t("voice:connectionPopover.statusGood")}
        </p>

        {/* 经典双按钮：除错 / 更多数据 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            data-testid="connection-debug-btn"
            onClick={handleCopyDebug}
            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-[#383a40] hover:bg-[#404249] text-white text-xs font-medium rounded-lg transition active:scale-98"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-discord-green" />
                <span className="text-discord-green">
                  {t("common:copied")}
                </span>
              </>
            ) : (
              <>
                <Bug className="w-3.5 h-3.5" />
                <span>{t("voice:connectionPopover.btnDebug")}</span>
              </>
            )}
          </button>

          <button
            type="button"
            data-testid="connection-more-stats-btn"
            onClick={() => {
              onClose();
              onOpenMoreStats();
            }}
            className="flex items-center justify-center space-x-1.5 py-1.5 px-3 bg-[#383a40] hover:bg-[#404249] text-white text-xs font-medium rounded-lg transition active:scale-98"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t("voice:connectionPopover.btnMoreStats")}</span>
          </button>
        </div>

        {/* 底部绿色端到端加密条目 */}
        <div className="pt-0.5">
          <div className={`flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold select-none ${e2eeActive ? "bg-[#23a55a]/15 text-[#23a55a] border border-[#23a55a]/30" : "bg-white/5 text-discord-textMuted border border-white/10"}`}>
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{t(e2eeActive ? "voice:connectionPopover.endToEndEncrypted" : "voice:connectionPopover.encryptionUnverified")}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
