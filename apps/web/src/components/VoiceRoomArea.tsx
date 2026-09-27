import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Channel,
  User,
  VoiceState,
  NetworkStats,
  Guild,
  VoiceConnectionStatus,
  NoiseSuppressionMode,
  CfMediaPublication,
  CfStreamWatchState,
} from "@tescord/types";
import { livekitService, ActiveScreenShare } from "../services/livekit.js";
import { cloudflareRealtimeService } from "../services/cloudflare_realtime/index.js";
import { VOICE_ENGINE, resolveServerUrl } from "../config.js";
import { audioEngine } from "../services/audioEngine.js";
import { audioMixer } from "../services/audioMixer.js";
import { sframeManager, SFrameStats } from "../services/sframe.js";
import { p2pStreamManager } from "../services/p2p/P2PStreamManager.js";
import { voiceMeshManager } from "../services/p2p/VoiceMeshManager.js";
import { PeerLatencyReport } from "@tescord/types";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
import { getUserDisplayName } from "../utils/userDisplay.js";
import {
  Volume2,
  VolumeX,
  Volume1,
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  PhoneOff,
  Sparkles,
  Radio,
  Zap,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Wifi,
  Sliders,
  X,
  Keyboard,
  PictureInPicture2,
  Tv,
  Menu,
  Pin,
  PinOff,
  ChevronUp,
  Check,
  Settings,
  Camera,
  ArrowLeftRight,
  Info,
  ScreenShareOff,
  Loader2,
  Play,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewport } from "../hooks/useViewport.js";
import { StreamStatsHUD } from "./stream/StreamStatsHUD.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";

interface VideoTrackPlayerProps {
  track: any;
  isMirrored?: boolean;
  className?: string;
  dataTestId?: string;
}

const VideoTrackPlayer: React.FC<VideoTrackPlayerProps> = ({
  track,
  isMirrored = false,
  className = "w-full h-full object-cover",
  dataTestId,
}) => {
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !track) return;
    try {
      if (typeof track.attach === "function") {
        track.attach(el);
      } else if (track instanceof MediaStreamTrack) {
        el.srcObject = new MediaStream([track]);
      } else if (
        track instanceof MediaStream ||
        (track && typeof track.getTracks === "function")
      ) {
        el.srcObject = track;
      }
    } catch (e) {
      console.warn("VideoTrackPlayer attach error:", e);
    }

    return () => {
      try {
        if (typeof track.detach === "function" && el) {
          track.detach(el);
        } else if (el) {
          el.srcObject = null;
        }
      } catch {}
    };
  }, [track]);

  return (
    <video
      ref={videoElRef}
      autoPlay
      playsInline
      muted
      data-testid={dataTestId}
      className={`${className} ${isMirrored ? "-scale-x-100" : ""}`}
    />
  );
};

interface ParticipantCardProps {
  participant: VoiceState;
  isMe: boolean;
  speaking: boolean;
  stats: NetworkStats | null;
  volume: number;
  onVolumeChange: (vol: number) => void;
  isPinned: boolean;
  onTogglePin: () => void;
  cameraTrack: any;
  screenShareTrack: any;
  screenShareInfo?: ActiveScreenShare | null;
  streamAvailable?: boolean;
  watching?: boolean;
  viewerCount?: number | null;
  watchPending?: boolean;
  watchError?: string | null;
  onToggleWatching?: () => void;
  streamVolume?: number;
  onStreamVolumeChange?: (volume: number) => void;
  guild?: Guild | null;
  currentUser: User;
  isTheaterMode: boolean;
  isNoiseSuppressionEnabled: boolean;
  noiseSuppressionMode: "off" | "rnnoise" | "dtln" | "dfn3";
  isSpotlight?: boolean;
  onStopScreenShare?: () => void;
  peerLatency?: PeerLatencyReport | null;
  isP2P?: boolean;
  showStatsHUD?: boolean;
  onToggleStats?: () => void;
  onCloseStats?: () => void;
}

