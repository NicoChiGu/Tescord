import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Message, Guild } from "@tescord/types";
import { usePermissions } from "../../hooks/usePermissions.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { Reply, Pin, Edit2, Trash2, Copy, Check, Smile } from "lucide-react";
import { EmojiPickerPopover } from "./EmojiPickerPopover.js";
import { ActionDrawer, DrawerItem } from "../ui/action-drawer.js";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🚀", "🎉", "🔥"];

export interface MobileActionSheetProps {
  isOpen: boolean;
  message: Message | null;
  guild?: Guild | null;
  onClose: () => void;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (messageId: string) => void;
  onTogglePin?: (messageId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
}

export const MobileActionSheet: React.FC<MobileActionSheetProps> = ({
  isOpen,
  message,
  guild,
  onClose,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  onAddReaction,
}) => {
  const { t } = useTranslation(["contextMenu", "chat", "common"]);
  const { user: currentUser } = useAuthStore();
  const { canManageMessages } = usePermissions(guild);
  const [copiedText, setCopiedText] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  if (!message) return null;

  const isAuthor = currentUser?.id === message.authorId;
  const canDelete = isAuthor || canManageMessages;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedText(true);
      setTimeout(() => {
        setCopiedText(false);
        onClose();
      }, 600);
    } catch (e) {
      console.error("Failed to copy message:", e);
      onClose();
    }
  };

  const handleReactionClick = (emoji: string) => {
    onAddReaction?.(message.id, emoji);
    onClose();
  };

  const emojiHeader = (
    <div
      data-testid="drawer-quick-reactions"
      className="bg-[#1e1f22] p-2 rounded-xl flex items-center justify-between overflow-x-auto custom-scrollbar border border-[#35373c]/50"
    >
      <div className="flex items-center space-x-1.5 sm:space-x-2">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            data-testid={`quick-reaction-${emoji}`}
            onClick={() => handleReactionClick(emoji)}
            className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-[#35373c] active:scale-125 rounded-lg transition"
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="relative pl-2 border-l border-[#35373c] flex-shrink-0">
        <button
          type="button"
          onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
          className="w-10 h-10 flex items-center justify-center text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition"
          title={t("contextMenu:moreReactions", "更多表情")}
        >
          <Smile className="w-5 h-5" />
        </button>
        <EmojiPickerPopover
          isOpen={isEmojiPickerOpen}
          onClose={() => setIsEmojiPickerOpen(false)}
          onSelectEmoji={(emoji) => {
            setIsEmojiPickerOpen(false);
            handleReactionClick(emoji);
          }}
          guildId={guild?.id}
        />
      </div>
    </div>
  );

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={t("contextMenu:messageActions", "消息操作")}
      headerContent={emojiHeader}
      data-testid="mobile-action-sheet"
    >
      <div className="bg-[#1e1f22] rounded-xl overflow-hidden divide-y divide-[#35373c]/50 border border-[#35373c]/50">
        {/* 引用回复 */}
        {onReply && (
          <DrawerItem
            icon={Reply}
            label={t("contextMenu:quoteReply", "引用回复")}
            data-testid="mobile-action-reply"
            onClick={() => {
              onReply(message);
              onClose();
            }}
          />
        )}

        {/* 编辑消息 */}
        {isAuthor && onEdit && (
          <DrawerItem
            icon={Edit2}
            label={t("contextMenu:editMessage", "编辑消息")}
            data-testid="mobile-action-edit"
            onClick={() => {
              onEdit(message);
              onClose();
            }}
          />
        )}

        {/* 置顶 / 取消置顶 */}
        {(isAuthor || canManageMessages) && onTogglePin && (
          <DrawerItem
            icon={() => (
              <Pin
                className={`w-5 h-5 ${
                  message.isPinned
                    ? "text-amber-400 fill-amber-400"
                    : "text-discord-textMuted"
                }`}
              />
            )}
            label={
              message.isPinned
                ? t("contextMenu:unpinMessage", "取消置顶")
                : t("contextMenu:pinMessage", "置顶该消息")
            }
            data-testid="mobile-action-pin"
            onClick={() => {
              onTogglePin(message.id);
              onClose();
            }}
          />
        )}

        {/* 复制文字内容 */}
        <DrawerItem
          icon={copiedText ? Check : Copy}
          label={
            copiedText
              ? t("common:copied", "已复制到剪贴板")
              : t("contextMenu:copyText", "复制文字内容")
          }
          data-testid="mobile-action-copy"
          onClick={handleCopyText}
        />

        {/* 删除 / 撤回此消息 (带原地红色二次确认) */}
        {canDelete && onDelete && (
          <DrawerItem
            icon={Trash2}
            variant="danger"
            isDestructive={true}
            confirmLabel={t("contextMenu:confirmDelete", "确认删除？")}
            label={t("contextMenu:deleteOrRecall", "删除 / 撤回此消息")}
            data-testid="mobile-action-delete"
            onClick={() => {
              onDelete(message.id);
              onClose();
            }}
          />
        )}
      </div>
    </ActionDrawer>
  );
};
