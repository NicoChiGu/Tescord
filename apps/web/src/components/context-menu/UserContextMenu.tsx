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
} from "lucide-react";

interface UserContextMenuProps {
  targetUser: {
    id: string;
    username: string;
    avatarUrl?: string | null;
    status?: UserStatus;
  };
  guild?: Guild | null;
  children: React.ReactNode;
  isInVoice?: boolean;
  isStreaming?: boolean;
  onStopScreenShare?: () => void;
  onMention?: (username: string) => void;
  onOpenProfile?: (userId: string) => void;
  onSendMessage?: (userId: string) => void;
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
  ONLINE: { labelKey: "common:status.online", defaultLabel: "在线", color: "bg-emerald-500" },
  IDLE: { labelKey: "common:status.idle", defaultLabel: "离开", color: "bg-amber-500" },
  DND: { labelKey: "common:status.dnd", defaultLabel: "请勿打扰", color: "bg-rose-500" },
  INVISIBLE: {
    labelKey: "common:status.invisible",
    defaultLabel: "隐身",
    color: "border-2 border-gray-400 bg-transparent",
  },
};

export const UserContextMenu: React.FC<UserContextMenuProps> = ({
  targetUser,
  guild,
  children,
  isInVoice = false,
  isStreaming = false,
  onStopScreenShare,
  onMention,
  onOpenProfile,
  onSendMessage,
  onShowStats,
  onOpenUserSettings,
  onOpenAudioSettings,
  onKickMember,
  onBanMember,
}) => {
  const { t } = useTranslation(["contextMenu", "common", "settings", "voice"]);
  const { user: currentUser, updateProfile } = useAuthStore();
  const { canKickMembers, canBanMembers } = usePermissions(guild);
  const [copiedId, setCopiedId] = useState(false);

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
      const unsubscribe = livekitService.onParticipantVolumeChange((identity, newVol) => {
        if (identity === targetUser.id) {
          setVolume(newVol);
        }
      });

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
            <ContextMenuLabel>在线状态</ContextMenuLabel>
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
                  <span>{t(STATUS_CONFIG[statusKey].labelKey, STATUS_CONFIG[statusKey].defaultLabel)}</span>
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
                <span>{copiedId ? t("common:copied", "已复制") : t("common:user.copyUserId", "复制用户 ID")}</span>
              </div>
            </ContextMenuItem>
          </>
        ) : (
          /* ============ 他人菜单 ============ */
          <>
            <ContextMenuLabel className="truncate">
              {targetUser.username}
            </ContextMenuLabel>

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
                  <span>{t("voice:statsHUD", "媒体属性与详细统计 (Stats)")}</span>
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
                    <span>{volume === 0 ? t("unmuteUser") : t("muteUser")}</span>
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
                <span>{copiedId ? t("common:copied", "已复制") : t("common:user.copyUserId", "复制用户 ID")}</span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
