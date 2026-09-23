import React, { useMemo } from "react";
import { parseFastMarkdown, Spoiler } from "./fastMarkdown.js";

export { Spoiler };

export interface MarkdownRendererProps {
  content: string;
  onMentionClick?: (username: string, rect: DOMRect) => void;
  currentUsername?: string;
}

const MarkdownRendererComponent: React.FC<MarkdownRendererProps> = ({
  content,
  onMentionClick,
  currentUsername,
}) => {
  const renderedContent = useMemo(() => {
    return parseFastMarkdown(content, {
      onMentionClick,
      currentUsername,
    });
  }, [content, onMentionClick, currentUsername]);

  return (
    <div className="text-[14px] leading-[1.375rem] text-discord-textNormal break-words font-normal">
      {renderedContent}
    </div>
  );
};

export const MarkdownRenderer = React.memo(MarkdownRendererComponent);
