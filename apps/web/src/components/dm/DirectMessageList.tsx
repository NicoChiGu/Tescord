import React, { useState } from "react";
import { Channel, User, UserStatus, Guild } from "@tescord/types";
import {
  Plus,
  X,
  MessageSquare,
  Search,
  Loader2,
  Users,
  Pin,
  BellOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { usePresenceStore } from "../../stores/usePresenceStore.js";
import { useFriendStore } from "../../stores/useFriendStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { UserContextMenu } from "../context-menu/UserContextMenu.js";

interface DirectMessageListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  currentUser: User;
  guilds?: Guild[];
  isFriendsActive?: boolean;
  onSelectFriends?: () => void;
  onSelectChannel: (channel: Channel) => void;
  onCloseChannel: (channelId: string) => void;
  onChannelCreated?: (channel: Channel) => void;
  onStartCall?: (userId: string) => void;
  onOpenProfile?: (userId: string) => void;
}

export const DirectMessageList: React.FC<DirectMessageListProps> = ({
  channels,
  selectedChannelId,
  currentUser,
  guilds,
  isFriendsActive,
  onSelectFriends,
  onSelectChannel,
  onCloseChannel,
  onChannelCreated,
  onStartCall,
  onOpenProfile,
}) => {
  const { t } = useTranslation(["chat", "common"]);
  const { getAuthHeaders } = useAuthStore();
  const presences = usePresenceStore((s) => s.presences);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchUsername, setSearchUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { pinnedDMs, userNotes, isUserMuted } = useSettingsStore();

  const sortedChannels = React.useMemo(() => {
    return [...channels].sort((a, b) => {
      const aPinned = pinnedDMs?.includes(a.id) ? 1 : 0;
      const bPinned = pinnedDMs?.includes(b.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return 0;
    });
  }, [channels, pinnedDMs]);

  // 获取状态颜色
  const getStatusColor = (status?: UserStatus) => {
    switch (status) {
      case "ONLINE":
        return "bg-discord-green";
      case "IDLE":
        return "bg-amber-400";
      case "DND":
        return "bg-rose-500";
      default:
        return "bg-zinc-500";
    }
  };

  // 发起新私信
  const handleStartDM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchUsername.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE}/api/users/@me/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ recipientId: searchUsername.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error ||
            t("chat:dm.createModal.errorFailed", {
              defaultValue: "发起私信会话失败",
            }),
        );
      }

      const newChannel: Channel = await res.json();
      setIsCreateOpen(false);
      setSearchUsername("");
      onChannelCreated?.(newChannel);
      onSelectChannel(newChannel);
    } catch (err: any) {
      setCreateError(
        err.message ||
          t("chat:dm.createModal.errorServerRequired", {
            defaultValue: "无法发起私信，需双方同属同一服务器",
          }),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-discord-channelList select-none">
      {/* 顶部标题栏与发起私信按钮 */}
      <div className="h-12 border-b border-[#1f2023] px-4 flex items-center justify-between shadow-sm">
        <span className="font-bold text-discord-textHeader text-sm">
          {t("chat:dm.title", { defaultValue: "私信列表" })}
        </span>
        <button
          onClick={() => {
            setIsCreateOpen(true);
            setCreateError(null);
          }}
          className="p-1 rounded hover:bg-[#35373c] text-discord-textMuted hover:text-white transition"
          title={t("chat:dm.createDM", { defaultValue: "发起私信" })}
          data-testid="create-dm-btn"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {/* 好友主页入口 */}
        <button
          onClick={onSelectFriends}
          className={`w-full flex items-center justify-between px-2.5 py-2 mb-2 rounded-md font-medium text-sm transition ${
            isFriendsActive
              ? "bg-[#35373c] text-white"
              : "text-discord-textMuted hover:bg-[#35373c]/60 hover:text-discord-textHeader"
          }`}
          data-testid="friends-tab-btn"
        >
          <div className="flex items-center space-x-3">
            <Users className="w-5 h-5" />
            <span>{t("chat:dm.friendsTab", { defaultValue: "好友" })}</span>
          </div>
          {useFriendStore.getState().getPendingCount() > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] font-bold bg-[#f23f43] text-white rounded-full">
              {useFriendStore.getState().getPendingCount()}
            </span>
          )}
        </button>

        <div className="px-2 pb-1 text-[11px] font-bold text-discord-textMuted uppercase tracking-wider">
          {t("chat:dm.sectionHeader", { defaultValue: "直接消息" })}
        </div>

        {sortedChannels.map((channel) => {
          const otherUser = channel.recipients?.find(
            (r) => r.id !== currentUser.id,
          );
          const realtimePresence = otherUser
            ? presences[otherUser.id]
            : undefined;
          const isSelected = selectedChannelId === channel.id;
          const originalName = otherUser
            ? otherUser.displayName ||
              (otherUser.username.includes("#")
                ? otherUser.username.split("#")[0]
                : otherUser.username)
            : channel.name;
          const note = otherUser ? userNotes[otherUser.id] : undefined;
          const displayName = note || originalName;
          const status =
            realtimePresence?.status || otherUser?.status || "OFFLINE";
          const customStatus =
            realtimePresence?.customStatus !== undefined
              ? realtimePresence.customStatus
              : otherUser?.customStatus;
          const unread = channel.unreadCount || 0;
          const isPinned = pinnedDMs?.includes(channel.id) || false;
          const isMuted = otherUser ? isUserMuted(otherUser.id) : false;

          return (
            <UserContextMenu
              key={channel.id}
              targetUser={
                otherUser || { id: channel.id, username: channel.name }
              }
              channelId={channel.id}
              guilds={guilds}
              onStartCall={onStartCall}
              onOpenProfile={onOpenProfile}
              onSendMessage={() => onSelectChannel(channel)}
            >
              <div
                onClick={() => onSelectChannel(channel)}
                className={`group relative flex items-center justify-between px-2 py-2 rounded-md cursor-pointer transition select-none ${
                  isSelected
                    ? "bg-[#35373c] text-white"
                    : "text-discord-textMuted hover:bg-[#35373c]/60 hover:text-discord-textHeader"
                }`}
                data-testid={`dm-item-${channel.id}`}
              >
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  {/* 头像 + 在线指示灯 */}
                  <div className="relative flex-shrink-0">
                    {otherUser?.avatarUrl ? (
                      <img
                        src={otherUser.avatarUrl}
                        alt={displayName}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-xs">
                        {displayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-discord-channelList ${getStatusColor(
                        status,
                      )}`}
                    />
                  </div>

                  {/* 昵称与最后一条消息预览 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-1.5">
                      <p className="font-semibold text-sm truncate text-white">
                        {displayName}
                      </p>
                      {note && (
                        <span className="text-[11px] text-discord-textMuted truncate">
                          ({originalName})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-discord-textMuted truncate">
                      {channel.lastMessage
                        ? channel.lastMessage.content
                        : customStatus ||
                          t("chat:dm.clickToChat", {
                            defaultValue: "点击开始私信沟通",
                          })}
                    </p>
                  </div>
                </div>

                {/* 右侧置顶、静音、未读徽标或关闭 X 按钮 */}
                <div className="flex items-center space-x-1 pl-2">
                  {isPinned && (
                    <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20 shrink-0" />
                  )}
                  {isMuted && (
                    <BellOff className="w-3.5 h-3.5 text-discord-textMuted shrink-0" />
                  )}
                  {unread > 0 && (
                    <span className="bg-[#f23f43] text-white text-[10px] font-bold rounded-full px-1.5 py-0.2 group-hover:hidden">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseChannel(channel.id);
                    }}
                    className="hidden group-hover:flex p-1 rounded hover:bg-[#404249] text-discord-textMuted hover:text-white transition"
                    title={t("chat:dm.closeDM", { defaultValue: "关闭私信" })}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </UserContextMenu>
          );
        })}

        {channels.length === 0 && (
          <div className="text-center py-10 px-4 text-discord-textMuted text-xs space-y-2">
            <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
            <p>
              {t("chat:dm.emptyActiveTitle", {
                defaultValue: "暂无活跃私信会话",
              })}
            </p>
            <p className="text-[11px] text-[#949ba4]">
              {t("chat:dm.emptyActiveDesc", {
                defaultValue: "点击右上角 + 或在服务器成员列表中右键发起私信",
              })}
            </p>
          </div>
        )}
      </div>

      {/* 发起私信弹窗 */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#313338] p-5 rounded-xl border border-[#3f4147] max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-white text-base">
                {t("chat:dm.createModal.title", {
                  defaultValue: "发起新的私信会话",
                })}
              </h4>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-discord-textMuted hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 p-2 rounded border border-rose-500/20">
                {createError}
              </p>
            )}

            <form onSubmit={handleStartDM} className="space-y-3">
              <div>
                <label className="text-xs text-discord-textMuted block mb-1">
                  {t("chat:dm.createModal.inputLabel", {
                    defaultValue: "输入对方用户名 (需同属同一服务器)",
                  })}
                </label>
                <div className="flex items-center bg-[#1e1f22] px-3 py-2 rounded border border-[#3f4147]">
                  <Search className="w-4 h-4 text-discord-textMuted mr-2" />
                  <input
                    type="text"
                    data-testid="create-dm-input"
                    placeholder={t("chat:dm.createModal.placeholder", {
                      defaultValue: "用户名，例如: Jackey",
                    })}
                    value={searchUsername}
                    onChange={(e) => setSearchUsername(e.target.value)}
                    className="bg-transparent text-white text-sm outline-none flex-1 placeholder:text-discord-textMuted"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 text-xs text-discord-textMuted hover:text-white"
                >
                  {t("common:cancel", { defaultValue: "取消" })}
                </button>
                <button
                  type="submit"
                  disabled={creating || !searchUsername.trim()}
                  className="px-4 py-1.5 bg-discord-brand hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold rounded flex items-center space-x-1"
                >
                  {creating && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  )}
                  <span>
                    {t("chat:dm.createModal.submit", {
                      defaultValue: "建立私信",
                    })}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
