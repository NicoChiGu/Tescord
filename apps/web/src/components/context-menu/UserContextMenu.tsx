import React, { useState, useEffect } from "react";
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
  onMention?: (username: string) => void;
  onOpenUserSettings?: () => void;
  onOpenAudioSettings?: () => void;
  onKickMember?: (userId: string, username: string) => void;
  onBanMember?: (userId: string, username: string) => void;
}

const STATUS_CONFIG: Record<
  UserStatus,
  { label: string; color: string }
> = {
  ONLINE: { label: "在线", color: "bg-emerald-500" },
  IDLE: { label: "离开", color: "bg-amber-500" },
  DND: { label: "请勿打扰", color: "bg-rose-500" },
  OFFLINE: { label: "隐身", color: "bg-gray-400" },
};

export const UserContextMenu: React.FC<UserContextMenuProps> = ({
  targetUser,
  guild,
  children,
  isInVoice = false,
  onMention,
  onOpenUserSettings,
  onOpenAudioSettings,
  onKickMember,
  onBanMember,
}) => {
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
    }
  }, [targetUser.id, isMe]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const status = newStatus as UserStatus;
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
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {isMe ? (
          /* ============ 自身菜单 ============ */
          <>
            <ContextMenuLabel>在线状态</ContextMenuLabel>
            <ContextMenuRadioGroup
              value={currentUser?.status || "ONLINE"}
              onValueChange={handleStatusChange}
            >
              {(Object.keys(STATUS_CONFIG) as UserStatus[]).map((statusKey) => (
                <ContextMenuRadioItem
                  key={statusKey}
                  value={statusKey}
                  className="flex items-center space-x-2"
                >
                  <span
                    className={`w-2 h-2 rounded-full mr-1.5 ${STATUS_CONFIG[statusKey].color}`}
                  />
                  <span>{STATUS_CONFIG[statusKey].label}</span>
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
                  <span>个人设置</span>
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
                  <span>语音与视频设置</span>
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
                <span>{copiedId ? "已复制我的 ID" : "复制我的 ID"}</span>
              </div>
            </ContextMenuItem>
          </>
        ) : (
          /* ============ 他人菜单 ============ */
          <>
            <ContextMenuLabel className="truncate">
              {targetUser.username}
            </ContextMenuLabel>

            {onMention && (
              <ContextMenuItem
                onClick={() => onMention(targetUser.username)}
                className="hover:bg-discord-brand"
              >
                <div className="flex items-center space-x-2">
                  <AtSign className="w-4 h-4 text-discord-textMuted" />
                  <span>@提及该用户</span>
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
                      <span>用户独立音量</span>
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
                    <span>{volume === 0 ? "取消静音" : "静音"}</span>
                  </div>
                </ContextMenuItem>
              </>
            )}

            {(canKickMembers || canBanMembers) && <ContextMenuSeparator />}

            {canKickMembers && (
              <ContextMenuItem
                variant="danger"
                onClick={() => onKickMember?.(targetUser.id, targetUser.username)}
              >
                <div className="flex items-center space-x-2">
                  <UserX className="w-4 h-4" />
                  <span>踢出服务器</span>
                </div>
              </ContextMenuItem>
            )}

            {canBanMembers && (
              <ContextMenuItem
                variant="danger"
                onClick={() => onBanMember?.(targetUser.id, targetUser.username)}
              >
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>封禁成员</span>
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
                <span>{copiedId ? "已复制用户 ID" : "复制用户 ID"}</span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
