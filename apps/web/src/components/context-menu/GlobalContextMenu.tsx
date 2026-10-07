import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useContextMenuStore,
  MessageMenuData,
  UserMenuData,
  AttachmentMenuData,
} from "../../stores/useContextMenuStore.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import { useFriendStore } from "../../stores/useFriendStore.js";
import { toast } from "../../stores/useToastStore.js";
import {
  openAttachmentDownload,
  getAttachmentAccess,
} from "../../services/attachmentAccess.js";
import { resolveServerUrl } from "../../config.js";
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
  ShieldAlert,
  UserX,
  Phone,
  UserPlus,
  UserMinus,
  Download,
  ExternalLink,
  Eye,
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
    Math.min(
      x,
      (typeof window !== "undefined" ? window.innerWidth : 1280) -
        menuWidth -
        8,
    ),
  );
  const clampedY = Math.max(
    8,
    Math.min(
      y,
      (typeof window !== "undefined" ? window.innerHeight : 800) -
        menuEstimatedHeight -
        8,
    ),
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
      ) : data.type === "attachment" ? (
        <AttachmentMenuItems
          data={data}
          currentUser={currentUser}
          copiedId={copiedId}
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

// 附件专属右键菜单项
interface AttachmentMenuItemsProps {
  data: AttachmentMenuData;
  currentUser: any;
  copiedId: boolean;
  setCopiedId: (v: boolean) => void;
  onClose: () => void;
}

const AttachmentMenuItems: React.FC<AttachmentMenuItemsProps> = ({
  data,
  currentUser,
  copiedId,
  setCopiedId,
  onClose,
}) => {
  const { t } = useTranslation(["contextMenu", "common"]);
  const { attachment, message, onPreviewImage, onReply, onDelete } = data;
  const isImage =
    Boolean(onPreviewImage) ||
    attachment.mimeType?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(attachment.fileName || "");

  const handleDownload = async () => {
    onClose();
    try {
      await openAttachmentDownload(attachment);
    } catch {
      toast.error(t("common:error", { defaultValue: "下载失败" }));
    }
  };

  const handleCopyLink = async () => {
    onClose();
    try {
      const access = await getAttachmentAccess(attachment);
      const url = resolveServerUrl(access.downloadUrl || access.url);
      await navigator.clipboard.writeText(url);
      toast.success(
        t("contextMenu:attachment.copyLinkSuccess", {
          defaultValue: "已复制附件链接至剪贴板",
        }),
      );
    } catch {
      const fallbackUrl = resolveServerUrl(attachment.url);
      await navigator.clipboard.writeText(fallbackUrl);
      toast.success(
        t("contextMenu:attachment.copyLinkSuccess", {
          defaultValue: "已复制附件链接至剪贴板",
        }),
      );
    }
  };

  const handleOpenInNewTab = async () => {
    onClose();
    try {
      const access = await getAttachmentAccess(attachment);
      const url = resolveServerUrl(access.url || access.downloadUrl);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.open(
        resolveServerUrl(attachment.url),
        "_blank",
        "noopener,noreferrer",
      );
    }
  };

  const isAuthor =
    message && currentUser && message.author?.id === currentUser.id;

  return (
    <div className="space-y-0.5">
      {/* 附件专属操作项 */}
      <button
        data-testid="attachment-ctx-download"
        onClick={handleDownload}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-discord-brand hover:text-white transition text-left cursor-pointer group"
      >
        <span>
          {t("contextMenu:attachment.download", { defaultValue: "下载附件" })}
        </span>
        <Download className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
      </button>

      <button
        data-testid="attachment-ctx-copy-link"
        onClick={handleCopyLink}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-discord-brand hover:text-white transition text-left cursor-pointer group"
      >
        <span>
          {t("contextMenu:attachment.copyLink", {
            defaultValue: "复制附件下载链接",
          })}
        </span>
        <Copy className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
      </button>

      <button
        data-testid="attachment-ctx-open-new-tab"
        onClick={handleOpenInNewTab}
        className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-discord-brand hover:text-white transition text-left cursor-pointer group"
      >
        <span>
          {t("contextMenu:attachment.openInNewTab", {
            defaultValue: "在浏览器新标签页打开",
          })}
        </span>
        <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
      </button>

      {isImage && onPreviewImage && (
        <button
          data-testid="attachment-ctx-preview-image"
          onClick={() => {
            onClose();
            onPreviewImage();
          }}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-discord-brand hover:text-white transition text-left cursor-pointer group"
        >
          <span>
            {t("contextMenu:attachment.previewImage", {
              defaultValue: "查看原图",
            })}
          </span>
          <Eye className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
        </button>
      )}

      {/* 消息级关联操作项 */}
      {message && (
        <>
          <div className="my-1 h-[1px] bg-[#35363c]" />

          {onReply && (
            <button
              data-testid="attachment-ctx-reply"
              onClick={() => {
                onClose();
                onReply(message);
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-discord-brand hover:text-white transition text-left cursor-pointer group"
            >
              <span>
                {t("contextMenu:quoteReply", { defaultValue: "引用回复" })}
              </span>
              <Reply className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
            </button>
          )}

          <button
            data-testid="attachment-ctx-copy-id"
            onClick={async () => {
              await navigator.clipboard.writeText(message.id);
              setCopiedId(true);
              setTimeout(() => {
                setCopiedId(false);
                onClose();
              }, 1200);
            }}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-discord-brand hover:text-white transition text-left cursor-pointer group"
          >
            <span>
              {copiedId
                ? t("contextMenu:idCopied", { defaultValue: "已复制 ID" })
                : t("contextMenu:copyMessageId", {
                    defaultValue: "复制消息 ID",
                  })}
            </span>
            {copiedId ? (
              <Check className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
            )}
          </button>

          {isAuthor && onDelete && (
            <button
              data-testid="attachment-ctx-delete"
              onClick={() => {
                onClose();
                onDelete(message.id);
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded text-red-400 hover:bg-red-500 hover:text-white transition text-left cursor-pointer group"
            >
              <span>
                {t("contextMenu:deleteMessage", { defaultValue: "删除消息" })}
              </span>
              <Trash2 className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
            </button>
          )}
        </>
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
  const { t } = useTranslation(["contextMenu", "common"]);
  const {
    message,
    guild,
    onReply,
    onEdit,
    onDelete,
    onTogglePin,
    onAddReaction,
  } = data;
  const { canManageMessages } = usePermissions(guild);

  const isAuthor = currentUser?.id === message.authorId;
  const canDelete = isAuthor || canManageMessages;
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

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
            title={`${t("contextMenu:addReaction")} ${emoji}`}
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
            <span>{t("contextMenu:quoteReply")}</span>
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
            <span>{t("contextMenu:editMessage")}</span>
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
            <span>
              {message.isPinned
                ? t("contextMenu:unpinMessage")
                : t("contextMenu:pinMessage")}
            </span>
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
          <span>
            {copiedText ? t("common:copied") : t("contextMenu:copyText")}
          </span>
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
          <span>
            {copiedId ? t("common:copied") : t("contextMenu:copyMessageId")}
          </span>
        </div>
      </div>

      {canDelete && onDelete && (
        <>
          <div className="h-[1px] bg-[#2b2d31] my-1" />
          <div
            role="menuitem"
            onClick={() => {
              if (!isConfirmingDelete) {
                setIsConfirmingDelete(true);
              } else {
                onDelete(message.id);
                onClose();
              }
            }}
            className={`flex cursor-pointer select-none items-center rounded px-2 py-1.5 transition-colors ${
              isConfirmingDelete
                ? "bg-rose-600 text-white font-semibold"
                : "text-rose-400 hover:bg-rose-600 hover:text-white"
            }`}
          >
            <div className="flex items-center space-x-2">
              <Trash2 className="w-4 h-4" />
              <span>
                {isConfirmingDelete
                  ? t("contextMenu:confirmDelete", "确认删除?")
                  : t("contextMenu:deleteMessage")}
              </span>
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
  const { t } = useTranslation(["contextMenu", "common"]);
  const {
    targetUser,
    guild,
    onOpenProfile,
    onSendMessage,
    onStartCall,
    onMention,
    onKickMember,
    onBanMember,
  } = data;
  const { canKickMembers, canBanMembers } = usePermissions(guild);
  const { relationships, sendFriendRequest, removeRelationship } =
    useFriendStore();

  const isMe = currentUser?.id === targetUser.id;
  const isFriend = relationships.some(
    (r) => r.targetUserId === targetUser.id && r.type === "FRIEND",
  );
  const [isConfirmingRemoveFriend, setIsConfirmingRemoveFriend] =
    useState(false);

  const handleAddFriend = async () => {
    try {
      await sendFriendRequest(targetUser.username);
      toast.success(t("contextMenu:addFriendSuccess", "已发送好友申请"));
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "发送好友申请失败");
      onClose();
    }
  };

  const handleRemoveFriend = async () => {
    if (!isConfirmingRemoveFriend) {
      setIsConfirmingRemoveFriend(true);
      return;
    }
    try {
      await removeRelationship(targetUser.id);
      toast.info(t("contextMenu:removeFriend", "已移除好友"));
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "移除好友失败");
      onClose();
    }
  };

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
            <span>{t("contextMenu:profile")}</span>
          </div>
        </div>
      )}

      {/* 传送消息 (发起私信) */}
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
            <span>{t("contextMenu:sendMessage", "传送消息")}</span>
          </div>
        </div>
      )}

      {/* 开始通话 */}
      {!isMe && onStartCall && (
        <div
          role="menuitem"
          onClick={() => {
            onStartCall(targetUser.id);
            onClose();
          }}
          className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Phone className="w-4 h-4 text-discord-textMuted" />
            <span>{t("contextMenu:startCall", "开始通话")}</span>
          </div>
        </div>
      )}

      {/* 好友管理：新增好友 / 移除好友（双确认） */}
      {!isMe &&
        (isFriend ? (
          <div
            role="menuitem"
            onClick={handleRemoveFriend}
            className={`flex cursor-pointer select-none items-center rounded px-2 py-1.5 transition-colors ${
              isConfirmingRemoveFriend
                ? "bg-rose-600 text-white font-semibold"
                : "text-rose-400 hover:bg-rose-600 hover:text-white"
            }`}
          >
            <div className="flex items-center space-x-2">
              <UserMinus className="w-4 h-4" />
              <span>
                {isConfirmingRemoveFriend
                  ? t("contextMenu:confirmDelete", "确认移除?")
                  : t("contextMenu:removeFriend", "移除好友")}
              </span>
            </div>
          </div>
        ) : (
          <div
            role="menuitem"
            onClick={handleAddFriend}
            className="flex cursor-pointer select-none items-center rounded px-2 py-1.5 hover:bg-discord-brand hover:text-white transition-colors"
          >
            <div className="flex items-center space-x-2">
              <UserPlus className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:addFriend", "新增好友")}</span>
            </div>
          </div>
        ))}

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
            <span>{t("contextMenu:mentionUser")}</span>
          </div>
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
          <span>
            {copiedId ? t("common:copied") : t("contextMenu:copyUserId")}
          </span>
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
                <span>
                  {t("contextMenu:kickUserNamed", {
                    name: targetUser.username,
                  })}
                </span>
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
                <span>
                  {t("contextMenu:banUserNamed", { name: targetUser.username })}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};
