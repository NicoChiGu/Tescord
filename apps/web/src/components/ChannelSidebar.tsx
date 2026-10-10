import React, { useState, useEffect, useRef } from "react";
import {
  Channel,
  ChannelCategory,
  Guild,
  User,
  VoiceState,
  VoiceConnectionStatus,
  PeerLatencyReport,
  ChannelUnreadInfo,
  ChannelUnreadMap,
} from "@tescord/types";
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
  ScreenShareOff,
  Signal,
  Plus,
  UserPlus,
  Check,
  X,
  Video,
  VideoOff,
  Loader2,
  ChevronDown,
  FolderPlus,
  BellOff,
  GripVertical,
  Network,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { VOICE_ENGINE, resolveServerUrl } from "../config.js";
import { VoiceConnectionStatusPopover } from "./VoiceConnectionStatusPopover.js";
import { StatusBadge } from "./ui/StatusBadge.js";
import { Tooltip } from "./ui/Tooltip.js";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  CollisionDetection,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
  DropAnimation,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { API_BASE } from "../config.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";
import { audioEngine } from "../services/audioEngine.js";
import { useNetworkStats } from "../hooks/useNetworkStats.js";
import { usePermissions } from "../hooks/usePermissions.js";
import { ServerContextMenu } from "./context-menu/ServerContextMenu.js";
import { ChannelContextMenu } from "./context-menu/ChannelContextMenu.js";
import { CategoryContextMenu } from "./context-menu/CategoryContextMenu.js";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
import { voiceMeshManager } from "../services/p2p/VoiceMeshManager.js";
import { p2pStreamManager } from "../services/p2p/P2PStreamManager.js";
import { DirectMessageList } from "./dm/DirectMessageList.js";
import { CurrentUserPopout } from "./profile/CurrentUserPopout.js";
import { MediaEncryptionIndicator } from "./MediaEncryptionIndicator.js";
import { useTouchContextMenu } from "../hooks/useTouchContextMenu.js";
import { getUserDisplayName } from "../utils/userDisplay.js";

export interface VoiceTransferNotice {
  targetPlatform: string;
  previousChannel: Channel | null;
}

interface ChannelSidebarProps {
  guild: Guild | null;
  channels: Channel[];
  dmChannels?: Channel[];
  guilds?: Guild[];
  isFriendsActive?: boolean;
  onSelectFriends?: () => void;
  onCloseDMChannel?: (channelId: string) => void;
  onDMChannelCreated?: (channel: Channel) => void;
  onStartDMCall?: (userId: string) => void;
  onOpenProfile?: (userId: string) => void;
  onOpenInviteFriends?: (guild: Guild) => void;
  selectedChannelId: string;
  activeVoiceChannelId: string | null;
  activeVoiceChannelObj?: Channel | null;
  voiceConnectionStatus?: VoiceConnectionStatus;
  voiceStates: VoiceState[];
  currentUser: User;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  activeSpeakers?: string[];
  isNoiseSuppressionEnabled: boolean;
  voiceTransferNotice?: VoiceTransferNotice | null;
  onDismissVoiceTransferNotice?: () => void;
  onReclaimVoice?: (channel: Channel) => void;
  onSelectChannel: (channel: Channel) => void;
  onJoinVoiceChannel: (channel: Channel) => void;
  onLeaveVoiceChannel: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onOpenSettings: () => void;
  onOpenUserSettings?: () => void;
  onOpenNetworkStats?: () => void;
  onToggleScreenShare: () => void;
  onStopScreenShare?: () => void;
  isScreenSharing?: boolean;
  isVideoEnabled?: boolean;
  onToggleVideo?: () => void;
  onOpenCreateChannel?: (category?: ChannelCategory) => void;
  onOpenCreateCategory?: () => void;
  onEditCategory?: (category: ChannelCategory) => void;
  onDeleteCategory?: (category: ChannelCategory) => void;
  onDeleteChannel?: (channel: Channel) => void;
  onEditChannel?: (channel: Channel) => void;
  onChannelsReordered?: (channels: Channel[]) => void;
  onCategoriesReordered?: (categories: ChannelCategory[]) => void;
  onOpenServerSettings?: (guild: Guild) => void;
  onLeaveGuild?: (guild: Guild) => void;
  onMarkGuildAsRead?: (guild: Guild) => void;
  onMarkChannelAsRead?: (channel: Channel) => void;
  onMention?: (username: string) => void;
  onOpenUserProfile?: (userId: string) => void;
  onSendMessage?: (userId: string) => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
  onDisconnectVoice?: (userId: string, username: string) => void;
  channelUnreadMap?: ChannelUnreadMap;
}

interface SortableChannelItemProps {
  channel: Channel;
  guild: Guild | null;
  selectedChannelId: string;
  activeVoiceChannelId: string | null;
  participants: VoiceState[];
  canManageChannels: boolean;
  currentUser: User;
  isSpeaking: boolean;
  activeSpeakers: string[];
  peerLatencies: Map<string, PeerLatencyReport>;
  t: (key: string, options?: any) => string;
  unreadInfo?: ChannelUnreadInfo;
  onSelectChannel: (channel: Channel) => void;
  onJoinVoiceChannel: (channel: Channel) => void;
  onEditChannel?: (channel: Channel) => void;
  onDeleteChannel?: (channel: Channel) => void;
  onMarkChannelAsRead?: (channel: Channel) => void;
  onMention?: (username: string) => void;
  onOpenUserProfile?: (userId: string) => void;
  onSendMessage?: (userId: string) => void;
  onOpenUserSettings?: () => void;
  onOpenSettings: () => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
  onDisconnectVoice?: (userId: string, username: string) => void;
  onCancelDrag?: () => void;
}

