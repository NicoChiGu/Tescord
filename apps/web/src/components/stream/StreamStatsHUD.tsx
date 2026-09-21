import React, { useState, useEffect } from "react";
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
} from "lucide-react";

interface StreamStatsHUDProps {
  participantIdentity?: string;
  participantName?: string;
  onClose: () => void;
}

export const StreamStatsHUD: React.FC<StreamStatsHUDProps> = ({
  participantIdentity,
  participantName = "媒体流",
  onClose,
}) => {
  const [stats, setStats] = useState<StreamDetailedStats | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchStats = async () => {
      try {
        const s =
          await mediaStatsService.getDetailedStats(participantIdentity);
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
      const s =
        await mediaStatsService.getDetailedStats(participantIdentity);
      setStats(s);
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute top-4 right-4 z-40 w-80 sm:w-96 bg-[#111214]/92 backdrop-blur-md border border-[#3f4147] rounded-xl shadow-2xl p-3.5 text-xs font-mono text-gray-200 select-text animate-fade-in"
    >
      {/* 顶部标题与操作栏 */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2b2d31] mb-2.5">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-discord-green animate-pulse" />
          <span className="font-bold text-white text-[13px] tracking-wide">
            媒体属性与实时统计
          </span>
          <span className="text-[10px] bg-discord-brand/20 text-discord-brand px-1.5 py-0.2 rounded font-sans">
            HUD
          </span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={handleManualRefresh}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white transition"
            title="立即刷新数据"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-discord-brand" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[#35373c] text-gray-400 hover:text-white transition"
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
            className="p-1 rounded hover:bg-discord-danger/20 hover:text-discord-danger text-gray-400 transition"
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
            {stats?.mimeType || "video/VP8, audio/opus"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Player Core:</span>
          <span className="text-gray-300 text-right">
            {stats?.playerCore || "LiveKit WebRTC Core"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Video Info:</span>
          <span className="text-emerald-400 font-semibold text-right">
            {stats?.videoInfo || "1280x720, 30FPS"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Audio Info:</span>
          <span className="text-gray-300 text-right">
            {stats?.audioInfo || "48KHz, Stereo, 64Kbps"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Encoder:</span>
          <span className="text-gray-300 text-right truncate">
            {stats?.encoder || "libwebrtc ScreenCapture"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Stream Host:</span>
          <span className="text-amber-400 text-right truncate">
            {stats?.streamHost || "livekit.tescord.local"}
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
                      : stats?.topology || "SFU 服务端"}
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
            <span>{stats?.connectionMode || "SFU Direct"}</span>
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
              {stats?.ipVersion === "IPv6" ? "IPv6 (双栈优先)" : "IPv4 (单栈)"}
            </span>
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">传输协议:</span>
          <span className="text-gray-300 text-right">
            {stats?.protocol || "UDP"}
          </span>
        </div>

        <div className="flex justify-between items-start gap-2">
          <span className="text-gray-400 flex-shrink-0">Buffer / Jitter:</span>
          <span className="text-gray-300 text-right">
            {stats?.bufferLength || "12ms"} / {stats?.jitter || "0.8ms"}
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
            {stats?.downloadBitrate || "0 Kbps"}
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
            {stats?.packetLoss || "0.0%"}
          </span>
        </div>
      </div>
    </div>
  );
};
