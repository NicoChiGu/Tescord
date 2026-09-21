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
} from "lucide-react";
import { useViewport } from "../hooks/useViewport.js";

interface VoiceRoomAreaProps {
  channel: Channel;
  guild?: Guild | null;
  currentUser: User;
  voiceStates: VoiceState[];
  isConnected?: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  isNoiseSuppressionEnabled: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleScreenShare: () => void;
  onToggleNoiseSuppression: () => void;
  onLeave: () => void;
  onJoin?: () => void;
  onToggleMobileDrawer?: () => void;
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
  isScreenSharing,
  onToggleMute,
  onToggleScreenShare,
  onToggleNoiseSuppression,
  onLeave,
  onJoin,
  onToggleMobileDrawer,
}) => {
  const { isMobile } = useViewport();
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
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

  // 阶段四：屏幕分享推流与订阅状态
  const [activeShare, setActiveShare] = useState<ActiveScreenShare | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<
    "high" | "medium" | "low" | "auto"
  >("auto");
  const [micMixGain, setMicMixGain] = useState(audioMixer.config.micVolume);
  const [systemMixGain, setSystemMixGain] = useState(
    audioMixer.config.systemAudioVolume,
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  // 监听 LiveKit 屏幕分享轨变动
  useEffect(() => {
    const unbindShare = livekitService.onScreenShareChange((share) => {
      setActiveShare(share);
    });
    return () => {
      unbindShare();
    };
  }, []);

  // 绑定视频轨到 HTML5 Video 元素
  useEffect(() => {
    if (!videoRef.current || !activeShare?.track) return;
    try {
      if (typeof activeShare.track.attach === "function") {
        activeShare.track.attach(videoRef.current);
      } else if (activeShare.track instanceof MediaStreamTrack) {
        videoRef.current.srcObject = new MediaStream([activeShare.track]);
      }
    } catch (err) {
      console.warn("Failed to attach video to element:", err);
    }
  }, [activeShare?.track]);

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

    return () => {
      unbindStats();
      unbindVol();
      unbindPTT();
      unbindSpeakers();
      unbindError();
      unbindSFrame();
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
  const displayParticipants =
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

  // 画中画 (PiP) 切换
  const handleTogglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn("PiP toggle error:", err);
    }
  };

  // 全屏切换
  const handleToggleFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoContainerRef.current.requestFullscreen().catch(() => {});
    }
  };

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

  const streamerName = activeShare?.isLocal
    ? `${currentUser.username} (你)`
    : displayParticipants.find(
        (p) => p.userId === activeShare?.participantIdentity,
      )?.user?.username || activeShare?.participantIdentity;

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

      {/* 主展示区 (屏幕直播流 + 剧场模式 + 参与者网格) */}
      <div
        className={`flex-1 p-3 sm:p-4 flex flex-col items-center overflow-y-auto custom-scrollbar ${
          isTheaterMode ? "justify-start" : "justify-center"
        }`}
      >
        {/* 4.1 屏幕直播真实渲染视口 (LiveKit Simulcast 超低延迟播放器) */}
        {(activeShare || isScreenSharing) && (
          <div
            ref={videoContainerRef}
            className={`w-full bg-black rounded-2xl border border-[#35373c] relative overflow-hidden flex flex-col items-center justify-center shadow-2xl mb-4 group transition-all ${
              isTheaterMode
                ? "h-[75vh] max-w-7xl"
                : "max-h-[35vh] sm:max-h-[50vh] md:h-[58vh] max-w-5xl"
            }`}
          >
            {/* 真实 HTML5 Video 元素 */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={activeShare?.isLocal}
              className="w-full h-full object-contain bg-[#0e0e10]"
            />

            {/* 顶栏直播悬浮信息条 */}
            <div className="absolute top-3 left-3 flex items-center space-x-2 z-20">
              <div className="bg-black/75 backdrop-blur-md px-3 py-1 rounded-lg text-xs text-white flex items-center space-x-2 border border-white/10 shadow-lg">
                <span className="w-2 h-2 rounded-full bg-discord-danger animate-ping" />
                <span className="font-bold">LIVE</span>
                <span className="text-discord-textMuted">|</span>
                <span>{streamerName}</span>
              </div>

              {/* 超低延迟指标徽章 (< 200ms) */}
              <div className="bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-lg text-[11px] text-discord-green flex items-center space-x-1.5 border border-discord-green/20 font-mono shadow-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-discord-green" />
                <span>延时: {localStats?.rtt || 28}ms</span>
                <span className="text-discord-textMuted">•</span>
                <span>60 FPS</span>
                <span className="text-discord-textMuted">•</span>
                <span className="text-discord-brand">Simulcast</span>
              </div>
            </div>

            {/* 顶栏右侧：Simulcast 清晰度拉流选择与播放控制 */}
            <div className="absolute top-3 right-3 flex items-center space-x-2 z-20 opacity-90 group-hover:opacity-100 transition">
              {/* Simulcast 清晰度选择浮层 */}
              {!activeShare?.isLocal && (
                <div className="bg-black/75 backdrop-blur-md p-1 rounded-lg flex items-center space-x-1 border border-white/10 text-xs text-discord-textMuted">
                  <Layers className="w-3.5 h-3.5 ml-1.5 text-discord-brand" />
                  {(["auto", "high", "medium", "low"] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => handleQualitySelect(q)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                        selectedQuality === q
                          ? "bg-discord-brand text-white"
                          : "hover:text-white"
                      }`}
                      title={
                        q === "auto"
                          ? "根据网络自适应拉流"
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

              {/* 画中画 (Picture-in-Picture) 按钮 */}
              <button
                onClick={handleTogglePiP}
                className="p-2 rounded-lg bg-black/75 hover:bg-discord-brand text-white border border-white/10 backdrop-blur-md transition shadow-lg"
                title="开启系统原生画中画 (PiP) 浮窗"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>

              {/* 剧场模式切换 */}
              <button
                onClick={() => setIsTheaterMode(!isTheaterMode)}
                className={`p-2 rounded-lg border backdrop-blur-md transition shadow-lg ${
                  isTheaterMode
                    ? "bg-discord-brand text-white border-discord-brand"
                    : "bg-black/75 hover:bg-discord-brand text-white border-white/10"
                }`}
                title={isTheaterMode ? "退出剧场模式" : "开启剧场模式 (大屏聚焦)"}
              >
                <Tv className="w-4 h-4" />
              </button>

              {/* 全屏按钮 */}
              <button
                onClick={handleToggleFullscreen}
                className="p-2 rounded-lg bg-black/75 hover:bg-discord-brand text-white border border-white/10 backdrop-blur-md transition shadow-lg"
                title="全屏播放"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* 参与者网格 (在剧场模式下下沉为紧凑横向滑动排，普通模式下为标准自适应网格) */}
        <div
          className={`w-full max-w-5xl transition-all ${
            isTheaterMode
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
          {displayParticipants.map((p) => {
            const isMe = p.userId === currentUser.id;
            const speaking = isMe
              ? isSpeaking
              : activeSpeakers.includes(p.userId);
            const stats = getParticipantStats(p.userId);
            const userVol = getVolume(p.userId);

            return (
              <UserContextMenu
                key={p.userId}
                targetUser={
                  p.user || {
                    id: p.userId,
                    username:
                      p.userId === currentUser.id
                        ? currentUser.username
                        : "用户",
                    avatarUrl: undefined,
                  }
                }
                guild={guild}
                isInVoice={true}
              >
                <div
                  className={`bg-[#2b2d31] rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center relative border-2 transition-all ${
                    isTheaterMode
                      ? "min-w-[140px] max-w-[160px] h-[130px] flex-shrink-0"
                      : "min-h-[140px] sm:min-h-[190px]"
                  } ${
                    speaking
                      ? "border-discord-green shadow-[0_0_20px_rgba(35,165,90,0.35)]"
                      : "border-transparent hover:border-[#383a40]"
                  }`}
                >
                {/* 右上角网络质量小标 */}
                {!isTheaterMode && (
                  <div
                    className="absolute top-2 right-2 sm:top-3 sm:right-3 flex items-center space-x-1 bg-[#1e1f22]/80 px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] text-discord-textMuted"
                    title={`RTT: ${stats?.rtt || 18}ms | 丢包: ${stats?.packetLoss || 0}% | 抖动: ${stats?.jitter || 1.1}ms`}
                  >
                    <Wifi className="w-3 h-3 text-discord-green" />
                    <span className="font-mono">
                      {stats ? `${stats.rtt}ms` : "18ms"}
                    </span>
                  </div>
                )}

                {/* 头像 */}
                <div className={`relative ${isTheaterMode ? "mb-1.5" : "mb-3"}`}>
                  <img
                    src={
                      p.user?.avatarUrl ||
                      "https://api.dicebear.com/7.x/bottts/svg?seed=avatar"
                    }
                    alt={p.user?.username || "用户"}
                    className={`rounded-full border-4 border-[#1e1f22] object-cover ${
                      isTheaterMode ? "w-12 h-12" : "w-20 h-20"
                    } ${speaking ? "speaking-ring" : ""}`}
                  />
                  {p.selfMute && (
                    <div className="absolute -bottom-1 -right-1 bg-discord-danger p-1 rounded-full text-white shadow-md">
                      <MicOff className="w-2.5 h-2.5" />
                    </div>
                  )}
                </div>

                {/* 用户名 */}
                <div className="font-bold text-discord-textHeader text-xs flex items-center space-x-1 truncate max-w-full">
                  <span className="truncate">
                    {p.user?.username || "匿名成员"}
                  </span>
                  {isMe && (
                    <span className="text-[10px] text-discord-textMuted">
                      (你)
                    </span>
                  )}
                </div>

                {/* 状态徽章与多路独立音量调节器 */}
                {!isTheaterMode && (
                  <div className="mt-2.5 flex items-center space-x-2">
                    {p.streaming && (
                      <span className="text-[10px] bg-discord-brand text-white px-1.5 py-0.5 rounded font-semibold">
                        直播中
                      </span>
                    )}
                    {isMe && isNoiseSuppressionEnabled && (
                      <span className="text-[10px] bg-discord-green/20 text-discord-green px-1.5 py-0.5 rounded flex items-center space-x-1 font-medium">
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>RNNoise 降噪</span>
                      </span>
                    )}

                    {/* 对非本人的远端成员提供独立 0%~200% 音量调节 */}
                    {!isMe && (
                      <div className="relative">
                        <button
                          onClick={() =>
                            setActiveVolumeUserId(
                              activeVolumeUserId === p.userId ? null : p.userId,
                            )
                          }
                          className={`text-[10px] px-2 py-0.5 rounded flex items-center space-x-1 border transition ${
                            userVol !== 100
                              ? "bg-discord-brand/20 text-discord-brand border-discord-brand/40 font-bold"
                              : "bg-[#1e1f22] text-discord-textMuted border-[#383a40] hover:text-white"
                          }`}
                          title="调节该用户的远端混音音量 (0% - 200%)"
                        >
                          {userVol === 0 ? (
                            <VolumeX className="w-2.5 h-2.5 text-discord-danger" />
                          ) : userVol > 100 ? (
                            <Volume2 className="w-2.5 h-2.5 text-discord-brand" />
                          ) : (
                            <Volume1 className="w-2.5 h-2.5" />
                          )}
                          <span>{userVol}%</span>
                        </button>

                        {activeVolumeUserId === p.userId && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-[#1e1f22] p-3 rounded-xl border border-[#3f4147] shadow-2xl z-30 animate-fadeIn">
                            <div className="flex justify-between items-center text-xs mb-1.5 font-bold">
                              <span className="text-discord-textHeader">
                                独立用户音量
                              </span>
                              <span className="text-discord-brand">
                                {userVol}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="200"
                              value={userVol}
                              onChange={(e) =>
                                handleVolumeChange(
                                  p.userId,
                                  Number(e.target.value),
                                )
                              }
                              className="w-full h-1.5 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                            />
                            <div className="flex justify-between items-center text-[10px] text-discord-textMuted mt-2 pt-1 border-t border-[#2b2d31]">
                              <button
                                onClick={() =>
                                  handleVolumeChange(
                                    p.userId,
                                    userVol === 0 ? 100 : 0,
                                  )
                                }
                                className="hover:underline flex items-center space-x-0.5"
                              >
                                {userVol === 0 ? (
                                  <span className="text-discord-green font-semibold">
                                    取消静音
                                  </span>
                                ) : (
                                  <span className="text-discord-danger">
                                    一键静音
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() =>
                                  handleVolumeChange(p.userId, 100)
                                }
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
                )}
              </div>
            </UserContextMenu>
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

            {/* 摄像头 */}
            <button
              onClick={() => setIsVideoEnabled(!isVideoEnabled)}
              className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg ${
                isVideoEnabled
                  ? "bg-discord-green text-white hover:bg-discord-green/90"
                  : "bg-[#2b2d31] text-discord-textNormal hover:bg-discord-hover"
              }`}
              title={isVideoEnabled ? "关闭摄像头" : "打开摄像头"}
            >
              {isVideoEnabled ? (
                <Video className="w-5 h-5" />
              ) : (
                <VideoOff className="w-5 h-5" />
              )}
            </button>

            {/* 屏幕共享直播 */}
            <button
              onClick={onToggleScreenShare}
              className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg ${
                isScreenSharing || activeShare?.isLocal
                  ? "bg-discord-brand text-white hover:bg-discord-brand-hover ring-4 ring-discord-brand/30"
                  : "bg-[#2b2d31] text-discord-textNormal hover:bg-discord-hover"
              }`}
              title={
                isScreenSharing || activeShare?.isLocal
                  ? "停止共享"
                  : "屏幕共享直播"
              }
            >
              <ScreenShare className="w-5 h-5" />
            </button>

            {/* AI 降噪切换 */}
            <button
              onClick={onToggleNoiseSuppression}
              className={`p-2.5 sm:p-3.5 rounded-full transition shadow-lg flex items-center space-x-1.5 ${
                isNoiseSuppressionEnabled
                  ? "bg-discord-green/20 text-discord-green border border-discord-green/40 hover:bg-discord-green/30"
                  : "bg-[#2b2d31] text-discord-textMuted hover:bg-discord-hover"
              }`}
              title={
                isNoiseSuppressionEnabled
                  ? "RNNoise AI 智能降噪已开启"
                  : "RNNoise 降噪已关闭"
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
