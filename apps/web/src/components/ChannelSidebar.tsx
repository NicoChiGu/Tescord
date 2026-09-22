import React, { useState, useEffect } from "react";
import {
  Channel,
  ChannelCategory,
  Guild,
  User,
  VoiceState,
  VoiceConnectionStatus,
  PeerLatencyReport,
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
  Sparkles,
  Plus,
  UserPlus,
  Check,
  X,
  Video,
  VideoOff,
  Loader2,
  ChevronDown,
  ChevronRight,
  FolderPlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { audioEngine } from "../services/audioEngine.js";
import { useNetworkStats } from "../hooks/useNetworkStats.js";
import { useGatewayStatus } from "../hooks/useGatewayStatus.js";
import { usePermissions } from "../hooks/usePermissions.js";
import { ServerContextMenu } from "./context-menu/ServerContextMenu.js";
import { ChannelContextMenu } from "./context-menu/ChannelContextMenu.js";
import { CategoryContextMenu } from "./context-menu/CategoryContextMenu.js";
import { UserContextMenu } from "./context-menu/UserContextMenu.js";
import { voiceMeshManager } from "../services/p2p/VoiceMeshManager.js";
import { p2pStreamManager } from "../services/p2p/P2PStreamManager.js";
import { DirectMessageList } from "./dm/DirectMessageList.js";

export interface VoiceTransferNotice {
  targetPlatform: string;
  previousChannel: Channel | null;
}

interface ChannelSidebarProps {
  guild: Guild | null;
  channels: Channel[];
  dmChannels?: Channel[];
  onCloseDMChannel?: (channelId: string) => void;
  onDMChannelCreated?: (channel: Channel) => void;
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
  t: (key: string) => string;
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
}) => {
  const isSelected = selectedChannelId === channel.id;
  const isConnected = activeVoiceChannelId === channel.id;
  const isVoice = channel.type === "VOICE";

  const {
    attributes: { role: _role, tabIndex: _tabIndex, ...sortableAttributes },
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `chn_${channel.id}`,
    data: { type: "channel", channel },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.25 : 1,
    zIndex: isDragging ? 0 : "auto",
  };

  return (
    <div ref={setNodeRef} style={style} className="space-y-[2px]">
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
          {...sortableAttributes}
          {...listeners}
          className="relative group w-full flex items-center"
        >
          {isVoice ? (
            <button
              type="button"
              data-testid={`channel-button-${channel.name}`}
              onClick={() => onSelectChannel(channel)}
              onDoubleClick={() => {
                onSelectChannel(channel);
                if (!isConnected) onJoinVoiceChannel(channel);
              }}
              title="单击预览房间，双击加入语音通话"
              className={`w-full flex items-center pl-2 pr-12 py-1.5 rounded-md text-sm font-medium transition ${
                isConnected
                  ? "bg-[#23a55a1a] text-discord-green font-semibold"
                  : isSelected
                    ? "bg-discord-active text-white"
                    : "text-discord-textMuted hover:bg-discord-hover hover:text-discord-textNormal"
              }`}
            >
              <Volume2
                className={`w-4 h-4 mr-1.5 flex-shrink-0 ${
                  isConnected ? "text-discord-green" : ""
                }`}
              />
              <span className="truncate">{channel.name}</span>
              <span className="ml-auto mr-1 text-xs px-1.5 py-0.5 rounded bg-[#1f2023] text-discord-textMuted">
                {participants.length}
              </span>
            </button>
          ) : (
            <button
              type="button"
              data-testid={`channel-button-${channel.name}`}
              onClick={() => onSelectChannel(channel)}
              className={`w-full flex items-center pl-2 pr-8 py-1.5 rounded-md text-sm font-medium transition ${
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
                <span className="ml-auto mr-1 text-[10px] bg-[#23a55a22] text-discord-green px-1 rounded border border-discord-green/30">
                  E2EE
                </span>
              )}
            </button>
          )}

          {canManageChannels && onEditChannel && (
            <button
              type="button"
              data-testid={`edit-channel-gear-${channel.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onEditChannel(channel);
              }}
              className="absolute right-2 opacity-0 group-hover:opacity-100 hover:text-white text-discord-textMuted p-0.5 rounded transition"
              title="编辑频道"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
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
              username: "用户",
              avatarUrl: null,
              status: undefined,
            };
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
              >
                <div className="flex items-center space-x-2 py-1 px-1.5 rounded hover:bg-[#35373c] text-xs text-discord-textNormal cursor-pointer">
                  <div className="relative">
                    <img
                      src={
                        targetUserObj.avatarUrl ||
                        "https://api.dicebear.com/7.x/bottts/svg?seed=user"
                      }
                      alt="avatar"
                      className={`w-5 h-5 rounded-full border-2 border-transparent ${
                        isSpeakingUser ? "speaking-ring" : ""
                      }`}
                    />
                  </div>
                  <span className="truncate flex-1">
                    {targetUserObj.username}
                  </span>
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
                    <MicOff className="w-3 h-3 text-discord-danger" />
                  )}
                  {p.streaming && (
                    <span className="text-[9px] bg-discord-brand text-white px-1 rounded font-bold">
                      直播中
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
  channels,
  dmChannels,
  onCloseDMChannel,
  onDMChannelCreated,
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
}) => {
  const { t } = useTranslation(["voice", "common"]);
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null);
  const networkStats = useNetworkStats();
  const { ping: gatewayPing } = useGatewayStatus();
  const { canManageChannels } = usePermissions(guild);

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

  // 获取正在当前语音频道的用户
  const getChannelParticipants = (channelId: string) => {
    return voiceStates.filter((v) => v.channelId === channelId);
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
  const currentRtt = typeof networkStats?.rtt === "number" && networkStats.rtt > 0
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
        delay: 200,
        tolerance: 5,
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
        await fetch(
          `${API_BASE}/api/guilds/${guild.id}/categories/positions`,
          {
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
          },
        );
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

  const categories = clonedCategories || (guild?.categories || []);
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
          onSelectChannel={onSelectChannel}
          onCloseChannel={(id) => onCloseDMChannel?.(id)}
          onChannelCreated={onDMChannelCreated}
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
          <div className="h-12 border-b border-[#1f2023] px-4 flex items-center justify-between font-bold text-discord-textHeader shadow-sm hover:bg-[#35373c] transition cursor-pointer">
            <span className="truncate">{guild.name}</span>
            <div className="flex items-center space-x-1">
              {onOpenCreateCategory && (
                <button
                  type="button"
                  data-testid="sidebar-create-category-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCreateCategory();
                  }}
                  className="p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
                  title="创建分类"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              )}
              {onOpenCreateChannel && (
                <button
                  type="button"
                  data-testid="sidebar-create-channel-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenCreateChannel();
                  }}
                  className="p-1 rounded hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
                  title="创建频道"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
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
          </div>
        </ServerContextMenu>
      )}

      {/* 频道列表与分类容器 */}
      {guild && (
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
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
              <div className="space-y-[2px]" data-testid="uncategorized-channels-group">
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
                    onToggleCollapse={() => toggleCategoryCollapse(category.id)}
                    onOpenCreateChannel={() => onOpenCreateChannel?.(category)}
                    onEditCategory={onEditCategory}
                    onDeleteCategory={onDeleteCategory}
                  >
                    {!isCollapsed && (
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
                              participants={getChannelParticipants(channel.id)}
                              canManageChannels={canManageChannels}
                              currentUser={currentUser}
                              isSpeaking={isSpeaking}
                              activeSpeakers={activeSpeakers}
                              peerLatencies={peerLatencies}
                              t={t}
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
                            />
                          ))}
                        </div>
                      </SortableContext>
                    )}
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
                  <Volume2 className="w-4 h-4 mr-1.5 text-discord-green flex-shrink-0" />
                ) : activeItem.channel.isE2EE ? (
                  <Lock className="w-4 h-4 mr-1.5 text-discord-green flex-shrink-0" />
                ) : (
                  <Hash className="w-4 h-4 mr-1.5 text-discord-textMuted flex-shrink-0" />
                )}
                <span className="truncate">{activeItem.channel.name}</span>
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
        <div className="bg-[#202225] border-b border-[#2b2d31] p-2.5 flex flex-col space-y-2 animate-fadeIn">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={
                voiceConnectionStatus === "connecting"
                  ? undefined
                  : onOpenNetworkStats
              }
              className={`flex items-center space-x-2 text-left p-1 -ml-1 rounded-lg transition group max-w-[calc(100%-36px)] ${
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
                const isBroadcasting = p2pStreamManager.isBroadcasting(activeVoiceChannel?.id);
                const isWatching = !!p2pStreamManager.getRemoteStream();
                const videoMode = isBroadcasting
                  ? `${t("voice:videoStatusBroadcasting")} (${p2pStreamManager.getTargetVideoCodec().toUpperCase()})`
                  : isWatching
                    ? `${t("voice:videoStatusWatching")} (P2P)`
                    : t("voice:videoStatusIdle");
                return `[${t("voice:tabAudio")}] ${audioMode}\n[${t("voice:tabVideo")}] ${videoMode}\n${t("voice:statsHUD")} (Esc / Click)`;
              })()}
            >
              {voiceConnectionStatus === "connecting" ? (
                <Loader2 className="w-4 h-4 text-[#faa61a] animate-spin flex-shrink-0" />
              ) : voiceConnectionStatus === "reconnecting" ? (
                <Loader2 className="w-4 h-4 text-discord-danger animate-spin flex-shrink-0" />
              ) : (
                <Signal
                  className={`w-4 h-4 ${qualityColor} animate-pulse flex-shrink-0`}
                />
              )}
              <div className="min-w-0">
                <div className="flex items-center space-x-1.5 leading-tight">
                  <span
                    className={`text-xs font-bold ${
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
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#1e1f22] border border-[#2b2d31] ${
                      voiceConnectionStatus === "connecting"
                        ? "text-[#faa61a]"
                        : qualityColor
                    } group-hover:border-discord-brand transition-colors`}
                  >
                    {(() => {
                      if (voiceConnectionStatus === "connecting") return "--ms";
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
                      return finalRtt === null ? "--ms" : `${finalRtt}ms`;
                    })()}
                  </span>
                </div>
                <div className="text-[11px] text-discord-textMuted truncate max-w-[130px]">
                  {activeVoiceChannel.name} /{" "}
                  {(() => {
                    if (voiceConnectionStatus === "connecting") {
                      return t("voice:handshaking");
                    }
                    if (voiceConnectionStatus === "reconnecting") {
                      return t("voice:networkReconnecting");
                    }
                    const activeSpeakerId =
                      activeSpeakers && activeSpeakers.length > 0
                        ? activeSpeakers[0]
                        : null;
                    const meshMetrics =
                      voiceMeshManager.getActiveSpeakerOrMedianLatency(
                        activeSpeakerId,
                      );
                    if (meshMetrics.isSpeaker) {
                      return t("voice:activeSpeakerLatency");
                    }
                    if (peerLatencies.size > 0) {
                      return t("voice:medianLatency");
                    }
                    return "LiveKit SFU";
                  })()}
                </div>
              </div>
            </button>
            <button
              onClick={onLeaveVoiceChannel}
              className="p-1.5 text-discord-textMuted hover:text-discord-danger hover:bg-[#35373c] rounded transition flex-shrink-0"
              title={
                voiceConnectionStatus === "connecting" ? "取消连接" : "断开连接"
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
              title={isVideoEnabled ? "关闭摄像头" : "开启摄像头"}
            >
              {isVideoEnabled ? (
                <VideoOff className="w-3.5 h-3.5" />
              ) : (
                <Video className="w-3.5 h-3.5" />
              )}
              <span>{isVideoEnabled ? "关视频" : "开视频"}</span>
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
              title={isScreenSharing ? "停止直播" : "直播分享"}
            >
              {isScreenSharing ? (
                <ScreenShareOff className="w-3.5 h-3.5" />
              ) : (
                <ScreenShare className="w-3.5 h-3.5" />
              )}
              <span>{isScreenSharing ? "停止直播" : "直播分享"}</span>
            </button>
            <div
              className={`flex items-center space-x-1 px-1.5 py-1 rounded text-[11px] ${
                isNoiseSuppressionEnabled
                  ? "text-discord-green bg-[#23a55a22]"
                  : "text-discord-textMuted"
              }`}
              title={
                audioEngine.config.noiseSuppressionMode === "dtln"
                  ? "DTLN 深度消键盘音降噪激活中"
                  : isNoiseSuppressionEnabled
                    ? "RNNoise AI 智能降噪激活中"
                    : "AI 降噪已关闭"
              }
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {audioEngine.config.noiseSuppressionMode === "dtln"
                  ? "DTLN"
                  : "AI"}
              </span>
            </div>
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
                语音已转移至【{voiceTransferNotice.targetPlatform || "其他设备"}
                】
              </span>
            </div>
            {onDismissVoiceTransferNotice && (
              <button
                type="button"
                data-testid="dismiss-transfer-notice-btn"
                onClick={onDismissVoiceTransferNotice}
                className="text-discord-textMuted hover:text-white p-0.5 rounded transition cursor-pointer"
                title="忽略提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="text-[11px] text-discord-textMuted leading-tight">
            当前账号已在另一端连接频道
            {voiceTransferNotice.previousChannel
              ? ` #${voiceTransferNotice.previousChannel.name}`
              : ""}
            。
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
              <span>在此设备重新连接</span>
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
                {gatewayPing !== null && (
                  <span
                    data-testid="gateway-ping-badge"
                    className="font-mono text-[9px] text-[#23a55a] opacity-80"
                    title={`WebSocket 信令网关延迟: ${gatewayPing}ms`}
                  >
                    • {gatewayPing}ms
                  </span>
                )}
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
            title={isMuted ? t("voice:unmuteMic") : t("voice:muteMic")}
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
            title={isDeafened ? t("voice:undeafen") : t("voice:deafen")}
          >
            <Headphones className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-testid="user-settings-gear-btn"
            onClick={onOpenSettings}
            className="p-1.5 rounded hover:bg-discord-hover hover:text-discord-textNormal transition cursor-pointer"
            title={t("voice:deviceSettings")}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
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
  const {
    attributes: { role: _role, tabIndex: _tabIndex, ...sortableAttributes },
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `cat_${category.id}`,
    data: { type: "category", category },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0.25 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
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
          {...sortableAttributes}
          {...listeners}
          className="text-[11px] font-bold text-discord-textMuted uppercase tracking-wider px-2 py-1 mb-0.5 flex items-center justify-between group cursor-pointer hover:text-discord-textNormal rounded"
          data-testid={`category-header-${category.id}`}
        >
          <div
            onClick={onToggleCollapse}
            className="flex items-center space-x-1 min-w-0 flex-1"
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 transition-transform" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 transition-transform" />
            )}
            <span className="truncate">{category.name}</span>
          </div>
          {onOpenCreateChannel && (
            <button
              type="button"
              data-testid={`create-channel-in-category-${category.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenCreateChannel();
              }}
              className="p-0.5 opacity-70 hover:opacity-100 hover:text-discord-textHeader transition text-discord-textMuted"
              title="创建频道"
              aria-label={`在【${category.name}】中创建频道`}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </CategoryContextMenu>
      {children}
    </div>
  );
};
