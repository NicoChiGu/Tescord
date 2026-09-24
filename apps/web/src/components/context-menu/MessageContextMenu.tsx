import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Message, Guild } from "@tescord/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu.js";
import { usePermissions } from "../../hooks/usePermissions.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { Reply, Pin, Edit2, Trash2, Copy, Check } from "lucide-react";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🚀", "🎉"];

interface MessageContextMenuProps {
  message: Message;
  guild?: Guild | null;
  children: React.ReactNode;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (messageId: string) => void;
  onTogglePin?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
}

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
  message,
  guild,
  children,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  onAddReaction,
}) => {
  const { t } = useTranslation(["contextMenu", "common"]);
  const { user: currentUser } = useAuthStore();
  const { canManageMessages } = usePermissions(guild);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const isAuthor = currentUser?.id === message.authorId;
  const canDelete = isAuthor || canManageMessages;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch (e) {
      console.error("Failed to copy message content:", e);
    }
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(message.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (e) {
      console.error("Failed to copy message id:", e);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* 顶部快捷表情栏 */}
        <div className="flex items-center justify-around px-1 py-1.5 bg-[#1e1f22] rounded mb-1">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onAddReaction?.(message.id, emoji)}
              className="text-base hover:scale-125 hover:bg-[#35373c] p-1 rounded transition-transform"
              title={`${t("contextMenu:addReaction")} ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <ContextMenuSeparator />

        {onReply && (
          <ContextMenuItem
            onClick={() => onReply(message)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Reply className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:quoteReply")}</span>
            </div>
          </ContextMenuItem>
        )}

        {isAuthor && onEdit && (
          <ContextMenuItem
            onClick={() => onEdit(message)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Edit2 className="w-4 h-4 text-discord-textMuted" />
              <span>{t("contextMenu:editMessage")}</span>
            </div>
          </ContextMenuItem>
        )}

        {(isAuthor || canManageMessages) && onTogglePin && (
          <ContextMenuItem
            onClick={() => onTogglePin(message.id)}
            className="hover:bg-discord-brand"
          >
            <div className="flex items-center space-x-2">
              <Pin
                className={`w-4 h-4 ${
                  message.isPinned
                    ? "text-amber-400 fill-amber-400"
                    : "text-discord-textMuted"
                }`}
              />
              <span>{message.isPinned ? t("contextMenu:unpinMessage") : t("contextMenu:pinMessage")}</span>
            </div>
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem onClick={handleCopyText}>
          <div className="flex items-center space-x-2">
            {copiedText ? (
              <Check className="w-4 h-4 text-discord-green" />
            ) : (
              <Copy className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>{copiedText ? t("common:copied") : t("contextMenu:copyText")}</span>
          </div>
        </ContextMenuItem>

        <ContextMenuItem onClick={handleCopyId}>
          <div className="flex items-center space-x-2">
            {copiedId ? (
              <Check className="w-4 h-4 text-discord-green" />
            ) : (
              <Copy className="w-4 h-4 text-discord-textMuted" />
            )}
            <span>{copiedId ? t("common:copied") : t("contextMenu:copyMessageId")}</span>
          </div>
        </ContextMenuItem>

        {canDelete && onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="danger"
              onClick={() => onDelete(message.id)}
            >
              <div className="flex items-center space-x-2">
                <Trash2 className="w-4 h-4" />
                <span>{t("contextMenu:deleteMessage")}</span>
              </div>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
