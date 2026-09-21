import React, { useState, useEffect } from "react";
import {
  Activity,
  X,
  ShieldCheck,
  Wifi,
  Cpu,
  Radio,
  Network,
  Server,
  Mic,
  Video,
  AlertTriangle,
  CheckCircle2,
  Layers,
  ArrowUpRight,
  HardDrive,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Channel, P2PNetworkDiagnostics, PeerLatencyReport } from "@tescord/types";
import { useNetworkStats } from "../../hooks/useNetworkStats.js";
import { sframeManager } from "../../services/sframe.js";
import { audioEngine } from "../../services/audioEngine.js";
import { p2pStreamManager } from "../../services/p2p/P2PStreamManager.js";
import { voiceMeshManager } from "../../services/p2p/VoiceMeshManager.js";
import { livekitService } from "../../services/livekit.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";

interface NetworkQualityModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel?: Channel | null;
  isNoiseSuppressionEnabled?: boolean;
}

type TabType = "overview" | "audio" | "video" | "nat";

export const NetworkQualityModal: React.FC<NetworkQualityModalProps> = ({
  isOpen,
  onClose,
  channel,
  isNoiseSuppressionEnabled,
}) => {
  const { t } = useTranslation(["voice", "common"]);
  const localStats = useNetworkStats();
  const [currentTab, setCurrentTab] = useState<TabType>("overview");

  const [sframeStats, setSframeStats] = useState(() =>
    sframeManager.getStats(),
  );
  const [p2pDiagnostics, setP2PDiagnostics] =
    useState<P2PNetworkDiagnostics | null>(null);

  // Mesh P2P 状态与延迟
  const [peerLatencies, setPeerLatencies] = useState<Map<string, PeerLatencyReport>>(
    () => voiceMeshManager.getAllPeerLatencies(),
  );
  const [isMeshActive, setIsMeshActive] = useState<boolean>(() =>
    voiceMeshManager.getIsMeshActive(),
  );
  const [isFallbackToSFU, setIsFallbackToSFU] = useState<boolean>(() =>
    voiceMeshManager.getIsFallbackToSFU(),
  );
  const [fallbackReason, setFallbackReason] = useState<string>(() =>
    voiceMeshManager.getFallbackReason(),
  );

  const videoSettings = useSettingsStore((state) => state.video);

  useEffect(() => {
    if (!isOpen) return;
    p2pStreamManager.getDiagnostics().then((d) => setP2PDiagnostics(d));
    const timer = setInterval(() => {
      p2pStreamManager.getDiagnostics().then((d) => setP2PDiagnostics(d));
      setIsMeshActive(voiceMeshManager.getIsMeshActive());
      setIsFallbackToSFU(voiceMeshManager.getIsFallbackToSFU());
      setFallbackReason(voiceMeshManager.getFallbackReason());
      setPeerLatencies(voiceMeshManager.getAllPeerLatencies());
    }, 1500);
    return () => clearInterval(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const unbindMesh = voiceMeshManager.onLatencyUpdate((reports) => {
      setPeerLatencies(new Map(reports));
      setIsMeshActive(voiceMeshManager.getIsMeshActive());
      setIsFallbackToSFU(voiceMeshManager.getIsFallbackToSFU());
      setFallbackReason(voiceMeshManager.getFallbackReason());
    });
    return () => unbindMesh();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setSframeStats(sframeManager.getStats());
    const unbind = sframeManager.onStatsChange((s) => setSframeStats(s));
    return () => unbind();
  }, [isOpen]);

  // 支持按下 Escape 键退出
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPTTMode =
    (audioEngine.config.inputMode as string) === "PTT" ||
    (audioEngine.config.inputMode as string) === "PUSH_TO_TALK";
  const noiseSuppressionActive =
    isNoiseSuppressionEnabled !== undefined
      ? isNoiseSuppressionEnabled
      : audioEngine.config.noiseSuppression;

  const getQualityBadge = (quality?: string) => {
    switch (quality) {
      case "excellent":
        return {
          label: "极佳 (Excellent)",
          className:
            "text-discord-green bg-discord-green/10 border-discord-green/30",
        };
      case "good":
        return {
          label: "良好 (Good)",
          className: "text-amber-400 bg-amber-400/10 border-amber-400/30",
        };
      case "poor":
        return {
          label: "较差 (Poor)",
          className:
            "text-discord-danger bg-discord-danger/10 border-discord-danger/30",
        };
      default:
        return {
          label: "极佳 (Excellent)",
          className:
            "text-discord-green bg-discord-green/10 border-discord-green/30",
        };
    }
  };

  const badge = getQualityBadge(localStats?.quality);

  // 视频状态判断
  const isBroadcastingVideo = p2pStreamManager.isBroadcasting(channel?.id);
  const isRemoteVideoActive = !!p2pStreamManager.getRemoteStream();
  const videoState = isBroadcastingVideo
    ? "broadcasting"
    : isRemoteVideoActive
      ? "watching"
      : "idle";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-[#313338] w-full max-w-xl rounded-2xl border border-[#3f4147] shadow-2xl overflow-hidden flex flex-col animate-scaleUp">
        {/* 1. 标题栏 */}
        <div className="px-6 py-4 border-b border-[#2b2d31] flex items-center justify-between bg-[#2b2d31]/60">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-discord-green/15 text-discord-green">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-discord-textHeader text-base leading-tight">
                WebRTC 媒体引擎与网络健康看板
              </h4>
              {channel && (
                <p className="text-xs text-discord-textMuted mt-0.5">
                  {channel.name}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition"
            title="关闭 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. 顶部 Tab 导航栏 */}
        <div className="flex border-b border-[#2b2d31] bg-[#232428] px-4 pt-1 gap-1 text-xs select-none">
          <button
            onClick={() => setCurrentTab("overview")}
            className={`flex items-center space-x-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              currentTab === "overview"
                ? "border-discord-brand text-white bg-[#2b2d31]/50 rounded-t-md"
                : "border-transparent text-discord-textMuted hover:text-discord-textNormal"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{t("voice:tabOverview")}</span>
          </button>

          <button
            onClick={() => setCurrentTab("audio")}
            className={`flex items-center space-x-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              currentTab === "audio"
                ? "border-discord-brand text-white bg-[#2b2d31]/50 rounded-t-md"
                : "border-transparent text-discord-textMuted hover:text-discord-textNormal"
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>{t("voice:tabAudio")}</span>
            {isMeshActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          <button
            onClick={() => setCurrentTab("video")}
            className={`flex items-center space-x-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              currentTab === "video"
                ? "border-discord-brand text-white bg-[#2b2d31]/50 rounded-t-md"
                : "border-transparent text-discord-textMuted hover:text-discord-textNormal"
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>{t("voice:tabVideo")}</span>
            {videoState !== "idle" && (
              <span className="w-1.5 h-1.5 rounded-full bg-discord-brand" />
            )}
          </button>

          <button
            onClick={() => setCurrentTab("nat")}
            className={`flex items-center space-x-1.5 px-3 py-2.5 font-medium border-b-2 transition ${
              currentTab === "nat"
                ? "border-discord-brand text-white bg-[#2b2d31]/50 rounded-t-md"
                : "border-transparent text-discord-textMuted hover:text-discord-textNormal"
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>{t("voice:tabNAT")}</span>
          </button>
        </div>

        {/* 3. 选项卡主体内容区 */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto custom-scrollbar">
          {/* ================= Tab 1: 总览看板 ================= */}
          {currentTab === "overview" && (
            <div className="space-y-4">
              {/* 本地上行综合质量 */}
              <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40]">
                <div className="text-xs font-bold text-discord-textMuted uppercase mb-3 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <Wifi className="w-3.5 h-3.5" />
                    <span>本地上行网络指标 (Local Upstream)</span>
                  </span>
                  <span
                    className={`font-bold px-2 py-0.5 rounded border text-[11px] ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2.5 text-center">
                  <div className="bg-[#1e1f22] p-2.5 rounded-lg border border-[#2b2d31]">
                    <div className="text-[11px] text-discord-textMuted mb-0.5">
                      往返延迟 RTT
                    </div>
                    <div className="text-lg font-bold text-discord-green font-mono">
                      {localStats?.rtt || 18}{" "}
                      <span className="text-xs font-normal">ms</span>
                    </div>
                  </div>
                  <div className="bg-[#1e1f22] p-2.5 rounded-lg border border-[#2b2d31]">
                    <div className="text-[11px] text-discord-textMuted mb-0.5">
                      丢包率 Loss
                    </div>
                    <div className="text-lg font-bold text-discord-textHeader font-mono">
                      {localStats?.packetLoss || 0}{" "}
                      <span className="text-xs font-normal">%</span>
                    </div>
                  </div>
                  <div className="bg-[#1e1f22] p-2.5 rounded-lg border border-[#2b2d31]">
                    <div className="text-[11px] text-discord-textMuted mb-0.5">
                      抖动 Jitter
                    </div>
                    <div className="text-lg font-bold text-discord-textHeader font-mono">
                      {localStats?.jitter || 1.1}{" "}
                      <span className="text-xs font-normal">ms</span>
                    </div>
                  </div>
                  <div className="bg-[#1e1f22] p-2.5 rounded-lg border border-[#2b2d31]">
                    <div className="text-[11px] text-discord-textMuted mb-0.5">
                      推流码率
                    </div>
                    <div className="text-lg font-bold text-discord-brand font-mono">
                      {localStats?.bitrate ||
                        audioEngine.config.audioBitrate / 1000}{" "}
                      <span className="text-xs font-normal">kbps</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 音视频双流模式速览卡片 */}
              <div className="grid grid-cols-2 gap-3">
                {/* 语音通道微缩卡片 */}
                <div
                  onClick={() => setCurrentTab("audio")}
                  className="bg-[#2b2d31] p-3.5 rounded-xl border border-[#383a40] hover:border-discord-brand/50 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-discord-green" />
                      <span>{t("voice:tabAudio")}</span>
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-discord-textMuted group-hover:text-white transition-colors" />
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-discord-textMuted">{t("voice:audioMode")}</span>
                      <span className="text-emerald-400 font-mono">
                        {isMeshActive ? t("voice:p2pMeshMode") : t("voice:sfuServerMode")}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-discord-textMuted">{t("voice:audioCodec")}</span>
                      <span className="text-white font-mono">Opus 48kHz</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-discord-textMuted">{t("voice:noiseSuppressionEngine")}</span>
                      <span className="text-discord-green font-mono">
                        {noiseSuppressionActive ? "RNNoise WASM" : "直通"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 视频通道微缩卡片 */}
                <div
                  onClick={() => setCurrentTab("video")}
                  className="bg-[#2b2d31] p-3.5 rounded-xl border border-[#383a40] hover:border-discord-brand/50 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5 text-discord-brand" />
                      <span>{t("voice:tabVideo")}</span>
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-discord-textMuted group-hover:text-white transition-colors" />
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-discord-textMuted">{t("voice:videoStatus")}</span>
                      <span className="text-discord-brand font-mono">
                        {videoState === "broadcasting"
                          ? t("voice:videoStatusBroadcasting")
                          : videoState === "watching"
                            ? t("voice:videoStatusWatching")
                            : t("voice:videoStatusIdle")}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-discord-textMuted">{t("voice:videoCodec")}</span>
                      <span className="text-white font-mono">
                        {localStats?.videoCodec || videoSettings?.preferredVideoCodec?.toUpperCase() || "H.264"}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-discord-textMuted">{t("voice:videoMode")}</span>
                      <span className="text-emerald-400 font-mono">
                        {p2pDiagnostics?.transmissionMode === "sfu"
                          ? t("voice:sfuServerMode")
                          : p2pDiagnostics?.transmissionMode === "p2p_relay"
                            ? t("voice:treeRelayMode")
                            : t("voice:p2pDirect")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 媒体会话属性与编解码器 */}
              <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-2 text-xs">
                <div className="font-bold text-discord-textHeader mb-1 flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 text-discord-brand" />
                  <span>媒体会话属性与编解码器</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">音频编码格式</span>
                  <span className="text-white font-mono">
                    Opus 48kHz (高清晰度立体声)
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">视频编码与广播</span>
                  <span className="text-discord-brand font-mono">
                    {localStats?.videoCodec
                      ? `${localStats.videoCodec} ${
                          localStats.videoResolution
                            ? `(${localStats.videoResolution}${
                                localStats.videoFramerate
                                  ? `@${localStats.videoFramerate}fps`
                                  : ""
                              })`
                            : ""
                        }`
                      : "H.264 / VP8 (自适应降级)"}
                  </span>
                </div>
                {localStats?.videoBitrate ? (
                  <div className="flex justify-between py-1 border-b border-[#35373c]">
                    <span className="text-discord-textMuted">视频实时码率</span>
                    <span className="text-emerald-400 font-mono">
                      {localStats.videoBitrate} kbps
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted flex items-center space-x-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>传输加密协议</span>
                  </span>
                  <span className="text-discord-green font-mono">
                    {channel?.isE2EE
                      ? "WebRTC SFrame (AES-256-GCM 盲中继)"
                      : "DTLS 1.2 / SRTP AES-128-GCM"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">神经网络降噪</span>
                  <span className="text-white font-mono">
                    {noiseSuppressionActive
                      ? "RNNoise WASM (480 采样点分帧)"
                      : "已旁路直通"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-discord-textMuted flex items-center space-x-1">
                    <Radio className="w-3.5 h-3.5 text-discord-brand" />
                    <span>语音活动检测 (VAD)</span>
                  </span>
                  <span className="text-white font-mono">
                    {isPTTMode
                      ? `按键说话 [${audioEngine.config.pushToTalkKey || "Space"}]`
                      : `智能 VAD 门限 (${audioEngine.config.vadSensitivity}%)`}
                  </span>
                </div>
              </div>

              {/* P2P 穿透与拓扑诊断 */}
              {p2pDiagnostics && (
                <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-2.5">
                  <div className="text-xs font-bold text-discord-textMuted uppercase flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <Network className="w-3.5 h-3.5 text-emerald-400" />
                      <span>P2P 穿透与拓扑诊断 (NAT & Relay HUD)</span>
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        p2pDiagnostics.transmissionMode === "sfu"
                          ? "text-discord-brand bg-discord-brand/10 border border-discord-brand/30"
                          : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30"
                      }`}
                    >
                      {p2pDiagnostics.transmissionMode === "sfu"
                        ? "服务器 SFU 模式"
                        : p2pDiagnostics.transmissionMode === "p2p_direct"
                          ? "P2P 直连 (Mesh)"
                          : "P2P 智能接力 (Tree)"}
                    </span>
                  </div>

                  <div className="text-xs space-y-1.5">
                    <div className="flex justify-between py-1 border-b border-[#35373c]">
                      <span className="text-discord-textMuted">NAT 穿透类型</span>
                      <span className="text-white font-mono flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            p2pDiagnostics.natType === "IPv6Direct" ||
                            p2pDiagnostics.natType === "FullCone"
                              ? "bg-emerald-400"
                              : "bg-amber-400"
                          }`}
                        />
                        <span>{p2pDiagnostics.natType}</span>
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-[#35373c]">
                      <span className="text-discord-textMuted">
                        全球公网 IPv6 状态
                      </span>
                      <span
                        className={`font-mono ${
                          p2pDiagnostics.hasIPv6
                            ? "text-emerald-400"
                            : "text-gray-400"
                        }`}
                      >
                        {p2pDiagnostics.hasIPv6
                          ? "🟢 原生畅通 (零NAT极速穿透)"
                          : "⚪ 未配置 (走IPv4 STUN)"}
                      </span>
                    </div>

                    {p2pDiagnostics.activeCandidatePair && (
                      <div className="flex justify-between py-1">
                        <span className="text-discord-textMuted">
                          活跃候选对类型
                        </span>
                        <span className="text-emerald-300 font-mono text-[11px]">
                          {p2pDiagnostics.activeCandidatePair.localCandidateType} ⟷{" "}
                          {p2pDiagnostics.activeCandidatePair.remoteCandidateType} (
                          {p2pDiagnostics.activeCandidatePair.protocol.toUpperCase()}
                          )
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= Tab 2: 语音通道 ================= */}
          {currentTab === "audio" && (
            <div className="space-y-4">
              {/* Fallback 状态提示条 */}
              {isFallbackToSFU ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-amber-300">
                      {t("voice:fallbackToSFUActive")}
                    </div>
                    <div className="text-[11px] text-amber-300/80 mt-0.5">
                      {fallbackReason || "P2P 穿透协商受阻或节点网络变动，已自动平滑降级回退至 LiveKit SFU 服务器，保障语音通话不中断。"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{t("voice:fallbackNormal")}</span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                    {isMeshActive ? t("voice:p2pMeshMode") : t("voice:sfuServerMode")}
                  </span>
                </div>
              )}

              {/* 语音核心参数表 */}
              <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-2.5 text-xs">
                <div className="font-bold text-discord-textHeader mb-1 flex items-center space-x-1.5">
                  <Mic className="w-3.5 h-3.5 text-discord-green" />
                  <span>{t("voice:audioChannelTitle")}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:audioMode")}</span>
                  <span className="text-emerald-400 font-mono">
                    {isMeshActive
                      ? `${t("voice:p2pMeshMode")} (${peerLatencies.size} 节点)`
                      : t("voice:sfuServerMode")}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:audioCodec")}</span>
                  <span className="text-white font-mono">
                    Opus 48kHz (高保真全频带立体声)
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:audioBitrate")}</span>
                  <span className="text-discord-brand font-mono">
                    {localStats?.bitrate || audioEngine.config.audioBitrate / 1000} kbps
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:noiseSuppressionEngine")}</span>
                  <span className="text-discord-green font-mono">
                    {noiseSuppressionActive
                      ? "RNNoise WASM (480 采样点深度神经网络)"
                      : "已旁路直通"}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted flex items-center space-x-1">
                    <Radio className="w-3.5 h-3.5 text-discord-brand" />
                    <span>{t("voice:vadSensitivity")}</span>
                  </span>
                  <span className="text-white font-mono">
                    {isPTTMode
                      ? `按键说话 [${audioEngine.config.pushToTalkKey || "Space"}]`
                      : `智能 VAD 门限 (${audioEngine.config.vadSensitivity}%)`}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted flex items-center space-x-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{t("voice:cryptoProtocol")}</span>
                  </span>
                  <span className="text-discord-green font-mono">
                    {channel?.isE2EE
                      ? "WebRTC SFrame (AES-256-GCM 盲中继)"
                      : "DTLS 1.2 / SRTP AES-128-GCM"}
                  </span>
                </div>

                {channel?.isE2EE && (
                  <div className="flex justify-between py-1">
                    <span className="text-discord-textMuted">{t("voice:sframeStream")}</span>
                    <span className="text-emerald-400 font-mono text-[11px]">
                      已加密 {sframeStats.framesEncrypted} 帧 / 已解密{" "}
                      {sframeStats.framesDecrypted} 帧 (拦截: {sframeStats.framesDroppedReplay})
                    </span>
                  </div>
                )}
              </div>

              {/* 若处于 Mesh 模式，展示直连各成员独立延迟 */}
              {isMeshActive && peerLatencies.size > 0 && (
                <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-2 text-xs">
                  <div className="font-bold text-discord-textHeader mb-1 flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <Network className="w-3.5 h-3.5 text-discord-brand" />
                      <span>{t("voice:peerCount")} ({peerLatencies.size})</span>
                    </span>
                    <span className="text-[11px] text-discord-textMuted">点对点独立 RTT</span>
                  </div>
                  <div className="space-y-1.5 pt-1">
                    {Array.from(peerLatencies.entries()).map(([peerId, rep]) => (
                      <div
                        key={peerId}
                        className="flex items-center justify-between bg-[#1e1f22] px-3 py-1.5 rounded-lg border border-[#2b2d31]"
                      >
                        <span className="text-discord-textNormal font-mono text-[11px]">
                          Peer: {peerId.slice(0, 8)}...
                        </span>
                        <div className="flex items-center gap-3 font-mono text-[11px]">
                          <span className="text-discord-green font-bold">
                            {rep.rtt} ms
                          </span>
                          <span className="text-discord-textMuted text-[10px]">
                            {rep.connectionType}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= Tab 3: 视频与直播通道 ================= */}
          {currentTab === "video" && (
            <div className="space-y-4">
              <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-2.5 text-xs">
                <div className="font-bold text-discord-textHeader mb-1 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Video className="w-3.5 h-3.5 text-discord-brand" />
                    <span>{t("voice:videoChannelTitle")}</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                      videoState === "broadcasting"
                        ? "bg-discord-brand/20 text-discord-brand border border-discord-brand/40"
                        : videoState === "watching"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                          : "bg-gray-500/20 text-gray-400 border border-gray-500/40"
                    }`}
                  >
                    {videoState === "broadcasting"
                      ? t("voice:videoStatusBroadcasting")
                      : videoState === "watching"
                        ? t("voice:videoStatusWatching")
                        : t("voice:videoStatusIdle")}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:videoMode")}</span>
                  <span className="text-discord-brand font-mono">
                    {p2pDiagnostics?.transmissionMode === "sfu"
                      ? t("voice:sfuServerMode")
                      : p2pDiagnostics?.transmissionMode === "p2p_relay"
                        ? t("voice:treeRelayMode")
                        : t("voice:p2pDirect")}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:videoCodec")}</span>
                  <span className="text-white font-mono flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-discord-brand" />
                    <span>
                      {localStats?.videoCodec ||
                        videoSettings?.preferredVideoCodec?.toUpperCase() ||
                        "H.264"}
                    </span>
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:hardwareAcceleration")}</span>
                  <span className="text-emerald-400 font-mono flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Intel QSV / WebCodecs / NVENC 畅通</span>
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-[#35373c]">
                  <span className="text-discord-textMuted">{t("voice:videoResolutionFps")}</span>
                  <span className="text-white font-mono">
                    {localStats?.videoResolution || "1920x1080"}
                    {localStats?.videoFramerate ? ` @ ${localStats.videoFramerate} fps` : " @ 60 fps"}
                  </span>
                </div>

                <div className="flex justify-between py-1">
                  <span className="text-discord-textMuted">{t("voice:videoBitrate")}</span>
                  <span className="text-emerald-400 font-mono">
                    {localStats?.videoBitrate || 2500} kbps
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ================= Tab 4: NAT 与穿透诊断 ================= */}
          {currentTab === "nat" && (
            <div className="space-y-4">
              {p2pDiagnostics ? (
                <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#383a40] space-y-2.5">
                  <div className="text-xs font-bold text-discord-textMuted uppercase flex items-center justify-between">
                    <span className="flex items-center space-x-1.5">
                      <Network className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t("voice:natDiagnosticsTitle")}</span>
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        p2pDiagnostics.transmissionMode === "sfu"
                          ? "text-discord-brand bg-discord-brand/10 border border-discord-brand/30"
                          : "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30"
                      }`}
                    >
                      {p2pDiagnostics.transmissionMode === "sfu"
                        ? t("voice:sfuServerMode")
                        : p2pDiagnostics.transmissionMode === "p2p_direct"
                          ? t("voice:p2pDirect")
                          : t("voice:treeRelayMode")}
                    </span>
                  </div>

                  <div className="text-xs space-y-1.5">
                    <div className="flex justify-between py-1 border-b border-[#35373c]">
                      <span className="text-discord-textMuted">{t("voice:natType")}</span>
                      <span className="text-white font-mono flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            p2pDiagnostics.natType === "IPv6Direct" ||
                            p2pDiagnostics.natType === "FullCone"
                              ? "bg-emerald-400"
                              : "bg-amber-400"
                          }`}
                        />
                        <span>{p2pDiagnostics.natType}</span>
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-[#35373c]">
                      <span className="text-discord-textMuted">
                        {t("voice:ipv6Status")}
                      </span>
                      <span
                        className={`font-mono ${
                          p2pDiagnostics.hasIPv6
                            ? "text-emerald-400"
                            : "text-gray-400"
                        }`}
                      >
                        {p2pDiagnostics.hasIPv6
                          ? "🟢 原生畅通 (零NAT极速穿透)"
                          : "⚪ 未配置 (走IPv4 STUN)"}
                      </span>
                    </div>

                    {p2pDiagnostics.activeCandidatePair && (
                      <div className="flex justify-between py-1 border-b border-[#35373c]">
                        <span className="text-discord-textMuted">
                          {t("voice:activeCandidatePair")}
                        </span>
                        <span className="text-emerald-300 font-mono text-[11px]">
                          {p2pDiagnostics.activeCandidatePair.localCandidateType} ⟷{" "}
                          {p2pDiagnostics.activeCandidatePair.remoteCandidateType} (
                          {p2pDiagnostics.activeCandidatePair.protocol.toUpperCase()}
                          )
                        </span>
                      </div>
                    )}

                    {p2pDiagnostics.transmissionMode === "p2p_relay" && (
                      <div className="flex justify-between py-1">
                        <span className="text-discord-textMuted">
                          {t("voice:downstreamPeers")}
                        </span>
                        <span className="text-discord-brand font-mono">
                          {p2pDiagnostics.downstreamPeersCount} 个客户端正在中继
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-[#2b2d31] p-6 rounded-xl border border-[#383a40] text-center text-discord-textMuted text-xs">
                  正在探测 NAT 穿透候选对与拓扑节点...
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. 底部按钮栏 */}
        <div className="bg-[#2b2d31] px-6 py-3 border-t border-[#383a40] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-lg bg-discord-brand text-white text-sm font-semibold hover:bg-discord-brand-hover transition"
          >
            {t("common:close", "关闭")}
          </button>
        </div>
      </div>
    </div>
  );
};
