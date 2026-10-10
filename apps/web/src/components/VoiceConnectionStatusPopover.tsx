import React, { useState, useEffect, useRef, useCallback } from "react";
import { Bug, ExternalLink, Lock, Check, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Channel, Guild, VoiceState, PeerLatencyReport } from "@tescord/types";
import { useNetworkStats } from "../hooks/useNetworkStats.js";
import { livekitService } from "../services/livekit.js";
import { voiceMeshManager } from "../services/p2p/VoiceMeshManager.js";
import { VOICE_ENGINE, resolveServerUrl } from "../config.js";
import { cloudflareRealtimeService } from "../services/cloudflare_realtime/index.js";
import { useAuthStore } from "../stores/useAuthStore.js";
import { getUserDisplayName } from "../utils/userDisplay.js";

interface VoiceConnectionStatusPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMoreStats: () => void;
  channel?: Channel | null;
  guild?: Guild | null;
  voiceStates?: VoiceState[];
}

interface PingSample {
  timeStr: string;
  rtt: number;
}

export const VoiceConnectionStatusPopover: React.FC<
  VoiceConnectionStatusPopoverProps
> = ({ isOpen, onClose, onOpenMoreStats, channel, guild, voiceStates }) => {
  const { t } = useTranslation(["voice", "common"]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const localStats = useNetworkStats();
  const userId = useAuthStore((state) => state.user?.id);
  const [copied, setCopied] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(new Set());

  // 纯语音 Mesh P2P 点对点各节点独立物理延迟状态
  const [peerLatencies, setPeerLatencies] = useState<
    Map<string, PeerLatencyReport>
  >(new Map());

  useEffect(() => {
    const unsubscribe = voiceMeshManager.onLatencyUpdate((reports) => {
      setPeerLatencies(new Map(reports));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // 记录最近有效 RTT，杜绝由于单次采样空窗导致的跳动闪烁
  const lastKnownRttRef = useRef<number | null>(null);

  // 初始化 ping 历史，优先继承 livekitService 持续采样的后台历史数据
  const [pingHistory, setPingHistory] = useState<PingSample[]>(() => {
    const history = livekitService.getLocalRttHistory?.() || [];
    if (history.length > 0) {
      return history.map((item) => {
        const d = new Date(item.timestamp);
        const m = d.getMinutes().toString().padStart(2, "0");
        const s = d.getSeconds().toString().padStart(2, "0");
        return { timeStr: `${m}:${s}`, rtt: item.rtt };
      });
    }
    return [];
  });

  // 时钟心跳驱动（用于刷新图表与时间刻度）
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // 判断媒体是否连接
  const mediaConnected =
    VOICE_ENGINE === "cloudflare_realtime"
      ? cloudflareRealtimeService.status === "connected"
      : livekitService.isConnected;

  // 滑动时间窗口检查（直接取执行时的 Date.now()，避免 React State 异步时序错位）
  const nowMs = Date.now();
  const statsAreFresh =
    !!channel?.id &&
    mediaConnected &&
    !!localStats &&
    Number.isFinite(localStats.timestamp) &&
    nowMs - localStats.timestamp < 10_000;

  const meshActive =
    !!channel?.id && mediaConnected && voiceMeshManager.getIsMeshActive();

  const rttSource = meshActive
    ? t("voice:connectionPopover.rttSourceP2P")
    : t("voice:connectionPopover.rttSourceSfu");

  // 计算当前有效 RTT（带有效值记忆平滑）
  const currentRtt = (() => {
    if (!statsAreFresh) {
      lastKnownRttRef.current = null;
      return null;
    }

    if (meshActive) {
      const activeLat = voiceMeshManager.getActiveSpeakerOrMedianLatency(null);
      if (activeLat.rtt > 0) {
        const val = Math.round(activeLat.rtt);
        lastKnownRttRef.current = val;
        return val;
      }
    } else if (localStats?.rtt && localStats.rtt > 0) {
      const val = Math.round(localStats.rtt);
      lastKnownRttRef.current = val;
      return val;
    }

    // 若当前周期因 RTCP 周期空窗无新采样，但仍在 10 秒新鲜期内，使用最后已知有效值
    return lastKnownRttRef.current;
  })();

  // 切换频道或用户时重置历史队列
  useEffect(() => {
    setPingHistory([]);
    lastKnownRttRef.current = null;
  }, [channel?.id, userId]);

  // 弹窗打开时，若历史样本不足且当前有可用 RTT，预填充基线走势，实现 Discord 式打开即见波形
  useEffect(() => {
    if (!isOpen || currentRtt === null) return;

    setPingHistory((prev) => {
      if (prev.length >= 2) return prev;
      // 基于当前测得 RTT 构造连贯基线
      const basePoints: PingSample[] = [];
      const d = new Date();
      for (let i = 5; i >= 0; i--) {
        const past = new Date(d.getTime() - i * 1500);
        const m = past.getMinutes().toString().padStart(2, "0");
        const s = past.getSeconds().toString().padStart(2, "0");
        // 允许微小的物理抖动，使得波形具有呼吸真实感
        const jitterOffset = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * (i % 3);
        basePoints.push({
          timeStr: `${m}:${s}`,
          rtt: Math.max(1, currentRtt + jitterOffset),
        });
      }
      return basePoints;
    });
  }, [isOpen, currentRtt]);

  // 定时采样并向历史队列推入新点
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      // 若数据已过期（超时 10 秒未更新），清空历史
      if (!statsAreFresh) {
        setPingHistory([]);
        return;
      }

      if (currentRtt !== null) {
        const d = new Date();
        const minutes = d.getMinutes().toString().padStart(2, "0");
        const seconds = d.getSeconds().toString().padStart(2, "0");
        setPingHistory((prev) => {
          const next = [
            ...prev.slice(-24),
            { timeStr: `${minutes}:${seconds}`, rtt: currentRtt },
          ];
          return next;
        });
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isOpen, statsAreFresh, currentRtt]);

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

  // P2P Mesh 直连统计与成员指标
  const connectedReports = Array.from(peerLatencies.values()).filter(
    (r) => r.status === "connected" && r.rtt > 0,
  );

  const allPeersAvgRtt =
    connectedReports.length > 0
      ? Math.round(
          connectedReports.reduce((s, r) => s + r.rtt, 0) /
            connectedReports.length,
        )
      : null;

  const validLosses = connectedReports
    .filter((r) => typeof r.packetLoss === "number")
    .map((r) => r.packetLoss!);

  const overallPacketLoss =
    validLosses.length > 0
      ? (validLosses.reduce((s, l) => s + l, 0) / validLosses.length).toFixed(1)
      : packetLossPercent;

  const maxMeshRtt = Math.max(150, ...connectedReports.map((r) => r.rtt));

  const getPeerUserInfo = (peerId: string) => {
    const vs = voiceStates?.find((v) => v.userId === peerId);
    const member = guild?.members?.find((m) => m.userId === peerId);
    const user = vs?.user;
    const displayName = getUserDisplayName(
      user || null,
      member,
      peerId.slice(0, 4),
    );
    const avatarUrl = user?.avatarUrl
      ? resolveServerUrl(user.avatarUrl)
      : undefined;
    return { displayName, avatarUrl };
  };

  // 网络状态健康主色调（Discord 标准：极佳绿 #23a55a / 轻微黄 #f0b232 / 警告红 #f23f43）
  const effectiveRtt = meshActive ? (allPeersAvgRtt ?? currentRtt) : currentRtt;
  const effectiveLoss = meshActive
    ? (overallPacketLoss ?? packetLossPercent)
    : packetLossPercent;

  const themeColor =
    (effectiveRtt ?? 0) >= 200 || Number(effectiveLoss ?? 0) > 5
      ? "#f23f43"
      : (effectiveRtt ?? 0) >= 100 || Number(effectiveLoss ?? 0) > 2
        ? "#f0b232"
        : "#23a55a";

  // 高保真 Discord Canvas 渲染逻辑 (Smooth Spline, Area Gradient, Pulsing Beacon)
  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(rect.width * dpr) ||
      canvas.height !== Math.round(rect.height * dpr)
    ) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    const rightMargin = 32;
    const topMargin = 8;
    const bottomMargin = 16;
    const chartWidth = width - rightMargin;
    const chartHeight = height - topMargin - bottomMargin;

    // 动态 Y 轴自适应刻度，保证波形处于舒展的黄金视觉中段
    const maxSample = Math.max(
      ...pingHistory.map((s) => s.rtt),
      currentRtt ?? 0,
      20,
    );
    const maxVal = Math.max(100, Math.ceil((maxSample * 1.35) / 50) * 50);

    // 绘制 3 条精致水平刻度虚线 (0, maxVal/2, maxVal)
    const scaleValues = [0, Math.round(maxVal / 2), maxVal];
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    scaleValues.forEach((val) => {
      const y = topMargin + chartHeight - (val / maxVal) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      // 纵坐标刻度文字
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = "9px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${val}`, width - 4, y + 3);
    });
    ctx.setLineDash([]); // 还原实线

    if (pingHistory.length >= 2) {
      // 计算所有点在画布上的平滑坐标
      const step = chartWidth / (pingHistory.length - 1);
      const points = pingHistory.map((sample, idx) => {
        const x = idx * step;
        const clampedRtt = Math.min(Math.max(sample.rtt, 0), maxVal);
        const y = topMargin + chartHeight - (clampedRtt / maxVal) * chartHeight;
        return { x, y, rtt: sample.rtt, timeStr: sample.timeStr };
      });

      // 1. 绘制三次贝塞尔平滑区域渐变填充
      const gradient = ctx.createLinearGradient(
        0,
        topMargin,
        0,
        topMargin + chartHeight,
      );
      gradient.addColorStop(0, `${themeColor}40`); // 25% 不透明度
      gradient.addColorStop(0.7, `${themeColor}10`);
      gradient.addColorStop(1, `${themeColor}00`); // 0%

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.lineTo(chartWidth, topMargin + chartHeight);
      ctx.lineTo(0, topMargin + chartHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // 2. 绘制平滑贝塞尔波形线条与微弱发光
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = themeColor;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0; // 重置发光阴影

      // 3. 在最新采样点绘制 Discord 式呼吸脉冲雷达圆点 (Pulsing Beacon)
      const lastPoint = points[points.length - 1];
      const pulseTime = (Date.now() % 1600) / 1600;
      const pulseRadius = 3 + pulseTime * 7;
      const pulseAlpha = (1 - pulseTime) * 0.6;

      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = `${themeColor}${Math.floor(pulseAlpha * 255)
        .toString(16)
        .padStart(2, "0")}`;
      ctx.fill();

      // 实心白芯微圆点
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 4. 鼠标悬停游标指示 (Hover Crosshair)
      if (hoverIndex !== null && points[hoverIndex]) {
        const hp = points[hoverIndex];
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hp.x, topMargin);
        ctx.lineTo(hp.x, topMargin + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // 浮动悬停数据气泡
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.beginPath();
        const tagText = `${hp.rtt}ms`;
        const tagWidth = ctx.measureText(tagText).width + 8;
        const tagX = Math.max(
          2,
          Math.min(chartWidth - tagWidth - 2, hp.x - tagWidth / 2),
        );
        const tagY = Math.max(topMargin + 2, hp.y - 18);
        ctx.roundRect(tagX, tagY, tagWidth, 14, 3);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(tagText, tagX + tagWidth / 2, tagY + 10);
      }

      // 5. 底部时间横轴标尺
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      if (points.length >= 3) {
        ctx.fillText(points[0].timeStr, 16, height - 2);
        const midIdx = Math.floor(points.length / 2);
        ctx.fillText(points[midIdx].timeStr, chartWidth / 2, height - 2);
        ctx.fillText(
          points[points.length - 1].timeStr,
          chartWidth - 16,
          height - 2,
        );
      }
    }

    ctx.restore();
  }, [pingHistory, currentRtt, themeColor, hoverIndex]);

  // 帧动画与尺寸变化响应式监听
  useEffect(() => {
    if (!isOpen) return;

    let animId: number;
    const renderLoop = () => {
      drawChart();
      animId = requestAnimationFrame(renderLoop);
    };
    animId = requestAnimationFrame(renderLoop);

    const observer = new ResizeObserver(() => {
      drawChart();
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [isOpen, drawChart]);

  // 鼠标在图表上滑动交互
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || pingHistory.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const rightMargin = 32;
    const chartWidth = rect.width - rightMargin;
    const offsetX = e.clientX - rect.left;
    if (offsetX < 0 || offsetX > chartWidth) {
      setHoverIndex(null);
      return;
    }
    const step = chartWidth / (pingHistory.length - 1);
    const index = Math.round(offsetX / step);
    setHoverIndex(Math.max(0, Math.min(pingHistory.length - 1, index)));
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  if (!isOpen) return null;

  const selectedPath =
    VOICE_ENGINE === "cloudflare_realtime"
      ? cloudflareRealtimeService.selectedCandidatePath
      : null;

  const connectionPath =
    VOICE_ENGINE === "cloudflare_realtime"
      ? selectedPath
        ? t(
            selectedPath.candidateType === "relay"
              ? "voice:connectionPopover.pathTurn"
              : "voice:connectionPopover.pathSfu",
            { protocol: selectedPath.protocol },
          )
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
      {/* 顶部标头：对齐 Discord 经典信号指示与状态 */}
      <div className="pt-3 px-4 pb-2.5 flex items-center justify-between border-b border-white/5 bg-[#232428]/40">
        <div className="flex items-center space-x-2">
          {/* 经典绿色信号塔指示图标 */}
          <div className="flex items-end space-x-0.5 h-3.5 w-3.5 text-[#23a55a]">
            <span className="w-1 h-1.5 bg-current rounded-sm" />
            <span className="w-1 h-2.5 bg-current rounded-sm" />
            <span className="w-1 h-3.5 bg-current rounded-sm" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">
              {t("voice:connectionPopover.title")}
            </h3>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              backgroundColor: themeColor,
              boxShadow: `0 0 6px ${themeColor}`,
            }}
          />
          <span className="text-[11px] font-semibold text-white/90">
            {rttSource}
          </span>
        </div>
      </div>

      <div className="px-4 pb-3 pt-3 space-y-3">
        {/* 实时示波波形图容器 或 P2P 成员延迟柱状图 */}
        {meshActive ? (
          <div
            data-testid="p2p-mesh-histogram"
            className="w-full h-36 bg-[#1e1f22]/90 rounded-lg p-2 relative border border-white/5 overflow-hidden flex flex-col justify-end"
          >
            {connectedReports.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-xs text-discord-textMuted">
                {noData}
              </div>
            ) : (
              <div className="flex items-end justify-around h-full gap-2 px-1 pt-6 pb-0.5">
                {connectedReports.map((report) => {
                  const { displayName, avatarUrl } = getPeerUserInfo(
                    report.targetUserId,
                  );
                  const barColor =
                    report.rtt < 100
                      ? "#23a55a"
                      : report.rtt <= 200
                        ? "#f0b232"
                        : "#f23f43";
                  const heightPercent = Math.min(
                    100,
                    Math.max(18, Math.round((report.rtt / maxMeshRtt) * 100)),
                  );

                  return (
                    <div
                      key={report.targetUserId}
                      data-testid={`p2p-histogram-bar-${report.targetUserId}`}
                      className="relative flex flex-col items-center h-full justify-end group/bar flex-1 max-w-[56px] select-none"
                    >
                      {/* 悬停详情 Tooltip */}
                      <div className="absolute bottom-full mb-1 opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none z-30 bg-[#111214]/95 backdrop-blur-md text-[10px] text-white p-2 rounded-lg shadow-2xl border border-white/10 whitespace-nowrap min-w-[120px]">
                        <div className="font-bold text-white mb-1 truncate max-w-[130px]">
                          {displayName}
                        </div>
                        <div className="space-y-0.5 font-mono text-discord-textMuted text-[9px]">
                          <div className="flex justify-between gap-2">
                            <span>RTT:</span>
                            <strong style={{ color: barColor }}>
                              {report.rtt}ms
                            </strong>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{t("voice:audioQuality.jitter")}:</span>
                            <span className="text-white/80">
                              {report.jitter !== undefined
                                ? `${report.jitter}ms`
                                : "--"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{t("voice:packetLoss")}:</span>
                            <span className="text-white/80">
                              {report.packetLoss !== undefined
                                ? `${report.packetLoss}%`
                                : "--"}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{t("voice:connectionMode")}:</span>
                            <span className="text-emerald-400">
                              {report.connectionType === "LAN"
                                ? t("voice:topology.lan")
                                : report.connectionType === "RELAY"
                                  ? t("voice:topology.relay")
                                  : t("voice:topology.p2p")}
                            </span>
                          </div>
                          {report.remoteAddress && (
                            <div className="flex justify-between gap-2 pt-0.5 border-t border-white/10 text-[8px]">
                              <span>IP:</span>
                              <span className="text-white/70 truncate max-w-[90px]">
                                {report.remoteAddress}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 柱顶：用户圆形头像 + 毫秒标签 */}
                      <div className="flex flex-col items-center mb-1 flex-shrink-0">
                        <div
                          className="w-5 h-5 rounded-full overflow-hidden border-2 shadow-sm mb-0.5"
                          style={{ borderColor: barColor }}
                        >
                          {avatarUrl && !failedAvatars.has(avatarUrl) ? (
                            <img
                              src={avatarUrl}
                              alt={displayName}
                              className="w-full h-full object-cover"
                              onError={() =>
                                setFailedAvatars((previous) =>
                                  new Set(previous).add(avatarUrl),
                                )
                              }
                            />
                          ) : (
                            <UserRound
                              aria-label={displayName}
                              className="w-full h-full text-discord-textMuted"
                            />
                          )}
                        </div>
                        <span
                          className="text-[9px] font-mono font-bold leading-none"
                          style={{ color: barColor }}
                        >
                          {report.rtt}ms
                        </span>
                      </div>

                      {/* 延迟柱条 */}
                      <div
                        className="w-4 sm:w-5 rounded-t transition-all duration-300"
                        style={{
                          height: `${heightPercent}%`,
                          backgroundColor: barColor,
                          boxShadow: `0 0 8px ${barColor}40`,
                        }}
                      />

                      {/* 底部成员名简写 */}
                      <span className="text-[9px] text-discord-textMuted truncate max-w-[48px] mt-0.5 leading-none">
                        {displayName}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="w-full h-28 bg-[#1e1f22]/90 rounded-lg p-1 relative border border-white/5 overflow-hidden cursor-crosshair"
          >
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
        )}

        {/* 服务器标识与核心指标 */}
        <div className="space-y-1.5 pt-0.5">
          <div className="text-sm font-bold text-white tracking-tight break-all">
            {meshActive
              ? `${t("voice:connectionPopover.directPeerTopology")} (${t("voice:nodeCount", { count: connectedReports.length })})`
              : connectionPath}
          </div>

          <div className="text-xs text-discord-textMuted space-y-0.5 leading-snug">
            {meshActive ? (
              <>
                <div className="flex items-center space-x-1">
                  <span>{t("voice:connectionPopover.allPeersAvgRtt")} :</span>
                  <strong className="text-white font-bold">
                    {allPeersAvgRtt === null
                      ? noData
                      : `${allPeersAvgRtt} ${msUnit}`}
                  </strong>
                </div>
                <div className="flex items-center space-x-1">
                  <span>
                    {t("voice:connectionPopover.overallPacketLoss")} :
                  </span>
                  <strong className="text-white font-bold">
                    {overallPacketLoss === null
                      ? noData
                      : `${overallPacketLoss}%`}
                  </strong>
                </div>
                <div className="flex items-center space-x-1">
                  <span>{t("voice:peerCount")} :</span>
                  <strong className="text-white font-bold">
                    {connectedReports.length}
                  </strong>
                </div>
                <div>{rttSource}</div>
              </>
            ) : (
              <>
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
                  <span>
                    {t(
                      VOICE_ENGINE === "cloudflare_realtime"
                        ? "voice:connectionPopover.uploadPacketLoss"
                        : "voice:connectionPopover.packetLoss",
                    )}{" "}
                    :
                  </span>
                  <strong className="text-white font-bold">
                    {packetLossPercent === null
                      ? noData
                      : `${packetLossPercent}%`}
                  </strong>
                </div>
                <div>{rttSource}</div>
              </>
            )}
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
                <span className="text-discord-green">{t("common:copied")}</span>
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
          <div
            className={`flex items-center space-x-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold select-none ${
              e2eeActive
                ? "bg-[#23a55a]/15 text-[#23a55a] border border-[#23a55a]/30"
                : "bg-white/5 text-discord-textMuted border border-white/10"
            }`}
          >
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {t(
                e2eeActive
                  ? "voice:connectionPopover.endToEndEncrypted"
                  : "voice:connectionPopover.encryptionUnverified",
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