const ParticipantCard: React.FC<ParticipantCardProps> = ({
  participant,
  isMe,
  speaking,
  stats,
  volume,
  onVolumeChange,
  isPinned,
  onTogglePin,
  cameraTrack,
  screenShareTrack,
  screenShareInfo,
  streamAvailable = false,
  watching = false,
  viewerCount = null,
  watchPending = false,
  watchError = null,
  onToggleWatching,
  streamVolume = 100,
  onStreamVolumeChange,
  guild,
  currentUser,
  isTheaterMode,
  isNoiseSuppressionEnabled,
  noiseSuppressionMode,
  isSpotlight = false,
  onStopScreenShare,
  peerLatency,
  isP2P = false,
  showStatsHUD,
  onToggleStats,
  onCloseStats,
}) => {
  const { t } = useTranslation(["voice", "common", "auth"]);
  // 当同时存在屏幕分享与摄像头时，是否对调主次画面 (默认: 屏幕分享为主，摄像头小窗在右下角)
  const [isSwapped, setIsSwapped] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const [internalShowStatsHUD, setInternalShowStatsHUD] = useState(false);

  // 严格遵循：若未处于聚焦放大状态，绝不允许显示 HUD
  const isHUDVisible = Boolean(
    isSpotlight &&
    (showStatsHUD !== undefined ? showStatsHUD : internalShowStatsHUD),
  );

  const handleToggleHUD = () => {
    if (onToggleStats) {
      onToggleStats();
    } else {
      if (!isSpotlight) {
        onTogglePin();
      }
      setInternalShowStatsHUD((prev) => !prev);
    }
  };

  const handleCloseHUD = () => {
    if (onCloseStats) {
      onCloseStats();
    } else {
      setInternalShowStatsHUD(false);
    }
  };
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<any>(null);

  const hasCamera = Boolean(cameraTrack);
  const hasScreen = Boolean(screenShareTrack);
  const hasAnyVideo = hasCamera || hasScreen;

  // 监听全屏变动事件以动态同步 isFullscreen 状态
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrent =
        document.fullscreenElement === cardRef.current ||
        (document as any).webkitFullscreenElement === cardRef.current;
      setIsFullscreen(Boolean(isCurrent));
      if (!isCurrent) {
        setShowControls(true);
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = null;
        }
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // 全屏模式下 3 秒鼠标闲置自动淡出控制栏与隐藏指针
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
    if (isFullscreen) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // 全屏切换核心方法 (支持标准 HTML5 Fullscreen API 与 WebKit 前缀)
  const toggleFullscreen = async () => {
    try {
      const currentFs =
        document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (!currentFs) {
        if (cardRef.current?.requestFullscreen) {
          await cardRef.current.requestFullscreen();
        } else if ((cardRef.current as any)?.webkitRequestFullscreen) {
          await (cardRef.current as any).webkitRequestFullscreen();
        } else {
          // 容灾保底
          setIsFullscreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any)?.webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else {
          setIsFullscreen(false);
        }
      }
    } catch (e) {
      console.warn("Fullscreen toggle error:", e);
      setIsFullscreen((prev) => !prev);
    }
  };

  // 快捷键 'F' / 'f' 切换全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      if (
        activeTag === "input" ||
        activeTag === "textarea" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (e.key === "f" || e.key === "F") {
        if (isFullscreen) {
          e.preventDefault();
          toggleFullscreen();
        } else if (hasAnyVideo && (isSpotlight || isPinned)) {
          e.preventDefault();
          toggleFullscreen();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, hasAnyVideo, isSpotlight, isPinned]);

  // 确定主画面轨与画中画 (PiP) 轨
  const mainTrack =
    hasScreen && hasCamera
      ? isSwapped
        ? cameraTrack
        : screenShareTrack
      : hasScreen
        ? screenShareTrack
        : cameraTrack;

  const pipTrack =
    hasScreen && hasCamera
      ? isSwapped
        ? screenShareTrack
        : cameraTrack
      : null;

  const isMainMirrored =
    hasScreen && hasCamera
      ? isSwapped
        ? isMe
        : false
      : hasScreen
        ? false
        : isMe;

  const isPipMirrored =
    hasScreen && hasCamera ? (isSwapped ? false : isMe) : false;

  const mainFitClass = isFullscreen
    ? "w-full h-full object-contain bg-black"
    : (hasScreen && hasCamera && !isSwapped) || (hasScreen && !hasCamera)
      ? "w-full h-full object-contain bg-black"
      : "w-full h-full object-cover";

  const pipFitClass = isSwapped
    ? "w-full h-full object-contain bg-black"
    : "w-full h-full object-cover";

  const controlsVisibilityClass = `transition-opacity duration-300 ${
    isFullscreen && !showControls
      ? "opacity-0 pointer-events-none"
      : "opacity-100"
  }`;

  const targetMember = useMemo(() => {
    return guild?.members?.find((m) => m.userId === participant.userId);
  }, [guild?.members, participant.userId]);

  const targetDisplayName = useMemo(() => {
    const rawUser = participant.user || (isMe ? currentUser : null);
    return getUserDisplayName(
      rawUser,
      targetMember,
      isMe ? currentUser.username : t("auth:defaultUserName"),
    );
  }, [participant.user, isMe, currentUser, targetMember, t]);

  const targetUser = participant.user || {
    id: participant.userId,
    username: targetDisplayName,
    avatarUrl: undefined,
  };

  return (
    <UserContextMenu
      targetUser={targetUser}
      guild={guild}
      isInVoice={true}
      isStreaming={streamAvailable}
      onStopScreenShare={isMe && hasScreen ? onStopScreenShare : undefined}
      onShowStats={handleToggleHUD}
    >
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (hasAnyVideo) {
            toggleFullscreen();
          } else {
            onTogglePin();
          }
        }}
        onClick={() => {
          // 在无视频且未聚焦时，点击卡片也可触发聚焦
          if (!hasAnyVideo && !isSpotlight) {
            onTogglePin();
          } else if (hasAnyVideo && !isSpotlight && !isFullscreen) {
            onTogglePin();
          }
        }}
        data-testid={
          hasAnyVideo
            ? `participant-video-tile-${participant.userId}`
            : `participant-card-${participant.userId}`
        }
        className={`bg-[#2b2d31] rounded-xl flex flex-col items-center justify-center relative border-2 transition-all select-none overflow-hidden group ${
          isFullscreen && !showControls ? "cursor-none" : "cursor-pointer"
        } ${
          isFullscreen
            ? "!fixed !inset-0 !z-50 !w-screen !h-screen !max-w-none !rounded-none !border-0 !aspect-auto bg-black shadow-none"
            : isSpotlight
              ? "w-full max-w-5xl aspect-video md:h-[62vh] shadow-2xl"
              : isTheaterMode
                ? "min-w-[140px] max-w-[160px] h-[130px] flex-shrink-0"
                : "min-h-[140px] sm:min-h-[190px] aspect-video w-full"
        } ${
          speaking && !isFullscreen
            ? "border-discord-green shadow-[0_0_20px_rgba(35,165,90,0.35)]"
            : isPinned && !isFullscreen
              ? "border-discord-brand shadow-[0_0_15px_rgba(88,101,242,0.3)]"
              : "border-transparent hover:border-[#383a40]"
        }`}
      >
        {hasAnyVideo ? (
          <>
            {/* 主视口视频流 (屏幕分享或摄像头) */}
            <VideoTrackPlayer
              track={mainTrack}
              isMirrored={isMainMirrored}
              className={mainFitClass}
              dataTestId={`participant-main-video-${participant.userId}`}
            />

            {/* 右下角画中画 (PiP) 叠加小窗：当用户同时开屏幕分享与摄像头时展示 */}
            {pipTrack && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSwapped((prev) => !prev);
                }}
                data-testid={`participant-pip-video-${participant.userId}`}
                className={`absolute bottom-2.5 right-2.5 z-20 ${controlsVisibilityClass} ${
                  isSpotlight ? "w-36 sm:w-48 md:w-56" : "w-28 sm:w-36 md:w-44"
                } aspect-video rounded-lg overflow-hidden border-2 border-white/30 hover:border-discord-brand shadow-2xl transition-all duration-200 hover:scale-105 cursor-pointer group/pip bg-black`}
                title={t("voice:mediaTooltips.swapView")}
              >
                <VideoTrackPlayer
                  track={pipTrack}
                  isMirrored={isPipMirrored}
                  className={pipFitClass}
                />
                {/* 悬浮切换按钮遮罩 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/pip:opacity-100 transition flex items-center justify-center space-x-1.5 backdrop-blur-[2px]">
                  <div
                    data-testid={`pip-swap-btn-${participant.userId}`}
                    className="bg-black/75 hover:bg-discord-brand p-1.5 rounded-full text-white shadow-lg transition"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[11px] text-white font-medium drop-shadow hidden sm:inline">
                    切换
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          /* 纯音频模式：圆形头像与呼吸光环 */
          <div className="flex flex-col items-center justify-center p-3 sm:p-4 w-full h-full relative">
            <div className={`relative ${isTheaterMode ? "mb-1.5" : "mb-3"}`}>
              <img
                src={
                  (participant.user?.avatarUrl &&
                    resolveServerUrl(participant.user.avatarUrl)) ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(participant.user?.username || "avatar")}`
                }
                alt={targetDisplayName}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(participant.user?.username || "avatar")}`;
                }}
                className={`rounded-full border-4 border-[#1e1f22] object-cover ${
                  isSpotlight
                    ? "w-28 h-28"
                    : isTheaterMode
                      ? "w-12 h-12"
                      : "w-20 h-20"
                } ${speaking ? "speaking-ring" : ""}`}
              />
              {participant.selfMute && (
                <div
                  data-testid={`voice-participant-muted-${participant.userId}`}
                  className="absolute -bottom-1 -right-1 bg-discord-danger p-1 rounded-full text-white shadow-md"
                >
                  <MicOff className="w-2.5 h-2.5" />
                </div>
              )}
            </div>

            <div className="font-bold text-discord-textHeader text-xs flex items-center space-x-1 truncate max-w-full">
              <span className="truncate">{targetDisplayName}</span>
              {isMe && (
                <span className="text-[10px] text-discord-textMuted">(你)</span>
              )}
            </div>

            {/* 居中大播放按钮：主播正在推流但观众尚未拉流时展示 (简洁无文字) */}
            {streamAvailable && !isMe && !watching && onToggleWatching && (
              <div
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center z-10 transition-all rounded-xl cursor-pointer group/play"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWatching();
                }}
                title={t("voice:watchStream")}
              >
                <button
                  type="button"
                  data-testid={`stream-center-play-btn-${participant.userId}`}
                  disabled={watchPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWatching();
                  }}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-discord-brand/90 hover:bg-discord-brand hover:scale-110 active:scale-95 text-white flex items-center justify-center shadow-2xl transition duration-200 backdrop-blur-md border border-white/20 group-hover/play:shadow-discord-brand/50 disabled:opacity-50"
                  aria-label={t("voice:watchStream")}
                >
                  {watchPending ? (
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                  ) : (
                    <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white ml-1 text-white" />
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 右上角悬浮操作区：全屏切换、钉选/聚焦、Simulcast 切换、网络延迟指示 */}
        <div
          className={`absolute top-2 right-2 flex items-center space-x-1.5 z-20 ${controlsVisibilityClass}`}
        >
          {/* 全屏播放切换按钮 (双击亦可切换，快捷键 F) */}
          {hasAnyVideo && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              data-testid={`fullscreen-btn-${participant.userId}`}
              className={`p-1 rounded-md backdrop-blur-md transition ${
                isFullscreen || isSpotlight
                  ? "bg-black/75 hover:bg-discord-brand text-white shadow-md opacity-100"
                  : "bg-black/60 hover:bg-discord-brand text-white opacity-0 group-hover:opacity-100"
              }`}
              title={isFullscreen ? "退出全屏 (Esc / F)" : "全屏播放 (F)"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          {isSpotlight ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              data-testid="stage-unpin-btn"
              className="bg-black/75 hover:bg-white/20 px-2.5 py-1 rounded-md text-xs text-white flex items-center space-x-1 backdrop-blur-md border border-white/10 transition shadow-lg"
              title={t("voice:mediaTooltips.exitFocus")}
            >
              <PinOff className="w-3.5 h-3.5 text-discord-brand" />
              <span className="hidden sm:inline font-semibold">退出聚焦</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              data-testid={`pin-btn-${participant.userId}`}
              className={`p-1 rounded-md backdrop-blur-md transition ${
                isPinned
                  ? "bg-discord-brand text-white shadow-md opacity-100"
                  : "bg-black/60 hover:bg-discord-brand text-white opacity-0 group-hover:opacity-100"
              }`}
              title={isPinned ? "取消聚焦" : "聚焦放大卡片 (亦可双击)"}
            >
              {isPinned ? (
                <PinOff className="w-3.5 h-3.5" />
              ) : (
                <Pin className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* 直播推流观看控制 */}
          {streamAvailable && !isMe && onToggleWatching && (
            <button
              type="button"
              data-testid={`stream-watch-toggle-${participant.userId}`}
              disabled={watchPending}
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatching();
              }}
              className="bg-black/75 hover:bg-discord-brand disabled:opacity-50 text-white px-2 py-1 rounded-md text-xs shadow-lg"
              title={
                watching
                  ? t("voice:stopWatchingStream")
                  : t("voice:watchStream")
              }
            >
              {watchPending
                ? t("common:loading")
                : watching
                  ? t("voice:stopWatchingStream")
                  : t("voice:watchStream")}
            </button>
          )}
          {watchError && (
            <span
              className="text-[10px] text-red-300 max-w-36 truncate"
              title={watchError}
            >
              {watchError}
            </span>
          )}

          {/* 直播与视频/语音属性详细统计 (Stats for nerds) - 仅在有活跃视频流 (hasAnyVideo) 时才允许查看 */}
          {hasAnyVideo && (
            <button
              type="button"
              data-testid="participant-stats-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleHUD();
              }}
              className={`p-1 rounded-md backdrop-blur-md transition ${
                isHUDVisible
                  ? "bg-discord-brand text-white shadow-md opacity-100"
                  : "bg-black/60 hover:bg-discord-brand text-white opacity-0 group-hover:opacity-100"
              }`}
              title={t("voice:statsHUD")}
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 本人直播停止推流显式操作 */}
          {isMe && hasScreen && (
            <button
              type="button"
              data-testid="participant-stop-screen-btn"
              onClick={(e) => {
                e.stopPropagation();
                onStopScreenShare?.();
              }}
              className="bg-discord-danger hover:bg-red-700 text-white px-2 py-1 rounded-md text-xs flex items-center space-x-1 shadow-lg transition cursor-pointer"
              title={t("voice:mediaTooltips.stopStream")}
            >
              <ScreenShareOff className="w-3.5 h-3.5" />
              <span className="font-semibold text-[11px]">
                {t("voice:stopLiveStream")}
              </span>
            </button>
          )}

          {/* 语音 P2P 模式下右上角成员独立网络延迟胶囊指示 (SFU 模式下完全隐藏) */}
          {!isTheaterMode && isP2P && !isMe && (
            <button
              type="button"
              data-testid={`participant-p2p-ping-${participant.userId}`}
              data-connection-status={peerLatency?.status || "connecting"}
              data-connection-type={peerLatency?.connectionType || "P2P"}
              disabled={peerLatency?.status !== "failed"}
              onClick={(event) => {
                event.stopPropagation();
                if (peerLatency?.status === "failed") {
                  void voiceMeshManager.retryPeer(participant.userId);
                }
              }}
              className={`flex items-center space-x-1 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full text-[10px] border transition select-none ${
                peerLatency?.status === "failed"
                  ? "border-discord-danger/50 text-discord-danger cursor-pointer hover:bg-discord-danger/20"
                  : peerLatency?.status === "connected" && peerLatency.rtt > 0
                    ? peerLatency.rtt < 80
                      ? "border-white/10 text-discord-green cursor-default"
                      : peerLatency.rtt < 150
                        ? "border-white/10 text-[#faa61a] cursor-default"
                        : "border-white/10 text-discord-danger cursor-default"
                    : "border-white/10 text-yellow-400 cursor-default"
              }`}
              title={
                peerLatency?.status === "failed"
                  ? t("voice:connectionBadge.retryTooltip")
                  : t("voice:connectionPopover.p2pLatencyTooltip", {
                      value:
                        peerLatency?.status === "connected" &&
                        peerLatency.rtt > 0
                          ? `${peerLatency.rtt}ms`
                          : t("voice:connectionPopover.noData"),
                      type: peerLatency?.connectionType || "P2P",
                    })
              }
            >
              <Wifi
                className={`w-3 h-3 flex-shrink-0 ${
                  peerLatency?.status === "failed"
                    ? "text-discord-danger"
                    : peerLatency?.status === "connected" && peerLatency.rtt > 0
                      ? peerLatency.rtt < 80
                        ? "text-discord-green"
                        : peerLatency.rtt < 150
                          ? "text-[#faa61a]"
                          : "text-discord-danger"
                      : "text-yellow-400 animate-pulse"
                }`}
              />
              <span className="font-mono">
                {peerLatency?.status === "failed"
                  ? t("voice:connectionBadge.failed")
                  : peerLatency?.status === "connected"
                    ? `${t(
                        peerLatency.connectionType === "RELAY"
                          ? "voice:connectionBadge.turn"
                          : peerLatency.connectionType === "LAN"
                            ? "voice:connectionBadge.lan"
                            : "voice:connectionBadge.p2p",
                      )}${peerLatency.rtt > 0 ? ` ${peerLatency.rtt}ms` : ""}`
                    : t("voice:connectionBadge.connecting")}
              </span>
            </button>
          )}
        </div>

        {/* 底部左侧信息浮层 (用户名 + 直播徽章 + 视频编码角标 + 静音标签 + 独立音量滑块) */}
        <div
          className={`absolute bottom-2 left-2 z-20 flex items-center space-x-1.5 bg-black/70 backdrop-blur-md px-2 py-1 rounded-lg text-white max-w-[55%] shadow-lg ${controlsVisibilityClass}`}
        >
          {speaking && (
            <span className="w-2 h-2 rounded-full bg-discord-green animate-pulse flex-shrink-0" />
          )}
          <span className="font-semibold text-xs truncate">
            {targetDisplayName}
          </span>
          {isMe && (
            <span className="text-[10px] text-discord-textMuted flex-shrink-0">
              (你)
            </span>
          )}
          {streamAvailable && (
            <span className="text-[10px] bg-discord-danger text-white px-1.5 py-0.2 rounded font-bold flex-shrink-0 flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping mr-0.5" />
              <span>LIVE</span>
            </span>
          )}
          {streamAvailable && viewerCount !== null && (
            <span
              data-testid={`stream-viewer-count-${participant.userId}`}
              className="text-[10px] text-white/80 flex-shrink-0"
            >
              {viewerCount} 人观看
            </span>
          )}
          {hasAnyVideo && (screenShareInfo?.codec || stats?.videoCodec) && (
            <span
              data-testid={`video-codec-badge-${participant.userId}`}
              className="text-[10px] bg-discord-brand/30 text-discord-brand border border-discord-brand/40 px-1.5 py-0.2 rounded font-mono font-bold flex-shrink-0"
              title={t("voice:mediaTooltips.videoCodec", {
                codec: screenShareInfo?.codec || stats?.videoCodec,
              })}
            >
              {screenShareInfo?.codec || stats?.videoCodec}
            </span>
          )}
          {participant.selfMute && (
            <div
              data-testid={`voice-participant-muted-${participant.userId}`}
              className="bg-discord-danger p-0.5 rounded-full text-white flex-shrink-0"
            >
              <MicOff className="w-2.5 h-2.5" />
            </div>
          )}

          {/* 对非本人的远端成员提供独立 0%~200% 音量调节 */}
          {!isMe && (
            <div className="relative flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsVolumeOpen(!isVolumeOpen);
                }}
                className={`text-[10px] px-1.5 py-0.5 rounded flex items-center space-x-0.5 border transition ${
                  volume !== 100
                    ? "bg-discord-brand/30 text-discord-brand border-discord-brand/50 font-bold"
                    : "bg-black/50 text-discord-textMuted border-transparent hover:text-white"
                }`}
                title={t("voice:mediaTooltips.volume")}
              >
                {volume === 0 ? (
                  <VolumeX className="w-2.5 h-2.5 text-discord-danger" />
                ) : volume > 100 ? (
                  <Volume2 className="w-2.5 h-2.5 text-discord-brand" />
                ) : (
                  <Volume1 className="w-2.5 h-2.5" />
                )}
                <span>{volume}%</span>
              </button>

              {isVolumeOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-full left-0 mb-2 w-48 bg-[#1e1f22] p-3 rounded-xl border border-[#3f4147] shadow-2xl z-30 animate-fadeIn"
                >
                  <div className="flex justify-between items-center text-xs mb-1.5 font-bold">
                    <span className="text-discord-textHeader">独立音量</span>
                    <span className="text-discord-brand">{volume}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={volume}
                    onChange={(e) => onVolumeChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                  />
                  <div className="flex justify-between items-center text-[10px] text-discord-textMuted mt-2 pt-1 border-t border-[#2b2d31]">
                    <button
                      onClick={() => onVolumeChange(volume === 0 ? 100 : 0)}
                      className="hover:underline flex items-center space-x-0.5"
                    >
                      {volume === 0 ? (
                        <span className="text-discord-green font-semibold">
                          取消静音
                        </span>
                      ) : (
                        <span className="text-discord-danger">一键静音</span>
                      )}
                    </button>
                    <button
                      onClick={() => onVolumeChange(100)}
                      className="text-discord-textHeader hover:underline"
                    >
                      重置 100%
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {streamAvailable && watching && !isMe && onStreamVolumeChange && (
            <label
              className="flex items-center gap-1 text-[10px] text-white"
              onClick={(e) => e.stopPropagation()}
            >
              直播伴音 {streamVolume}%
              <input
                data-testid={`stream-audio-volume-${participant.userId}`}
                type="range"
                min="0"
                max="200"
                value={streamVolume}
                onChange={(e) => onStreamVolumeChange(Number(e.target.value))}
                className="w-16 accent-discord-brand"
              />
            </label>
          )}
        </div>

        {/* 详细媒体属性与实时统计 (Stats for nerds) HUD */}
        {isHUDVisible && (
          <StreamStatsHUD
            containerRef={cardRef}
            participantIdentity={participant.userId}
            participantName={
              targetDisplayName || (isMe ? "我的推流" : "视频流")
            }
            onClose={handleCloseHUD}
          />
        )}
      </div>
    </UserContextMenu>
  );
};

interface VoiceRoomAreaProps {
  channel: Channel;
  guild?: Guild | null;
  currentUser: User;
  voiceStates: VoiceState[];
  isConnected?: boolean;
  voiceConnectionStatus?: VoiceConnectionStatus;
  isMuted: boolean;
  isSpeaking: boolean;
  activeSpeakers?: string[];
  isNoiseSuppressionEnabled: boolean;
  noiseSuppressionMode?: "off" | "rnnoise" | "dtln" | "dfn3";
  isScreenSharing: boolean;
  isVideoEnabled?: boolean;
  onToggleMute: () => void;
  onToggleScreenShare: () => void;
  onStopScreenShare?: () => void;
  onToggleVideo?: () => void;
  onToggleNoiseSuppression: () => void;
  onSelectNoiseSuppressionMode?: (
    mode: "off" | "rnnoise" | "dtln" | "dfn3",
  ) => void;
  onLeave: () => void;
  onJoin?: () => void;
  onCancelJoin?: () => void;
  onToggleMobileDrawer?: () => void;
  onOpenVideoSettings?: () => void;
}

export const VoiceRoomArea: React.FC<VoiceRoomAreaProps> = ({
  channel,
  guild,
  currentUser,
  voiceStates,
  isConnected = true,
  voiceConnectionStatus,
  isMuted,
  isSpeaking,
  activeSpeakers: propActiveSpeakers,
  isNoiseSuppressionEnabled,
  noiseSuppressionMode = "rnnoise",
  isScreenSharing,
  isVideoEnabled = false,
  onToggleMute,
  onToggleScreenShare,
  onStopScreenShare,
  onToggleVideo,
  onToggleNoiseSuppression,
  onSelectNoiseSuppressionMode,
  onLeave,
  onJoin,
  onCancelJoin,
  onToggleMobileDrawer,
  onOpenVideoSettings,
}) => {
  const { isMobile } = useViewport();
  const { t } = useTranslation(["voice", "common"]);
  const isActuallyConnected =
    voiceConnectionStatus === "connected" ||
    voiceConnectionStatus === "p2p_active" ||
    (voiceConnectionStatus === undefined && isConnected);
  const isConnecting = voiceConnectionStatus === "connecting";
  const isP2P =
    voiceConnectionStatus === "p2p_active" ||
    voiceMeshManager.getIsMeshActive();

  const [cameraTracks, setCameraTracks] = useState<Map<string, any>>(
    new Map(livekitService.cameraTracksMap),
  );

  // 麦克风快速选择菜单状态
  const [isMicMenuOpen, setIsMicMenuOpen] = useState(false);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeMicId, setActiveMicId] = useState<string>(
    livekitService.getAudioInputDeviceId() || "default",
  );
  const micMenuRef = useRef<HTMLDivElement | null>(null);

  // 摄像头快速选择菜单状态
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>(
    livekitService.getCameraDeviceId() || "default",
  );
  const cameraMenuRef = useRef<HTMLDivElement | null>(null);

  const [isNoiseMenuOpen, setIsNoiseMenuOpen] = useState(false);
  const noiseMenuRef = useRef<HTMLDivElement | null>(null);

  // 获取并监听系统摄像头与麦克风设备变动与当前激活设备
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setCameraDevices(devices.filter((d) => d.kind === "videoinput"));
          setMicDevices(devices.filter((d) => d.kind === "audioinput"));
        }
      } catch {}
    };
    fetchDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", fetchDevices);
    const cleanupActiveCam = livekitService.onActiveCameraChange((id) => {
      setActiveCameraId(id);
    });
    const cleanupActiveMic = livekitService.onActiveAudioInputChange((id) => {
      setActiveMicId(id);
    });

    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        fetchDevices,
      );
      cleanupActiveCam();
      cleanupActiveMic();
    };
  }, []);

  // 快捷菜单点击外部关闭
  useEffect(() => {
    if (!isCameraMenuOpen && !isMicMenuOpen && !isNoiseMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        cameraMenuRef.current &&
        !cameraMenuRef.current.contains(e.target as Node)
      ) {
        setIsCameraMenuOpen(false);
      }
      if (
        micMenuRef.current &&
        !micMenuRef.current.contains(e.target as Node)
      ) {
        setIsMicMenuOpen(false);
      }
      if (
        noiseMenuRef.current &&
        !noiseMenuRef.current.contains(e.target as Node)
      ) {
        setIsNoiseMenuOpen(false);
      }
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [isCameraMenuOpen, isMicMenuOpen, isNoiseMenuOpen]);

  const handleSelectCamera = async (deviceId: string) => {
    setActiveCameraId(deviceId);
    await livekitService.switchCameraDevice(deviceId);
    if (VOICE_ENGINE === "cloudflare_realtime") {
      await cloudflareRealtimeService.switchCameraDevice(deviceId);
    }
    setIsCameraMenuOpen(false);
  };

  const handleSelectMic = async (deviceId: string) => {
    setActiveMicId(deviceId);
    await livekitService.switchAudioInputDevice(deviceId);
    setIsMicMenuOpen(false);
  };

  const handleSelectNoiseMode = (mode: "off" | "rnnoise" | "dtln" | "dfn3") => {
    setIsNoiseMenuOpen(false);
    if (onSelectNoiseSuppressionMode) {
      onSelectNoiseSuppressionMode(mode);
    } else {
      audioEngine.setNoiseSuppressionMode(mode);
      onToggleNoiseSuppression();
    }
  };
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [statsUserId, setStatsUserId] = useState<string | null>(null);
  const [isMixerOpen, setIsMixerOpen] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [activeVolumeUserId, setActiveVolumeUserId] = useState<string | null>(
    null,
  );
  const [participantVolumes, setParticipantVolumes] = useState<{
    [userId: string]: number;
  }>({});
  const [networkStats, setNetworkStats] = useState<Map<string, NetworkStats>>(
    new Map(),
  );
  const [isPTTPressed, setIsPTTPressed] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>(
    () => propActiveSpeakers || livekitService.getActiveSpeakers(),
  );

  // 纯语音 Mesh P2P 点对点各成员独立延迟状态
  const [peerLatencies, setPeerLatencies] = useState<
    Map<string, PeerLatencyReport>
  >(new Map());

  useEffect(() => {
    const unsub = voiceMeshManager.onLatencyUpdate((reports) => {
      setPeerLatencies(new Map(reports));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (propActiveSpeakers) {
      setActiveSpeakers(propActiveSpeakers);
    }
  }, [propActiveSpeakers]);

  const [micError, setMicError] = useState<string | null>(
    audioEngine.lastError,
  );
  const [sframeStats, setSframeStats] = useState<SFrameStats>(
    sframeManager.getStats(),
  );

  // 阶段四：多路屏幕分享推流与订阅状态
  const [activeShare, setActiveShare] = useState<ActiveScreenShare | null>(
    null,
  );
  const [screenShares, setScreenShares] = useState<
    Map<string, ActiveScreenShare>
  >(new Map(livekitService.screenSharesMap));
  const [cloudflarePublications, setCloudflarePublications] = useState<
    CfMediaPublication[]
  >([]);
  const [watchStates, setWatchStates] = useState<
    Map<string, CfStreamWatchState>
  >(new Map());
  const [watchPending, setWatchPending] = useState<Set<string>>(new Set());
  const [watchErrors, setWatchErrors] = useState<Map<string, string>>(
    new Map(),
  );
  const [watchedLiveKitUsers, setWatchedLiveKitUsers] = useState<Set<string>>(
    new Set(),
  );
  const [streamVolumes, setStreamVolumes] = useState<Map<string, number>>(
    new Map(),
  );
  const [p2pScreenShares, setP2pScreenShares] = useState<
    Map<string, ActiveScreenShare>
  >(new Map());
  const [p2pRemoteAudio, setP2PRemoteAudio] = useState<{
    stream: MediaStream;
    userId: string;
  } | null>(null);
  const [watchedP2PStreamerId, setWatchedP2PStreamerId] = useState<
    string | null
  >(null);
  const p2pAudioContextRef = useRef<AudioContext | null>(null);
  const p2pAudioGainRef = useRef<GainNode | null>(null);
  const outputVolume = useSettingsStore((state) => state.outputVolume);
  const outputDeviceId = useSettingsStore(
    (state) => state.audio.outputDeviceId,
  );
  const [micMixGain, setMicMixGain] = useState(audioMixer.config.micVolume);
  const [systemMixGain, setSystemMixGain] = useState(
    audioMixer.config.systemAudioVolume,
  );

  // 监听 LiveKit 屏幕分享轨与摄像头轨道状态变动
  useEffect(() => {
    const unbindShares = livekitService.onScreenSharesChange((shares) => {
      setScreenShares(new Map(shares));
    });
    const unbindShare = livekitService.onScreenShareChange((share) => {
      setActiveShare(share);
    });
    const unbindCamera = livekitService.onCameraTracksChange((tracks) => {
      setCameraTracks(new Map(tracks));
    });
    const unbindCloudflareVideo = cloudflareRealtimeService.onRemoteVideo(
      (publication, stream) => {
        const track = stream?.getVideoTracks()[0] || null;
        if (publication.source === "camera") {
          setCameraTracks((previous) => {
            const next = new Map(previous);
            if (track) next.set(publication.userId, track);
            else next.delete(publication.userId);
            return next;
          });
        } else if (publication.source === "screen") {
          setScreenShares((previous) => {
            const next = new Map(previous);
            if (track)
              next.set(publication.userId, {
                participantIdentity: publication.userId,
                track,
                isLocal: publication.userId === currentUser.id,
                preset: "Cloudflare SFU",
              });
            else next.delete(publication.userId);
            return next;
          });
        }
      },
    );
    const unbindPublications = cloudflareRealtimeService.onPublicationsChange(
      (publications) => {
        setCloudflarePublications(publications);
      },
    );
    const unbindWatchState = cloudflareRealtimeService.onStreamWatchChange(
      (state) => {
        setWatchStates((previous) =>
          new Map(previous).set(state.publisherSessionId, state),
        );
      },
    );
    const unbindP2P = p2pStreamManager.onStreamChange((stream, ownerId) => {
      setP2PRemoteAudio(
        stream && ownerId !== currentUser.id && stream.getAudioTracks().length
          ? { stream, userId: ownerId }
          : null,
      );
      setP2pScreenShares((prev) => {
        const next = new Map(prev);
        if (!stream) {
          next.delete(ownerId);
        } else {
          const videoTrack = stream.getVideoTracks()[0];
          next.set(ownerId, {
            participantIdentity: ownerId,
            track: videoTrack || stream,
            isLocal: ownerId === currentUser.id,
            preset: "P2P 直连",
          });
        }
        return next;
      });
    });

    return () => {
      unbindShares();
      unbindShare();
      unbindCamera();
      unbindCloudflareVideo();
      unbindPublications();
      unbindWatchState();
      unbindP2P();
    };
  }, [currentUser.id]);

  useEffect(() => {
    if (!p2pRemoteAudio || watchedP2PStreamerId !== p2pRemoteAudio.userId)
      return;
    const audio = new MediaStream(p2pRemoteAudio.stream.getAudioTracks());
    if (!audio.getAudioTracks().length) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(audio);
    const gain = context.createGain();
    source.connect(gain).connect(context.destination);
    p2pAudioContextRef.current = context;
    p2pAudioGainRef.current = gain;
    if (outputDeviceId && "setSinkId" in context) {
      void (context as AudioContext & { setSinkId(id: string): Promise<void> })
        .setSinkId(outputDeviceId)
        .catch(console.warn);
    }
    void context.resume();
    return () => {
      source.disconnect();
      gain.disconnect();
      p2pAudioGainRef.current = null;
      p2pAudioContextRef.current = null;
      void context.close();
    };
  }, [
    p2pRemoteAudio?.stream,
    p2pRemoteAudio?.userId,
    watchedP2PStreamerId,
    outputDeviceId,
  ]);

  useEffect(() => {
    if (
      !p2pAudioGainRef.current ||
      !p2pAudioContextRef.current ||
      !p2pRemoteAudio
    )
      return;
    p2pAudioGainRef.current.gain.setTargetAtTime(
      ((streamVolumes.get(p2pRemoteAudio.userId) ?? 100) / 100) *
        (outputVolume / 100),
      p2pAudioContextRef.current.currentTime,
      0.02,
    );
  }, [streamVolumes, outputVolume, p2pRemoteAudio?.userId]);

  // 筛选出当前频道的成员
  const currentParticipants = voiceStates.filter(
    (v) => v.channelId === channel.id,
  );
  const voiceStatesRef = useRef(voiceStates);
  voiceStatesRef.current = voiceStates;

  // 稳定提取当前频道内正在进行 P2P 直播的远端主播信息（避免由于其他成员麦克风状态波动导致重复触发）
  const activeP2PStreamer = useMemo(() => {
    return currentParticipants.find(
      (p) =>
        p.userId !== currentUser.id &&
        p.streaming &&
        (p.streamMode === "p2p_direct" || p.streamMode === "p2p_relay"),
    );
  }, [currentParticipants, currentUser.id]);

  const p2pStreamerId = activeP2PStreamer?.userId || null;
  const p2pStreamMode = activeP2PStreamer?.streamMode || null;

  useEffect(() => {
    if (watchedP2PStreamerId && watchedP2PStreamerId !== p2pStreamerId) {
      if (p2pStreamManager.getStreamOwnerId() !== currentUser.id) {
        p2pStreamManager.stopAll();
      }
      setWatchedP2PStreamerId(null);
    }
  }, [p2pStreamerId, watchedP2PStreamerId, currentUser.id]);

  // 组件卸载时释放拉流连接（主播端保留推流）
  useEffect(() => {
    return () => {
      if (p2pStreamManager.getStreamOwnerId() !== currentUser.id) {
        p2pStreamManager.stopAll();
      }
    };
  }, [currentUser.id]);

  // 仅在已连接语音且自己尚未同步到 voiceStates 时，才保底展示自己
  const hasCurrentUser = currentParticipants.some(
    (p) => p.userId === currentUser.id,
  );
  const rawParticipants =
    hasCurrentUser || !isConnected
      ? currentParticipants
      : [
          {
            userId: currentUser.id,
            guildId: channel.guildId || "",
            channelId: channel.id,
            selfMute: isMuted,
            selfDeaf: false,
            selfVideo: isVideoEnabled,
            streaming: isScreenSharing,
            user: currentUser,
          },
          ...currentParticipants,
        ];

  // 保证当前用户的 selfVideo 与本地 isVideoEnabled 强同步
  const displayParticipants = rawParticipants.map((p) => {
    if (p.userId === currentUser.id && isConnected) {
      return { ...p, selfMute: isMuted, selfVideo: isVideoEnabled };
    }
    return p;
  });

  const pinnedParticipant = pinnedUserId
    ? displayParticipants.find((p) => p.userId === pinnedUserId) || null
    : null;

  const getScreenPublication = (userId: string) =>
    cloudflarePublications.find(
      (publication) =>
        publication.userId === userId && publication.source === "screen",
    ) || cloudflareRealtimeService.getScreenPublicationForUser(userId);

  const isWatchingStream = (userId: string, mode?: string): boolean => {
    if (mode === "p2p_direct" || mode === "p2p_relay")
      return watchedP2PStreamerId === userId;
    if (VOICE_ENGINE === "cloudflare_realtime") {
      const publication = getScreenPublication(userId);
      return publication
        ? (
            watchStates.get(publication.sessionId) ||
            cloudflareRealtimeService.getWatchState(publication.sessionId)
          )?.watching === true
        : false;
    }
    return watchedLiveKitUsers.has(userId);
  };

  // 舞台多流网格：提取所有正在观看直播的成员、以及被用户置顶（Pin）的成员
  const stageParticipants = useMemo(() => {
    return displayParticipants.filter((p) => {
      const isWatched = isWatchingStream(p.userId, p.streamMode);
      const isPinned = pinnedUserId === p.userId;
      return isWatched || isPinned;
    });
  }, [
    displayParticipants,
    watchedLiveKitUsers,
    watchedP2PStreamerId,
    watchStates,
    pinnedUserId,
  ]);

  // 若被聚焦的成员离开频道，自动退出聚焦
  useEffect(() => {
    if (
      pinnedUserId &&
      !displayParticipants.some((p) => p.userId === pinnedUserId)
    ) {
      setPinnedUserId(null);
    }
  }, [pinnedUserId, displayParticipants]);

  // 当未处于聚焦状态或切换聚焦成员时，自动清理统计面板显示（严格保证“如果没有聚焦就不允许显示”）
  useEffect(() => {
    if (statsUserId && pinnedUserId !== statsUserId) {
      setStatsUserId(null);
    }
  }, [pinnedUserId, statsUserId]);

  const handleToggleStats = (userId: string) => {
    if (statsUserId === userId) {
      setStatsUserId(null);
    } else {
      setPinnedUserId(userId);
      setStatsUserId(userId);
    }
  };

  // 根据参与者信息索取对应的摄像头与屏幕分享轨道
  const getParticipantMedia = (p: VoiceState) => {
    const isMe = p.userId === currentUser.id;
    // 摄像头轨道解析
    const myVideoTrack = isVideoEnabled
      ? cameraTracks.get(currentUser.id) ||
        cameraTracks.get("local") ||
        livekitService.localCameraTrack
      : null;
    const cameraTrack = isMe
      ? myVideoTrack
      : p.selfVideo
        ? cameraTracks.get(p.userId)
        : null;

    // 屏幕分享轨道解析：优先兼容 SFU 与 P2P 本地推流预览
    const localP2PStream = p2pStreamManager.getLocalStream();
    const isLocalP2PStreaming =
      Boolean(localP2PStream) &&
      p2pStreamManager.getStreamOwnerId() === currentUser.id;
    const isCurrentlyScreenSharing = isScreenSharing || isLocalP2PStreaming;

    const p2pLocalShare =
      isCurrentlyScreenSharing && localP2PStream
        ? {
            participantIdentity: currentUser.id,
            track: localP2PStream.getVideoTracks()[0] || localP2PStream,
            isLocal: true,
            preset: "P2P 直连",
          }
        : null;

    const myScreenShare = isCurrentlyScreenSharing
      ? screenShares.get(currentUser.id) ||
        screenShares.get("local") ||
        livekitService.localScreenShare ||
        livekitService.activeScreenShare ||
        p2pScreenShares.get(currentUser.id) ||
        p2pLocalShare
      : null;

    // Cloudflare 的轨道公告可能先于 Gateway 的 streaming 状态到达。
    // 只要当前仍有该用户的屏幕轨公告，就允许呈现已订阅的活跃轨道。
    const hasCurrentCloudflareScreen =
      VOICE_ENGINE === "cloudflare_realtime" &&
      Boolean(getScreenPublication(p.userId));
    const participantScreenShare = isMe
      ? myScreenShare
      : p.streaming || hasCurrentCloudflareScreen
        ? screenShares.get(p.userId) || p2pScreenShares.get(p.userId)
        : null;

    // 活性检测：排除 readyState === "ended" 的已销毁媒体轨
    const rawTrack = participantScreenShare?.track;
    const isTrackAlive =
      rawTrack &&
      ((rawTrack as any).mediaStreamTrack
        ? (rawTrack as any).mediaStreamTrack.readyState !== "ended"
        : (rawTrack as any).readyState !== "ended");

    const validScreenShareTrack = isTrackAlive ? rawTrack : null;

    return {
      cameraTrack,
      screenShareTrack: validScreenShareTrack,
      screenShareInfo: validScreenShareTrack ? participantScreenShare : null,
    };
  };

  // 监听推流停止：当观看的主播停止推流时，自动清理观看队列与本地陈旧屏幕轨
  useEffect(() => {
    watchedLiveKitUsers.forEach((streamerId) => {
      const p = currentParticipants.find((item) => item.userId === streamerId);
      if (!p || !p.streaming) {
        livekitService.setScreenWatching(streamerId, false);
        setWatchedLiveKitUsers((prev) => {
          const next = new Set(prev);
          next.delete(streamerId);
          return next;
        });
        setScreenShares((prev) => {
          if (!prev.has(streamerId)) return prev;
          const next = new Map(prev);
          next.delete(streamerId);
          return next;
        });
      }
    });

    if (watchedP2PStreamerId) {
      const p = currentParticipants.find(
        (item) => item.userId === watchedP2PStreamerId,
      );
      if (!p || !p.streaming) {
        p2pStreamManager.stopAll();
        setWatchedP2PStreamerId(null);
      }
    }
  }, [currentParticipants, watchedLiveKitUsers, watchedP2PStreamerId]);

  // 需求 3：如果直播被关闭或用户自己关闭直播，右上角媒体属性/实时统计 HUD 自动关闭展示
  useEffect(() => {
    if (!statsUserId) return;
    const target = displayParticipants.find((p) => p.userId === statsUserId);
    if (!target) {
      setStatsUserId(null);
      return;
    }
    const media = getParticipantMedia(target);
    const hasAnyVideo = Boolean(media.cameraTrack || media.screenShareTrack);
    if (!hasAnyVideo) {
      setStatsUserId(null);
    }
  }, [
    displayParticipants,
    statsUserId,
    isVideoEnabled,
    cameraTracks,
    screenShares,
    p2pScreenShares,
  ]);

  // 监听远端音量、网络健康、活跃讲话者及声卡异常变动
  useEffect(() => {
    const unbindStats = livekitService.onNetworkStatsUpdate((stats) => {
      if (VOICE_ENGINE === "cloudflare_realtime") return;
      setNetworkStats(new Map(stats));
    });

    const unbindCloudflareStats =
      cloudflareRealtimeService.onNetworkStatsUpdate((stats) => {
        if (VOICE_ENGINE === "cloudflare_realtime")
          setNetworkStats(new Map(stats));
      });

    const unbindVol = (
      VOICE_ENGINE === "cloudflare_realtime"
        ? cloudflareRealtimeService
        : livekitService
    ).onParticipantVolumeChange((identity, vol) => {
      setParticipantVolumes((prev) => ({ ...prev, [identity]: vol }));
    });

    const unbindPTT = audioEngine.onPTTChange((active) => {
      setIsPTTPressed(active);
    });

    const unbindSpeakers = (
      VOICE_ENGINE === "cloudflare_realtime"
        ? cloudflareRealtimeService
        : livekitService
    ).onActiveSpeakersChange((speakers) => {
      setActiveSpeakers([...speakers]);
    });

    const unbindError = audioEngine.onError((err) => {
      setMicError(err);
    });

    const unbindSFrame = sframeManager.onStatsChange((stats) => {
      setSframeStats(stats);
    });

    const unbindCamera = livekitService.onCameraTracksChange((tracks) => {
      setCameraTracks(new Map(tracks));
    });

    return () => {
      unbindStats();
      unbindCloudflareStats();
      unbindVol();
      unbindPTT();
      unbindSpeakers();
      unbindError();
      unbindSFrame();
      unbindCamera();
    };
  }, []);

  const handleVolumeChange = (userId: string, vol: number) => {
    const val = Math.max(0, Math.min(200, vol));
    setParticipantVolumes((prev) => ({ ...prev, [userId]: val }));
    livekitService.setParticipantVolume(userId, val);
    cloudflareRealtimeService.setParticipantVolume(userId, val);
  };

  const getVolume = (userId: string) => {
    return participantVolumes[userId] !== undefined
      ? participantVolumes[userId]
      : (VOICE_ENGINE === "cloudflare_realtime"
          ? cloudflareRealtimeService
          : livekitService
        ).getParticipantVolume(userId);
  };

  const getStreamViewerCount = (userId: string): number | null => {
    if (VOICE_ENGINE !== "cloudflare_realtime") return null;
    const publication = getScreenPublication(userId);
    if (!publication) return null;
    return (
      (
        watchStates.get(publication.sessionId) ||
        cloudflareRealtimeService.getWatchState(publication.sessionId)
      )?.viewerCount ?? null
    );
  };

  const handleToggleWatching = async (
    participant: VoiceState,
  ): Promise<void> => {
    const userId = participant.userId;
    if (watchPending.has(userId)) return;
    setWatchPending((previous) => new Set(previous).add(userId));
    setWatchErrors((previous) => {
      const next = new Map(previous);
      next.delete(userId);
      return next;
    });
    try {
      let effectiveStreamMode =
        voiceStatesRef.current.find(
          (state) => state.userId === userId && state.channelId === channel.id,
        )?.streamMode || participant.streamMode;

      // A Cloudflare publication and the Gateway voice-state update can reach
      // the viewer in either order. If neither route is authoritative yet,
      // wait briefly instead of defaulting to the SFU branch and producing a
      // black/no-track watch session for a P2P broadcast.
      if (
        participant.streaming &&
        effectiveStreamMode !== "p2p_direct" &&
        effectiveStreamMode !== "p2p_relay" &&
        VOICE_ENGINE === "cloudflare_realtime" &&
        !getScreenPublication(userId)
      ) {
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const latest = voiceStatesRef.current.find(
            (state) =>
              state.userId === userId && state.channelId === channel.id,
          );
          effectiveStreamMode = latest?.streamMode || effectiveStreamMode;
          if (
            effectiveStreamMode === "p2p_direct" ||
            effectiveStreamMode === "p2p_relay" ||
            getScreenPublication(userId)
          )
            break;
        }
      }

      if (
        effectiveStreamMode === "p2p_direct" ||
        effectiveStreamMode === "p2p_relay"
      ) {
        if (watchedP2PStreamerId === userId) {
          p2pStreamManager.stopAll();
          setWatchedP2PStreamerId(null);
        } else {
          await p2pStreamManager.joinStream(
            channel.id,
            channel.guildId || "",
            userId,
            effectiveStreamMode,
          );
          setWatchedP2PStreamerId(userId);
        }
      } else if (VOICE_ENGINE === "cloudflare_realtime") {
        const publication = getScreenPublication(userId);
        if (!publication)
          throw new Error(t("voice:connectionPopover.streamTrackNotReady"));
        if (isWatchingStream(userId, effectiveStreamMode))
          await cloudflareRealtimeService.stopWatchingStream(
            publication.sessionId,
          );
        else
          await cloudflareRealtimeService.startWatchingStream(
            publication.sessionId,
          );
      } else {
        const next = !watchedLiveKitUsers.has(userId);
        livekitService.setScreenWatching(userId, next);
        setWatchedLiveKitUsers((previous) => {
          const updated = new Set(previous);
          if (next) updated.add(userId);
          else updated.delete(userId);
          return updated;
        });
      }
    } catch (error) {
      setWatchErrors((previous) =>
        new Map(previous).set(
          userId,
          error instanceof Error
            ? error.message
            : t("voice:connectionPopover.streamJoinFailed"),
        ),
      );
    } finally {
      setWatchPending((previous) => {
        const next = new Set(previous);
        next.delete(userId);
        return next;
      });
    }
  };

  const getParticipantStats = (userId: string): NetworkStats | null => {
    const isMe = userId === currentUser.id;
    if (isMe) {
      return (
        networkStats.get("local-me") || networkStats.get(currentUser.id) || null
      );
    }
    return networkStats.get(userId) || null;
  };

  const localStats = getParticipantStats(currentUser.id);
  const isPTTMode =
    audioEngine.config.inputMode === "PTT" || audioEngine.config.pushToTalk;

  // 伴音与麦克风混音增益调节
  const handleMixGainChange = (mic: number, sys: number) => {
    setMicMixGain(mic);
    setSystemMixGain(sys);
    audioMixer.setGains(mic, sys, isMuted);
  };

  return (
    <div
      data-testid="voice-room-area"
      className="flex-1 flex flex-col h-full bg-[#111214] relative overflow-hidden select-none"
    >
      {/* 顶部房间信息栏 */}
      <div className="h-12 border-b border-[#232428] px-3 sm:px-4 flex items-center justify-between bg-discord-channelList/50 backdrop-blur z-10">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          {onToggleMobileDrawer && (
            <button
              type="button"
              data-testid="toggle-mobile-drawer-btn"
              onClick={onToggleMobileDrawer}
              className="md:hidden p-1.5 -ml-1 text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition flex-shrink-0"
              title={t("voice:mediaTooltips.openDrawer")}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <Volume2 className="w-5 h-5 text-discord-green flex-shrink-0" />
          <span className="font-bold text-discord-textHeader truncate max-w-[110px] xs:max-w-[150px] sm:max-w-none">
            {channel.name}
          </span>
          <span className="hidden xs:inline text-xs text-discord-textMuted bg-[#1e1f22] px-2 py-0.5 rounded-full flex-shrink-0">
            {channel.bitrate
              ? `${channel.bitrate / 1000}kbps Opus`
              : `${audioEngine.config.audioBitrate / 1000}kbps Opus`}
          </span>
          {channel.isE2EE ? (
            <div className="hidden sm:flex items-center space-x-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 flex-shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>SFrame 端到端加密</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center space-x-1 text-[11px] text-discord-green bg-discord-green/10 px-2 py-0.5 rounded border border-discord-green/20 flex-shrink-0">
              <ShieldCheck className="w-3 h-3" />
              <span>DTLS-SRTP 加密</span>
            </div>
          )}
          {activeShare && (
            <div className="flex items-center space-x-1.5 text-[11px] text-discord-brand bg-discord-brand/10 px-2 py-0.5 rounded border border-discord-brand/20 animate-pulse flex-shrink-0">
              <ScreenShare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {activeShare.codec ? `[${activeShare.codec}] ` : ""}Simulcast
                屏幕直播中
              </span>
              <span className="sm:hidden">
                {activeShare.codec ? `[${activeShare.codec}] ` : ""}直播中
              </span>
            </div>
          )}
        </div>

        {/* 顶部右侧：伴音混音与网络健康看板切换按钮 */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
          {/* 声卡伴音混音控制开关 */}
          <button
            onClick={() => setIsMixerOpen(!isMixerOpen)}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
              isMixerOpen
                ? "bg-discord-brand text-white border-discord-brand"
                : "bg-[#1e1f22] text-discord-textMuted border-[#2b2d31] hover:text-white hover:border-[#383a40]"
            }`}
            title={t("voice:mediaTooltips.mixPanel")}
          >
            <Sliders className="w-3.5 h-3.5 text-discord-brand" />
            <span className="hidden sm:inline">伴音混音器</span>
            <span className="sm:hidden">混音</span>
          </button>
        </div>
      </div>

      {/* 顶部麦克风故障容灾提示条 */}
      {micError && (
        <div className="bg-discord-danger/15 border-b border-discord-danger/30 px-4 py-2 flex items-center justify-between text-xs text-red-300 z-10 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <MicOff className="w-4 h-4 text-discord-danger flex-shrink-0" />
            <span>
              {micError}
              （系统已自动启用仅收听模式，您仍可清晰收听房间成员语音及伴音）
            </span>
          </div>
          <button
            onClick={() => setMicError(null)}
            className="p-1 hover:text-white rounded transition"
            title={t("voice:mediaTooltips.closeNotice")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 主展示区 (仅连接后显示详细用户画面；连接中展示圆形Loading；未连接展示大厅预览) */}
      {isConnecting ? (
        <div
          data-testid="voice-connecting-view"
          className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fadeIn select-none"
        >
          {/* 精致的双层脉冲圆形 Loading 指示器 */}
          <div className="relative flex items-center justify-center mb-6">
            <div className="w-20 h-20 rounded-full border-4 border-[#5865F2]/20 border-t-discord-brand animate-spin" />
            <div className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-discord-brand/10 flex items-center justify-center animate-pulse">
              <Volume2 className="w-6 h-6 text-discord-brand" />
            </div>
          </div>

          <h3 className="text-lg sm:text-xl font-bold text-discord-textHeader mb-2">
            正在连接语音服务器...
          </h3>
          <p className="text-xs sm:text-sm text-discord-textMuted max-w-sm mb-6 leading-relaxed">
            正在与 LiveKit SFU 媒体网关建立 WebRTC 会话，即将连入{" "}
            <span className="text-white font-medium">#{channel.name}</span>
          </p>

          {onCancelJoin && (
            <button
              onClick={onCancelJoin}
              data-testid="voice-cancel-connecting-btn"
              className="px-5 py-2 rounded-full bg-[#2b2d31] hover:bg-[#35373c] text-discord-textNormal hover:text-white text-xs font-semibold transition shadow-md flex items-center space-x-2"
            >
              <PhoneOff className="w-3.5 h-3.5 text-discord-danger" />
              <span>取消连接</span>
            </button>
          )}
        </div>
      ) : !isActuallyConnected ? (
        /* 未连接（房间预览大厅），隐藏详细用户视频与卡片网格，展示沉浸式频道预览与加入按钮 */
        <div
          data-testid="voice-preview-lobby"
          className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-fadeIn select-none"
        >
          <div className="w-20 h-20 rounded-2xl bg-[#2b2d31]/80 border border-[#383a40] flex items-center justify-center mb-5 shadow-xl">
            <Volume2 className="w-10 h-10 text-discord-green animate-pulse" />
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-discord-textHeader mb-2">
            #{channel.name}
          </h2>

          <p className="text-xs sm:text-sm text-discord-textMuted max-w-md mb-6 leading-relaxed">
            {channel.topic ||
              "当前语音频道支持高保真 Opus 音频、低延迟推流与双轨画中画互动。点击下方按钮即可进入通话。"}
          </p>

          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#1e1f22] border border-[#2b2d31] text-xs text-discord-textMuted mb-6">
            <span className="w-2 h-2 rounded-full bg-discord-green inline-block animate-pulse" />
            <span>
              {displayParticipants.length > 0
                ? `${displayParticipants.length} 位成员正在通话中`
                : "频道当前空闲，成为第一个加入的人吧"}
            </span>
          </div>

          {onJoin && (
            <button
              onClick={onJoin}
              data-testid="lobby-join-voice-btn"
              className="px-8 py-3 rounded-full bg-discord-green text-white text-sm font-bold hover:bg-discord-green/90 active:scale-95 transition shadow-lg hover:shadow-discord-green/20 flex items-center space-x-2 cursor-pointer"
            >
              <Volume2 className="w-5 h-5" />
              <span>加入语音通话</span>
            </button>
          )}
        </div>
      ) : (
        /* 仅在 LiveKit 连接成功后，才呈现中间的详细用户画面 */
        <div
          data-testid="voice-connected-stage"
          className={`flex-1 p-3 sm:p-4 flex flex-col items-center overflow-y-auto custom-scrollbar ${
            isTheaterMode ? "justify-start" : "justify-center"
          }`}
        >
          {/* 当有正在观看的直播或用户聚焦时：在中央渲染自适应多流分屏网格舞台 */}
          {stageParticipants.length > 0 && (
            <div
              className={`w-full grid gap-3 sm:gap-4 mb-4 transition-all animate-fadeIn ${
                stageParticipants.length === 1
                  ? "grid-cols-1 max-w-4xl"
                  : stageParticipants.length === 2
                    ? "grid-cols-1 md:grid-cols-2 max-w-6xl"
                    : stageParticipants.length === 3
                      ? "grid-cols-1 md:grid-cols-3 max-w-7xl"
                      : stageParticipants.length === 4
                        ? "grid-cols-1 sm:grid-cols-2 max-w-7xl"
                        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-7xl"
              }`}
            >
              {stageParticipants.map((p) => {
                const isMe = p.userId === currentUser.id;
                const speaking = isMe
                  ? isSpeaking
                  : activeSpeakers.includes(p.userId);
                const stats = getParticipantStats(p.userId);
                const userVol = getVolume(p.userId);
                const media = getParticipantMedia(p);
                const isPinned = pinnedUserId === p.userId;

                return (
                  <ParticipantCard
                    key={`stage-${p.userId}`}
                    participant={p}
                    isMe={isMe}
                    speaking={speaking}
                    stats={stats}
                    volume={userVol}
                    onVolumeChange={(vol) => handleVolumeChange(p.userId, vol)}
                    isPinned={isPinned}
                    onTogglePin={() => {
                      setPinnedUserId(isPinned ? null : p.userId);
                      if (isPinned) setStatsUserId(null);
                    }}
                    cameraTrack={media.cameraTrack}
                    screenShareTrack={media.screenShareTrack}
                    screenShareInfo={media.screenShareInfo}
                    streamAvailable={
                      p.streaming ||
                      Boolean(media.screenShareTrack) ||
                      (VOICE_ENGINE === "cloudflare_realtime" &&
                        Boolean(getScreenPublication(p.userId)))
                    }
                    watching={isWatchingStream(p.userId, p.streamMode)}
                    viewerCount={getStreamViewerCount(p.userId)}
                    watchPending={watchPending.has(p.userId)}
                    watchError={watchErrors.get(p.userId)}
                    onToggleWatching={() => void handleToggleWatching(p)}
                    streamVolume={
                      streamVolumes.get(p.userId) ??
                      cloudflareRealtimeService.getStreamVolume(p.userId)
                    }
                    onStreamVolumeChange={(volume) => {
                      cloudflareRealtimeService.setStreamVolume(
                        p.userId,
                        volume,
                      );
                      setStreamVolumes((previous) =>
                        new Map(previous).set(p.userId, volume),
                      );
                    }}
                    guild={guild}
                    currentUser={currentUser}
                    isTheaterMode={isTheaterMode}
                    isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
                    noiseSuppressionMode={noiseSuppressionMode}
                    isSpotlight={true}
                    onStopScreenShare={onStopScreenShare || onToggleScreenShare}
                    peerLatency={peerLatencies.get(p.userId)}
                    isP2P={isP2P}
                    showStatsHUD={statsUserId === p.userId}
                    onToggleStats={() => handleToggleStats(p.userId)}
                    onCloseStats={() => setStatsUserId(null)}
                  />
                );
              })}
            </div>
          )}

          {/* 参与者网格 (若舞台有流展示或剧场模式，其余成员下沉为横向紧凑栏；无流时为自适应 CSS Grid) */}
          {(() => {
            const otherParticipants =
              stageParticipants.length > 0
                ? displayParticipants.filter(
                    (p) =>
                      !stageParticipants.some((sp) => sp.userId === p.userId),
                  )
                : displayParticipants;

            if (otherParticipants.length === 0) return null;

            return (
              <div
                className={`w-full max-w-7xl transition-all ${
                  stageParticipants.length > 0 || isTheaterMode
                    ? "flex flex-row space-x-3 overflow-x-auto py-2 px-1 custom-scrollbar justify-start"
                    : `grid gap-3 sm:gap-4 ${
                        displayParticipants.length === 1
                          ? "grid-cols-1 max-w-md"
                          : displayParticipants.length === 2
                            ? "grid-cols-1 sm:grid-cols-2"
                            : "grid-cols-1 xs:grid-cols-2 lg:grid-cols-3"
                      }`
                }`}
              >
                {otherParticipants.map((p) => {
                  const isMe = p.userId === currentUser.id;
                  const speaking = isMe
                    ? isSpeaking
                    : activeSpeakers.includes(p.userId);
                  const stats = getParticipantStats(p.userId);
                  const userVol = getVolume(p.userId);
                  const isPinned = pinnedUserId === p.userId;
                  const media = getParticipantMedia(p);

                  return (
                    <ParticipantCard
                      key={p.userId}
                      participant={p}
                      isMe={isMe}
                      speaking={speaking}
                      stats={stats}
                      volume={userVol}
                      onVolumeChange={(vol) =>
                        handleVolumeChange(p.userId, vol)
                      }
                      isPinned={isPinned}
                      onTogglePin={() =>
                        setPinnedUserId(isPinned ? null : p.userId)
                      }
                      cameraTrack={media.cameraTrack}
                      screenShareTrack={media.screenShareTrack}
                      screenShareInfo={media.screenShareInfo}
                      streamAvailable={
                        p.streaming ||
                        Boolean(media.screenShareTrack) ||
                        (VOICE_ENGINE === "cloudflare_realtime" &&
                          Boolean(getScreenPublication(p.userId)))
                      }
                      watching={isWatchingStream(p.userId, p.streamMode)}
                      viewerCount={getStreamViewerCount(p.userId)}
                      watchPending={watchPending.has(p.userId)}
                      watchError={watchErrors.get(p.userId)}
                      onToggleWatching={() => void handleToggleWatching(p)}
                      streamVolume={
                        streamVolumes.get(p.userId) ??
                        cloudflareRealtimeService.getStreamVolume(p.userId)
                      }
                      onStreamVolumeChange={(volume) => {
                        cloudflareRealtimeService.setStreamVolume(
                          p.userId,
                          volume,
                        );
                        setStreamVolumes((previous) =>
                          new Map(previous).set(p.userId, volume),
                        );
                      }}
                      guild={guild}
                      currentUser={currentUser}
                      isTheaterMode={
                        isTheaterMode || Boolean(stageParticipants.length > 0)
                      }
                      isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
                      noiseSuppressionMode={noiseSuppressionMode}
                      isSpotlight={false}
                      onStopScreenShare={
                        onStopScreenShare || onToggleScreenShare
                      }
                      peerLatency={peerLatencies.get(p.userId)}
                      isP2P={isP2P}
                      showStatsHUD={false}
                      onToggleStats={() => handleToggleStats(p.userId)}
                      onCloseStats={() => setStatsUserId(null)}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* 按键说话 (PTT) 悬浮提示胶囊 */}
      {isPTTMode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-[#1e1f22]/90 backdrop-blur px-4 py-1.5 rounded-full border border-[#383a40] flex items-center space-x-2 text-xs shadow-lg z-20">
          <Keyboard
            className={`w-4 h-4 ${isPTTPressed ? "text-discord-green animate-bounce" : "text-discord-textMuted"}`}
          />
          <span className="text-discord-textMuted">按键说话:</span>
          <span className="font-bold text-white bg-[#2b2d31] px-2 py-0.5 rounded border border-[#383a40]">
            {audioEngine.config.pushToTalkKey || "Space"}
          </span>
          <span
            className={`font-semibold ${isPTTPressed ? "text-discord-green" : "text-discord-textMuted"}`}
          >
            {isPTTPressed ? "● 正在开麦推流" : "未按压 (静音防杂音)"}
          </span>
        </div>
      )}

      {/* 底部浮动控制栏 */}
      <div className="h-20 bg-[#1e1f22]/95 backdrop-blur border-t border-[#2b2d31] flex items-center justify-center space-x-2 sm:space-x-4 px-2 sm:px-4 z-20 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {isConnecting ? (
          <div className="flex items-center space-x-3 sm:space-x-4 animate-fadeIn">
            <Loader2 className="w-4 h-4 text-[#faa61a] animate-spin" />
            <span className="text-xs sm:text-sm text-[#faa61a] font-medium">
              正在建立 LiveKit 媒体连接...
            </span>
            {onCancelJoin && (
              <button
                onClick={onCancelJoin}
                className="px-3 py-1.5 rounded-full bg-[#2b2d31] hover:bg-[#35373c] text-discord-textMuted hover:text-white text-xs transition font-semibold"
              >
                取消
              </button>
            )}
          </div>
        ) : !isActuallyConnected ? (
          <div className="flex items-center space-x-3 sm:space-x-4">
            <span className="text-xs sm:text-sm text-discord-textMuted">
              您当前未连入此语音频道
            </span>
          </div>
        ) : (
          <>
            {/* 麦克风与快捷切换控制组 (类 Discord 紧凑胶囊) */}
            <div
              className={`relative inline-flex items-stretch rounded-full transition shadow-lg ${
                isPTTMode
                  ? isPTTPressed
                    ? "bg-discord-green text-white ring-4 ring-discord-green/30 scale-105"
                    : "bg-[#2b2d31] text-discord-textMuted"
                  : isMuted
                    ? "bg-discord-danger text-white"
                    : "bg-[#2b2d31] text-discord-textNormal"
              }`}
              ref={micMenuRef}
            >
              <button
                type="button"
                data-testid="voice-toggle-mute-btn"
                onClick={isPTTMode ? undefined : onToggleMute}
                onTouchStart={
                  isPTTMode
                    ? (e) => {
                        e.preventDefault();
                        setIsPTTPressed(true);
                        audioEngine.setPTTActive(true);
                      }
                    : undefined
                }
                onTouchEnd={
                  isPTTMode
                    ? (e) => {
                        e.preventDefault();
                        setIsPTTPressed(false);
                        audioEngine.setPTTActive(false);
                      }
                    : undefined
                }
                className={`p-2.5 sm:p-3 pr-1.5 sm:pr-2 rounded-l-full transition cursor-pointer flex items-center justify-center ${
                  isPTTMode
                    ? isPTTPressed
                      ? "hover:bg-discord-green/90"
                      : "hover:bg-discord-hover text-discord-textMuted"
                    : isMuted
                      ? "hover:bg-discord-danger/90"
                      : "hover:bg-discord-hover text-discord-textNormal"
                }`}
                title={
                  isPTTMode
                    ? "按住说话 (Touch to Talk)"
                    : isMuted
                      ? "开麦"
                      : "静音"
                }
              >
                {isPTTMode ? (
                  isPTTPressed ? (
                    <Mic className="w-5 h-5 text-white" />
                  ) : (
                    <MicOff className="w-5 h-5" />
                  )
                ) : isMuted ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>

              <button
                type="button"
                data-testid="voice-mic-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMicMenuOpen((prev) => !prev);
                }}
                className={`px-1.5 sm:px-2 rounded-r-full border-l border-black/25 transition flex items-center justify-center cursor-pointer ${
                  isMuted || (isPTTMode && isPTTPressed)
                    ? "hover:bg-black/10"
                    : "hover:bg-discord-hover hover:text-white"
                }`}
                title={t("voice:mediaTooltips.micOptions")}
              >
                <ChevronUp
                  className={`w-3 h-3 transition-transform duration-150 ${
                    isMicMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* 麦克风快捷弹出菜单 */}
              {isMicMenuOpen && (
                <div
                  data-testid="mic-quick-menu"
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64 bg-[#111214] border border-[#2b2d31] rounded-xl shadow-2xl p-2 z-50 text-left animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-discord-brand" />
                    <span>选择麦克风设备</span>
                  </div>

                  <div className="space-y-0.5 mt-1 max-h-48 overflow-y-auto">
                    {micDevices.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-gray-500">
                        未检测到可用麦克风
                      </div>
                    ) : (
                      micDevices.map((d, index) => {
                        const isSelected =
                          activeMicId === d.deviceId ||
                          (!activeMicId && index === 0);
                        return (
                          <button
                            key={d.deviceId || index}
                            type="button"
                            data-testid={`mic-option-${d.deviceId}`}
                            onClick={() => handleSelectMic(d.deviceId)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                              isSelected
                                ? "bg-discord-brand/20 text-white font-semibold"
                                : "text-gray-300 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            <span className="truncate pr-2">
                              {d.label || `麦克风设备 ${index + 1}`}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-discord-brand shrink-0" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 摄像头与快捷切换控制组 (类 Discord 紧凑胶囊) */}
            <div
              className={`relative inline-flex items-stretch rounded-full transition shadow-lg ${
                isVideoEnabled
                  ? "bg-discord-green text-white"
                  : "bg-[#2b2d31] text-discord-textNormal"
              }`}
              ref={cameraMenuRef}
            >
              <button
                type="button"
                onClick={onToggleVideo}
                data-testid="voice-toggle-camera-btn"
                className={`p-2.5 sm:p-3 pr-1.5 sm:pr-2 rounded-l-full transition cursor-pointer flex items-center justify-center ${
                  isVideoEnabled
                    ? "hover:bg-discord-green/90"
                    : "hover:bg-discord-hover text-discord-textNormal"
                }`}
                title={isVideoEnabled ? "关闭摄像头" : "打开摄像头"}
              >
                {isVideoEnabled ? (
                  <Video className="w-5 h-5" />
                ) : (
                  <VideoOff className="w-5 h-5" />
                )}
              </button>

              <button
                type="button"
                data-testid="voice-camera-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCameraMenuOpen((prev) => !prev);
                }}
                className={`px-1.5 sm:px-2 rounded-r-full border-l border-black/25 transition flex items-center justify-center cursor-pointer ${
                  isVideoEnabled
                    ? "hover:bg-black/10"
                    : "hover:bg-discord-hover hover:text-white"
                }`}
                title={t("voice:mediaTooltips.cameraOptions")}
              >
                <ChevronUp
                  className={`w-3 h-3 transition-transform duration-150 ${
                    isCameraMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* 快捷弹出菜单 */}
              {isCameraMenuOpen && (
                <div
                  data-testid="camera-quick-menu"
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64 bg-[#111214] border border-[#2b2d31] rounded-xl shadow-2xl p-2 z-50 text-left animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-discord-brand" />
                    <span>选择摄像头设备</span>
                  </div>

                  <div className="space-y-0.5 mt-1 max-h-48 overflow-y-auto">
                    {cameraDevices.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-gray-500">
                        未检测到可用摄像头
                      </div>
                    ) : (
                      cameraDevices.map((d, index) => {
                        const isSelected =
                          activeCameraId === d.deviceId ||
                          (!activeCameraId && index === 0);
                        return (
                          <button
                            key={d.deviceId || index}
                            type="button"
                            data-testid={`camera-option-${d.deviceId}`}
                            onClick={() => handleSelectCamera(d.deviceId)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                              isSelected
                                ? "bg-discord-brand/20 text-white font-semibold"
                                : "text-gray-300 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            <span className="truncate pr-2">
                              {d.label || `摄像头设备 ${index + 1}`}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-discord-brand shrink-0" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="h-px bg-white/5 my-1.5" />

                  <button
                    type="button"
                    data-testid="camera-menu-settings-btn"
                    onClick={() => {
                      setIsCameraMenuOpen(false);
                      onOpenVideoSettings?.();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-discord-brand hover:bg-discord-brand/10 transition cursor-pointer font-medium"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>视频设置...</span>
                  </button>
                </div>
              )}
            </div>

            {/* 屏幕共享直播 */}
            {(() => {
              const isLocalP2PActive =
                Boolean(p2pStreamManager.getLocalStream()) &&
                p2pStreamManager.getStreamOwnerId() === currentUser.id;
              const isScreenActive =
                isScreenSharing ||
                activeShare?.isLocal ||
                isLocalP2PActive ||
                livekitService.isSharingScreen;

              return (
                <button
                  data-testid="voice-toggle-screen-btn"
                  onClick={() => {
                    if (isScreenActive) {
                      if (onStopScreenShare) {
                        onStopScreenShare();
                      } else {
                        onToggleScreenShare();
                      }
                    } else {
                      onToggleScreenShare();
                    }
                  }}
                  className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg ${
                    isScreenActive
                      ? "bg-discord-brand text-white hover:bg-discord-brand-hover ring-4 ring-discord-brand/30"
                      : "bg-[#2b2d31] text-discord-textNormal hover:bg-discord-hover"
                  }`}
                  title={isScreenActive ? "停止共享" : "屏幕共享"}
                >
                  <ScreenShare className="w-5 h-5" />
                </button>
              );
            })()}

            {/* AI 降噪切换 (弹出浮层支持 4 档精准点选：RNNoise / DTLN / DFNv3 / 关闭直通) */}
            <div className="relative" ref={noiseMenuRef}>
              <button
                data-testid="voice-sparkles-btn"
                onClick={() => setIsNoiseMenuOpen((prev) => !prev)}
                className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg flex items-center space-x-1.5 ${
                  isNoiseSuppressionEnabled
                    ? noiseSuppressionMode === "dfn3"
                      ? "bg-purple-500/30 text-purple-300 border border-purple-500 ring-1 ring-purple-500/40 hover:bg-purple-500/40"
                      : noiseSuppressionMode === "dtln"
                        ? "bg-discord-green/30 text-discord-green border border-discord-green ring-1 ring-discord-green/40 hover:bg-discord-green/40"
                        : "bg-discord-green/20 text-discord-green border border-discord-green/40 hover:bg-discord-green/30"
                    : "bg-[#2b2d31] text-discord-textMuted hover:bg-discord-hover"
                }`}
                title={
                  noiseSuppressionMode === "dfn3"
                    ? "DFNv3 旗舰全频降噪已开启 (48kHz 复数滤波)"
                    : noiseSuppressionMode === "dtln"
                      ? "DTLN 深度净化降噪已开启 (专攻消除机械键盘敲击音)"
                      : isNoiseSuppressionEnabled
                        ? "RNNoise AI 智能降噪已开启"
                        : "AI 降噪已关闭"
                }
              >
                <Sparkles className="w-5 h-5" />
              </button>

              {isNoiseMenuOpen && (
                <div
                  data-testid="voice-noise-menu"
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64 bg-[#2b2d31] border border-[#383a40] rounded-xl shadow-2xl p-2 z-50 animate-fadeIn space-y-1"
                >
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-discord-brand" />
                    <span>选择 AI 智能降噪引擎</span>
                  </div>

                  <div className="space-y-0.5 mt-1">
                    {/* 选项 1: RNNoise */}
                    <button
                      type="button"
                      data-testid="noise-option-rnnoise"
                      onClick={() => handleSelectNoiseMode("rnnoise")}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        isNoiseSuppressionEnabled &&
                        noiseSuppressionMode === "rnnoise"
                          ? "bg-discord-brand/20 text-white font-semibold"
                          : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-discord-brand" />
                        <div className="text-left">
                          <div className="text-xs">RNNoise 标准轻量</div>
                          <div className="text-[10px] text-discord-textMuted">
                            平稳风噪底噪 (推荐)
                          </div>
                        </div>
                      </div>
                      {isNoiseSuppressionEnabled &&
                        noiseSuppressionMode === "rnnoise" && (
                          <Check className="w-3.5 h-3.5 text-discord-brand shrink-0" />
                        )}
                    </button>

                    {/* 选项 2: DTLN */}
                    <button
                      type="button"
                      data-testid="noise-option-dtln"
                      onClick={() => handleSelectNoiseMode("dtln")}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        isNoiseSuppressionEnabled &&
                        noiseSuppressionMode === "dtln"
                          ? "bg-discord-green/20 text-white font-semibold"
                          : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-discord-green" />
                        <div className="text-left">
                          <div className="text-xs">DTLN 深度净化</div>
                          <div className="text-[10px] text-discord-textMuted">
                            专攻消机械键盘音
                          </div>
                        </div>
                      </div>
                      {isNoiseSuppressionEnabled &&
                        noiseSuppressionMode === "dtln" && (
                          <Check className="w-3.5 h-3.5 text-discord-green shrink-0" />
                        )}
                    </button>

                    {/* 选项 3: DFNv3 */}
                    <button
                      type="button"
                      data-testid="noise-option-dfn3"
                      onClick={() => handleSelectNoiseMode("dfn3")}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        isNoiseSuppressionEnabled &&
                        noiseSuppressionMode === "dfn3"
                          ? "bg-purple-500/20 text-white font-semibold"
                          : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Radio className="w-3.5 h-3.5 text-purple-400" />
                        <div className="text-left">
                          <div className="text-xs">DFNv3 旗舰声学</div>
                          <div className="text-[10px] text-discord-textMuted">
                            48kHz 全频复数滤波
                          </div>
                        </div>
                      </div>
                      {isNoiseSuppressionEnabled &&
                        noiseSuppressionMode === "dfn3" && (
                          <Check className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        )}
                    </button>

                    {/* 选项 4: 关闭直通 */}
                    <button
                      type="button"
                      data-testid="noise-option-off"
                      onClick={() => handleSelectNoiseMode("off")}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        !isNoiseSuppressionEnabled ||
                        noiseSuppressionMode === "off"
                          ? "bg-rose-500/20 text-white font-semibold"
                          : "text-gray-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                        <div className="text-left">
                          <div className="text-xs">直通原声 (未降噪)</div>
                          <div className="text-[10px] text-discord-textMuted">
                            关闭算法降噪
                          </div>
                        </div>
                      </div>
                      {(!isNoiseSuppressionEnabled ||
                        noiseSuppressionMode === "off") && (
                        <Check className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 挂断退出 */}
            <button
              onClick={onLeave}
              className="p-2.5 sm:p-3.5 rounded-full bg-discord-danger text-white hover:bg-discord-danger/90 transition shadow-lg"
              title={t("voice:mediaTooltips.disconnect")}
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* 4.2 伴音与麦克风声卡混音控制模态浮层 */}
      {isMixerOpen && (
        <div className="absolute bottom-24 right-6 z-40 bg-[#313338] w-80 p-5 rounded-2xl border border-[#3f4147] shadow-2xl animate-fadeIn space-y-4">
          <div className="flex justify-between items-center border-b border-[#383a40] pb-2">
            <div className="flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-discord-brand" />
              <h4 className="font-bold text-sm text-white">
                声卡伴音混音控制台
              </h4>
            </div>
            <button
              onClick={() => setIsMixerOpen(false)}
              className="text-discord-textMuted hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 麦克风人声音量 */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-discord-textMuted">麦克风人声增益</span>
              <span className="text-white font-mono">{micMixGain}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={micMixGain}
              onChange={(e) =>
                handleMixGainChange(Number(e.target.value), systemMixGain)
              }
              className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-discord-brand"
            />
          </div>

          {/* 系统游戏伴音音量 */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-discord-textMuted">系统/游戏音频伴音</span>
              <span className="text-discord-green font-mono">
                {systemMixGain}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={systemMixGain}
              onChange={(e) =>
                handleMixGainChange(micMixGain, Number(e.target.value))
              }
              className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-discord-green"
            />
          </div>

          <div className="pt-2 border-t border-[#383a40] flex justify-between items-center text-[11px] text-discord-textMuted">
            <span>立体声推流状态:</span>
            <span className="text-discord-green font-bold bg-discord-green/10 px-2 py-0.5 rounded">
              已合成立体声
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
