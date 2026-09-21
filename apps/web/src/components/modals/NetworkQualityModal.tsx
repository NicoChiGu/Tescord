import React, { useState, useEffect } from "react";
import { Activity, X, ShieldCheck, Wifi, Cpu, Radio } from "lucide-react";
import { Channel } from "@tescord/types";
import { useNetworkStats } from "../../hooks/useNetworkStats.js";
import { sframeManager } from "../../services/sframe.js";
import { audioEngine } from "../../services/audioEngine.js";

interface NetworkQualityModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel?: Channel | null;
  isNoiseSuppressionEnabled?: boolean;
}

export const NetworkQualityModal: React.FC<NetworkQualityModalProps> = ({
  isOpen,
  onClose,
  channel,
  isNoiseSuppressionEnabled,
}) => {
  const localStats = useNetworkStats();
  const [sframeStats, setSframeStats] = useState(() => sframeManager.getStats());

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
          className: "text-discord-green bg-discord-green/10 border-discord-green/30",
        };
      case "good":
        return {
          label: "良好 (Good)",
          className: "text-amber-400 bg-amber-400/10 border-amber-400/30",
        };
      case "poor":
        return {
          label: "较差 (Poor)",
          className: "text-discord-danger bg-discord-danger/10 border-discord-danger/30",
        };
      default:
        return {
          label: "极佳 (Excellent)",
          className: "text-discord-green bg-discord-green/10 border-discord-green/30",
        };
    }
  };

  const badge = getQualityBadge(localStats?.quality);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-[#313338] w-full max-w-lg rounded-2xl border border-[#3f4147] shadow-2xl overflow-hidden flex flex-col animate-scaleUp">
        {/* 标题栏 */}
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
                  当前房间：{channel.name}
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

        {/* 详细指标内容 */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* 本地上行网络指标卡片 */}
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

          {/* 媒体会话与安全参数 */}
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
                H.264 / VP8 Simulcast 自适应码率
              </span>
            </div>
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
            {channel?.isE2EE && (
              <div className="flex justify-between py-1 border-b border-[#35373c]">
                <span className="text-discord-textMuted">
                  SFrame 语音加密帧流
                </span>
                <span className="text-emerald-400 font-mono text-[11px]">
                  已加密 {sframeStats.framesEncrypted} 帧 / 已解密{" "}
                  {sframeStats.framesDecrypted} 帧 (防重放拦截:{" "}
                  {sframeStats.framesDroppedReplay})
                </span>
              </div>
            )}
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
        </div>

        {/* 底部按钮栏 */}
        <div className="bg-[#2b2d31] px-6 py-3 border-t border-[#383a40] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-lg bg-discord-brand text-white text-sm font-semibold hover:bg-discord-brand-hover transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
