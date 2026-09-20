import React, { useEffect, useRef } from "react";

interface EmojiPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
}

const COMMON_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "🔥",
  "🎉",
  "🚀",
  "👀",
  "💯",
  "🤔",
  "💩",
  "🥳",
  "✨",
  "👏",
  "🙌",
  "💡",
  "⚡",
  "🤩",
  "💖",
  "🤝",
  "😎",
  "💀",
  "🤡",
  "✅",
  "❌",
];

export const EmojiPickerPopover: React.FC<EmojiPickerPopoverProps> = ({
  isOpen,
  onClose,
  onSelectEmoji,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full right-0 mb-2 z-40 bg-[#2b2d31] border border-[#3f4147] rounded-xl shadow-2xl p-2 w-64 animate-fade-in"
    >
      <div className="text-[11px] font-bold uppercase tracking-wider text-discord-textMuted px-2 py-1 mb-1">
        快捷表情 (Reactions)
      </div>
      <div className="grid grid-cols-6 gap-1 p-1">
        {COMMON_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => {
              onSelectEmoji(emoji);
              onClose();
            }}
            className="w-8 h-8 flex items-center justify-center text-lg hover:bg-[#35373c] rounded-lg transition hover:scale-125 select-none"
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
