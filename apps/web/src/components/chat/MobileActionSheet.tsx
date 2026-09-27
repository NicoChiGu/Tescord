import React, { useState } from "react";
import { Message, Guild } from "@tescord/types";
import { usePermissions } from "../../hooks/usePermissions.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { Reply, Pin, Edit2, Trash2, Copy, Check, X, Smile } from "lucide-react";
import { EmojiPickerPopover } from "./EmojiPickerPopover.js";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🚀", "🎉", "🔥"];

interface MobileActionSheetProps {
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
  const { user: currentUser } = useAuthStore();
  const { canManageMessages } = usePermissions(guild);
  const [copiedText, setCopiedText] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);

  if (!isOpen || !message) return null;

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

  return (
    <div
      data-testid="mobile-action-sheet"
      className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden"
    >
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* 底部抽屉主体 */}
      <div className="relative z-10 w-full bg-[#2b2d31] rounded-t-2xl shadow-2xl border-t border-[#3f4147] px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] animate-slide-up flex flex-col space-y-3">
        {/* 顶部指示条与关闭按钮 */}
        <div className="flex items-center justify-between pb-1">
          <div className="w-10 h-1 bg-[#4e5058] rounded-full mx-auto" />
          <button
            onClick={onClose}
            className="absolute right-4 top-3 text-discord-textMuted hover:text-white p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 快捷 Emoji 表情条 */}
        <div className="bg-[#1e1f22] p-2 rounded-xl flex items-center justify-between overflow-x-auto custom-scrollbar">
          <div className="flex items-center space-x-2">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleReactionClick(emoji)}
                className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-[#35373c] active:scale-125 rounded-lg transition"
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="relative pl-2 border-l border-[#35373c] flex-shrink-0">
            <button
              onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
              className="w-10 h-10 flex items-center justify-center text-discord-textMuted hover:text-white hover:bg-[#35373c] rounded-lg transition"
              title="更多表情"
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
            />
          </div>
        </div>

        {/* 操作项按钮列表 */}
        <div className="bg-[#1e1f22] rounded-xl overflow-hidden divide-y divide-[#35373c]">
          {onReply && (
            <button
              onClick={() => {
                onReply(message);
                onClose();
              }}
              className="w-full flex items-center space-x-3 px-4 py-3.5 text-discord-textNormal hover:bg-[#35373c] active:bg-discord-brand active:text-white transition"
            >
              <Reply className="w-5 h-5 text-discord-textMuted" />
              <span className="text-sm font-medium">引用回复</span>
            </button>
          )}

          {isAuthor && onEdit && (
            <button
              onClick={() => {
                onEdit(message);
                onClose();
              }}
              className="w-full flex items-center space-x-3 px-4 py-3.5 text-discord-textNormal hover:bg-[#35373c] active:bg-discord-brand active:text-white transition"
            >
              <Edit2 className="w-5 h-5 text-discord-textMuted" />
              <span className="text-sm font-medium">编辑消息</span>
            </button>
          )}

          {(isAuthor || canManageMessages) && onTogglePin && (
            <button
              onClick={() => {
                onTogglePin(message.id);
                onClose();
              }}
              className="w-full flex items-center space-x-3 px-4 py-3.5 text-discord-textNormal hover:bg-[#35373c] active:bg-discord-brand active:text-white transition"
            >
              <Pin
                className={`w-5 h-5 ${
                  message.isPinned
                    ? "text-amber-400 fill-amber-400"
                    : "text-discord-textMuted"
                }`}
              />
              <span className="text-sm font-medium">
                {message.isPinned ? "取消置顶" : "置顶该消息"}
              </span>
            </button>
          )}

          <button
            onClick={handleCopyText}
            className="w-full flex items-center space-x-3 px-4 py-3.5 text-discord-textNormal hover:bg-[#35373c] active:bg-discord-brand active:text-white transition"
          >
            {copiedText ? (
              <Check className="w-5 h-5 text-discord-green" />
            ) : (
              <Copy className="w-5 h-5 text-discord-textMuted" />
            )}
            <span className="text-sm font-medium">
              {copiedText ? "已复制到剪贴板" : "复制文字内容"}
            </span>
          </button>

          {canDelete && onDelete && (
            <button
              onClick={() => {
                onDelete(message.id);
                onClose();
              }}
              className="w-full flex items-center space-x-3 px-4 py-3.5 text-discord-danger hover:bg-discord-danger/10 active:bg-discord-danger active:text-white transition"
            >
              <Trash2 className="w-5 h-5" />
              <span className="text-sm font-medium">删除 / 撤回此消息</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
