import React, { useState } from "react";
import { Channel, User, UserStatus } from "@tescord/types";
import { Plus, X, MessageSquare, Search, Loader2 } from "lucide-react";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { usePresenceStore } from "../../stores/usePresenceStore.js";

interface DirectMessageListProps {
  channels: Channel[];
  selectedChannelId: string | null;
  currentUser: User;
  onSelectChannel: (channel: Channel) => void;
  onCloseChannel: (channelId: string) => void;
  onChannelCreated?: (channel: Channel) => void;
}

export const DirectMessageList: React.FC<DirectMessageListProps> = ({
  channels,
  selectedChannelId,
  currentUser,
  onSelectChannel,
  onCloseChannel,
  onChannelCreated,
}) => {
  const { getAuthHeaders } = useAuthStore();
  const presences = usePresenceStore((s) => s.presences);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchUsername, setSearchUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
        throw new Error(data.error || "发起私信会话失败");
      }

      const newChannel: Channel = await res.json();
      setIsCreateOpen(false);
      setSearchUsername("");
      onChannelCreated?.(newChannel);
      onSelectChannel(newChannel);
    } catch (err: any) {
      setCreateError(err.message || "无法发起私信，需双方同属同一服务器");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-discord-channelList select-none">
      {/* 顶部标题栏与发起私信按钮 */}
      <div className="h-12 border-b border-[#1f2023] px-4 flex items-center justify-between shadow-sm">
        <span className="font-bold text-discord-textHeader text-sm">私信列表</span>
        <button
          onClick={() => {
            setIsCreateOpen(true);
            setCreateError(null);
          }}
          className="p-1 rounded hover:bg-[#35373c] text-discord-textMuted hover:text-white transition"
          title="发起私信"
          data-testid="create-dm-btn"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        <div className="px-2 pb-1 text-[11px] font-bold text-discord-textMuted uppercase tracking-wider">
          直接消息
        </div>

        {channels.map((channel) => {
          const otherUser = channel.recipients?.find(
            (r) => r.id !== currentUser.id,
          );
          const realtimePresence = otherUser ? presences[otherUser.id] : undefined;
          const isSelected = selectedChannelId === channel.id;
          const displayName = otherUser ? otherUser.username : channel.name;
          const status = realtimePresence?.status || otherUser?.status || "OFFLINE";
          const customStatus =
            realtimePresence?.customStatus !== undefined
              ? realtimePresence.customStatus
              : otherUser?.customStatus;
          const unread = channel.unreadCount || 0;

          return (
            <div
              key={channel.id}
              onClick={() => onSelectChannel(channel)}
              className={`group relative flex items-center justify-between px-2 py-2 rounded-md cursor-pointer transition ${
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
                  <p className="font-semibold text-sm truncate text-white">
                    {displayName}
                  </p>
                  <p className="text-xs text-discord-textMuted truncate">
                    {channel.lastMessage
                      ? channel.lastMessage.content
                      : customStatus || "点击开始私信沟通"}
                  </p>
                </div>
              </div>

              {/* 右侧未读徽标或关闭 X 按钮 */}
              <div className="flex items-center space-x-1 pl-2">
                {unread > 0 && (
                  <span className="bg-discord-brand text-white text-[10px] font-bold rounded-full px-1.5 py-0.2 group-hover:hidden">
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
                  title="关闭私信"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {channels.length === 0 && (
          <div className="text-center py-10 px-4 text-discord-textMuted text-xs space-y-2">
            <MessageSquare className="w-8 h-8 mx-auto opacity-30" />
            <p>暂无活跃私信会话</p>
            <p className="text-[11px] text-[#949ba4]">
              点击右上角 + 或在服务器成员列表中右键发起私信
            </p>
          </div>
        )}
      </div>

      {/* 发起私信弹窗 */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[#313338] p-5 rounded-xl border border-[#3f4147] max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-white text-base">发起新的私信会话</h4>
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
                  输入对方用户名 (需同属同一服务器)
                </label>
                <div className="flex items-center bg-[#1e1f22] px-3 py-2 rounded border border-[#3f4147]">
                  <Search className="w-4 h-4 text-discord-textMuted mr-2" />
                  <input
                    type="text"
                    data-testid="create-dm-input"
                    placeholder="用户名，例如: Jackey"
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
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating || !searchUsername.trim()}
                  className="px-4 py-1.5 bg-discord-brand hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold rounded flex items-center space-x-1"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                  <span>建立私信</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
