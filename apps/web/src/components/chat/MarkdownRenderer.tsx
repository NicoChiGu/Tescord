import React, { useMemo } from "react";
import { parseFastMarkdown, Spoiler } from "./fastMarkdown.js";

export { Spoiler };

export interface MarkdownRendererProps {
  content: string;
  onMentionClick?: (username: string, rect: DOMRect) => void;
  onAttachmentClick?: (url: string) => void;
  currentUsername?: string;
  className?: string;
}

const MarkdownRendererComponent: React.FC<MarkdownRendererProps> = ({
  content,
  onMentionClick,
  onAttachmentClick,
  currentUsername,
  className = "",
}) => {
  const renderedContent = useMemo(() => {
    return parseFastMarkdown(content, {
      onMentionClick,
      onAttachmentClick,
      currentUsername,
    });
  }, [content, onMentionClick, onAttachmentClick, currentUsername]);

  return (
    <div
      className={`text-[length:var(--chat-font-size,16px)] leading-[var(--chat-line-height,1.375rem)] text-discord-textNormal break-words font-normal ${className}`}
    >
      {renderedContent}
    </div>
  );
};

export const MarkdownRenderer = React.memo(MarkdownRendererComponent);
