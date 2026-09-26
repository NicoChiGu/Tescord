import React, { useState, useEffect } from "react";
import { User, Relationship } from "@tescord/types";
import {
  Users,
  MessageSquare,
  Phone,
  MoreVertical,
  Check,
  X,
  Search,
  Loader2,
  UserPlus,
  Trash2,
  Menu,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Guild } from "@tescord/types";
import { useFriendStore, FriendTab } from "../../stores/useFriendStore.js";
import { usePresenceStore } from "../../stores/usePresenceStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { UserContextMenu } from "../context-menu/UserContextMenu.js";

interface FriendsDashboardProps {
  currentUser: User;
  guilds?: Guild[];
  onStartDM: (targetUserId: string) => void;
  onStartCall?: (targetUserId: string) => void;
  onOpenProfile?: (userId: string) => void;
  onOpenServerMenu?: () => void;
}

export const FriendsDashboard: React.FC<FriendsDashboardProps> = ({
  currentUser,
  guilds,
  onStartDM,
  onStartCall,
  onOpenProfile,
  onOpenServerMenu,
}) => {
  const { t } = useTranslation(["chat", "common"]);

  const {
    relationships,
    activeTab,
    isLoading,
    setActiveTab,
    fetchRelationships,
    sendFriendRequest,
    acceptFriendRequest,
    removeRelationship,
    getPendingCount,
    getOnlineFriends,
    getAllFriends,
    getPendingIncoming,
    getPendingOutgoing,
  } = useFriendStore();

  const { userNotes, isUserMuted } = useSettingsStore();

  const presences = usePresenceStore((s) => s.presences);

  // 本地添加好友表单状态
  const [addIdentifier, setAddIdentifier] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addSuccessMsg, setAddSuccessMsg] = useState<string | null>(null);
  const [addErrorMsg, setAddErrorMsg] = useState<string | null>(null);

  // 搜索过滤好友
  const [filterText, setFilterText] = useState("");

  // 操作菜单弹出控制
  const [actionMenuUserId, setActionMenuUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships]);

  const pendingCount = getPendingCount();
  const onlineFriends = getOnlineFriends();
  const allFriends = getAllFriends();
  const pendingIncoming = getPendingIncoming();
  const pendingOutgoing = getPendingOutgoing();

  // 添加好友提交
  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addIdentifier.trim();
    setAddSuccessMsg(null);
    setAddErrorMsg(null);

    if (!trimmed) {
      setAddErrorMsg(
        t("chat:friends.errors.inputEmpty", {
          defaultValue: "请输入对方的用户识别码",
        }),
      );
      return;
    }

    // 格式前端校验
    if (!trimmed.includes("#")) {
      setAddErrorMsg(
        t("chat:friends.errors.missingTag", {
          defaultValue:
            "缺少数字标签！请输入完整的用户识别码，例如：用户名#12345",
        }),
      );
      return;
    }
    if (trimmed.startsWith("#")) {
      setAddErrorMsg(
        t("chat:friends.errors.missingUsername", {
          defaultValue:
            "缺少用户名称！请输入完整的用户识别码，例如：用户名#12345",
        }),
      );
      return;
    }
    if (!/^.+#[0-9]{5}$/.test(trimmed)) {
      setAddErrorMsg(
        t("chat:friends.errors.invalidFormat", {
          defaultValue:
            "识别码格式不正确，标签必须为 5 位数字，例如：Nick#12345",
        }),
      );
      return;
    }

    setAddLoading(true);
    try {
      const rel = await sendFriendRequest(trimmed);
      if (rel.type === "FRIEND") {
        setAddSuccessMsg(
          t("chat:friends.success.mutualFriend", {
            name: trimmed,
            defaultValue: `太棒了！你与 ${trimmed} 互相发送了申请，已直接成为好友！`,
          }),
        );
      } else {
        setAddSuccessMsg(
          t("chat:friends.success.requestSent", {
            name: trimmed,
            defaultValue: `好友申请已成功发送给 ${trimmed}！`,
          }),
        );
      }
      setAddIdentifier("");
    } catch (err: any) {
      setAddErrorMsg(
        err.message ||
          t("chat:friends.errors.sendFailed", {
            defaultValue: "发送申请失败，请稍后重试",
          }),
      );
    } finally {
      setAddLoading(false);
    }
  };

  // 接受申请
  const handleAccept = async (targetUserId: string) => {
    try {
      await acceptFriendRequest(targetUserId);
    } catch (err: any) {
      alert(
        err.message ||
          t("chat:friends.errors.acceptFailed", {
            defaultValue: "接受申请失败",
          }),
      );
    }
  };

  // 拒绝 / 取消 / 删除好友
  const handleRemove = async (targetUserId: string) => {
    try {
      await removeRelationship(targetUserId);
      setActionMenuUserId(null);
    } catch (err: any) {
      alert(
        err.message ||
          t("chat:friends.errors.actionFailed", {
            defaultValue: "操作失败",
          }),
      );
    }
  };

  // 渲染好友卡片项
  const renderFriendRow = (rel: Relationship) => {
    const friend = rel.targetUser;
    if (!friend) return null;

    const realtimePresence = presences[friend.id];
    const status = realtimePresence?.status || friend.status || "OFFLINE";
    const customStatus =
      realtimePresence?.customStatus !== undefined
        ? realtimePresence.customStatus
        : friend.customStatus;

    // 备注与名称分层：若有备注优先展示备注，副标题展示 @username
    const note = userNotes?.[friend.id];
    const originalName =
      friend.displayName ||
      (friend.username.includes("#")
        ? friend.username.split("#")[0]
        : friend.username);
    const displayMain = note || originalName;
    const displaySub = friend.username.startsWith("@")
      ? friend.username
      : `@${friend.username}`;
    const muted = isUserMuted(friend.id);

    const getStatusDotColor = (st: string) => {
      switch (st) {
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

    return (
      <UserContextMenu
        key={rel.id}
        targetUser={friend}
        guilds={guilds}
        onStartCall={onStartCall}
        onOpenProfile={onOpenProfile}
        onSendMessage={() => onStartDM(friend.id)}
      >
        <div
          onDoubleClick={() => onStartDM(friend.id)}
          className="group flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#35373c]/50 transition border-t border-[#1f2023]/40 first:border-none cursor-pointer"
        >
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            {/* 头像 + 状态灯 */}
            <div className="relative flex-shrink-0">
              {friend.avatarUrl ? (
                <img
                  src={friend.avatarUrl}
                  alt={displayMain}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-sm">
                  {displayMain.slice(0, 2).toUpperCase()}
                </div>
              )}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-discord-chat ${getStatusDotColor(
                  status,
                )}`}
              />
            </div>

            {/* 名字分层展示 */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-white text-sm truncate">
                  {displayMain}
                </span>
                {note && (
                  <span className="text-xs text-discord-textMuted truncate">
                    ({originalName})
                  </span>
                )}
                <span className="text-xs text-discord-textMuted font-mono">
                  {displaySub}
                </span>
                {muted && (
                  <span className="text-[10px] bg-[#1e1f22] text-discord-textMuted px-1.5 py-0.5 rounded">
                    {t("common:muted", { defaultValue: "已静音" })}
                  </span>
                )}
              </div>
              {customStatus ? (
                <div className="text-xs text-discord-textMuted truncate mt-0.5">
                  {customStatus}
                </div>
              ) : (
                <div className="text-xs text-discord-textMuted capitalize mt-0.5">
                  {t(`common:status.${status.toLowerCase()}`, {
                    defaultValue: status.toLowerCase(),
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 快捷操作区 */}
          <div className="flex items-center space-x-2 pl-3 relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartDM(friend.id);
              }}
              className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#35373c] text-discord-textMuted hover:text-white flex items-center justify-center transition shadow-sm"
              title={t("chat:friends.actions.sendMessage", {
                defaultValue: "发送消息",
              })}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            {onStartCall && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCall(friend.id);
                }}
                className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#35373c] text-discord-textMuted hover:text-white flex items-center justify-center transition shadow-sm"
                title={t("chat:friends.actions.voiceCall", {
                  defaultValue: "语音呼叫",
                })}
              >
                <Phone className="w-4 h-4" />
              </button>
            )}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActionMenuUserId(
                    actionMenuUserId === friend.id ? null : friend.id,
                  );
                }}
                className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#35373c] text-discord-textMuted hover:text-white flex items-center justify-center transition shadow-sm"
                title={t("chat:friends.actions.moreOptions", {
                  defaultValue: "更多选项",
                })}
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {actionMenuUserId === friend.id && (
                <div className="absolute right-0 top-10 w-36 bg-[#111214] border border-[#232428] rounded-md shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(friend.id);
                    }}
                    className="w-full px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-500/20 flex items-center space-x-2 transition text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>
                      {t("chat:friends.actions.removeFriend", {
                        defaultValue: "删除好友",
                      })}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </UserContextMenu>
    );
  };

  // 筛选列表
  const filterList = (list: Relationship[]) => {
    if (!filterText.trim()) return list;
    const q = filterText.toLowerCase();
    return list.filter((r) => {
      const u = r.targetUser;
      if (!u) return false;
      return (
        u.username.toLowerCase().includes(q) ||
        (u.displayName && u.displayName.toLowerCase().includes(q))
      );
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-discord-chat select-none">
      {/* 顶部标签栏 */}
      <div className="min-h-12 border-b border-[#1f2023] px-3 sm:px-6 py-2 sm:py-0 flex flex-col sm:flex-row sm:items-center shadow-sm bg-discord-chat gap-2 sm:gap-0">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0 w-full">
          <div className="flex items-center gap-2 shrink-0">
            {onOpenServerMenu && (
              <button
                type="button"
                data-testid="friends-open-server-menu"
                onClick={onOpenServerMenu}
                className="md:hidden p-2 -ml-1 rounded-lg text-discord-textMuted hover:text-white hover:bg-white/10"
                aria-label="打开服务器列表"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center space-x-2 text-white font-bold text-sm">
              <Users className="w-5 h-5 text-discord-textMuted" />
              <span>{t("chat:friends.title", { defaultValue: "好友" })}</span>
            </div>
          </div>

          <div className="hidden sm:block h-4 w-[1px] bg-[#3f4147]" />

          {/* 选项卡按钮 */}
          <div className="flex items-center space-x-2 overflow-x-auto min-w-0 w-full no-scrollbar">
            <button
              onClick={() => setActiveTab("online")}
              className={`shrink-0 whitespace-nowrap px-3 py-1 text-sm font-medium rounded-md transition ${
                activeTab === "online"
                  ? "bg-[#35373c] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c]/50 hover:text-discord-textHeader"
              }`}
            >
              {t("chat:friends.tabs.online", { defaultValue: "在线" })}
            </button>
            <button
              onClick={() => setActiveTab("all")}
              className={`shrink-0 whitespace-nowrap px-3 py-1 text-sm font-medium rounded-md transition ${
                activeTab === "all"
                  ? "bg-[#35373c] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c]/50 hover:text-discord-textHeader"
              }`}
            >
              {t("chat:friends.tabs.all", { defaultValue: "全部" })}
            </button>
            <button
              onClick={() => setActiveTab("pending")}
              className={`shrink-0 whitespace-nowrap px-3 py-1 text-sm font-medium rounded-md transition relative flex items-center space-x-1.5 ${
                activeTab === "pending"
                  ? "bg-[#35373c] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c]/50 hover:text-discord-textHeader"
              }`}
            >
              <span>
                {t("chat:friends.tabs.pending", { defaultValue: "待处理" })}
              </span>
              {pendingCount > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-bold bg-[#f23f43] text-white rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("add_friend")}
              className={`shrink-0 whitespace-nowrap px-3 py-1 text-sm font-medium rounded-md transition ${
                activeTab === "add_friend"
                  ? "bg-transparent text-discord-green font-semibold"
                  : "bg-discord-green text-white hover:bg-discord-greenHover font-semibold"
              }`}
            >
              {t("chat:friends.tabs.addFriend", { defaultValue: "添加好友" })}
            </button>
          </div>
        </div>
      </div>

      {/* 主视图区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 sm:py-6">
        {/* 1. 添加好友视图 */}
        {activeTab === "add_friend" && (
          <div className="max-w-2xl">
            <h2 className="text-white text-base font-bold uppercase tracking-wide">
              {t("chat:friends.add.title", { defaultValue: "添加好友" })}
            </h2>
            <p className="text-xs text-discord-textMuted mt-1 mb-4">
              {t("chat:friends.add.desc", {
                example: "Nick#12312",
                defaultValue:
                  "你可以通过好友的完整用户唯一识别码进行搜索和添加（例如：Nick#12312，不可只输入名称或数字标签）。",
              })}
            </p>

            <form
              onSubmit={handleSendRequest}
              className={`flex items-center bg-[#1e1f22] p-3 rounded-lg border transition ${
                addErrorMsg
                  ? "border-rose-500"
                  : addSuccessMsg
                    ? "border-discord-green"
                    : "border-black/50 focus-within:border-discord-brand"
              }`}
            >
              <input
                type="text"
                value={addIdentifier}
                onChange={(e) => {
                  setAddIdentifier(e.target.value);
                  setAddErrorMsg(null);
                  setAddSuccessMsg(null);
                }}
                placeholder={t("chat:friends.add.placeholder", {
                  defaultValue: "你可以输入例如 Nick#12312",
                })}
                className="flex-1 bg-transparent text-white placeholder-zinc-500 text-sm focus:outline-none"
              />
              <button
                type="submit"
                disabled={addLoading || !addIdentifier.trim()}
                className="ml-3 px-4 py-1.5 bg-discord-brand hover:bg-discord-brand/90 disabled:opacity-50 text-white text-xs font-semibold rounded transition flex items-center space-x-1.5"
              >
                {addLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {t("chat:friends.add.submit", {
                    defaultValue: "发送好友申请",
                  })}
                </span>
              </button>
            </form>

            {addErrorMsg && (
              <div className="text-xs text-rose-400 mt-2 font-medium">
                {addErrorMsg}
              </div>
            )}
            {addSuccessMsg && (
              <div className="text-xs text-discord-green mt-2 font-medium">
                {addSuccessMsg}
              </div>
            )}

            <div className="mt-8 border-t border-[#1f2023] pt-6 flex flex-col items-center justify-center text-center opacity-60">
              <UserPlus className="w-12 h-12 text-zinc-500 mb-2" />
              <div className="text-sm font-semibold text-zinc-300">
                {t("chat:friends.add.emptyTitle", {
                  defaultValue: "结识新伙伴",
                })}
              </div>
              <div className="text-xs text-zinc-500 max-w-sm mt-1">
                {t("chat:friends.add.emptyDesc", {
                  defaultValue:
                    "成为好友后，你们将不受服务器限制，随时随地发起 1v1 即时私信、语音连麦和视频通话。",
                })}
              </div>
            </div>
          </div>
        )}

        {/* 2. 在线好友视图 */}
        {activeTab === "online" && (
          <div>
            <div className="relative mb-5">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={t("chat:friends.list.searchPlaceholder", {
                  defaultValue: "搜索好友...",
                })}
                className="w-full bg-[#1e1f22] text-white placeholder-zinc-500 text-sm px-3 py-2 rounded-md focus:outline-none pr-9"
              />
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-2.5 pointer-events-none" />
            </div>

            <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2">
              {t("chat:friends.list.onlineCount", {
                count: filterList(onlineFriends).length,
                defaultValue: `在线 — ${filterList(onlineFriends).length}`,
              })}
            </div>

            {filterList(onlineFriends).length === 0 ? (
              <div className="text-center py-16 text-discord-textMuted text-sm">
                {t("chat:friends.list.emptyOnline", {
                  defaultValue: "目前没有好友在线",
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {filterList(onlineFriends).map(renderFriendRow)}
              </div>
            )}
          </div>
        )}

        {/* 3. 全部好友视图 */}
        {activeTab === "all" && (
          <div>
            <div className="relative mb-5">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={t("chat:friends.list.searchPlaceholder", {
                  defaultValue: "搜索好友...",
                })}
                className="w-full bg-[#1e1f22] text-white placeholder-zinc-500 text-sm px-3 py-2 rounded-md focus:outline-none pr-9"
              />
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-2.5 pointer-events-none" />
            </div>

            <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-2">
              {t("chat:friends.list.allCount", {
                count: filterList(allFriends).length,
                defaultValue: `全部好友 — ${filterList(allFriends).length}`,
              })}
            </div>

            {filterList(allFriends).length === 0 ? (
              <div className="text-center py-16 text-discord-textMuted text-sm">
                {t("chat:friends.list.emptyAll", {
                  defaultValue: "暂无好友，快去“添加好友”结交新伙伴吧！",
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {filterList(allFriends).map(renderFriendRow)}
              </div>
            )}
          </div>
        )}

        {/* 4. 待处理视图 */}
        {activeTab === "pending" && (
          <div>
            <div className="text-xs font-bold text-discord-textMuted uppercase tracking-wider mb-3">
              {t("chat:friends.list.pendingCount", {
                count: pendingIncoming.length + pendingOutgoing.length,
                defaultValue: `待处理 — ${pendingIncoming.length + pendingOutgoing.length}`,
              })}
            </div>

            {pendingIncoming.length === 0 && pendingOutgoing.length === 0 ? (
              <div className="text-center py-16 text-discord-textMuted text-sm">
                {t("chat:friends.list.emptyPending", {
                  defaultValue: "没有待处理的好友申请",
                })}
              </div>
            ) : (
              <div className="space-y-6">
                {/* 收到的申请 */}
                {pendingIncoming.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      {t("chat:friends.list.incomingCount", {
                        count: pendingIncoming.length,
                        defaultValue: `收到的申请 — ${pendingIncoming.length}`,
                      })}
                    </div>
                    <div className="space-y-1">
                      {pendingIncoming.map((rel) => {
                        const target = rel.targetUser;
                        if (!target) return null;
                        const displayMain =
                          target.displayName ||
                          (target.username.includes("#")
                            ? target.username.split("#")[0]
                            : target.username);

                        return (
                          <div
                            key={rel.id}
                            className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#35373c]/50 transition border-t border-[#1f2023]/40 first:border-none"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-sm overflow-hidden">
                                {target.avatarUrl ? (
                                  <img
                                    src={target.avatarUrl}
                                    alt={displayMain}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  displayMain.slice(0, 2).toUpperCase()
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center space-x-2">
                                  <span className="font-semibold text-white text-sm truncate">
                                    {displayMain}
                                  </span>
                                  <span className="text-xs text-discord-textMuted font-mono">
                                    @{target.username}
                                  </span>
                                </div>
                                <div className="text-xs text-discord-textMuted">
                                  {t("chat:friends.list.incomingRequest", {
                                    defaultValue: "发来了好友申请",
                                  })}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => handleAccept(target.id)}
                                className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-discord-green text-discord-textMuted hover:text-white flex items-center justify-center transition"
                                title={t("chat:friends.actions.acceptRequest", {
                                  defaultValue: "接受申请",
                                })}
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleRemove(target.id)}
                                className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-rose-500 text-discord-textMuted hover:text-white flex items-center justify-center transition"
                                title={t("chat:friends.actions.rejectRequest", {
                                  defaultValue: "拒绝申请",
                                })}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 发出的申请 */}
                {pendingOutgoing.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      {t("chat:friends.list.outgoingCount", {
                        count: pendingOutgoing.length,
                        defaultValue: `发出的申请 — ${pendingOutgoing.length}`,
                      })}
                    </div>
                    <div className="space-y-1">
                      {pendingOutgoing.map((rel) => {
                        const target = rel.targetUser;
                        if (!target) return null;
                        const displayMain =
                          target.displayName ||
                          (target.username.includes("#")
                            ? target.username.split("#")[0]
                            : target.username);

                        return (
                          <div
                            key={rel.id}
                            className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#35373c]/50 transition border-t border-[#1f2023]/40 first:border-none"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-discord-brand text-white flex items-center justify-center font-bold text-sm overflow-hidden">
                                {target.avatarUrl ? (
                                  <img
                                    src={target.avatarUrl}
                                    alt={displayMain}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  displayMain.slice(0, 2).toUpperCase()
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center space-x-2">
                                  <span className="font-semibold text-white text-sm truncate">
                                    {displayMain}
                                  </span>
                                  <span className="text-xs text-discord-textMuted font-mono">
                                    @{target.username}
                                  </span>
                                </div>
                                <div className="text-xs text-discord-textMuted">
                                  {t("chat:friends.list.waitingAccept", {
                                    defaultValue: "等待对方同意",
                                  })}
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() => handleRemove(target.id)}
                              className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-rose-500 text-discord-textMuted hover:text-white flex items-center justify-center transition"
                              title={t("chat:friends.actions.cancelRequest", {
                                defaultValue: "取消申请",
                              })}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
