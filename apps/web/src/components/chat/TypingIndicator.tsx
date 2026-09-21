import React from "react";

export interface TypingUser {
  id: string;
  username: string;
}

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  typingUsers,
}) => {
  const isTyping = typingUsers.length > 0;

  const renderTypingText = () => {
    if (typingUsers.length === 0) return null;

    if (typingUsers.length === 1) {
      return (
        <span>
          <strong className="font-semibold text-discord-textNormal">
            {typingUsers[0].username}
          </strong>{" "}
          正在输入...
        </span>
      );
    }

    if (typingUsers.length === 2) {
      return (
        <span>
          <strong className="font-semibold text-discord-textNormal">
            {typingUsers[0].username}
          </strong>{" "}
          和{" "}
          <strong className="font-semibold text-discord-textNormal">
            {typingUsers[1].username}
          </strong>{" "}
          正在输入...
        </span>
      );
    }

    if (typingUsers.length === 3) {
      return (
        <span>
          <strong className="font-semibold text-discord-textNormal">
            {typingUsers[0].username}
          </strong>
          、
          <strong className="font-semibold text-discord-textNormal">
            {typingUsers[1].username}
          </strong>{" "}
          和{" "}
          <strong className="font-semibold text-discord-textNormal">
            {typingUsers[2].username}
          </strong>{" "}
          正在输入...
        </span>
      );
    }

    return (
      <span>
        <strong className="font-semibold text-discord-textNormal">数人</strong>{" "}
        正在输入...
      </span>
    );
  };

  return (
    <div
      data-testid="typing-indicator"
      className={`h-5 min-h-[20px] max-h-[20px] px-1 flex items-center text-xs text-discord-textMuted select-none overflow-hidden transition-opacity duration-150 ${
        isTyping ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      aria-live="polite"
      aria-atomic="true"
    >
      {isTyping && (
        <div className="flex items-center space-x-1.5 truncate">
          {/* Discord 经典三圆点跳跃动画 */}
          <div
            className="flex items-center space-x-0.5 shrink-0"
            aria-hidden="true"
            data-testid="typing-dots"
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-discord-textMuted animate-typing-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-discord-textMuted animate-typing-bounce"
              style={{ animationDelay: "180ms" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-discord-textMuted animate-typing-bounce"
              style={{ animationDelay: "360ms" }}
            />
          </div>

          <div className="truncate" data-testid="typing-text">
            {renderTypingText()}
          </div>
        </div>
      )}
    </div>
  );
};
