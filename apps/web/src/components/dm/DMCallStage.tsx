import React, { useState, useEffect, useRef } from "react";
import { User, ClientCallState } from "@tescord/types";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  ScreenShare,
  ScreenShareOff,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Sliders,
  ShieldCheck,
  Wifi,
  Tv,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDMCallStore } from "../../stores/dmCallStore.js";

interface DMCallStageProps {
  channelId: string;
  currentUser: User;
  targetUser: User;
  callState: ClientCallState;
  hasVideo: boolean;
  onCancelCall: () => void;
  onHangup: () => void;
  isMuted: boolean;
  isDeafened: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  isNoiseSuppressionEnabled: boolean;
  noiseSuppressionMode: "off" | "rnnoise" | "dtln" | "dfn3";
  onToggleNoiseSuppression: () => void;
  isSpeakingLocal: boolean;
  isSpeakingRemote: boolean;
  localVideoTrack?: any;
  remoteVideoTrack?: any;
  screenShareTrack?: any;
  encryption?: {
    status: string;
    fingerprint?: string;
  };
}

export const DMCallStage: React.FC<DMCallStageProps> = ({
  currentUser,
  targetUser,
  callState,
  onCancelCall,
  onHangup,
  isMuted,
  isDeafened,
  isVideoEnabled,
  isScreenSharing,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onToggleScreenShare,
  isNoiseSuppressionEnabled,
  noiseSuppressionMode,
  onToggleNoiseSuppression,
  isSpeakingLocal,
  isSpeakingRemote,
  localVideoTrack,
  remoteVideoTrack,
  screenShareTrack,
  encryption,
}) => {
  const { t } = useTranslation(["voice", "chat", "common"]);
  const {
    isStageCollapsed,
    toggleStageCollapsed,
    videoFitMode,
    setVideoFitMode,
    remoteVolume,
    setRemoteVolume,
    callStartTime,
  } = useDMCallStore();

  const [callDuration, setCallDuration] = useState("00:00");
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement | null>(null);

  // 通话计时器驱动
  useEffect(() => {
    if (callState !== "connected" || !callStartTime) {
      setCallDuration("00:00");
      return;
    }
    const updateTimer = () => {
      const elapsedSeconds = Math.floor((Date.now() - callStartTime) / 1000);
      const mins = Math.floor(elapsedSeconds / 60)
        .toString()
        .padStart(2, "0");
      const secs = (elapsedSeconds % 60).toString().padStart(2, "0");
      setCallDuration(`${mins}:${secs}`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [callState, callStartTime]);

  // 绑定本地摄像头 Track
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el || !localVideoTrack) return;
    try {
      if (typeof localVideoTrack.attach === "function") {
        localVideoTrack.attach(el);
      } else if (localVideoTrack instanceof MediaStreamTrack) {
        el.srcObject = new MediaStream([localVideoTrack]);
      } else if (localVideoTrack instanceof MediaStream) {
        el.srcObject = localVideoTrack;
      }
    } catch {}
    return () => {
      try {
        if (typeof localVideoTrack?.detach === "function" && el) {
          localVideoTrack.detach(el);
        } else if (el) {
          el.srcObject = null;
        }
      } catch {}
    };
  }, [localVideoTrack]);

  // 绑定远端摄像头 Track
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el || !remoteVideoTrack) return;
    try {
      if (typeof remoteVideoTrack.attach === "function") {
        remoteVideoTrack.attach(el);
      } else if (remoteVideoTrack instanceof MediaStreamTrack) {
        el.srcObject = new MediaStream([remoteVideoTrack]);
      } else if (remoteVideoTrack instanceof MediaStream) {
        el.srcObject = remoteVideoTrack;
      }
    } catch {}
    return () => {
      try {
        if (typeof remoteVideoTrack?.detach === "function" && el) {
          remoteVideoTrack.detach(el);
        } else if (el) {
          el.srcObject = null;
        }
      } catch {}
    };
  }, [remoteVideoTrack]);

  // 绑定屏幕共享 Track
  useEffect(() => {
    const el = screenShareVideoRef.current;
    if (!el || !screenShareTrack) return;
    try {
      if (typeof screenShareTrack.attach === "function") {
        screenShareTrack.attach(el);
      } else if (screenShareTrack instanceof MediaStreamTrack) {
        el.srcObject = new MediaStream([screenShareTrack]);
      } else if (screenShareTrack instanceof MediaStream) {
        el.srcObject = screenShareTrack;
      }
    } catch {}
    return () => {
      try {
        if (typeof screenShareTrack?.detach === "function" && el) {
          screenShareTrack.detach(el);
        } else if (el) {
          el.srcObject = null;
        }
      } catch {}
    };
  }, [screenShareTrack]);

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (!document.fullscreenElement) {
      stageRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // 1. 折叠模式下的顶部紧凑语音条 (Collapsed Top Banner)
  if (isStageCollapsed && callState === "connected") {
    return (
      <div
        data-testid="dm-call-collapsed-bar"
        className="h-12 bg-[#1e1f22] border-b border-[#2b2d31] px-4 flex items-center justify-between flex-shrink-0 z-20 shadow-md select-none"
      >
        <div className="flex items-center space-x-3 min-w-0">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-white truncate">
            {t("voice:dmCall.inCallWith", {
              name: targetUser.displayName || targetUser.username,
              username: targetUser.displayName || targetUser.username,
              defaultValue: `与 ${targetUser.displayName || targetUser.username} 通话中`,
            })}
          </span>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            {callDuration}
          </span>
          {isSpeakingRemote && (
            <span className="text-[10px] text-emerald-400 font-medium animate-pulse hidden sm:inline">
              {t("voice:speaking", "正在说话...")}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* 静音控制 */}
          <button
            onClick={onToggleMute}
            className={`p-1.5 rounded-lg transition ${
              isMuted
                ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                : "text-zinc-300 hover:bg-[#35373c]"
            }`}
            title={
              isMuted ? t("voice:unmute", "取消静音") : t("voice:mute", "静音")
            }
          >
            {isMuted ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>

          {/* 展开舞台 */}
          <button
            onClick={toggleStageCollapsed}
            data-testid="dm-expand-stage-btn"
            className="p-1.5 rounded-lg text-zinc-300 hover:bg-[#35373c] transition flex items-center space-x-1 text-xs"
            title={t("voice:dmCall.expandStage", "展开通话舞台")}
          >
            <ChevronDown className="w-4 h-4" />
            <span className="hidden md:inline">
              {t("voice:dmCall.expand", "展开")}
            </span>
          </button>

          {/* 红色挂断按钮 */}
          <button
            onClick={onHangup}
            data-testid="dm-collapsed-hangup-btn"
            className="w-8 h-8 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-white transition transform hover:scale-105"
            title={t("voice:disconnect", "挂断通话")}
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // 2. 拨出等待与媒体连接协商阶段 (Outgoing Calling & Connecting Stage)
  if (callState === "outgoing_calling" || callState === "connecting") {
    return (
      <div
        data-testid={
          callState === "connecting"
            ? "dm-connecting-call-stage"
            : "dm-outgoing-call-stage"
        }
        className="h-80 sm:h-96 bg-gradient-to-b from-[#1e1f22] to-[#111214] border-b border-[#2b2d31] flex flex-col items-center justify-center relative overflow-hidden select-none p-6"
      >
        {/* 背景水波呼吸波纹 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-48 h-48 rounded-full border border-discord-brand/30 animate-ping opacity-25" />
          <div className="w-64 h-64 rounded-full border border-discord-brand/20 animate-pulse opacity-20" />
        </div>

        {/* 对方大头像 */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="relative">
            {targetUser.avatarUrl ? (
              <img
                src={targetUser.avatarUrl}
                alt={targetUser.username}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border-4 border-discord-brand shadow-2xl"
              />
            ) : (
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-discord-brand flex items-center justify-center font-bold text-white text-3xl shadow-2xl border-4 border-white/20">
                {targetUser.username.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-discord-green flex items-center justify-center text-white shadow-md">
              <Phone className="w-4 h-4 animate-bounce" />
            </div>
          </div>

          <h2 className="mt-4 text-xl sm:text-2xl font-bold text-white tracking-wide">
            {targetUser.username}
          </h2>

          <div className="mt-2 flex items-center space-x-2 text-sm text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>
              {t("voice:dmCall.callingUser", {
                name: targetUser.displayName || targetUser.username,
                username: targetUser.displayName || targetUser.username,
                defaultValue: `正在呼叫 ${targetUser.displayName || targetUser.username}...`,
              })}
            </span>
          </div>

          <div className="mt-2 flex items-center space-x-1.5 text-xs text-discord-green bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>
              {encryption?.status === "tofu"
                ? t("chat:dm.incomingCall.e2eeTofu", {
                    defaultValue: "首次信任设备 · E2EE",
                  })
                : encryption?.status === "failed"
                  ? t("chat:dm.incomingCall.e2eeFailed", {
                      defaultValue: "设备验证失败",
                    })
                  : t("chat:dm.incomingCall.e2eeTrusted", {
                      defaultValue: "已验证设备 · E2EE",
                    })}
            </span>
          </div>

          {/* 本端预览控制与取消呼叫 */}
          <div className="mt-6 flex items-center space-x-4">
            <button
              onClick={onToggleMute}
              className={`p-3 rounded-full transition ${
                isMuted
                  ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                  : "bg-[#2b2d31] text-zinc-300 hover:bg-[#35373c]"
              }`}
              title={
                isMuted
                  ? t("voice:unmute", "开启麦克风")
                  : t("voice:mute", "静音")
              }
            >
              {isMuted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>

            <button
              onClick={onToggleCamera}
              className={`p-3 rounded-full transition ${
                isVideoEnabled
                  ? "bg-discord-brand text-white"
                  : "bg-[#2b2d31] text-zinc-300 hover:bg-[#35373c]"
              }`}
              title={
                isVideoEnabled
                  ? t("voice:disableVideo", "关闭摄像头")
                  : t("voice:enableVideo", "开启摄像头")
              }
            >
              {isVideoEnabled ? (
                <Video className="w-5 h-5" />
              ) : (
                <VideoOff className="w-5 h-5" />
              )}
            </button>

            {/* 大尺寸红色取消呼叫按钮 */}
            <button
              onClick={onCancelCall || onHangup}
              data-testid="dm-cancel-call-btn"
              className="px-6 py-3 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center space-x-2 shadow-xl transition transform hover:scale-105 active:scale-95"
            >
              <PhoneOff className="w-5 h-5" />
              <span>
                {t("voice:dmCall.cancelCall", {
                  defaultValue: "取消呼叫",
                })}
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. 接通后的完整音视频舞台 (Active In-Call Stage)
  const isScreenSharingActive = Boolean(screenShareTrack);

  return (
    <div
      ref={stageRef}
      data-testid="dm-active-call-stage"
      className="relative w-full bg-[#111214] border-b border-[#2b2d31] flex flex-col overflow-hidden select-none transition-all duration-300"
      style={{ height: isFullscreen ? "100vh" : "360px" }}
    >
      {/* 顶部轻量浮动状态条 */}
      <div className="absolute top-3 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center space-x-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-xs">
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-zinc-200 font-medium font-mono">
            {callDuration}
          </span>
          <span className="text-zinc-500">|</span>
          <span className="text-emerald-400 font-medium">RTC Connected</span>
        </div>

        <div className="pointer-events-auto flex items-center space-x-2">
          {/* Fit vs Fill 画面填充切换 */}
          {(remoteVideoTrack || localVideoTrack) && (
            <button
              onClick={() =>
                setVideoFitMode(
                  videoFitMode === "contain" ? "cover" : "contain",
                )
              }
              className="bg-black/60 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-white/10 text-xs text-zinc-300 hover:text-white transition"
              title={
                videoFitMode === "contain"
                  ? "切换为充满卡片 (Cover)"
                  : "切换为适应窗口 (Contain)"
              }
            >
              {videoFitMode === "contain" ? "Fit" : "Fill"}
            </button>
          )}

          {/* 全屏切换 */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 text-zinc-300 hover:text-white transition"
            title={
              isFullscreen
                ? t("voice:exitFullscreen", "退出全屏")
                : t("voice:fullscreen", "全屏")
            }
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          {/* 折叠舞台 */}
          <button
            onClick={toggleStageCollapsed}
            data-testid="dm-collapse-stage-btn"
            className="p-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 text-zinc-300 hover:text-white transition"
            title={t("voice:dmCall.collapseStage", "折叠舞台")}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 核心音视频网格区域 */}
      <div className="flex-1 w-full h-full p-4 pb-20 flex items-center justify-center">
        {isScreenSharingActive ? (
          // 焦点大屏模式 (Spotlight Layout)：屏幕共享居中大屏，摄像头缩在底部
          <div className="w-full h-full flex flex-col gap-2">
            <div className="flex-1 bg-black rounded-xl overflow-hidden relative flex items-center justify-center">
              <video
                ref={screenShareVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full ${
                  videoFitMode === "contain" ? "object-contain" : "object-cover"
                }`}
              />
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur px-2.5 py-1 rounded text-xs text-white flex items-center space-x-1.5">
                <Tv className="w-3.5 h-3.5 text-discord-brand" />
                <span>屏幕共享大画面</span>
              </div>
            </div>

            {/* 底部缩略条 */}
            <div className="h-20 flex gap-2">
              <div className="w-32 bg-[#2b2d31] rounded-lg overflow-hidden relative flex items-center justify-center">
                {remoteVideoTrack ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-xs">
                    {targetUser.username.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="absolute bottom-1 left-1 text-[10px] text-white/80 bg-black/60 px-1 rounded truncate max-w-[90%]">
                  {targetUser.username}
                </span>
              </div>

              <div className="w-32 bg-[#2b2d31] rounded-lg overflow-hidden relative flex items-center justify-center">
                {localVideoTrack && isVideoEnabled ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover -scale-x-100"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-xs">
                    {currentUser.username.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="absolute bottom-1 left-1 text-[10px] text-white/80 bg-black/60 px-1 rounded truncate max-w-[90%]">
                  {currentUser.username} (你)
                </span>
              </div>
            </div>
          </div>
        ) : (
          // 经典 50/50 左右等比网格 (Side-by-side Dual Grid)
          <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-5xl">
            {/* 1. 对端好友卡片 */}
            <div
              className={`relative bg-[#2b2d31] rounded-2xl overflow-hidden flex items-center justify-center transition shadow-lg ${
                isSpeakingRemote
                  ? "ring-4 ring-emerald-500 shadow-emerald-500/30"
                  : "border border-[#35373c]"
              }`}
            >
              {remoteVideoTrack ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={`w-full h-full ${
                    videoFitMode === "contain"
                      ? "object-contain"
                      : "object-cover"
                  }`}
                />
              ) : (
                <div className="flex flex-col items-center">
                  <div className="relative">
                    {targetUser.avatarUrl ? (
                      <img
                        src={targetUser.avatarUrl}
                        alt={targetUser.username}
                        className={`w-24 h-24 rounded-full object-cover shadow-xl transition ${
                          isSpeakingRemote ? "scale-105" : ""
                        }`}
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-discord-brand flex items-center justify-center font-bold text-white text-2xl shadow-xl">
                        {targetUser.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {isSpeakingRemote && (
                      <div className="absolute inset-0 rounded-full border-4 border-emerald-400 animate-ping opacity-40 pointer-events-none" />
                    )}
                  </div>
                </div>
              )}

              {/* 用户信息标牌与音量滑块快捷按钮 */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <div className="pointer-events-auto bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl flex items-center space-x-2 text-xs text-white">
                  <span className="font-semibold truncate max-w-[120px]">
                    {targetUser.username}
                  </span>
                  {isSpeakingRemote && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                </div>

                <div className="relative pointer-events-auto">
                  <button
                    onClick={() => setShowVolumeSlider(!showVolumeSlider)}
                    className="p-2 bg-black/70 backdrop-blur-md hover:bg-black/90 rounded-xl text-zinc-300 hover:text-white transition shadow"
                    title={t("voice:userVolume", "调节音量")}
                  >
                    <Sliders className="w-3.5 h-3.5" />
                  </button>

                  {/* 独立音量滑块弹窗 (0-200%) */}
                  {showVolumeSlider && (
                    <div className="absolute bottom-10 right-0 bg-[#1e1f22] p-3 rounded-xl border border-[#35373c] shadow-2xl w-44 z-30 flex flex-col space-y-2">
                      <div className="flex justify-between text-xs text-zinc-300">
                        <span>{t("voice:userVolume", "用户音量")}</span>
                        <span className="font-mono text-discord-brand font-bold">
                          {remoteVolume}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={remoteVolume}
                        onChange={(e) =>
                          setRemoteVolume(Number(e.target.value))
                        }
                        className="w-full accent-discord-brand cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. 本端用户卡片 */}
            <div
              className={`relative bg-[#2b2d31] rounded-2xl overflow-hidden flex items-center justify-center transition shadow-lg ${
                isSpeakingLocal
                  ? "ring-4 ring-emerald-500 shadow-emerald-500/30"
                  : "border border-[#35373c]"
              }`}
            >
              {localVideoTrack && isVideoEnabled ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full -scale-x-100 ${
                    videoFitMode === "contain"
                      ? "object-contain"
                      : "object-cover"
                  }`}
                />
              ) : (
                <div className="flex flex-col items-center">
                  <div className="relative">
                    {currentUser.avatarUrl ? (
                      <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.username}
                        className={`w-24 h-24 rounded-full object-cover shadow-xl transition ${
                          isSpeakingLocal ? "scale-105" : ""
                        }`}
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-full bg-discord-brand flex items-center justify-center font-bold text-white text-2xl shadow-xl">
                        {currentUser.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {isSpeakingLocal && (
                      <div className="absolute inset-0 rounded-full border-4 border-emerald-400 animate-ping opacity-40 pointer-events-none" />
                    )}
                  </div>
                </div>
              )}

              {/* 本端状态标牌 */}
              <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl flex items-center space-x-2 text-xs text-white">
                <span className="font-semibold truncate max-w-[120px]">
                  {currentUser.username} (你)
                </span>
                {isMuted && <MicOff className="w-3.5 h-3.5 text-rose-400" />}
                {isDeafened && (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部悬浮控制底座 (Floating Controls Dock) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <div className="bg-[#1e1f22]/95 backdrop-blur-xl border border-[#35373c] rounded-2xl px-5 py-2.5 flex items-center space-x-3 shadow-2xl">
          {/* 麦克风 */}
          <button
            onClick={onToggleMute}
            className={`p-3 rounded-full transition transform hover:scale-105 ${
              isMuted
                ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                : "bg-[#2b2d31] text-zinc-200 hover:bg-[#35373c]"
            }`}
            title={
              isMuted
                ? t("voice:unmute", "开启麦克风 (Ctrl+Shift+M)")
                : t("voice:mute", "静音麦克风 (Ctrl+Shift+M)")
            }
            data-testid="dm-mute-btn"
          >
            {isMuted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* 声音闭音 */}
          <button
            onClick={onToggleDeafen}
            className={`p-3 rounded-full transition transform hover:scale-105 ${
              isDeafened
                ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                : "bg-[#2b2d31] text-zinc-200 hover:bg-[#35373c]"
            }`}
            title={
              isDeafened
                ? t("voice:undeafen", "取消静音耳机 (Ctrl+Shift+D)")
                : t("voice:deafen", "静音耳机 (Ctrl+Shift+D)")
            }
            data-testid="dm-deafen-btn"
          >
            {isDeafened ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>

          {/* 摄像头开关 */}
          <button
            onClick={onToggleCamera}
            className={`p-3 rounded-full transition transform hover:scale-105 ${
              isVideoEnabled
                ? "bg-discord-brand text-white shadow-lg shadow-discord-brand/30"
                : "bg-[#2b2d31] text-zinc-200 hover:bg-[#35373c]"
            }`}
            title={
              isVideoEnabled
                ? t("voice:disableVideo", "关闭摄像头")
                : t("voice:enableVideo", "开启摄像头")
            }
            data-testid="dm-camera-btn"
          >
            {isVideoEnabled ? (
              <Video className="w-5 h-5" />
            ) : (
              <VideoOff className="w-5 h-5" />
            )}
          </button>

          {/* 屏幕共享 */}
          <button
            onClick={onToggleScreenShare}
            className={`p-3 rounded-full transition transform hover:scale-105 ${
              isScreenSharing
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/30"
                : "bg-[#2b2d31] text-zinc-200 hover:bg-[#35373c]"
            }`}
            title={
              isScreenSharing
                ? t("voice:stopShare", "停止屏幕共享")
                : t("voice:shareScreen", "共享你的屏幕")
            }
            data-testid="dm-screenshare-btn"
          >
            {isScreenSharing ? (
              <ScreenShareOff className="w-5 h-5" />
            ) : (
              <ScreenShare className="w-5 h-5" />
            )}
          </button>

          {/* AI 降噪切换 */}
          <button
            onClick={onToggleNoiseSuppression}
            className={`p-3 rounded-full transition transform hover:scale-105 ${
              isNoiseSuppressionEnabled
                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                : "bg-[#2b2d31] text-zinc-400 hover:bg-[#35373c]"
            }`}
            title={`AI 降噪: ${noiseSuppressionMode.toUpperCase()} (${
              isNoiseSuppressionEnabled ? "已开启" : "已关闭"
            })`}
          >
            <Sparkles className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-zinc-700/60 my-auto" />

          {/* 断开通话 (红色大按钮) */}
          <button
            onClick={onHangup}
            data-testid="dm-disconnect-call-btn"
            className="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-white shadow-xl transition transform hover:scale-110 active:scale-95"
            title={t("voice:disconnect", "挂断通话")}
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
