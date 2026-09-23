import React, { useState, useEffect, useRef } from "react";
import {
  useContextMenuStore,
  MessageMenuData,
  UserMenuData,
} from "../../stores/useContextMenuStore.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import { livekitService } from "../../services/livekit.js";
import {
  Reply,
  Pin,
  Edit2,
  Trash2,
  Copy,
  Check,
  User as UserIcon,
  MessageSquare,
  AtSign,
  Volume2,
  ShieldAlert,
  UserX,
} from "lucide-react";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🚀", "🎉"];

export const GlobalContextMenu: React.FC = () => {
  const { isOpen, x, y, data, closeMenu } = useContextMenuStore();
  const { user: currentUser } = useAuthStore();
  const menuRef = useRef<HTMLDivElement>(null);

  const [copiedText, setCopiedText] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // 点击外部与 ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, closeMenu]);

  if (!isOpen || !data) return null;

  // 坐标边界防溢出计算
  const menuWidth = 224; // 14rem = 224px
  const menuEstimatedHeight = 280;
  const clampedX = Math.max(
    8,
    Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1280) - menuWidth - 8),
  );
  const clampedY = Math.max(
    8,
    Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - menuEstimatedHeight - 8),
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      data-radix-menu-content=""
      style={{
        position: "fixed",
        left: `${clampedX}px`,
        top: `${clampedY}px`,
        zIndex: 9999,
      }}
      className="w-56 rounded-md bg-[#111214] p-1.5 text-xs text-[#dbdee1] shadow-2xl border border-[#2b2d31] animate-context-menu-in select-none"
    >
      {data.type === "message" ? (
        <MessageMenuItems
          data={data}
          currentUser={currentUser}
          copiedText={copiedText}
          copiedId={copiedId}
          setCopiedText={setCopiedText}
          setCopiedId={setCopiedId}
          onClose={closeMenu}
        />
      ) : (
        <UserMenuItems
          data={data}
          currentUser={currentUser}
          copiedId={copiedId}
          setCopiedId={setCopiedId}
          onClose={closeMenu}
        />
      )}
    </div>
  );
};

// 消息右键菜单项
interface MessageMenuItemsProps {
  data: MessageMenuData;
  currentUser: any;
  copiedText: boolean;
  copiedId: boolean;
  setCopiedText: (v: boolean) => void;
  setCopiedId: (v: boolean) => void;
  onClose: () => void;
}

