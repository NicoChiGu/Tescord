import React, { useState } from "react";
import { Channel, Guild, User, VoiceState } from "@tescord/types";
import {
  Hash,
  Volume2,
  Lock,
  Mic,
  MicOff,
  Headphones,
  Settings,
  PhoneOff,
  ScreenShare,
  Signal,
  Sparkles,
  Plus,
  UserPlus,
  Check,
} from "lucide-react";
import { API_BASE } from "../config.js";
import { ServerContextMenu } from "./context-menu/ServerContextMenu.js";
import { ChannelContextMenu } from "./context-menu/ChannelContextMenu.js";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";

interface ChannelSidebarProps {
  guild: Guild | null;
  channels: Channel[];
  selectedChannelId: string;
  activeVoiceChannelId: string | null;
  voiceStates: VoiceState[];
  currentUser: User;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  isNoiseSuppressionEnabled: boolean;
  onSelectChannel: (channel: Channel) => void;
  onJoinVoiceChannel: (channel: Channel) => void;
  onLeaveVoiceChannel: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onOpenSettings: () => void;
  onOpenUserSettings?: () => void;
  onToggleScreenShare: () => void;
  onOpenCreateChannel?: () => void;
  onDeleteChannel?: (channel: Channel) => void;
  onEditChannel?: (channel: Channel) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkGuildAsRead?: (guild: Guild) => void;
  onMarkChannelAsRead?: (channel: Channel) => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  guild,
  channels,
  selectedChannelId,
  activeVoiceChannelId,
  voiceStates,
  currentUser,
  isMuted,
  isDeafened,
  isSpeaking,
  isNoiseSuppressionEnabled,
  onSelectChannel,
  onJoinVoiceChannel,
  onLeaveVoiceChannel,
  onToggleMute,
  onToggleDeafen,
  onOpenSettings,
  onOpenUserSettings,
  onToggleScreenShare,
  onOpenCreateChannel,
  onDeleteChannel,
  onEditChannel,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkGuildAsRead,
  onMarkChannelAsRead,
}) => {
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);

  const handleCreateInvite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!guild) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ maxUses: 10, expiresInHours: 24 }),
      });
      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(data.code);
        setCopiedInvite(data.code);
        setTimeout(() => setCopiedInvite(null), 3000);
      }
    } catch (err) {
      console.error("Failed to create invite:", err);
    }
  };

  const textChannels = channels.filter((c) => c.type === "TEXT");
  const voiceChannels = channels.filter((c) => c.type === "VOICE");

  // 获取正在当前语音频道的用户
  const getChannelParticipants = (channelId: string) => {
    return voiceStates.filter((v) => v.channelId === channelId);
  };

  const activeVoiceChannel = channels.find(
    (c) => c.id === activeVoiceChannelId,
  );

  return (
    <div className="w-60 bg-discord-channelList flex flex-col h-full border-r border-[#232428] select-none">
      {/* 服务器标题 */}
      {guild ? (
        <ServerContextMenu
          guild={guild}
          onOpenCreateChannel={onOpenCreateChannel}
          onOpenServerSettings={onOpenServerSettings}
          onLeaveGuild={onLeaveGuild}
          onMarkAsRead={onMarkGuildAsRead}
        >
          <div className="h-12 border-b border-[#1f2023] px-4 flex items-center justify-between font-bold text-discord-textHeader shadow-sm hover:bg-[#35373c] transition cursor-pointer">
            <span className="truncate">{guild.name}</span>
            <button
              onClick={handleCreateInvite}
              className="p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition flex items-center space-x-1"
              title="生成并复制邀请码"
            >
              {copiedInvite ? (
                <span className="flex items-center text-xs text-discord-green space-x-0.5">
                  <Check className="w-3.5 h-3.5" />
                  <span className="font-mono text-[10px]">{copiedInvite}</span>
                </span>
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
            </button>
          </div>
        </ServerContextMenu>
      ) : (
        <div className="h-12 border-b border-[#1f2023] px-4 flex items-center justify-between font-bold text-discord-textHeader shadow-sm hover:bg-[#35373c] transition">
          <span className="truncate">私信列表</span>
        </div>
      )}

      {/* 频道列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* 文字频道 */}
        <div>
          <div className="text-[11px] font-bold text-discord-textMuted uppercase tracking-wider px-2 mb-1 flex items-center justify-between">
            <span>文字频道</span>
            {onOpenCreateChannel && (
              <button
                onClick={onOpenCreateChannel}
                className="p-0.5 hover:text-discord-textHeader transition text-discord-textMuted"
                title="创建频道"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-[2px]">
            {textChannels.map((channel) => {
              const isSelected = selectedChannelId === channel.id;
              return (
                <ChannelContextMenu
                  key={channel.id}
                  channel={channel}
                  guild={guild}
                  onSelectChannel={onSelectChannel}
                  onEditChannel={onEditChannel}
                  onDeleteChannel={onDeleteChannel}
                  onMarkAsRead={onMarkChannelAsRead}
                >
                  <button
                    onClick={() => onSelectChannel(channel)}
                    className={`w-full flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition group ${
                      isSelected
                        ? "bg-discord-active text-white"
                        : "text-discord-textMuted hover:bg-discord-hover hover:text-discord-textNormal"
                    }`}
                  >
                    {channel.isE2EE ? (
                      <Lock className="w-4 h-4 mr-1.5 text-discord-green flex-shrink-0" />
                    ) : (
                      <Hash className="w-4 h-4 mr-1.5 text-discord-textMuted flex-shrink-0" />
                    )}
                    <span className="truncate">{channel.name}</span>
                    {channel.isE2EE && (
                      <span className="ml-auto text-[10px] bg-[#23a55a22] text-discord-green px-1 rounded border border-discord-green/30">
                        E2EE
                      </span>
                    )}
                  </button>
                </ChannelContextMenu>
              );
            })}
          </div>
        </div>

        {/* 语音频道 */}
        <div>
          <div className="text-[11px] font-bold text-discord-textMuted uppercase tracking-wider px-2 mb-1 flex items-center justify-between">
            <span>语音与直播频道</span>
            {onOpenCreateChannel && (
              <button
                onClick={onOpenCreateChannel}
                className="p-0.5 hover:text-discord-textHeader transition text-discord-textMuted"
                title="创建频道"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="space-y-[2px]">
            {voiceChannels.map((channel) => {
              const isSelected = selectedChannelId === channel.id;
              const isConnected = activeVoiceChannelId === channel.id;
              const participants = getChannelParticipants(channel.id);

              return (
                <div key={channel.id}>
                  <ChannelContextMenu
                    channel={channel}
                    guild={guild}
                    onSelectChannel={() => {
                      onSelectChannel(channel);
                      if (!isConnected) {
                        onJoinVoiceChannel(channel);
                      }
                    }}
                    onEditChannel={onEditChannel}
                    onDeleteChannel={onDeleteChannel}
                    onMarkAsRead={onMarkChannelAsRead}
                  >
                    <button
                      onClick={() => {
                        onSelectChannel(channel);
                        if (!isConnected) {
                          onJoinVoiceChannel(channel);
                        }
                      }}
                      className={`w-full flex items-center px-2 py-1.5 rounded-md text-sm font-medium transition group ${
                        isConnected
                          ? "bg-[#23a55a1a] text-discord-green font-semibold"
                          : isSelected
                            ? "bg-discord-active text-white"
                            : "text-discord-textMuted hover:bg-discord-hover hover:text-discord-textNormal"
                      }`}
                    >
                      <Volume2
                        className={`w-4 h-4 mr-1.5 flex-shrink-0 ${isConnected ? "text-discord-green" : ""}`}
                      />
                      <span className="truncate">{channel.name}</span>
                      <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-[#1f2023] text-discord-textMuted">
                        {participants.length}
                      </span>
                    </button>
                  </ChannelContextMenu>

                  {/* 频道内成员展开 */}
                  {participants.length > 0 && (
                    <div className="pl-6 pr-2 py-1 space-y-1">
                      {participants.map((p) => {
                        const isSpeakingUser =
                          p.userId === currentUser.id && isSpeaking;
                        return (
                          <div
                            key={p.userId}
                            className="flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-[#35373c] text-xs text-discord-textNormal"
                          >
                            <div className="relative">
                              <img
                                src={
                                  p.user?.avatarUrl ||
                                  "https://api.dicebear.com/7.x/bottts/svg?seed=user"
                                }
                                alt="avatar"
                                className={`w-5 h-5 rounded-full border-2 border-transparent ${
                                  isSpeakingUser ? "speaking-ring" : ""
                                }`}
                              />
                            </div>
                            <span className="truncate flex-1">
                              {p.user?.username || "用户"}
                            </span>
                            {p.selfMute && (
                              <MicOff className="w-3 h-3 text-discord-danger" />
                            )}
                            {p.streaming && (
                              <span className="text-[9px] bg-discord-brand text-white px-1 rounded font-bold">
                                直播中
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 底部连接控制面板 (仅在接入语音时显示) */}
      {activeVoiceChannel && (
        <div className="bg-[#202225] border-b border-[#2b2d31] p-2.5 flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Signal className="w-4 h-4 text-discord-green animate-pulse" />
              <div>
                <div className="text-xs font-bold text-discord-green leading-tight">
                  语音已连接
                </div>
                <div className="text-[11px] text-discord-textMuted truncate max-w-[120px]">
                  {activeVoiceChannel.name} / LiveKit SFU
                </div>
              </div>
            </div>
            <button
              onClick={onLeaveVoiceChannel}
              className="p-1.5 text-discord-textMuted hover:text-discord-danger hover:bg-[#35373c] rounded transition"
              title="断开连接"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-[#2b2d31]">
            <button
              onClick={onToggleScreenShare}
              className="flex-1 py-1 px-2 mr-1 text-xs bg-discord-sidebar hover:bg-discord-hover text-discord-textNormal rounded flex items-center justify-center space-x-1 transition"
            >
              <ScreenShare className="w-3.5 h-3.5" />
              <span>直播分享</span>
            </button>
            <div
              className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] ${
                isNoiseSuppressionEnabled
                  ? "text-discord-green bg-[#23a55a22]"
                  : "text-discord-textMuted"
              }`}
              title="RNNoise AI 智能降噪激活中"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI降噪</span>
            </div>
          </div>
        </div>
      )}

      {/* 底部当前用户信息栏 */}
      <div className="h-[52px] bg-[#232428] px-2 flex items-center justify-between">
        <UserContextMenu
          targetUser={currentUser}
          guild={guild}
          onOpenUserSettings={onOpenUserSettings}
          onOpenAudioSettings={onOpenSettings}
        >
          <button
            type="button"
            onClick={onOpenUserSettings}
            className="flex items-center space-x-2 overflow-hidden mr-1 p-1 -ml-1 rounded hover:bg-discord-hover transition text-left group min-w-0 cursor-pointer"
            title="点击打开设置，或右键快捷切换在线状态"
          >
            <div className="relative flex-shrink-0">
              <img
                src={
                  currentUser.avatarUrl ||
                  "https://api.dicebear.com/7.x/bottts/svg?seed=avatar"
                }
                alt={currentUser.username}
                className={`w-8 h-8 rounded-full border-2 border-transparent ${
                  isSpeaking ? "speaking-ring" : ""
                }`}
              />
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#232428] ${
                  currentUser.status === "ONLINE"
                    ? "bg-emerald-500"
                    : currentUser.status === "IDLE"
                      ? "bg-amber-500"
                      : currentUser.status === "DND"
                        ? "bg-rose-500"
                        : "bg-gray-400"
                }`}
              />
            </div>
            <div className="flex flex-col truncate">
              <span className="text-xs font-semibold text-discord-textHeader truncate group-hover:underline">
                {currentUser.username}
              </span>
              <span className="text-[10px] text-discord-textMuted truncate">
                {currentUser.customStatus ||
                  (currentUser.status === "ONLINE"
                    ? "在线"
                    : currentUser.status === "IDLE"
                      ? "离开"
                      : currentUser.status === "DND"
                        ? "请勿打扰"
                        : "隐身")}
              </span>
            </div>
          </button>
        </UserContextMenu>

        {/* 麦克风/耳机/设置控制按钮 */}
        <div className="flex items-center space-x-0.5 text-discord-textMuted">
          <button
            onClick={onToggleMute}
            className={`p-1.5 rounded hover:bg-discord-hover transition ${
              isMuted
                ? "text-discord-danger hover:text-discord-danger"
                : "hover:text-discord-textNormal"
            }`}
            title={isMuted ? "取消静音" : "静音"}
          >
            {isMuted ? (
              <MicOff className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onToggleDeafen}
            className={`p-1.5 rounded hover:bg-discord-hover transition ${
              isDeafened
                ? "text-discord-danger hover:text-discord-danger"
                : "hover:text-discord-textNormal"
            }`}
            title={isDeafened ? "开启扬声器" : "闭麦拒听"}
          >
            <Headphones className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded hover:bg-discord-hover hover:text-discord-textNormal transition"
            title="音频与降噪设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
