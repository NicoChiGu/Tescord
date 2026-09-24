import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { User, Guild, UserStatus } from "@tescord/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../ui/context-menu.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { useSettingsStore } from "../../stores/useSettingsStore.js";
import { useFriendStore } from "../../stores/useFriendStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";
import { livekitService } from "../../services/livekit.js";
import { gatewayClient } from "../../services/gateway.js";
import {
  AtSign,
  Volume2,
  VolumeX,
  ShieldAlert,
  UserX,
  Copy,
  Check,
  Settings,
  Headphones,
  Circle,
  User as UserIcon,
  Info,
  MessageSquare,
  RotateCcw,
  ScreenShareOff,
  Pin,
  PinOff,
  Phone,
  FileText,
  Bell,
  BellOff,
  UserMinus,
  Ban,
  UserPlus,
} from "lucide-react";

interface UserContextMenuProps {
  targetUser: {
    id: string;
    username: string;
    avatarUrl?: string | null;
    status?: UserStatus;
  };
  guild?: Guild | null;
  guilds?: Guild[];
  channelId?: string;
  children: React.ReactNode;
  isInVoice?: boolean;
  isStreaming?: boolean;
  onStopScreenShare?: () => void;
  onMention?: (username: string) => void;
  onOpenProfile?: (userId: string) => void;
  onSendMessage?: (userId: string) => void;
  onStartCall?: (userId: string) => void;
  onInviteToServer?: (guild: Guild, targetUserId: string) => void;
  onShowStats?: () => void;
  onOpenUserSettings?: () => void;
  onOpenAudioSettings?: () => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
}

const STATUS_CONFIG: Record<
  Exclude<UserStatus, "OFFLINE">,
  { labelKey: string; defaultLabel: string; color: string }
> = {
  ONLINE: {
    labelKey: "common:status.online",
    defaultLabel: "在线",
    color: "bg-emerald-500",
  },
  IDLE: {
    labelKey: "common:status.idle",
    defaultLabel: "离开",
    color: "bg-amber-500",
  },
  DND: {
    labelKey: "common:status.dnd",
    defaultLabel: "请勿打扰",
    color: "bg-rose-500",
  },
  INVISIBLE: {
    labelKey: "common:status.invisible",
    defaultLabel: "隐身",
    color: "border-2 border-gray-400 bg-transparent",
  },
};

