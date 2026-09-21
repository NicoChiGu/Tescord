import React, { useState, useEffect, useRef } from "react";
import { Channel, User, VoiceState, NetworkStats, Guild } from "@tescord/types";
import { livekitService, ActiveScreenShare } from "../services/livekit.js";
import { audioEngine } from "../services/audioEngine.js";
import { audioMixer } from "../services/audioMixer.js";
import { sframeManager, SFrameStats } from "../services/sframe.js";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
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
  Maximize2,
  ShieldCheck,
  Wifi,
  Sliders,
  X,
  Keyboard,
  Layers,
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
} from "lucide-react";
import { useViewport } from "../hooks/useViewport.js";

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
  guild?: Guild | null;
  currentUser: User;
  isTheaterMode: boolean;
  isNoiseSuppressionEnabled: boolean;
  noiseSuppressionMode: "off" | "rnnoise" | "dtln";
  isSpotlight?: boolean;
  selectedQuality?: "high" | "medium" | "low" | "auto";
  onQualitySelect?: (q: "high" | "medium" | "low" | "auto") => void;
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
  guild,
  currentUser,
  isTheaterMode,
  isNoiseSuppressionEnabled,
  noiseSuppressionMode,
  isSpotlight = false,
  selectedQuality = "auto",
  onQualitySelect,
}) => {
  // 当同时存在屏幕分享与摄像头时，是否对调主次画面 (默认: 屏幕分享为主，摄像头小窗在右下角)
  const [isSwapped, setIsSwapped] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);

  const hasCamera = Boolean(cameraTrack);
  const hasScreen = Boolean(screenShareTrack);
  const hasAnyVideo = hasCamera || hasScreen;

  // 确定主画面轨与画中画 (PiP) 轨
  const mainTrack = hasScreen && hasCamera
    ? (isSwapped ? cameraTrack : screenShareTrack)
    : (hasScreen ? screenShareTrack : cameraTrack);

  const pipTrack = hasScreen && hasCamera
    ? (isSwapped ? screenShareTrack : cameraTrack)
    : null;

  const isMainMirrored = hasScreen && hasCamera
    ? (isSwapped ? isMe : false)
    : (hasScreen ? false : isMe);

  const isPipMirrored = hasScreen && hasCamera
    ? (isSwapped ? false : isMe)
    : false;

  const mainFitClass = (hasScreen && hasCamera && !isSwapped) || (hasScreen && !hasCamera)
    ? "w-full h-full object-contain bg-black"
    : "w-full h-full object-cover";

  const pipFitClass = isSwapped
    ? "w-full h-full object-contain bg-black"
    : "w-full h-full object-cover";

  const targetUser =
    participant.user || {
      id: participant.userId,
      username: isMe ? currentUser.username : "用户",
      avatarUrl: undefined,
    };

  return (
    <UserContextMenu
      targetUser={targetUser}
      guild={guild}
      isInVoice={true}
    >
      <div
        onDoubleClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        onClick={() => {
          // 在无视频且未聚焦时，点击卡片也可触发聚焦
          if (!hasAnyVideo && !isSpotlight) {
            onTogglePin();
          } else if (hasAnyVideo && !isSpotlight) {
            onTogglePin();
          }
        }}
        data-testid={
          hasAnyVideo
            ? `participant-video-tile-${participant.userId}`
            : undefined
        }
        className={`bg-[#2b2d31] rounded-xl flex flex-col items-center justify-center relative border-2 transition-all select-none overflow-hidden group cursor-pointer ${
          isSpotlight
            ? "w-full max-w-5xl aspect-video md:h-[62vh] shadow-2xl"
            : isTheaterMode
              ? "min-w-[140px] max-w-[160px] h-[130px] flex-shrink-0"
              : "min-h-[140px] sm:min-h-[190px] aspect-video w-full"
        } ${
          speaking
            ? "border-discord-green shadow-[0_0_20px_rgba(35,165,90,0.35)]"
            : isPinned
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
                className={`absolute bottom-2.5 right-2.5 z-20 ${
                  isSpotlight ? "w-36 sm:w-48 md:w-56" : "w-28 sm:w-36 md:w-44"
                } aspect-video rounded-lg overflow-hidden border-2 border-white/30 hover:border-discord-brand shadow-2xl transition-all duration-200 hover:scale-105 cursor-pointer group/pip bg-black`}
                title="点击切换主次画面"
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
          <div className="flex flex-col items-center justify-center p-3 sm:p-4 w-full h-full">
            <div className={`relative ${isTheaterMode ? "mb-1.5" : "mb-3"}`}>
              <img
                src={
                  participant.user?.avatarUrl ||
                  "https://api.dicebear.com/7.x/bottts/svg?seed=avatar"
                }
                alt={participant.user?.username || "用户"}
                className={`rounded-full border-4 border-[#1e1f22] object-cover ${
                  isSpotlight
                    ? "w-28 h-28"
                    : isTheaterMode
                      ? "w-12 h-12"
                      : "w-20 h-20"
                } ${speaking ? "speaking-ring" : ""}`}
              />
              {participant.selfMute && (
                <div className="absolute -bottom-1 -right-1 bg-discord-danger p-1 rounded-full text-white shadow-md">
                  <MicOff className="w-2.5 h-2.5" />
                </div>
              )}
            </div>

            <div className="font-bold text-discord-textHeader text-xs flex items-center space-x-1 truncate max-w-full">
              <span className="truncate">
                {participant.user?.username || "匿名成员"}
              </span>
              {isMe && (
                <span className="text-[10px] text-discord-textMuted">
                  (你)
                </span>
              )}
            </div>
          </div>
        )}

        {/* 右上角悬浮操作区：钉选/聚焦、Simulcast 切换、网络延迟指示 */}
        <div className="absolute top-2 right-2 flex items-center space-x-1.5 z-20">
          {isSpotlight ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              data-testid="stage-unpin-btn"
              className="bg-black/75 hover:bg-white/20 px-2.5 py-1 rounded-md text-xs text-white flex items-center space-x-1 backdrop-blur-md border border-white/10 transition shadow-lg"
              title="退出聚焦视图"
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

          {/* Simulcast 清晰度拉流选择 (仅在远端屏幕分享时展示) */}
          {hasScreen && !isMe && onQualitySelect && (
            <div className="hidden sm:flex bg-black/75 backdrop-blur-md p-0.5 rounded-lg items-center space-x-0.5 border border-white/10 text-xs text-discord-textMuted">
              <Layers className="w-3 h-3 ml-1 text-discord-brand" />
              {(["auto", "high", "medium", "low"] as const).map((q) => (
                <button
                  key={q}
                  onClick={(e) => {
                    e.stopPropagation();
                    onQualitySelect(q);
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                    selectedQuality === q
                      ? "bg-discord-brand text-white"
                      : "hover:text-white"
                  }`}
                  title={
                    q === "auto"
                      ? "根据网络自适应清晰度"
                      : q === "high"
                        ? "强制 1080p 60fps"
                        : q === "medium"
                          ? "强制 720p 30fps"
                          : "强制 360p 省流"
                  }
                >
                  {q === "auto"
                    ? "自适应"
                    : q === "high"
                      ? "1080p"
                      : q === "medium"
                        ? "720p"
                        : "360p"}
                </button>
              ))}
            </div>
          )}

          {!isTheaterMode && (
            <div
              className="flex items-center space-x-1 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded-full text-[10px] text-discord-textMuted"
              title={`RTT: ${stats?.rtt || 18}ms | 丢包: ${stats?.packetLoss || 0}% | 抖动: ${stats?.jitter || 1.1}ms`}
            >
              <Wifi className="w-3 h-3 text-discord-green" />
              <span className="font-mono">
                {stats ? `${stats.rtt}ms` : "18ms"}
              </span>
            </div>
          )}
        </div>

        {/* 底部左侧信息浮层 (用户名 + 直播徽章 + 静音标签 + 独立音量滑块) */}
        <div className="absolute bottom-2 left-2 z-20 flex items-center space-x-1.5 bg-black/70 backdrop-blur-md px-2 py-1 rounded-lg text-white max-w-[55%] shadow-lg">
          {speaking && (
            <span className="w-2 h-2 rounded-full bg-discord-green animate-pulse flex-shrink-0" />
          )}
          <span className="font-semibold text-xs truncate">
            {participant.user?.username || "匿名成员"}
          </span>
          {isMe && (
            <span className="text-[10px] text-discord-textMuted flex-shrink-0">
              (你)
            </span>
          )}
          {hasScreen && (
            <span className="text-[10px] bg-discord-danger text-white px-1.5 py-0.2 rounded font-bold flex-shrink-0 flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping mr-0.5" />
              <span>LIVE</span>
            </span>
          )}
          {participant.selfMute && (
            <div className="bg-discord-danger p-0.5 rounded-full text-white flex-shrink-0">
              <MicOff className="w-2.5 h-2.5" />
            </div>
          )}
          {isMe && isNoiseSuppressionEnabled && !hasAnyVideo && (
            <span className="hidden sm:flex text-[10px] bg-discord-green/20 text-discord-green px-1.5 py-0.5 rounded items-center space-x-1 font-medium">
              <Sparkles className="w-2.5 h-2.5" />
              <span>{noiseSuppressionMode === "dtln" ? "DTLN" : "RNNoise"}</span>
            </span>
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
                title="调节该用户的远端独立音量 (0% - 200%)"
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
        </div>
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
  isMuted: boolean;
  isSpeaking: boolean;
  isNoiseSuppressionEnabled: boolean;
  noiseSuppressionMode?: "off" | "rnnoise" | "dtln";
  isScreenSharing: boolean;
  isVideoEnabled?: boolean;
  onToggleMute: () => void;
  onToggleScreenShare: () => void;
  onToggleVideo?: () => void;
  onToggleNoiseSuppression: () => void;
  onLeave: () => void;
  onJoin?: () => void;
  onToggleMobileDrawer?: () => void;
  onOpenVideoSettings?: () => void;
}

export const VoiceRoomArea: React.FC<VoiceRoomAreaProps> = ({
  channel,
  guild,
  currentUser,
  voiceStates,
  isConnected = true,
  isMuted,
  isSpeaking,
  isNoiseSuppressionEnabled,
  noiseSuppressionMode = "rnnoise",
  isScreenSharing,
  isVideoEnabled = false,
  onToggleMute,
  onToggleScreenShare,
  onToggleVideo,
  onToggleNoiseSuppression,
  onLeave,
  onJoin,
  onToggleMobileDrawer,
  onOpenVideoSettings,
}) => {
  const { isMobile } = useViewport();
  const [cameraTracks, setCameraTracks] = useState<Map<string, any>>(
    new Map(livekitService.cameraTracksMap),
  );

  // 摄像头快速选择菜单状态
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string>(
    livekitService.getCameraDeviceId() || "default",
  );
  const cameraMenuRef = useRef<HTMLDivElement | null>(null);

  // 获取并监听系统摄像头设备变动与当前激活设备
  useEffect(() => {
    const fetchCameras = async () => {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setCameraDevices(devices.filter((d) => d.kind === "videoinput"));
        }
      } catch {}
    };
    fetchCameras();
    navigator.mediaDevices?.addEventListener?.("devicechange", fetchCameras);
    const cleanupActiveCam = livekitService.onActiveCameraChange((id) => {
      setActiveCameraId(id);
    });

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", fetchCameras);
      cleanupActiveCam();
    };
  }, []);

  // 快捷菜单点击外部关闭
  useEffect(() => {
    if (!isCameraMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        cameraMenuRef.current &&
        !cameraMenuRef.current.contains(e.target as Node)
      ) {
        setIsCameraMenuOpen(false);
      }
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [isCameraMenuOpen]);

  const handleSelectCamera = async (deviceId: string) => {
    setActiveCameraId(deviceId);
    await livekitService.switchCameraDevice(deviceId);
    setIsCameraMenuOpen(false);
  };
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
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
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [micError, setMicError] = useState<string | null>(
    audioEngine.lastError,
  );
  const [sframeStats, setSframeStats] = useState<SFrameStats>(
    sframeManager.getStats(),
  );

  // 阶段四：多路屏幕分享推流与订阅状态
  const [activeShare, setActiveShare] = useState<ActiveScreenShare | null>(null);
  const [screenShares, setScreenShares] = useState<
    Map<string, ActiveScreenShare>
  >(new Map(livekitService.screenSharesMap));
  const [selectedQuality, setSelectedQuality] = useState<
    "high" | "medium" | "low" | "auto"
  >("auto");
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
    return () => {
      unbindShares();
      unbindShare();
      unbindCamera();
    };
  }, []);

  // 筛选出当前频道的成员
  const currentParticipants = voiceStates.filter(
    (v) => v.channelId === channel.id,
  );

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
            guildId: channel.guildId,
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
    if (p.userId === currentUser.id) {
      return { ...p, selfVideo: isVideoEnabled };
    }
    return p;
  });

  const pinnedParticipant = pinnedUserId
    ? displayParticipants.find((p) => p.userId === pinnedUserId) || null
    : null;

  // 若被聚焦的成员离开频道，自动退出聚焦
  useEffect(() => {
    if (
      pinnedUserId &&
      !displayParticipants.some((p) => p.userId === pinnedUserId)
    ) {
      setPinnedUserId(null);
    }
  }, [pinnedUserId, displayParticipants]);

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
      : (p.selfVideo ? cameraTracks.get(p.userId) : null);



    // 屏幕分享轨道解析
    const myScreenShare = isScreenSharing
      ? screenShares.get(currentUser.id) ||
        screenShares.get("local") ||
        livekitService.activeScreenShare
      : null;
    const participantScreenShare = isMe
      ? myScreenShare
      : screenShares.get(p.userId);

    return {
      cameraTrack,
      screenShareTrack: participantScreenShare?.track || null,
      screenShareInfo: participantScreenShare || null,
    };
  };

  // 监听远端音量、网络健康、活跃讲话者及声卡异常变动
  useEffect(() => {
    const unbindStats = livekitService.onNetworkStatsUpdate((stats) => {
      setNetworkStats(new Map(stats));
    });

    const unbindVol = livekitService.onParticipantVolumeChange(
      (identity, vol) => {
        setParticipantVolumes((prev) => ({ ...prev, [identity]: vol }));
      },
    );

    const unbindPTT = audioEngine.onPTTChange((active) => {
      setIsPTTPressed(active);
    });

    const unbindSpeakers = livekitService.onActiveSpeakersChange((speakers) => {
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
  };

  const getVolume = (userId: string) => {
    return participantVolumes[userId] !== undefined
      ? participantVolumes[userId]
      : livekitService.getParticipantVolume(userId);
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

  // Simulcast 清晰度拉流档位切换
  const handleQualitySelect = (quality: "high" | "medium" | "low" | "auto") => {
    setSelectedQuality(quality);
    if (quality !== "auto") {
      livekitService.setSubscribedScreenQuality(quality);
    }
  };

  // 伴音与麦克风混音增益调节
  const handleMixGainChange = (mic: number, sys: number) => {
    setMicMixGain(mic);
    setSystemMixGain(sys);
    audioMixer.setGains(mic, sys, isMuted);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#111214] relative overflow-hidden select-none">
      {/* 顶部房间信息栏 */}
      <div className="h-12 border-b border-[#232428] px-3 sm:px-4 flex items-center justify-between bg-discord-channelList/50 backdrop-blur z-10">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          {onToggleMobileDrawer && (
            <button
              type="button"
              onClick={onToggleMobileDrawer}
              className="md:hidden p-1.5 -ml-1 text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition flex-shrink-0"
              title="打开频道与服务器抽屉"
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
              <span className="hidden sm:inline">Simulcast 屏幕直播中</span>
              <span className="sm:hidden">直播中</span>
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
            title="声卡伴音与麦克风混音控制面板"
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
            title="关闭提示"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 主展示区 (沉浸式卡片展示，支持双轨画中画自由对调与 Spotlight 聚焦放大) */}
      <div
        className={`flex-1 p-3 sm:p-4 flex flex-col items-center overflow-y-auto custom-scrollbar ${
          isTheaterMode ? "justify-start" : "justify-center"
        }`}
      >
        {/* 当处于 Spotlight 聚焦模式时：在中央渲染放大的主舞台卡片 */}
        {pinnedParticipant && (
          <div className="w-full flex flex-col items-center mb-4 transition-all animate-fadeIn">
            {(() => {
              const p = pinnedParticipant;
              const isMe = p.userId === currentUser.id;
              const speaking = isMe
                ? isSpeaking
                : activeSpeakers.includes(p.userId);
              const stats = getParticipantStats(p.userId);
              const userVol = getVolume(p.userId);
              const media = getParticipantMedia(p);

              return (
                <ParticipantCard
                  key={`pinned-${p.userId}`}
                  participant={p}
                  isMe={isMe}
                  speaking={speaking}
                  stats={stats}
                  volume={userVol}
                  onVolumeChange={(vol) => handleVolumeChange(p.userId, vol)}
                  isPinned={true}
                  onTogglePin={() => setPinnedUserId(null)}
                  cameraTrack={media.cameraTrack}
                  screenShareTrack={media.screenShareTrack}
                  screenShareInfo={media.screenShareInfo}
                  guild={guild}
                  currentUser={currentUser}
                  isTheaterMode={isTheaterMode}
                  isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
                  noiseSuppressionMode={noiseSuppressionMode}
                  isSpotlight={true}
                  selectedQuality={selectedQuality}
                  onQualitySelect={handleQualitySelect}
                />
              );
            })()}
          </div>
        )}

        {/* 参与者网格 (普通模式为自适应 CSS Grid；在聚焦或剧场模式下下沉为横向滑动条) */}
        <div
          className={`w-full max-w-5xl transition-all ${
            pinnedParticipant || isTheaterMode
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
          {displayParticipants
            .filter((p) =>
              pinnedParticipant ? p.userId !== pinnedUserId : true,
            )
            .map((p) => {
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
                  onVolumeChange={(vol) => handleVolumeChange(p.userId, vol)}
                  isPinned={isPinned}
                  onTogglePin={() =>
                    setPinnedUserId(isPinned ? null : p.userId)
                  }
                  cameraTrack={media.cameraTrack}
                  screenShareTrack={media.screenShareTrack}
                  screenShareInfo={media.screenShareInfo}
                  guild={guild}
                  currentUser={currentUser}
                  isTheaterMode={isTheaterMode || Boolean(pinnedParticipant)}
                  isNoiseSuppressionEnabled={isNoiseSuppressionEnabled}
                  noiseSuppressionMode={noiseSuppressionMode}
                  isSpotlight={false}
                  selectedQuality={selectedQuality}
                  onQualitySelect={handleQualitySelect}
                />
              );
            })}
        </div>
      </div>

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
        {!isConnected ? (
          <div className="flex items-center space-x-3 sm:space-x-4">
            <span className="text-xs sm:text-sm text-discord-textMuted">您当前未连入此语音频道</span>
            {onJoin && (
              <button
                onClick={onJoin}
                className="px-4 sm:px-6 py-2 sm:py-2.5 rounded-full bg-discord-green text-white text-xs sm:text-sm font-semibold hover:bg-discord-green/90 transition shadow-lg flex items-center space-x-1.5 sm:space-x-2"
              >
                <Volume2 className="w-4 h-4" />
                <span>加入语音通话</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 麦克风 (在按键说话 PTT 模式下支持移动端按住开麦) */}
            <button
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
              className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg ${
                isPTTMode
                  ? isPTTPressed
                    ? "bg-discord-green text-white ring-4 ring-discord-green/30 scale-105"
                    : "bg-[#2b2d31] text-discord-textMuted hover:bg-discord-hover"
                  : isMuted
                    ? "bg-discord-danger text-white hover:bg-discord-danger/90"
                    : "bg-[#2b2d31] text-discord-textNormal hover:bg-discord-hover"
              }`}
              title={isPTTMode ? "按住说话 (Touch to Talk)" : isMuted ? "开麦" : "静音"}
            >
              {isPTTMode ? (
                isPTTPressed ? <Mic className="w-5 h-5 text-white" /> : <MicOff className="w-5 h-5" />
              ) : isMuted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </button>

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
                title="摄像头选项"
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
            <button
              data-testid="voice-toggle-screen-btn"
              onClick={onToggleScreenShare}
              className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg ${
                isScreenSharing || activeShare?.isLocal
                  ? "bg-discord-brand text-white hover:bg-discord-brand-hover ring-4 ring-discord-brand/30"
                  : "bg-[#2b2d31] text-discord-textNormal hover:bg-discord-hover"
              }`}
              title={
                isScreenSharing || activeShare?.isLocal
                  ? "停止共享"
                  : "屏幕共享"
              }
            >
              <ScreenShare className="w-5 h-5" />
            </button>

            {/* AI 降噪切换 (支持 RNNoise / DTLN 深度消键盘音 / 关闭) */}
            <button
              data-testid="voice-sparkles-btn"
              onClick={onToggleNoiseSuppression}
              className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg flex items-center space-x-1.5 ${
                isNoiseSuppressionEnabled
                  ? noiseSuppressionMode === "dtln"
                    ? "bg-discord-green/30 text-discord-green border border-discord-green ring-1 ring-discord-green/40 hover:bg-discord-green/40"
                    : "bg-discord-green/20 text-discord-green border border-discord-green/40 hover:bg-discord-green/30"
                  : "bg-[#2b2d31] text-discord-textMuted hover:bg-discord-hover"
              }`}
              title={
                noiseSuppressionMode === "dtln"
                  ? "DTLN 深度净化降噪已开启 (专攻消除机械键盘敲击音)"
                  : isNoiseSuppressionEnabled
                    ? "RNNoise AI 智能降噪已开启"
                    : "AI 降噪已关闭"
              }
            >
              <Sparkles className="w-5 h-5" />
            </button>

            {/* 挂断退出 */}
            <button
              onClick={onLeave}
              className="p-2.5 sm:p-3.5 rounded-full bg-discord-danger text-white hover:bg-discord-danger/90 transition shadow-lg"
              title="断开连接"
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
              <span className="text-discord-textMuted">
                系统/游戏音频伴音
              </span>
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
