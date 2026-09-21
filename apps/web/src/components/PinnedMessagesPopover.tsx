import React, { useEffect, useRef } from "react";
import { Message, User } from "@tescord/types";
import {
  Pin,
  PinOff,
  X,
  ExternalLink,
  MessageSquare,
  Image as ImageIcon,
} from "lucide-react";

interface PinnedMessagesPopoverProps {
  channelName: string;
  pinnedMessages: Message[];
  decryptedContents?: Record<string, { text: string; fingerprint?: string }>;
  currentUser: User;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
}

export const PinnedMessagesPopover: React.FC<PinnedMessagesPopoverProps> = ({
  channelName,
  pinnedMessages,
  decryptedContents = {},
  currentUser,
  onClose,
  onJumpToMessage,
  onUnpinMessage,
}) => {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // 监听点击外部与 ESC 键自动关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const formatTime = (dateStr?: string | Date) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-14 right-4 sm:right-12 z-50 w-80 sm:w-[420px] max-h-[560px] bg-[#2b2d31] border border-[#202225] rounded-lg shadow-2xl flex flex-col overflow-hidden animate-fade-in text-discord-textNormal"
    >
      {/* 顶部标题栏 */}
      <div className="h-12 px-4 bg-[#232428] border-b border-[#1f2023] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <Pin className="w-4 h-4 text-discord-textHeader rotate-45" />
          <span className="font-bold text-discord-textHeader text-sm">
            已固定的消息
          </span>
          <span className="text-xs text-discord-textMuted font-medium">
            ({pinnedMessages.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-discord-textMuted hover:text-white hover:bg-[#35373c] transition"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 置顶消息流 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar max-h-[480px]">
        {pinnedMessages.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center px-4">
            <div className="w-14 h-14 rounded-full bg-[#1e1f22] flex items-center justify-center mb-3">
              <Pin className="w-7 h-7 text-discord-textMuted opacity-60 rotate-45" />
            </div>
            <h4 className="text-sm font-semibold text-discord-textHeader mb-1">
              还没有已固定的消息
            </h4>
            <p className="text-xs text-discord-textMuted max-w-xs leading-relaxed">
              悬停在 #{channelName}{" "}
              中的任何重要消息上，点击右键或操作栏中的“置顶消息”即可将其固定在此处。
            </p>
          </div>
        ) : (
          pinnedMessages.map((msg) => {
            const rawContent =
              msg.isEncrypted && decryptedContents[msg.id]
                ? decryptedContents[msg.id].text
                : msg.content;

            return (
              <div
                key={msg.id}
                className="bg-[#1e1f22] hover:bg-[#232428] border border-[#26282c] rounded-lg p-3 transition group relative"
              >
                {/* 作者头像、名字与发布时间 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    <img
                      src={
                        msg.author?.avatarUrl ||
                        "https://api.dicebear.com/7.x/bottts/svg?seed=user"
                      }
                      alt={msg.author?.username || "用户"}
                      className="w-6 h-6 rounded-full flex-shrink-0"
                    />
                    <span className="font-semibold text-xs text-discord-textHeader truncate">
                      {msg.author?.username || "用户"}
                    </span>
                    <span className="text-[10px] text-discord-textMuted font-mono flex-shrink-0">
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>

                  {/* 悬浮操作按钮组 */}
                  <div className="flex items-center space-x-1 opacity-80 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => {
                        onJumpToMessage(msg.id);
                        onClose();
                      }}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-discord-brand/20 hover:bg-discord-brand text-discord-brand hover:text-white text-[11px] font-medium transition"
                      title="在聊天视口中定位此消息"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>跳转</span>
                    </button>
                    {onUnpinMessage && (
                      <button
                        type="button"
                        onClick={() => onUnpinMessage(msg.id)}
                        className="p-1 rounded text-discord-textMuted hover:text-discord-danger hover:bg-discord-danger/10 transition"
                        title="取消固定"
                      >
                        <PinOff className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 消息文本 */}
                {rawContent && (
                  <p className="text-xs text-discord-textNormal whitespace-pre-wrap break-words leading-relaxed pl-8">
                    {rawContent}
                  </p>
                )}

                {/* 图片或附件预览 */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 pl-8 flex flex-wrap gap-2">
                    {msg.attachments.map((att) => {
                      const isImg =
                        att.mimeType?.startsWith("image/") ||
                        /\.(png|jpe?g|gif|webp|svg)$/i.test(att.fileName);
                      if (isImg) {
                        return (
                          <img
                            key={att.id || att.url}
                            src={att.url}
                            alt={att.fileName}
                            className="max-h-28 max-w-full rounded border border-[#2b2d31] object-cover"
                          />
                        );
                      }
                      return (
                        <div
                          key={att.id || att.url}
                          className="flex items-center space-x-1.5 bg-[#2b2d31] px-2 py-1 rounded text-[11px] text-gray-300"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-discord-textMuted" />
                          <span className="truncate max-w-[150px]">
                            {att.fileName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