export const UserContextMenu: React.FC<UserContextMenuProps> = ({
  targetUser,
  guild,
  guilds,
  channelId,
  children,
  isInVoice = false,
  isStreaming = false,
  onStopScreenShare,
  onMention,
  onOpenProfile,
  onSendMessage,
  onStartCall,
  onInviteToServer,
  onShowStats,
  onOpenUserSettings,
  onOpenAudioSettings,
  onKickMember,
  onBanMember,
}) => {
  const { t } = useTranslation([
    "contextMenu",
    "common",
    "settings",
    "voice",
    "chat",
  ]);
  const { user: currentUser, updateProfile } = useAuthStore();
  const { canKickMembers, canBanMembers } = usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);

  const {
    isDMPinned,
    pinDM,
    unpinDM,
    userNotes,
    setUserNote,
    isUserMuted,
    muteUser,
    unmuteUser,
  } = useSettingsStore();
  const { relationships, removeRelationship } = useFriendStore();

  const isFriend = relationships.some(
    (r) => r.targetUserId === targetUser.id && r.type === "FRIEND",
  );
  const isPinned = channelId ? isDMPinned(channelId) : false;
  const isMuted = isUserMuted(targetUser.id);
  const currentNote = userNotes[targetUser.id] || "";

  const handleTogglePin = () => {
    if (!channelId) return;
    if (isPinned) {
      unpinDM(channelId);
      toast.info(t("contextMenu:unpinned", "已取消置顶"));
    } else {
      pinDM(channelId);
      toast.success(t("contextMenu:pinned", "已置顶该私信会话"));
    }
  };

  const handleEditNote = async () => {
    const res = await dialog.prompt({
      title: t("contextMenu:addNoteTitle", "设置备注"),
      description: t("contextMenu:addNoteDesc", "只有您可以看到此备注"),
      placeholder: t("contextMenu:notePlaceholder", "输入好友备注名..."),
      defaultValue: currentNote,
      maxLength: 32,
    });
    if (res !== null) {
      setUserNote(targetUser.id, res);
      toast.success(t("contextMenu:noteUpdated", "备注已更新"));
    }
  };

  const handleRemoveFriend = async () => {
    const confirmed = await dialog.confirm({
      title: t("chat:friends.actions.removeFriend", "移除好友"),
      description: t("chat:friends.confirm.removeDesc", {
        defaultValue: `确定要将 ${targetUser.username} 从好友列表中移除吗？`,
        name: targetUser.username,
      }),
      variant: "danger",
      confirmText: t("common:confirm", "确认移除"),
    });
    if (confirmed) {
      try {
        await removeRelationship(targetUser.id);
        toast.success(t("chat:friends.success.removed", "已删除该好友"));
      } catch (e: any) {
        toast.error(e?.message || "删除好友失败");
      }
    }
  };

  const handleBlockUser = async () => {
    const confirmed = await dialog.confirm({
      title: t("contextMenu:blockUser", "封锁用户"),
      description: t("contextMenu:blockDesc", {
        defaultValue: `确定要封锁 ${targetUser.username} 吗？对方将无法向你发送消息与呼叫。`,
        name: targetUser.username,
      }),
      variant: "danger",
      confirmText: t("contextMenu:block", "封锁"),
    });
    if (confirmed) {
      try {
        await removeRelationship(targetUser.id);
        toast.success(t("contextMenu:blocked", "已成功封锁该用户"));
      } catch (e: any) {
        toast.error(e?.message || "封锁用户失败");
      }
    }
  };

  const isMe = currentUser?.id === targetUser.id;

  // 远端用户音量 (0 - 200)
  const [volume, setVolume] = useState<number>(() => {
    if (!isMe) {
      return livekitService.getParticipantVolume(targetUser.id) ?? 100;
    }
    return 100;
  });

  useEffect(() => {
    if (!isMe) {
      const currentVol = livekitService.getParticipantVolume(targetUser.id);
      if (currentVol !== undefined) {
        setVolume(currentVol);
      }

      // 订阅底层全局音量变动，确保与中间卡片滑块以及其他位置的改动双向同步
      const unsubscribe = livekitService.onParticipantVolumeChange(
        (identity, newVol) => {
          if (identity === targetUser.id) {
            setVolume(newVol);
          }
        },
      );

      return () => {
        unsubscribe();
      };
    }
  }, [targetUser.id, isMe]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const status = newStatus as UserStatus;
      gatewayClient.updateStatus(status, currentUser?.customStatus);
      await updateProfile({ status });
      window.electronAPI?.syncUserStatus(status);
    } catch (e) {
      console.error("Failed to update status:", e);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    livekitService.setParticipantVolume(targetUser.id, newVol);
  };

  const handleToggleMute = () => {
    const nextVol = volume === 0 ? 100 : 0;
    handleVolumeChange(nextVol);
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(targetUser.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy user id:", e);
    }
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open && !isMe) {
          // 菜单弹出瞬间强制同步最新音量快照，防止旧值反向覆盖
          const latestVol = livekitService.getParticipantVolume(targetUser.id);
          if (latestVol !== undefined) {
            setVolume(latestVol);
          }
        }
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {isMe ? (
          /* ============ 自身菜单 ============ */
          <>
            <ContextMenuLabel>
              {t("contextMenu:userStatus", "在线状态")}
            </ContextMenuLabel>
            <ContextMenuRadioGroup
              value={
                currentUser?.status === "OFFLINE"
                  ? "INVISIBLE"
                  : currentUser?.status || "ONLINE"
              }
              onValueChange={handleStatusChange}
            >
              {(
                Object.keys(STATUS_CONFIG) as (keyof typeof STATUS_CONFIG)[]
              ).map((statusKey) => (
                <ContextMenuRadioItem
                  key={statusKey}
                  value={statusKey}
                  className="flex items-center space-x-2"
                >
                  <span
                    className={`w-2 h-2 rounded-full mr-1.5 ${STATUS_CONFIG[statusKey].color}`}
                  />
                  <span>
                    {t(
                      STATUS_CONFIG[statusKey].labelKey,
                      STATUS_CONFIG[statusKey].defaultLabel,
                    )}
                  </span>
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>

            <ContextMenuSeparator />

            {onOpenUserSettings && (
              <ContextMenuItem
                onClick={onOpenUserSettings}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <Settings className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("common:user.userSettings", "个人设置")}</span>
                </div>
              </ContextMenuItem>
            )}

            {onOpenAudioSettings && (
              <ContextMenuItem
                onClick={onOpenAudioSettings}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <Headphones className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("settings:voiceAndVideo", "语音与视频设置")}</span>
                </div>
              </ContextMenuItem>
            )}

            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleCopyId}>
              <div className="flex items-center space-x-2">
                {copiedId ? (
                  <Check className="w-4 h-4 text-discord-green" />
                ) : (
                  <Copy className="w-4 h-4 text-discord-textMuted" />
                )}
                <span>
                  {copiedId
                    ? t("common:copied", "已复制")
                    : t("common:user.copyUserId", "复制用户 ID")}
                </span>
              </div>
            </ContextMenuItem>
          </>
        ) : (
          /* ============ 他人菜单 ============ */
          <>
            <ContextMenuLabel className="truncate">
              {currentNote
                ? `${currentNote} (${targetUser.username})`
                : targetUser.username}
            </ContextMenuLabel>

            {/* 1. 置顶私信 / 取消置顶 */}
            {channelId && (
              <ContextMenuItem
                onClick={handleTogglePin}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  {isPinned ? (
                    <PinOff className="w-4 h-4 text-discord-textMuted" />
                  ) : (
                    <Pin className="w-4 h-4 text-discord-textMuted" />
                  )}
                  <span>
                    {isPinned
                      ? t("contextMenu:unpinDM", "取消置顶私信")
                      : t("contextMenu:pinDM", "置顶私信")}
                  </span>
                </div>
              </ContextMenuItem>
            )}

            {/* 2. 个人资料 */}
            {onOpenProfile && (
              <ContextMenuItem
                onClick={() => onOpenProfile(targetUser.id)}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <UserIcon className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("common:user.viewProfile", "个人资料")}</span>
                </div>
              </ContextMenuItem>
            )}

            {/* 3. 发送私信 */}
            {onSendMessage && (
              <ContextMenuItem
                onClick={() => onSendMessage(targetUser.id)}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <MessageSquare className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("contextMenu:sendMessage", "发送私信")}</span>
                </div>
              </ContextMenuItem>
            )}

            {/* 4. 开始通话 */}
            {onStartCall && (
              <ContextMenuItem
                onClick={() => onStartCall(targetUser.id)}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("chat:friends.actions.voiceCall", "开始通话")}</span>
                </div>
              </ContextMenuItem>
            )}

            {/* 5. 加入备注 (只有您看得到) */}
            <ContextMenuItem
              onClick={handleEditNote}
              className="hover:bg-discord-brand"
            >
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-discord-textMuted" />
                <span>
                  {currentNote
                    ? t("contextMenu:editNote", "修改备注(只有您看得到)")
                    : t("contextMenu:addNote", "加入备注(只有您看得到)")}
                </span>
              </div>
            </ContextMenuItem>

            {/* 6. 邀请到服务器 */}
            {guilds && guilds.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="hover:bg-discord-brand">
                  <div className="flex items-center space-x-2">
                    <UserPlus className="w-4 h-4 text-discord-textMuted" />
                    <span>
                      {t("contextMenu:inviteToServer", "邀请到服务器")}
                    </span>
                  </div>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48 max-h-60 overflow-y-auto">
                  {guilds.map((g) => (
                    <ContextMenuItem
                      key={g.id}
                      onClick={() => onInviteToServer?.(g, targetUser.id)}
                      className="hover:bg-discord-brand truncate"
                    >
                      <span className="truncate">{g.name}</span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}

            {/* 7. 将 XXXXXX 静音 */}
            {isMuted ? (
              <ContextMenuItem
                onClick={() => {
                  unmuteUser(targetUser.id);
                  toast.info(t("contextMenu:unmuted", "已取消静音"));
                }}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <Bell className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("contextMenu:unmuteUser", "取消静音")}</span>
                </div>
              </ContextMenuItem>
            ) : (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="hover:bg-discord-brand">
                  <div className="flex items-center space-x-2">
                    <BellOff className="w-4 h-4 text-discord-textMuted" />
                    <span className="truncate">
                      {t("contextMenu:muteUserWithName", {
                        defaultValue: `将 ${targetUser.username} 静音`,
                        name: targetUser.username,
                      })}
                    </span>
                  </div>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-44">
                  <ContextMenuItem
                    onClick={() => {
                      muteUser(targetUser.id, 15);
                      toast.success(
                        t("contextMenu:mute15mSuccess", "已静音 15 分钟"),
                      );
                    }}
                  >
                    <span>{t("contextMenu:mute15m", "15 分钟")}</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      muteUser(targetUser.id, 60);
                      toast.success(
                        t("contextMenu:mute1hSuccess", "已静音 1 小时"),
                      );
                    }}
                  >
                    <span>{t("contextMenu:mute1h", "1 小时")}</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      muteUser(targetUser.id, 180);
                      toast.success(
                        t("contextMenu:mute3hSuccess", "已静音 3 小时"),
                      );
                    }}
                  >
                    <span>{t("contextMenu:mute3h", "3 小时")}</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      muteUser(targetUser.id, 480);
                      toast.success(
                        t("contextMenu:mute8hSuccess", "已静音 8 小时"),
                      );
                    }}
                  >
                    <span>{t("contextMenu:mute8h", "8 小时")}</span>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      muteUser(targetUser.id, 1440);
                      toast.success(
                        t("contextMenu:mute24hSuccess", "已静音 24 小时"),
                      );
                    }}
                  >
                    <span>{t("contextMenu:mute24h", "24 小时")}</span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => {
                      muteUser(targetUser.id, -1);
                      toast.success(
                        t(
                          "contextMenu:mutePermanentSuccess",
                          "已静音直到重新打开",
                        ),
                      );
                    }}
                  >
                    <span>
                      {t("contextMenu:muteUntilTurnOn", "直到重新打开")}
                    </span>
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}

            <ContextMenuSeparator />

            {/* 8. 移除好友 */}
            {isFriend && (
              <ContextMenuItem variant="danger" onClick={handleRemoveFriend}>
                <div className="flex items-center space-x-2">
                  <UserMinus className="w-4 h-4" />
                  <span>
                    {t("chat:friends.actions.removeFriend", "移除好友")}
                  </span>
                </div>
              </ContextMenuItem>
            )}

            {/* 9. 封锁 */}
            <ContextMenuItem variant="danger" onClick={handleBlockUser}>
              <div className="flex items-center space-x-2">
                <Ban className="w-4 h-4" />
                <span>{t("contextMenu:blockUser", "封锁")}</span>
              </div>
            </ContextMenuItem>

            <ContextMenuSeparator />

            {onMention && (
              <ContextMenuItem
                onClick={() => onMention(targetUser.username)}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <AtSign className="w-4 h-4 text-discord-textMuted" />
                  <span>{t("contextMenu:mentionUser", "@提及该用户")}</span>
                </div>
              </ContextMenuItem>
            )}

            {/* 直播与视频流属性查看 (Stats for Nerds) */}
            {onShowStats && (
              <ContextMenuItem
                onClick={onShowStats}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-discord-brand" />
                  <span>
                    {t("voice:statsHUD", "媒体属性与详细统计 (Stats)")}
                  </span>
                </div>
              </ContextMenuItem>
            )}

            {/* 本人直播停止推流菜单入口 */}
            {isStreaming && onStopScreenShare && (
              <ContextMenuItem
                onClick={onStopScreenShare}
                className="hover:bg-discord-danger text-red-400 hover:text-white"
              >
                <div className="flex items-center space-x-2">
                  <ScreenShareOff className="w-4 h-4 text-discord-danger group-hover:text-white" />
                  <span>{t("voice:stopScreenShare", "停止直播")}</span>
                </div>
              </ContextMenuItem>
            )}

            {/* 语音音量控制（通话中或有语音状态） */}
            {isInVoice && (
              <>
                <ContextMenuSeparator />
                <div
                  className="px-2 py-2 flex flex-col space-y-1.5 bg-[#18191c] rounded my-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between text-xs text-discord-textMuted font-medium">
                    <span className="flex items-center space-x-1.5">
                      {volume === 0 ? (
                        <VolumeX className="w-3.5 h-3.5 text-discord-danger" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                      <span>{t("userVolume")}</span>
                    </span>
                    <span className="font-mono text-discord-textNormal">
                      {volume}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#4e5058] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                  />
                  <div className="flex justify-between items-center text-[10px] text-discord-textMuted pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleVolumeChange(100)}
                      className="hover:text-white hover:underline transition flex items-center space-x-1"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>{t("resetVolume")}</span>
                    </button>
                    <span>{t("maxVolume")}</span>
                  </div>
                </div>

                <ContextMenuItem
                  onClick={handleToggleMute}
                  className="hover:bg-discord-brand"
                >
                  <div className="flex items-center space-x-2">
                    {volume === 0 ? (
                      <Volume2 className="w-4 h-4 text-discord-green" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-discord-textMuted" />
                    )}
                    <span>
                      {volume === 0 ? t("unmuteUser") : t("muteUser")}
                    </span>
                  </div>
                </ContextMenuItem>
              </>
            )}

            {(canKickMembers || canBanMembers) && <ContextMenuSeparator />}

            {canKickMembers && (
              <ContextMenuItem
                variant="danger"
                onClick={() =>
                  onKickMember?.(targetUser.id, targetUser.username)
                }
              >
                <div className="flex items-center space-x-2">
                  <UserX className="w-4 h-4" />
                  <span>{t("contextMenu:kickUser", "踢出服务器")}</span>
                </div>
              </ContextMenuItem>
            )}

            {canBanMembers && (
              <ContextMenuItem
                variant="danger"
                onClick={() =>
                  onBanMember?.(targetUser.id, targetUser.username)
                }
              >
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{t("contextMenu:banUser", "封禁成员")}</span>
                </div>
              </ContextMenuItem>
            )}

            <ContextMenuSeparator />

            <ContextMenuItem onClick={handleCopyId}>
              <div className="flex items-center space-x-2">
                {copiedId ? (
                  <Check className="w-4 h-4 text-discord-green" />
                ) : (
                  <Copy className="w-4 h-4 text-discord-textMuted" />
                )}
                <span>
                  {copiedId
                    ? t("common:copied", "已复制")
                    : t("common:user.copyUserId", "复制用户 ID")}
                </span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
