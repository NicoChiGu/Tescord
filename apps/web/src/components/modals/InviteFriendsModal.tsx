import React, { useState, useEffect, useMemo } from "react";
import { X, Search, Check, Copy, Settings, Loader2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Guild, User, Relationship } from "@tescord/types";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { useFriendStore } from "../../stores/useFriendStore.js";
import { usePresenceStore } from "../../stores/usePresenceStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { toast } from "../../stores/useToastStore.js";
import { InviteSettingsModal, InviteOptions } from "./InviteSettingsModal.js";

interface InviteFriendsModalProps {
  isOpen: boolean;
  guild: Guild;
  onClose: () => void;
}

export const InviteFriendsModal: React.FC<InviteFriendsModalProps> = ({
  isOpen,
  guild,
  onClose,
}) => {
  const { t } = useTranslation(["modals", "common", "chat"]);
  const { getAuthHeaders } = useAuthStore();
  const { relationships, fetchRelationships } = useFriendStore();
  const presences = usePresenceStore((s) => s.presences);
  const userNotes = useSettingsStore((s) => s.userNotes);

  const [inviteCode, setInviteCode] = useState<string>("");
  const [inviteOptions, setInviteOptions] = useState<InviteOptions>({
    maxAge: 604800, // 默认 7 天
    maxUses: 0,
    isTemporary: false,
  });
  const [loadingCode, setLoadingCode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState<Record<string, boolean>>({});
  const [sendingInvite, setSendingInvite] = useState<Record<string, boolean>>(
    {},
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 初始化拉取或创建邀请链接
  const generateOrFetchInvite = async (opts: InviteOptions) => {
    try {
      setLoadingCode(true);
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          maxAge: opts.maxAge,
          maxUses: opts.maxUses,
          isTemporary: opts.isTemporary,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setInviteCode(data.code);
        setInviteOptions(opts);
      }
    } catch (err) {
      console.error("Failed to generate invite:", err);
    } finally {
      setLoadingCode(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRelationships();
      generateOrFetchInvite(inviteOptions);
      setSearchQuery("");
      setCopied(false);
    }
  }, [isOpen, guild.id]);

  const fullInviteUrl = useMemo(() => {
    if (!inviteCode) return "";
    const origin =
      typeof window !== "undefined" && window.location.origin
        ? window.location.origin
        : "https://tescord.com";
    return `${origin}/invite/${inviteCode}`;
  }, [inviteCode]);

  // 好友列表与搜索过滤
  const friendList = useMemo(() => {
    // 过滤出双向好友
    const friends = relationships
      .map((r) => r.targetUser)
      .filter((u): u is User => !!u);

    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter((u) => {
      const note = userNotes?.[u.id];
      const name = u.displayName || u.username;
      return (
        name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (note && note.toLowerCase().includes(q))
      );
    });
  }, [relationships, searchQuery, userNotes]);

  // 复制邀请链接
  const handleCopy = async () => {
    if (!fullInviteUrl) return;
    try {
      await navigator.clipboard.writeText(fullInviteUrl);
      setCopied(true);
      toast.success(
        t("modals:inviteFriends.linkCopied", {
          defaultValue: "邀请链接已复制到剪贴板！",
        }),
      );
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error("Failed to copy invite:", err);
    }
  };

  // 通过私信向好友发送邀请卡片
  const handleSendInviteToFriend = async (friend: User) => {
    if (invitedUsers[friend.id] || sendingInvite[friend.id] || !fullInviteUrl)
      return;
    try {
      setSendingInvite((prev) => ({ ...prev, [friend.id]: true }));
      // 1. 获取或创建 DM 频道
      const dmRes = await fetch(`${API_BASE}/api/users/@me/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ recipientId: friend.id }),
      });
      if (!dmRes.ok) throw new Error("无法创建私信会话");
      const dmChannel = await dmRes.json();

      // 2. 发送邀请链接消息
      const msgRes = await fetch(
        `${API_BASE}/api/channels/${dmChannel.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({
            content: fullInviteUrl,
          }),
        },
      );
      if (!msgRes.ok) throw new Error("发送邀请私信失败");

      // 3. 标记为已邀请
      setInvitedUsers((prev) => ({ ...prev, [friend.id]: true }));
      toast.success(
        t("modals:inviteFriends.sentSuccess", {
          name: friend.displayName || friend.username,
          defaultValue: `已成功向 ${friend.displayName || friend.username} 发送服务器邀请！`,
        }),
      );
    } catch (err: any) {
      toast.error(err.message || "发送邀请失败");
    } finally {
      setSendingInvite((prev) => ({ ...prev, [friend.id]: false }));
    }
  };

  // 计算过期时间描述
  const getExpirationText = () => {
    if (inviteOptions.maxAge === 0) {
      return t("modals:inviteFriends.expireNever", {
        defaultValue: "您的邀請連結將永不失效。",
      });
    }
    const days = Math.round(inviteOptions.maxAge / 86400);
    if (days >= 1) {
      return t("modals:inviteFriends.expireDays", {
        count: days,
        defaultValue: `您的邀請連結將在 ${days} 天後過期。`,
      });
    }
    const hours = Math.round(inviteOptions.maxAge / 3600);
    return t("modals:inviteFriends.expireHours", {
      count: hours,
      defaultValue: `您的邀請連結將在 ${hours} 小時後過期。`,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div
          className="bg-[#313338] w-full max-w-md rounded-lg overflow-hidden shadow-2xl border border-[#1f2023] animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 顶部标题栏 */}
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <h3 className="text-white text-base font-bold tracking-wide truncate pr-2">
              {t("modals:inviteFriends.title", {
                serverName: guild.name,
                defaultValue: `邀請好友至 ${guild.name}`,
              })}
            </h3>
            <button
              onClick={onClose}
              className="text-discord-textMuted hover:text-white transition shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="px-5 py-2">
            <div className="flex items-center bg-[#1e1f22] rounded-md px-3 py-2 border border-transparent focus-within:border-discord-brand transition">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("modals:inviteFriends.searchPlaceholder", {
                  defaultValue: "搜尋好友",
                })}
                className="bg-transparent text-sm text-white placeholder-discord-textMuted focus:outline-none flex-1 min-w-0"
              />
              <Search className="w-4 h-4 text-discord-textMuted ml-2 shrink-0" />
            </div>
          </div>

          {/* 好友列表区域 */}
          <div className="flex-1 overflow-y-auto px-5 py-2 divide-y divide-[#1f2023]/60 min-h-[160px] max-h-[320px]">
            {friendList.length > 0 ? (
              friendList.map((friend) => {
                const presence = presences[friend.id];
                const isOnline = presence?.status === "ONLINE";
                const isIdle = presence?.status === "IDLE";
                const isDnd = presence?.status === "DND";
                const note = userNotes?.[friend.id];
                const originalName = friend.displayName || friend.username;
                const displayName = note || originalName;
                const isInvited = !!invitedUsers[friend.id];
                const isSending = !!sendingInvite[friend.id];

                return (
                  <div
                    key={friend.id}
                    className="flex items-center justify-between py-2.5 group"
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1 pr-3">
                      {/* 头像与在线绿点 */}
                      <div className="relative shrink-0">
                        {friend.avatarUrl ? (
                          <img
                            src={friend.avatarUrl}
                            alt={displayName}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-xs">
                            {displayName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#313338] ${
                            isOnline
                              ? "bg-discord-green"
                              : isIdle
                                ? "bg-amber-400"
                                : isDnd
                                  ? "bg-rose-500"
                                  : "bg-zinc-500"
                          }`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-white text-sm font-semibold truncate">
                            {displayName}
                          </span>
                          {note && (
                            <span className="text-xs text-discord-textMuted truncate">
                              ({originalName})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-discord-textMuted font-mono truncate">
                          {friend.username.startsWith("@")
                            ? friend.username
                            : `@${friend.username}`}
                        </div>
                      </div>
                    </div>

                    {/* 邀请 / 已邀请 按钮 */}
                    <div className="shrink-0">
                      {isInvited ? (
                        <button
                          disabled
                          className="px-4 py-1.5 rounded border border-[#23a55a]/60 text-[#23a55a] text-xs font-semibold flex items-center space-x-1 bg-transparent cursor-default"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>
                            {t("modals:inviteFriends.invited", {
                              defaultValue: "已邀請",
                            })}
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSendInviteToFriend(friend)}
                          disabled={isSending || loadingCode}
                          className="px-4 py-1.5 rounded border border-discord-brand hover:bg-discord-brand text-white text-xs font-semibold transition flex items-center space-x-1"
                        >
                          {isSending && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          <span>
                            {t("modals:inviteFriends.invite", {
                              defaultValue: "邀請",
                            })}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-10 text-center text-xs text-discord-textMuted space-y-1">
                <Users className="w-8 h-8 mx-auto opacity-30" />
                <p>
                  {searchQuery
                    ? t("modals:inviteFriends.noSearchResults", {
                        defaultValue: "找不到相符的好友",
                      })
                    : t("modals:inviteFriends.noFriends", {
                        defaultValue: "暂无好友，你可以通过链接邀请其他人加入",
                      })}
                </p>
              </div>
            )}
          </div>

          {/* 底部链接与设置区 */}
          <div className="bg-[#2b2d31] p-5 border-t border-[#1f2023] space-y-3">
            <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider">
              {t("modals:inviteFriends.sendLinkPrompt", {
                defaultValue: "或傳送伺服器邀請連結給好友",
              })}
            </div>

            {/* 链接输入框 + 复制按钮 */}
            <div className="flex items-center bg-[#1e1f22] rounded-md p-1 pl-3 border border-[#1f2023] focus-within:border-discord-brand transition">
              <input
                type="text"
                readOnly
                value={
                  loadingCode
                    ? t("common:loading", { defaultValue: "正在生成..." })
                    : fullInviteUrl
                }
                className="bg-transparent text-sm text-discord-textNormal focus:outline-none flex-1 font-mono truncate select-all"
              />
              <button
                onClick={handleCopy}
                disabled={loadingCode || !fullInviteUrl}
                className={`ml-2 px-4 py-2 rounded text-xs font-semibold transition text-white shrink-0 ${
                  copied
                    ? "bg-[#23a55a] hover:bg-[#23a55a]/90"
                    : "bg-discord-brand hover:bg-discord-brand/90"
                }`}
              >
                {copied
                  ? t("common:copied", { defaultValue: "已複製" })
                  : t("common:copy", { defaultValue: "複製" })}
              </button>
            </div>

            {/* 过期时间提示与编辑超链接 */}
            <div className="flex items-center justify-between text-xs text-discord-textMuted pt-1">
              <span className="truncate pr-2">{getExpirationText()}</span>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="text-discord-brand hover:underline flex items-center space-x-1 shrink-0 font-medium"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>
                  {t("modals:inviteFriends.editLink", {
                    defaultValue: "編輯邀請連結",
                  })}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 邀请链接配置子 Modal (图 2) */}
      <InviteSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentOptions={inviteOptions}
        onGenerate={generateOrFetchInvite}
      />
    </>
  );
};