const MessageMenuItems: React.FC<MessageMenuItemsProps> = ({
  data,
  currentUser,
  copiedText,
  copiedId,
  setCopiedText,
  setCopiedId,
  onClose,
}) => {
  const { message, guild, onReply, onEdit, onDelete, onTogglePin, onAddReaction } =
    data;
  const { canManageMessages } = usePermissions(guild);

  const isAuthor = currentUser?.id === message.authorId;
  const canDelete = isAuthor || canManageMessages;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedText(true);
      setTimeout(() => {
        setCopiedText(false);
        onClose();
      }, 500);
    } catch (e) {
      console.error("Failed to copy message content:", e);
      onClose();
    }
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(message.id);
      setCopiedId(true);
      setTimeout(() => {
        setCopiedId(false);
        onClose();
      }, 500);
    } catch (e) {
      console.error("Failed to copy message id:", e);
      onClose();
    }
  };

  return (
    <>
      {/* 顶部快捷表情栏 */}
      <div className="flex items-center justify-around px-1 py-1.5 bg-[#1e1f22] rounded mb-1">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onAddReaction?.(message.id, emoji);
              onClose();
            }}
            className="text-base hover:scale-125 hover:bg-[#35373c] p-1 rounded transition-transform"
            title={`添加反应 ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="h-[1px] bg-[#2b2d31] my-1" />

      {onReply && (
        <div
          role="menuitem"
          onClick={() => {
            onReply(message);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Reply className="w-4 h-4 text-discord-textMuted" />
            <span>引用回复</span>
          </div>
        </div>
      )}

      {isAuthor && onEdit && (
        <div
          role="menuitem"
          onClick={() => {
            onEdit(message);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Edit2 className="w-4 h-4 text-discord-textMuted" />
            <span>编辑消息</span>
          </div>
        </div>
      )}

      {(isAuthor || canManageMessages) && onTogglePin && (
        <div
          role="menuitem"
          onClick={() => {
            onTogglePin(message.id);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Pin
              className={`w-4 h-4 ${
                message.isPinned
                  ? "text-amber-400 fill-amber-400"
                  : "text-discord-textMuted"
              }`}
            />
            <span>{message.isPinned ? "取消置顶" : "置顶消息"}</span>
          </div>
        </div>
      )}

      <div className="h-[1px] bg-[#2b2d31] my-1" />

      <div
        role="menuitem"
        onClick={handleCopyText}
        className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
      >
        <div className="flex items-center space-x-2">
          {copiedText ? (
            <Check className="w-4 h-4 text-discord-green" />
          ) : (
            <Copy className="w-4 h-4 text-discord-textMuted" />
          )}
          <span>{copiedText ? "已复制消息内容" : "复制文字消息"}</span>
        </div>
      </div>

      <div
        role="menuitem"
        onClick={handleCopyId}
        className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
      >
        <div className="flex items-center space-x-2">
          {copiedId ? (
            <Check className="w-4 h-4 text-discord-green" />
          ) : (
            <Copy className="w-4 h-4 text-discord-textMuted" />
          )}
          <span>{copiedId ? "已复制消息 ID" : "复制消息 ID"}</span>
        </div>
      </div>

      {canDelete && onDelete && (
        <>
          <div className="h-[1px] bg-[#2b2d31] my-1" />
          <div
            role="menuitem"
            onClick={() => {
              onDelete(message.id);
              onClose();
            }}
            className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-rose-400 hover:bg-rose-600 hover:text-white transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Trash2 className="w-4 h-4" />
              <span>撤回 / 删除消息</span>
            </div>
          </div>
        </>
      )}
    </>
  );
};

// 用户右键菜单项
interface UserMenuItemsProps {
  data: UserMenuData;
  currentUser: any;
  copiedId: boolean;
  setCopiedId: (v: boolean) => void;
  onClose: () => void;
}

const UserMenuItems: React.FC<UserMenuItemsProps> = ({
  data,
  currentUser,
  copiedId,
  setCopiedId,
  onClose,
}) => {
  const {
    targetUser,
    guild,
    onOpenProfile,
    onSendMessage,
    onMention,
    onKickMember,
    onBanMember,
  } = data;
  const { canKickMembers, canBanMembers } = usePermissions(guild);

  const isMe = currentUser?.id === targetUser.id;
  const [volume, setVolume] = useState<number>(() => {
    if (!isMe) {
      return livekitService.getParticipantVolume(targetUser.id) ?? 100;
    }
    return 100;
  });

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(targetUser.id);
      setCopiedId(true);
      setTimeout(() => {
        setCopiedId(false);
        onClose();
      }, 500);
    } catch (e) {
      console.error("Failed to copy user id:", e);
      onClose();
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    livekitService.setParticipantVolume(targetUser.id, newVol);
  };

  return (
    <>
      <div className="px-2 py-1.5 font-semibold text-discord-textHeader truncate border-b border-[#2b2d31] mb-1">
        {targetUser.username}
      </div>

      {onOpenProfile && (
        <div
          role="menuitem"
          onClick={() => {
            onOpenProfile(targetUser.id);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <UserIcon className="w-4 h-4 text-discord-textMuted" />
            <span>个人资料</span>
          </div>
        </div>
      )}

      {!isMe && onSendMessage && (
        <div
          role="menuitem"
          onClick={() => {
            onSendMessage(targetUser.id);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-discord-textMuted" />
            <span>发消息</span>
          </div>
        </div>
      )}

      {onMention && (
        <div
          role="menuitem"
          onClick={() => {
            onMention(targetUser.username);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <AtSign className="w-4 h-4 text-discord-textMuted" />
            <span>提及</span>
          </div>
        </div>
      )}

      {/* 用户音量调节滑块 */}
      {!isMe && (
        <div className="px-2 py-1.5">
          <div className="flex items-center justify-between text-[11px] text-discord-textMuted mb-1">
            <span className="flex items-center space-x-1">
              <Volume2 className="w-3.5 h-3.5" />
              <span>用户音量</span>
            </span>
            <span>{volume}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="w-full h-1 bg-[#4e5058] rounded-lg appearance-none cursor-pointer accent-discord-brand"
          />
        </div>
      )}

      <div className="h-[1px] bg-[#2b2d31] my-1" />

      <div
        role="menuitem"
        onClick={handleCopyId}
        className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
      >
        <div className="flex items-center space-x-2">
          {copiedId ? (
            <Check className="w-4 h-4 text-discord-green" />
          ) : (
            <Copy className="w-4 h-4 text-discord-textMuted" />
          )}
          <span>{copiedId ? "已复制用户 ID" : "复制用户 ID"}</span>
        </div>
      </div>

      {/* 权限操作：踢出与封禁 */}
      {!isMe && (canKickMembers || canBanMembers) && (
        <>
          <div className="h-[1px] bg-[#2b2d31] my-1" />
          {canKickMembers && onKickMember && (
            <div
              role="menuitem"
              onClick={() => {
                onKickMember(targetUser.id, targetUser.username);
                onClose();
              }}
              className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-rose-400 hover:bg-rose-600 hover:text-white transition-colors"
            >
              <div className="flex items-center space-x-2">
                <UserX className="w-4 h-4" />
                <span>踢出 {targetUser.username}</span>
              </div>
            </div>
          )}
          {canBanMembers && onBanMember && (
            <div
              role="menuitem"
              onClick={() => {
                onBanMember(targetUser.id, targetUser.username);
                onClose();
              }}
              className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 text-rose-400 hover:bg-rose-600 hover:text-white transition-colors"
            >
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4" />
                <span>封禁 {targetUser.username}</span>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};