const SortableChannelItem: React.FC<SortableChannelItemProps> = ({
  channel,
  guild,
  selectedChannelId,
  activeVoiceChannelId,
  participants,
  canManageChannels,
  currentUser,
  isSpeaking,
  activeSpeakers,
  peerLatencies,
  t,
  unreadInfo,
  onSelectChannel,
  onJoinVoiceChannel,
  onEditChannel,
  onDeleteChannel,
  onMarkChannelAsRead,
  onMention,
  onOpenUserProfile,
  onSendMessage,
  onOpenUserSettings,
  onOpenSettings,
  onKickMember,
  onBanMember,
  onDisconnectVoice,
}) => {
  const isSelected = selectedChannelId === channel.id;
  const isConnected = activeVoiceChannelId === channel.id;
  const isVoice = channel.type === "VOICE";
  const isP2P =
    isVoice &&
    (channel.voiceMode === "p2p_mesh" ||
      channel.streamMode === "p2p_direct" ||
      channel.streamMode === "p2p_relay");
  const isChannelMuted = useSettingsStore((s) => s.isChannelMuted(channel.id));
  const hasUnread = Boolean(unreadInfo?.hasUnread && !isSelected);
  const mentionCount = unreadInfo?.mentionCount || 0;
  // 静音时普通未读不显示白条，仅在有 mention 时显示（对齐 Discord 经典规范）
  const showPill = hasUnread && (!isChannelMuted || mentionCount > 0);

  const touchMenu = useTouchContextMenu();

  const {
    attributes: { role: _role, tabIndex: _tabIndex, ...sortableAttributes },
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `chn_${channel.id}`,
    data: { type: "channel", channel },
    disabled: !canManageChannels,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.25 : 1,
    zIndex: isDragging ? 0 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="space-y-[2px]"
      data-testid={`channel-sortable-${channel.id}`}
      data-dragging={isDragging}
    >
      <ChannelContextMenu
        channel={channel}
        guild={guild}
        onSelectChannel={onSelectChannel}
        onJoinVoiceChannel={onJoinVoiceChannel}
        onEditChannel={onEditChannel}
        onDeleteChannel={onDeleteChannel}
        onMarkAsRead={onMarkChannelAsRead}
      >
        <div
          {...touchMenu}
          onMouseDown={
            canManageChannels
              ? (event) => listeners?.onMouseDown?.(event)
              : undefined
          }
          data-channel-id={channel.id}
          className="relative group w-full flex items-center"
        >
          {canManageChannels && (
            <button
              type="button"
              data-drag-handle
              data-testid={`channel-drag-handle-${channel.id}`}
              ref={setActivatorNodeRef}
              {...sortableAttributes}
              {...listeners}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onClick={(event) => event.stopPropagation()}
              aria-label={t("server:dragChannel", { name: channel.name })}
              className="shrink-0 w-11 h-11 flex items-center justify-center touch-none text-discord-textMuted lg:hidden"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          {/* Discord 经典左边缘未读白色胶囊指示条 */}
          {showPill && (
            <span
              data-testid="channel-unread-pill"
              className="absolute -left-2 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full transition-all duration-200 pointer-events-none h-2 group-hover:h-5 z-10"
            />
          )}

          {isVoice ? (
            <button
              type="button"
              data-channel-id={channel.id}
              data-testid={`channel-button-${channel.name}`}
              onClick={() => onSelectChannel(channel)}
              onDoubleClick={() => {
                onSelectChannel(channel);
                if (activeVoiceChannelId !== channel.id) {
                  onJoinVoiceChannel(channel);
                }
              }}
              title={t("voice:previewAndJoin")}
              className={`w-full flex items-center pl-2 pr-16 py-1.5 rounded-md text-sm font-medium transition ${
                isConnected
                  ? "bg-[#23a55a1a] text-discord-green font-semibold"
                  : isSelected
                    ? "bg-discord-active text-white"
                    : isChannelMuted
                      ? "text-[#80848e] opacity-75 hover:bg-discord-hover hover:text-discord-textNormal"
                      : "text-discord-textMuted hover:bg-discord-hover hover:text-discord-textNormal"
              }`}
            >
              <div className="relative mr-1.5 flex-shrink-0">
                <Volume2
                  className={`w-4 h-4 ${
                    isConnected ? "text-discord-green" : ""
                  }`}
                />
                {isP2P && (
                  <span
                    data-testid="voice-p2p-icon"
                    className="absolute -top-1 -right-1.5 flex items-center justify-center bg-[#1e1f22] rounded-full p-[1px] shadow ring-1 ring-[#1e1f22]"
                    title={t("voice:p2pMeshTitle")}
                  >
                    <Network className="w-2.5 h-2.5 text-blue-400" />
                  </span>
                )}
              </div>
              <span className="truncate">{channel.name}</span>
              {channel.isE2EE && (
                <span
                  data-testid="voice-e2ee-lock-icon"
                  title={t("voice:encryptedChannel")}
                  className="inline-flex items-center ml-1.5 flex-shrink-0"
                >
                  <Lock className="w-3.5 h-3.5 text-discord-green" />
                </span>
              )}
            </button>
          ) : (
            <button
              type="button"
              data-channel-id={channel.id}
              data-testid={`channel-button-${channel.name}`}
              onClick={() => onSelectChannel(channel)}
              className={`w-full flex items-center pl-2 pr-12 py-1.5 rounded-md text-sm font-medium transition ${
                isSelected
                  ? "bg-discord-active text-white"
                  : showPill
                    ? "text-white font-semibold hover:bg-discord-hover"
                    : isChannelMuted
                      ? "text-[#80848e] opacity-75 hover:bg-discord-hover hover:text-discord-textNormal"
                      : "text-discord-textMuted hover:bg-discord-hover hover:text-discord-textNormal"
              }`}
            >
              {channel.isE2EE ? (
                <div className="relative mr-1.5 flex-shrink-0">
                  <Hash
                    className={`w-4 h-4 ${
                      isSelected || showPill
                        ? "text-white"
                        : "text-discord-textMuted"
                    }`}
                  />
                  <Lock className="w-2.5 h-2.5 text-discord-green absolute -top-0.5 -right-1" />
                </div>
              ) : (
                <Hash
                  className={`w-4 h-4 mr-1.5 flex-shrink-0 ${
                    isSelected || showPill
                      ? "text-white"
                      : "text-discord-textMuted"
                  }`}
                />
              )}
              <span className="truncate">{channel.name}</span>
            </button>
          )}

          {/* 右侧指示器与操作区域 */}
          <div className="absolute right-2 flex items-center space-x-1.5 pointer-events-none">
            {mentionCount > 0 && !isSelected && (
              <span
                data-testid={`channel-mention-badge-${channel.id}`}
                className="bg-[#da373c] text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] h-4 flex items-center justify-center flex-shrink-0"
              >
                {mentionCount}
              </span>
            )}
            {isChannelMuted && (
              <Tooltip content={t("voice:channelMuted")}>
                <span className="flex items-center text-discord-textMuted pointer-events-auto">
                  <BellOff
                    className="w-3.5 h-3.5 text-discord-textMuted flex-shrink-0"
                    data-testid={`channel-muted-icon-${channel.id}`}
                  />
                </span>
              </Tooltip>
            )}

            {canManageChannels && onEditChannel && (
              <Tooltip content={t("contextMenu:channel.editChannel")}>
                <button
                  type="button"
                  data-testid={`edit-channel-gear-${channel.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditChannel(channel);
                  }}
                  className="group/cog pointer-events-auto opacity-0 group-hover:opacity-100 hover:text-white text-discord-textMuted p-0.5 rounded transition-all duration-150 active:scale-90"
                >
                  <Settings className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover/cog:rotate-45" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </ChannelContextMenu>

      {/* 语音频道成员展开 */}
      {isVoice && participants.length > 0 && (
        <div className="pl-6 pr-2 py-1 space-y-1">
          {participants.map((p) => {
            const isSpeakingUser =
              p.userId === currentUser.id
                ? isSpeaking
                : activeSpeakers.includes(p.userId);
            const targetUserObj = p.user || {
              id: p.userId,
              username: t("common:memberList.defaultUser") || "User",
              avatarUrl: null,
              status: undefined,
            };
            const targetMember = guild?.members?.find(
              (m) => m.userId === p.userId,
            );
            const displayName = getUserDisplayName(
              targetUserObj,
              targetMember,
              targetUserObj.username,
            );
            return (
              <UserContextMenu
                key={p.userId}
                targetUser={targetUserObj}
                guild={guild}
                isInVoice={true}
                onMention={onMention}
                onOpenProfile={onOpenUserProfile}
                onSendMessage={onSendMessage}
                onOpenUserSettings={onOpenUserSettings}
                onOpenAudioSettings={onOpenSettings}
                onKickMember={onKickMember}
                onBanMember={onBanMember}
                onDisconnectVoice={onDisconnectVoice}
              >
                <div className="flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-[#35373c] text-xs text-discord-textNormal cursor-pointer">
                  <div className="relative">
                    <img
                      src={
                        (targetUserObj.avatarUrl &&
                          resolveServerUrl(targetUserObj.avatarUrl)) ||
                        `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(targetUserObj.username || "user")}`
                      }
                      alt="avatar"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src =
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(targetUserObj.username || "user")}`;
                      }}
                      className={`w-5 h-5 rounded-full object-cover border-2 border-transparent ${
                        isSpeakingUser ? "speaking-ring" : ""
                      }`}
                    />
                  </div>
                  <span className="truncate flex-1">{displayName}</span>
                  {(() => {
                    const peerReport = peerLatencies.get(p.userId);
                    if (!peerReport || peerReport.rtt <= 0) return null;
                    return (
                      <span
                        className={`text-[9px] font-mono px-1 py-0.5 rounded transition-colors ${
                          peerReport.rtt < 50
                            ? "text-discord-green bg-discord-green/10"
                            : peerReport.rtt < 120
                              ? "text-[#faa61a] bg-[#faa61a]/10"
                              : "text-discord-danger bg-discord-danger/10"
                        }`}
                        title={`${t("voice:directRtt")}: ${peerReport.rtt}ms (${peerReport.connectionType})`}
                      >
                        {peerReport.rtt}ms
                      </span>
                    );
                  })()}
                  {p.selfMute && (
                    <MicOff
                      data-testid={`voice-sidebar-muted-${p.userId}`}
                      className="w-3 h-3 text-discord-danger"
                    />
                  )}
                  {p.streaming && (
                    <span className="text-[9px] bg-discord-brand text-white px-1 rounded font-bold">
                      {t("voice:liveStreaming")}
                    </span>
                  )}
                </div>
              </UserContextMenu>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  guild,
  guilds,
  channels,
  dmChannels,
  isFriendsActive,
  onSelectFriends,
  onCloseDMChannel,
  onDMChannelCreated,
  onStartDMCall,
  onOpenProfile,
  selectedChannelId,
  activeVoiceChannelId,
  activeVoiceChannelObj,
  voiceConnectionStatus,
  voiceStates,
  currentUser,
  isMuted,
  isDeafened,
  isSpeaking,
  activeSpeakers = [],
  isNoiseSuppressionEnabled,
  isVideoEnabled = false,
  onToggleVideo,
  voiceTransferNotice,
  onDismissVoiceTransferNotice,
  onReclaimVoice,
  onSelectChannel,
  onJoinVoiceChannel,
  onLeaveVoiceChannel,
  onToggleMute,
  onToggleDeafen,
  onOpenSettings,
  onOpenUserSettings,
  onOpenNetworkStats,
  onToggleScreenShare,
  onStopScreenShare,
  isScreenSharing = false,
  onOpenCreateChannel,
  onOpenCreateCategory,
  onEditCategory,
  onDeleteCategory,
  onDeleteChannel,
  onEditChannel,
  onChannelsReordered,
  onCategoriesReordered,
  onOpenServerSettings,
  onLeaveGuild,
  onMarkGuildAsRead,
  onMarkChannelAsRead,
  onMention,
  onOpenUserProfile,
  onSendMessage,
  onKickMember,
  onBanMember,
  onDisconnectVoice,
  onOpenInviteFriends,
  channelUnreadMap,
}) => {
  const { t } = useTranslation(["voice", "common", "contextMenu", "server"]);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);
  const networkStats = useNetworkStats();
  const { canManageChannels, canManageGuild, canCreateInvite } =
    usePermissions(guild);
  const [isCurrentUserCardOpen, setIsCurrentUserCardOpen] = useState(false);
  const [userTriggerRect, setUserTriggerRect] = useState<DOMRect | null>(null);
  const userTriggerBtnRef = useRef<HTMLButtonElement | null>(null);

  const handleToggleUserCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (userTriggerBtnRef.current) {
      setUserTriggerRect(userTriggerBtnRef.current.getBoundingClientRect());
    }
    setIsCurrentUserCardOpen((prev) => !prev);
  };

  // 分类折叠状态：持久化保存在 localStorage 中
  const storageKey = guild ? `tescord_collapsed_categories_${guild.id}` : "";
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, boolean>
  >(() => {
    if (!storageKey) return {};
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setCollapsedCategories(JSON.parse(saved));
      } else {
        setCollapsedCategories({});
      }
    } catch {
      setCollapsedCategories({});
    }
  }, [storageKey]);

  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = { ...prev, [categoryId]: !prev[categoryId] };
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  // 滚动容器引用：用于实现频道列表定位滚动
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // 当选中的频道发生变化（例如切换服务器记忆恢复、点击频道或路由变化）时：
  // 1. 若目标频道所处的分类当前处于折叠状态，自动自愈展开该分类并更新本地持久化；
  // 2. 将频道列表平滑滚动到该频道位置（nearest 就近对齐，已在视野内则不晃动）
  useEffect(() => {
    if (!selectedChannelId || !guild) return;

    const allChannels = clonedChannels || channels;
    const targetChannel = allChannels.find((c) => c.id === selectedChannelId);

    // 1. 若目标频道属于某个已被折叠的分类，自动展开
    if (targetChannel?.parentId) {
      setCollapsedCategories((prev) => {
        if (prev[targetChannel.parentId!]) {
          const next = { ...prev, [targetChannel.parentId!]: false };
          if (storageKey) {
            try {
              localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {}
          }
          return next;
        }
        return prev;
      });
    }

    // 2. 在渲染帧就绪后执行平滑就近滚动
    let raf2: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const targetEl = container.querySelector(
          `[data-channel-id="${selectedChannelId}"]`,
        ) as HTMLElement | null;

        if (targetEl) {
          targetEl.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest",
          });
        }
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [selectedChannelId, guild?.id, storageKey]);

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

  const handleOpenInviteModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!guild) return;
    if (onOpenInviteFriends) {
      onOpenInviteFriends(guild);
    } else {
      window.dispatchEvent(
        new CustomEvent("tescord:open-invite-modal", { detail: { guild } }),
      );
    }
  };

  // 获取正在当前语音频道的用户
  const getChannelParticipants = (channelId: string) => {
    return voiceStates
      .filter((v) => v.channelId === channelId)
      .map((v) =>
        v.userId === currentUser.id && channelId === activeVoiceChannelId
          ? { ...v, selfMute: isMuted, selfDeaf: isDeafened }
          : v,
      );
  };

  const activeVoiceChannel =
    activeVoiceChannelObj ||
    channels.find((c) => c.id === activeVoiceChannelId);

  // 网络质量颜色映射
  const getQualityColor = (quality?: string) => {
    switch (quality) {
      case "excellent":
        return "text-discord-green";
      case "good":
        return "text-amber-400";
      case "poor":
        return "text-discord-danger";
      default:
        return "text-discord-textMuted";
    }
  };

  const qualityColor = getQualityColor(networkStats?.quality);
  const [isConnectionPopoverOpen, setIsConnectionPopoverOpen] = useState(false);
  const currentRtt =
    typeof networkStats?.rtt === "number" && networkStats.rtt > 0
      ? networkStats.rtt
      : null;

  // 拖拽悬浮项与克隆状态（用于实时平滑占位与无延迟跟随）
  const [activeItem, setActiveItem] = useState<
    | { type: "channel"; channel: Channel }
    | { type: "category"; category: ChannelCategory }
    | null
  >(null);
  const [clonedChannels, setClonedChannels] = useState<Channel[] | null>(null);
  const [clonedCategories, setClonedCategories] = useState<
    ChannelCategory[] | null
  >(null);

  // 拖拽激活时在全局禁止文本选择并显示抓取光标
  useEffect(() => {
    if (activeItem) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [activeItem]);

  // 拖拽传感器：MouseSensor 5px 快速响应，低于 5px 保留为单击/双击；TouchSensor 200ms 防滚屏误触
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 8,
      },
    }),
  );

  // 专为嵌套多容器定制的复合碰撞检测算法：彻底消除大分类容器与小单项频道的中心点竞争与抖动
  const customCollisionDetection: CollisionDetection = (args) => {
    // 1. 如果正在拖拽分类：仅在分类候选（cat_*）中检测
    if (activeItem?.type === "category") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          String(c.id).startsWith("cat_"),
        ),
      });
    }

    // 2. 如果正在拖拽频道：优先检测光标指针穿透的实际区域 (pointerWithin)
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      // 优先命中具体频道条目
      const channelCollision = pointerCollisions.find((c) =>
        String(c.id).startsWith("chn_"),
      );
      if (channelCollision) {
        return [channelCollision];
      }
      // 其次命中分类头部（用于拖到空分类或分类标题）
      const categoryCollision = pointerCollisions.find((c) =>
        String(c.id).startsWith("cat_"),
      );
      if (categoryCollision) {
        return [categoryCollision];
      }
      return pointerCollisions;
    }

    // 3. 兜底回退：若光标处在条目间微小间隙，使用矩形相交检测
    return rectIntersection(args);
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (!canManageChannels) return;
    const { active } = event;
    const activeData = active.data.current;
    if (activeData?.type === "channel") {
      setActiveItem({ type: "channel", channel: activeData.channel });
      setClonedChannels(channels);
    } else if (activeData?.type === "category") {
      setActiveItem({ type: "category", category: activeData.category });
      setClonedCategories(guild?.categories || []);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !guild) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // 1. 频道跨分类或在分类内拖拽实时平滑占位
    if (activeId.startsWith("chn_")) {
      const activeChnId = activeId.replace("chn_", "");

      setClonedChannels((prevChannels) => {
        const items = prevChannels ? [...prevChannels] : [...channels];
        const activeIdx = items.findIndex((c) => c.id === activeChnId);
        if (activeIdx === -1) return prevChannels;

        const activeChannel = items[activeIdx];
        let targetParentId: string | null = activeChannel.parentId || null;

        if (overId.startsWith("cat_")) {
          targetParentId = overId.replace("cat_", "");
        } else if (overId.startsWith("chn_")) {
          const overChnId = overId.replace("chn_", "");
          const overChannel = items.find((c) => c.id === overChnId);
          if (overChannel) {
            targetParentId = overChannel.parentId || null;
          }
        }

        if (overId.startsWith("chn_")) {
          const overChnId = overId.replace("chn_", "");
          const overIdx = items.findIndex((c) => c.id === overChnId);
          if (
            overIdx !== -1 &&
            (activeIdx !== overIdx || activeChannel.parentId !== targetParentId)
          ) {
            const updated = { ...activeChannel, parentId: targetParentId };
            items.splice(activeIdx, 1);
            items.splice(overIdx, 0, updated);
            return items;
          }
        } else if (overId.startsWith("cat_")) {
          if (activeChannel.parentId !== targetParentId) {
            const updated = { ...activeChannel, parentId: targetParentId };
            items.splice(activeIdx, 1);
            const firstChildIdx = items.findIndex(
              (c) => c.parentId === targetParentId,
            );
            if (firstChildIdx !== -1) {
              items.splice(firstChildIdx, 0, updated);
            } else {
              items.push(updated);
            }
            return items;
          }
        }

        return prevChannels;
      });
      return;
    }

    // 2. 分类上下排序实时预览
    if (activeId.startsWith("cat_") && overId.startsWith("cat_")) {
      const activeCatId = activeId.replace("cat_", "");
      const overCatId = overId.replace("cat_", "");

      setClonedCategories((prevCategories) => {
        const items = prevCategories
          ? [...prevCategories]
          : [...(guild.categories || [])];
        const oldIndex = items.findIndex((c) => c.id === activeCatId);
        const newIndex = items.findIndex((c) => c.id === overCatId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex)
          return prevCategories;
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const finalChannels = clonedChannels;
    const finalCategories = clonedCategories;

    setActiveItem(null);
    setClonedChannels(null);
    setClonedCategories(null);

    if (!over || !guild) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // 1. 分类排序提交
    if (activeId.startsWith("cat_")) {
      const baseCategories = finalCategories
        ? [...finalCategories]
        : [...(guild.categories || [])];
      const activeCatId = activeId.replace("cat_", "");
      const overCatId = overId.replace("cat_", "");
      const oldIndex = baseCategories.findIndex((c) => c.id === activeCatId);
      const newIndex = baseCategories.findIndex((c) => c.id === overCatId);

      let newCategories = baseCategories;
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        newCategories = arrayMove(baseCategories, oldIndex, newIndex);
      }
      const indexedCategories = newCategories.map((cat, idx) => ({
        ...cat,
        position: idx,
      }));
      onCategoriesReordered?.(indexedCategories);

      try {
        const token = localStorage.getItem("tescord_access_token");
        await fetch(`${API_BASE}/api/guilds/${guild.id}/categories/positions`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            categories: indexedCategories.map((c) => ({
              id: c.id,
              position: c.position,
            })),
          }),
        });
      } catch (e) {
        console.error("Failed to reorder categories:", e);
      }
      return;
    }

    // 2. 频道排序与归属分类提交
    if (activeId.startsWith("chn_")) {
      const items = finalChannels ? [...finalChannels] : [...channels];
      const indexedChannels = items.map((c, idx) => ({
        ...c,
        position: idx,
      }));
      onChannelsReordered?.(indexedChannels);

      try {
        const token = localStorage.getItem("tescord_access_token");
        await fetch(`${API_BASE}/api/guilds/${guild.id}/channels/positions`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            channels: indexedChannels.map((c) => ({
              id: c.id,
              position: c.position,
              parentId: c.parentId || null,
            })),
          }),
        });
      } catch (e) {
        console.error("Failed to reorder channels:", e);
      }
    }
  };

  const handleDragCancel = () => {
    setActiveItem(null);
    setClonedChannels(null);
    setClonedCategories(null);
  };

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: "0.3",
        },
      },
    }),
    duration: 180,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
  };

  const categories = clonedCategories || guild?.categories || [];
  const currentChannels = clonedChannels || channels;

  // 顶层未分类频道
  const uncategorizedChannels = currentChannels
    .filter(
      (c) => !c.parentId || !categories.some((cat) => cat.id === c.parentId),
    )
    .sort((a, b) => a.position - b.position);

  return (
    <div className="w-60 bg-discord-channelList flex flex-col h-full border-r border-[#232428] select-none">
      {/* 未选择服务器时，展示完整的私信会话列表 */}
      {!guild && (
        <DirectMessageList
          channels={dmChannels || []}
          selectedChannelId={selectedChannelId}
          currentUser={currentUser}
          guilds={guilds}
          isFriendsActive={isFriendsActive}
          onSelectFriends={onSelectFriends}
          onSelectChannel={onSelectChannel}
          onCloseChannel={(id) => onCloseDMChannel?.(id)}
          onChannelCreated={onDMChannelCreated}
          onStartCall={onStartDMCall}
          onOpenProfile={onOpenProfile}
        />
      )}

      {/* 服务器标题 */}
      {guild && (
        <ServerContextMenu
          guild={guild}
          onOpenCreateChannel={() => onOpenCreateChannel?.()}
          onOpenCreateCategory={onOpenCreateCategory}
          onOpenServerSettings={onOpenServerSettings}
          onLeaveGuild={onLeaveGuild}
          onMarkAsRead={onMarkGuildAsRead}
        >
          <div
            data-testid="server-header"
            className="h-12 border-b border-[#1f2023] px-4 flex items-center justify-between font-bold text-discord-textHeader shadow-sm hover:bg-[#35373c] transition cursor-pointer"
          >
            <span className="truncate">{guild.name}</span>
            <div className="flex items-center space-x-1">
              {canManageGuild && onOpenServerSettings && (
                <button
                  type="button"
                  data-testid="mobile-server-settings-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenServerSettings(guild);
                  }}
                  className="md:hidden p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
                  title={t("contextMenu:server.settings")}
                  aria-label={t("contextMenu:server.settings")}
                >
                  <Settings className="w-4 h-4" />
                </button>
              )}
              {canManageChannels && onOpenCreateCategory && (
                <button
                  type="button"
                  data-testid="sidebar-create-category-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCreateCategory();
                  }}
                  className="p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
                  title={t("contextMenu:server.createCategory")}
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              )}
              {canManageChannels && onOpenCreateChannel && (
                <button
                  type="button"
                  data-testid="sidebar-create-channel-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCreateChannel();
                  }}
                  className="p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
                  title={t("contextMenu:server.createChannel")}
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              {canCreateInvite && (
                <button
                  type="button"
                  data-testid="sidebar-invite-friends-btn"
                  onClick={handleOpenInviteModal}
                  className="p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition flex items-center space-x-1"
                  title={t("server:inviteFriends")}
                >
                  <UserPlus className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </ServerContextMenu>
      )}

      {/* 频道列表与分类容器 */}
      {guild && (
        <div
          ref={scrollContainerRef}
          data-testid="channel-list-scroll-container"
          className="flex-1 overflow-y-auto px-2 py-3 space-y-3"
        >
          <DndContext
            sensors={sensors}
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* 1. 顶层未分类频道 (直接罗列于顶层，无需折叠头) */}
            {uncategorizedChannels.length > 0 && (
              <SortableContext
                items={uncategorizedChannels.map((c) => `chn_${c.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className="space-y-[2px]"
                  data-testid="uncategorized-channels-group"
                >
                  {uncategorizedChannels.map((channel) => (
                    <SortableChannelItem
                      key={channel.id}
                      channel={channel}
                      guild={guild}
                      selectedChannelId={selectedChannelId}
                      activeVoiceChannelId={activeVoiceChannelId}
                      participants={getChannelParticipants(channel.id)}
                      canManageChannels={canManageChannels}
                      currentUser={currentUser}
                      isSpeaking={isSpeaking}
                      activeSpeakers={activeSpeakers}
                      peerLatencies={peerLatencies}
                      t={t}
                      unreadInfo={channelUnreadMap?.[channel.id]}
                      onSelectChannel={onSelectChannel}
                      onJoinVoiceChannel={onJoinVoiceChannel}
                      onEditChannel={onEditChannel}
                      onDeleteChannel={onDeleteChannel}
                      onMarkChannelAsRead={onMarkChannelAsRead}
                      onMention={onMention}
                      onOpenUserProfile={onOpenUserProfile}
                      onSendMessage={onSendMessage}
                      onOpenUserSettings={onOpenUserSettings}
                      onOpenSettings={onOpenSettings}
                      onKickMember={onKickMember}
                      onBanMember={onBanMember}
                      onDisconnectVoice={onDisconnectVoice}
                      onCancelDrag={handleDragCancel}
                    />
                  ))}
                </div>
              </SortableContext>
            )}

            {/* 2. 动态分类列表 */}
            <SortableContext
              items={categories.map((cat) => `cat_${cat.id}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {categories.map((category) => {
                  const isCollapsed = !!collapsedCategories[category.id];
                  const categoryChannels = currentChannels
                    .filter((c) => c.parentId === category.id)
                    .sort((a, b) => a.position - b.position);

                  return (
                    <SortableCategorySection
                      key={category.id}
                      category={category}
                      guild={guild}
                      isCollapsed={isCollapsed}
                      canManageChannels={canManageChannels}
                      onToggleCollapse={() =>
                        toggleCategoryCollapse(category.id)
                      }
                      onOpenCreateChannel={() =>
                        onOpenCreateChannel?.(category)
                      }
                      onEditCategory={onEditCategory}
                      onDeleteCategory={onDeleteCategory}
                    >
                      <div
                        className={`discord-accordion ${
                          isCollapsed ? "collapsed" : ""
                        }`}
                      >
                        <div className="overflow-hidden">
                          <SortableContext
                            items={categoryChannels.map((c) => `chn_${c.id}`)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div
                              className="space-y-[2px] mt-0.5"
                              data-testid={`category-channels-${category.id}`}
                            >
                              {categoryChannels.map((channel) => (
                                <SortableChannelItem
                                  key={channel.id}
                                  channel={channel}
                                  guild={guild}
                                  selectedChannelId={selectedChannelId}
                                  activeVoiceChannelId={activeVoiceChannelId}
                                  participants={getChannelParticipants(
                                    channel.id,
                                  )}
                                  canManageChannels={canManageChannels}
                                  currentUser={currentUser}
                                  isSpeaking={isSpeaking}
                                  activeSpeakers={activeSpeakers}
                                  peerLatencies={peerLatencies}
                                  t={t}
                                  unreadInfo={channelUnreadMap?.[channel.id]}
                                  onSelectChannel={onSelectChannel}
                                  onJoinVoiceChannel={onJoinVoiceChannel}
                                  onEditChannel={onEditChannel}
                                  onDeleteChannel={onDeleteChannel}
                                  onMarkChannelAsRead={onMarkChannelAsRead}
                                  onMention={onMention}
                                  onOpenUserProfile={onOpenUserProfile}
                                  onSendMessage={onSendMessage}
                                  onOpenUserSettings={onOpenUserSettings}
                                  onOpenSettings={onOpenSettings}
                                  onKickMember={onKickMember}
                                  onBanMember={onBanMember}
                                  onDisconnectVoice={onDisconnectVoice}
                                  onCancelDrag={handleDragCancel}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </div>
                      </div>
                    </SortableCategorySection>
                  );
                })}
              </div>
            </SortableContext>

            {/* 3. 悬浮跟手幽灵图层 (DragOverlay)：消除滞后，丝滑 60fps 实时贴手 */}
            <DragOverlay dropAnimation={dropAnimation}>
              {activeItem?.type === "channel" ? (
                <div className="flex items-center px-2 py-1.5 rounded-md text-sm font-medium bg-[#2b2d31] text-white shadow-2xl ring-1 ring-discord-brand/60 rotate-1 scale-[1.02] cursor-grabbing opacity-95 pointer-events-none">
                  {activeItem.channel.type === "VOICE" ? (
                    <div className="relative mr-1.5 flex-shrink-0">
                      <Volume2 className="w-4 h-4 text-discord-green" />
                      {(activeItem.channel.voiceMode === "p2p_mesh" ||
                        activeItem.channel.streamMode === "p2p_direct" ||
                        activeItem.channel.streamMode === "p2p_relay") && (
                        <span className="absolute -top-1 -right-1.5 flex items-center justify-center bg-[#1e1f22] rounded-full p-[1px] shadow ring-1 ring-[#1e1f22]">
                          <Network className="w-2.5 h-2.5 text-blue-400" />
                        </span>
                      )}
                    </div>
                  ) : activeItem.channel.isE2EE ? (
                    <div className="relative mr-1.5 flex-shrink-0">
                      <Hash className="w-4 h-4 text-discord-textMuted" />
                      <Lock className="w-2.5 h-2.5 text-discord-green absolute -top-0.5 -right-1" />
                    </div>
                  ) : (
                    <Hash className="w-4 h-4 mr-1.5 text-discord-textMuted flex-shrink-0" />
                  )}
                  <span className="truncate">{activeItem.channel.name}</span>
                  {activeItem.channel.type === "VOICE" &&
                    activeItem.channel.isE2EE && (
                      <Lock className="w-3.5 h-3.5 ml-1.5 text-discord-green flex-shrink-0" />
                    )}
                </div>
              ) : activeItem?.type === "category" ? (
                <div className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs font-bold text-white uppercase tracking-wider bg-[#2b2d31] shadow-2xl ring-1 ring-discord-brand/60 rotate-1 scale-[1.02] cursor-grabbing opacity-95 pointer-events-none">
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-discord-textMuted" />
                  <span className="truncate">{activeItem.category.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* 底部连接控制面板 (接入语音连接中或已连接时显示) */}
      {activeVoiceChannel && voiceConnectionStatus !== "disconnected" && (
        <div className="bg-[#202225] border-b border-[#2b2d31] p-2.5 flex flex-col space-y-2 animate-fadeIn relative">
          <MediaEncryptionIndicator showCounters={false} visuallyHidden={true} />
          <VoiceConnectionStatusPopover
            isOpen={isConnectionPopoverOpen}
            onClose={() => setIsConnectionPopoverOpen(false)}
            onOpenMoreStats={() => {
              onOpenNetworkStats?.();
            }}
            channel={activeVoiceChannel}
            guild={guild}
            voiceStates={voiceStates}
          />
          <div className="flex items-center">
            <div
              role="button"
              tabIndex={0}
              data-testid="voice-connection-status-btn"
              aria-expanded={isConnectionPopoverOpen}
              onClick={
                voiceConnectionStatus === "connecting"
                  ? undefined
                  : () => setIsConnectionPopoverOpen((prev) => !prev)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (voiceConnectionStatus !== "connecting") {
                    setIsConnectionPopoverOpen((prev) => !prev);
                  }
                }
              }}
              className={`flex-1 min-w-0 mr-1.5 flex flex-col pt-1.5 pb-1 px-1.5 -ml-1 rounded-lg transition group ${
                voiceConnectionStatus === "connecting"
                  ? "cursor-default opacity-90"
                  : "hover:bg-[#35373c]/60 cursor-pointer"
              }`}
              title={(() => {
                if (voiceConnectionStatus === "connecting") {
                  return t("voice:voiceConnecting");
                }
                const audioMode = voiceMeshManager.getIsFallbackToSFU()
                  ? t("voice:fallbackToSFUActive")
                  : voiceMeshManager.getIsMeshActive()
                    ? `${t("voice:p2pMeshMode")} (${peerLatencies.size})`
                    : t("voice:sfuServerMode");
                const isBroadcasting = p2pStreamManager.isBroadcasting(
                  activeVoiceChannel?.id,
                );
                const isWatching = !!p2pStreamManager.getRemoteStream();
                const videoMode = isBroadcasting
                  ? `${t("voice:videoStatusBroadcasting")} (${p2pStreamManager.getTargetVideoCodec().toUpperCase()})`
                  : isWatching
                    ? `${t("voice:videoStatusWatching")} (P2P)`
                    : t("voice:videoStatusIdle");
                return `[${t("voice:tabAudio")}] ${audioMode}\n[${t("voice:tabVideo")}] ${videoMode}\n${t("voice:statsHUD")} (Esc / Click)`;
              })()}
            >
              <div className="flex items-center space-x-2 py-0.5 min-w-0">
                {voiceConnectionStatus === "connecting" ? (
                  <Loader2 className="w-4 h-4 text-[#faa61a] animate-spin flex-shrink-0" />
                ) : voiceConnectionStatus === "reconnecting" ? (
                  <Loader2 className="w-4 h-4 text-discord-danger animate-spin flex-shrink-0" />
                ) : (
                  <Signal
                    className={`w-4 h-4 ${qualityColor} animate-pulse flex-shrink-0`}
                  />
                )}
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span
                    className={`text-xs font-bold leading-5 truncate ${
                      voiceConnectionStatus === "connecting"
                        ? "text-[#faa61a]"
                        : voiceConnectionStatus === "reconnecting"
                          ? "text-discord-danger"
                          : qualityColor
                    }`}
                  >
                    {voiceConnectionStatus === "connecting"
                      ? t("voice:voiceConnecting")
                      : voiceConnectionStatus === "reconnecting"
                        ? t("voice:voiceReconnecting")
                        : t("voice:voiceConnected")}
                  </span>
                  <span
                    data-testid="voice-connection-latency"
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1e1f22] border border-[#2b2d31] ${
                      voiceConnectionStatus === "connecting"
                        ? "text-[#faa61a]"
                        : qualityColor
                    } group-hover:border-discord-brand transition-colors`}
                  >
                    {(() => {
                      const isP2P =
                        activeVoiceChannel?.voiceMode === "p2p_mesh" ||
                        voiceMeshManager.getIsMeshActive();
                      if (voiceConnectionStatus === "connecting") {
                        return isP2P ? "P2P" : "--ms";
                      }
                      const activeSpeakerId =
                        activeSpeakers && activeSpeakers.length > 0
                          ? activeSpeakers[0]
                          : null;
                      const meshMetrics =
                        voiceMeshManager.getActiveSpeakerOrMedianLatency(
                          activeSpeakerId,
                        );
                      const finalRtt =
                        meshMetrics.rtt > 0 ? meshMetrics.rtt : currentRtt;
                      const latencyStr =
                        finalRtt === null ? "--ms" : `${finalRtt}ms`;
                      return isP2P ? `P2P ${latencyStr}` : latencyStr;
                    })()}
                  </span>
                </div>
              </div>
              {/* 独立可点击语音频道名称：位于容器内部上层，仅文字范围响应，点击时阻止冒泡切回语音主舞台并关闭 Popover */}
              <div className="pl-6 min-w-0 flex items-center">
                <button
                  type="button"
                  data-testid="voice-connection-channel-name"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConnectionPopoverOpen(false);
                    if (activeVoiceChannel) {
                      onSelectChannel(activeVoiceChannel);
                    }
                  }}
                  className="text-left text-[11px] leading-4 text-discord-textMuted hover:text-white hover:underline transition-colors truncate inline-block max-w-full cursor-pointer relative z-10"
                  title={activeVoiceChannel.name}
                >
                  {activeVoiceChannel.name}
                </button>
              </div>
            </div>
            <button
              onClick={onLeaveVoiceChannel}
              className="p-1.5 text-discord-textMuted hover:text-discord-danger hover:bg-[#35373c] rounded transition flex-shrink-0"
              title={
                voiceConnectionStatus === "connecting"
                  ? t("voice:cancelVoiceConnecting")
                  : t("voice:disconnect")
              }
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>

          <div
            className={`flex items-center justify-between pt-1 border-t border-[#2b2d31] gap-1 transition-opacity ${
              voiceConnectionStatus === "connecting"
                ? "opacity-50 pointer-events-none"
                : ""
            }`}
          >
            <button
              onClick={onToggleVideo}
              data-testid="sidebar-toggle-video-btn"
              disabled={voiceConnectionStatus === "connecting"}
              className={`py-1 px-1.5 text-xs rounded flex items-center justify-center space-x-1 transition flex-1 ${
                isVideoEnabled
                  ? "bg-discord-green text-white hover:bg-discord-green/90 shadow-sm"
                  : "bg-discord-sidebar hover:bg-discord-hover text-discord-textNormal"
              }`}
              title={
                isVideoEnabled
                  ? t("voice:turnOffCamera")
                  : t("voice:turnOnCamera")
              }
            >
              {isVideoEnabled ? (
                <VideoOff className="w-3.5 h-3.5" />
              ) : (
                <Video className="w-3.5 h-3.5" />
              )}
              <span>
                {isVideoEnabled
                  ? t("voice:disableVideo")
                  : t("voice:enableVideo")}
              </span>
            </button>
            <button
              onClick={() => {
                if (isScreenSharing) {
                  if (onStopScreenShare) {
                    onStopScreenShare();
                  } else {
                    onToggleScreenShare();
                  }
                } else {
                  onToggleScreenShare();
                }
              }}
              data-testid="sidebar-toggle-screen-btn"
              disabled={voiceConnectionStatus === "connecting"}
              className={`flex-1 py-1 px-1.5 text-xs rounded flex items-center justify-center space-x-1 transition ${
                isScreenSharing
                  ? "bg-discord-brand text-white hover:bg-discord-brand-hover shadow-sm"
                  : "bg-discord-sidebar hover:bg-discord-hover text-discord-textNormal"
              }`}
              title={
                isScreenSharing
                  ? t("voice:stopScreenShare")
                  : t("voice:screenShare")
              }
            >
              {isScreenSharing ? (
                <ScreenShareOff className="w-3.5 h-3.5" />
              ) : (
                <ScreenShare className="w-3.5 h-3.5" />
              )}
              <span>
                {isScreenSharing
                  ? t("voice:stopScreenShare")
                  : t("voice:screenShare")}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 语音转移提示卡片 (Discord 风格) */}
      {voiceTransferNotice && !activeVoiceChannel && (
        <div
          data-testid="voice-transfer-notice"
          className="bg-[#2b2d31] border-l-4 border-amber-500 border-b border-[#1f2023] p-2.5 flex flex-col space-y-2 animate-fade-in"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-1.5 text-amber-400 text-xs font-semibold">
              <PhoneOff className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                {t("voice:voiceTransferred", {
                  target: voiceTransferNotice.targetPlatform || "Device",
                })}
              </span>
            </div>
            {onDismissVoiceTransferNotice && (
              <button
                type="button"
                data-testid="dismiss-transfer-notice-btn"
                onClick={onDismissVoiceTransferNotice}
                className="text-discord-textMuted hover:text-white p-0.5 rounded transition cursor-pointer"
                title={t("voice:ignoreNotice")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="text-[11px] text-discord-textMuted leading-tight">
            {t("voice:otherDeviceVoiceNotice")}
            {voiceTransferNotice.previousChannel
              ? ` #${voiceTransferNotice.previousChannel.name}`
              : ""}
            .
          </div>
          {voiceTransferNotice.previousChannel && onReclaimVoice && (
            <button
              type="button"
              data-testid="reclaim-voice-btn"
              onClick={() =>
                onReclaimVoice(voiceTransferNotice.previousChannel!)
              }
              className="w-full py-1 px-2 text-xs bg-discord-brand hover:bg-discord-brandHover text-white rounded font-medium flex items-center justify-center space-x-1 transition shadow-sm cursor-pointer"
            >
              <span>{t("voice:joinOnThisDevice")}</span>
            </button>
          )}
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
            ref={userTriggerBtnRef}
            type="button"
            data-testid="current-user-panel-btn"
            onClick={handleToggleUserCard}
            className="flex items-center space-x-2 overflow-hidden mr-1 p-1 -ml-1 rounded hover:bg-discord-hover transition text-left group min-w-0 cursor-pointer"
            title={t("voice:openProfileTooltip")}
          >
            <div className="relative flex-shrink-0">
              <img
                src={
                  (currentUser.avatarUrl &&
                    resolveServerUrl(currentUser.avatarUrl)) ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username || "avatar")}`
                }
                alt={currentUser.username}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(currentUser.username || "avatar")}`;
                }}
                className={`w-8 h-8 rounded-full object-cover border-2 border-transparent ${
                  isSpeaking ? "speaking-ring" : ""
                }`}
              />
              <div className="absolute bottom-0 right-0">
                <StatusBadge
                  status={currentUser.status}
                  size={10}
                  borderColor="#232428"
                />
              </div>
            </div>
            <div className="flex flex-col truncate">
              <span
                className="text-xs font-semibold text-discord-textHeader truncate group-hover:underline"
                title={currentUser.username}
              >
                {getUserDisplayName(currentUser)}
              </span>
              <span className="text-[10px] text-discord-textMuted truncate flex items-center gap-1">
                <span>
                  {currentUser.customStatus ||
                    (currentUser.status === "ONLINE"
                      ? t("common:status.online")
                      : currentUser.status === "IDLE"
                        ? t("common:status.idle")
                        : currentUser.status === "DND"
                          ? t("common:status.dnd")
                          : t("common:status.invisible"))}
                </span>
              </span>
            </div>
          </button>
        </UserContextMenu>

        {/* 麦克风/耳机/设置控制按钮 */}
        <div className="flex items-center space-x-0.5 text-discord-textMuted">
          <Tooltip
            content={isMuted ? t("voice:unmuteMic") : t("voice:muteMic")}
          >
            <button
              data-testid="user-bar-mic-btn"
              onClick={onToggleMute}
              className={`p-1.5 rounded hover:bg-discord-hover transition-all duration-150 active:scale-90 ${
                isMuted
                  ? "text-discord-danger hover:text-discord-danger bg-discord-danger/10 hover:bg-discord-danger/20"
                  : "hover:text-discord-textNormal"
              }`}
            >
              {isMuted ? (
                <MicOff className="w-4 h-4 transition-transform duration-150 scale-100" />
              ) : (
                <Mic className="w-4 h-4 transition-transform duration-150 scale-100" />
              )}
            </button>
          </Tooltip>

          <Tooltip
            content={isDeafened ? t("voice:undeafen") : t("voice:deafen")}
          >
            <button
              data-testid="user-bar-deafen-btn"
              onClick={onToggleDeafen}
              className={`p-1.5 rounded hover:bg-discord-hover transition-all duration-150 active:scale-90 relative ${
                isDeafened
                  ? "text-discord-danger hover:text-discord-danger bg-discord-danger/10 hover:bg-discord-danger/20"
                  : "hover:text-discord-textNormal"
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Headphones className="w-4 h-4 transition-transform duration-150" />
                {isDeafened && (
                  <span className="absolute w-5 h-0.5 bg-discord-danger rotate-45 transform origin-center rounded-full shadow-sm animate-in fade-in zoom-in-75 duration-150" />
                )}
              </div>
            </button>
          </Tooltip>

          <Tooltip content={t("voice:deviceSettings")}>
            <button
              type="button"
              data-testid="user-settings-gear-btn"
              data-action="open-user-settings"
              onClick={onOpenSettings}
              className="group/gear p-1.5 rounded hover:bg-discord-hover hover:text-discord-textNormal transition-all duration-150 active:scale-90 cursor-pointer"
            >
              <Settings className="w-4 h-4 transition-transform duration-300 ease-out group-hover/gear:rotate-45" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Discord 风格左下角当前用户弹窗卡片 */}
      <CurrentUserPopout
        isOpen={isCurrentUserCardOpen}
        onClose={() => setIsCurrentUserCardOpen(false)}
        targetRect={userTriggerRect}
        triggerRef={userTriggerBtnRef}
        currentUser={currentUser}
        onOpenUserSettings={onOpenUserSettings}
      />
    </div>
  );
};

interface SortableCategorySectionProps {
  category: ChannelCategory;
  guild: Guild | null;
  isCollapsed: boolean;
  canManageChannels: boolean;
  onToggleCollapse: () => void;
  onOpenCreateChannel?: () => void;
  onEditCategory?: (category: ChannelCategory) => void;
  onDeleteCategory?: (category: ChannelCategory) => void;
  children: React.ReactNode;
}

const SortableCategorySection: React.FC<SortableCategorySectionProps> = ({
  category,
  guild,
  isCollapsed,
  canManageChannels,
  onToggleCollapse,
  onOpenCreateChannel,
  onEditCategory,
  onDeleteCategory,
  children,
}) => {
  const { t } = useTranslation(["contextMenu", "voice", "server"]);
  const touchMenu = useTouchContextMenu();
  const {
    attributes: { role: _role, tabIndex: _tabIndex, ...sortableAttributes },
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `cat_${category.id}`,
    data: { type: "category", category },
    disabled: !canManageChannels,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.25 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`category-sortable-${category.id}`}
      data-dragging={isDragging}
    >
      <CategoryContextMenu
        category={category}
        guild={guild}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        onCreateChannel={() => onOpenCreateChannel?.()}
        onEditCategory={onEditCategory}
        onDeleteCategory={onDeleteCategory}
      >
        <div
          {...touchMenu}
          onMouseDown={
            canManageChannels
              ? (event) => listeners?.onMouseDown?.(event)
              : undefined
          }
          className={`text-[11px] font-bold text-discord-textMuted uppercase tracking-wider px-2 py-1 mb-0.5 flex items-center justify-between group select-none hover:text-discord-textNormal rounded ${
            canManageChannels ? "cursor-grab" : "cursor-pointer"
          }`}
          data-testid={`category-header-${category.id}`}
        >
          {canManageChannels && (
            <button
              type="button"
              data-drag-handle
              data-testid={`category-drag-handle-${category.id}`}
              ref={setActivatorNodeRef}
              {...sortableAttributes}
              {...listeners}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
              onClick={(event) => event.stopPropagation()}
              aria-label={t("server:dragCategory", { name: category.name })}
              className="shrink-0 w-11 h-11 flex items-center justify-center touch-none text-discord-textMuted lg:hidden"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          <div
            onClick={onToggleCollapse}
            className="flex items-center space-x-1 min-w-0 flex-1 cursor-pointer"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ease-out ${
                isCollapsed ? "-rotate-90" : "rotate-0"
              }`}
            />
            <span className="truncate">{category.name}</span>
          </div>
          {canManageChannels && onOpenCreateChannel && (
            <button
              type="button"
              data-testid={`create-channel-in-category-${category.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenCreateChannel();
              }}
              className="group/plus p-0.5 opacity-70 hover:opacity-100 hover:text-discord-textHeader transition text-discord-textMuted active:scale-90"
              title={t("contextMenu:server.createChannel")}
              aria-label={t("voice:createChannelInCategory", {
                name: category.name,
              })}
            >
              <Plus className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover/plus:rotate-90" />
            </button>
          )}
        </div>
      </CategoryContextMenu>
      {children}
    </div>
  );
};
