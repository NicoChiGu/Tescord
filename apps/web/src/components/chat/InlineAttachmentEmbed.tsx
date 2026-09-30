import React, { useMemo } from "react";
import type { Attachment } from "@tescord/types";
import { ImageAttachment } from "./ImageAttachment.js";
import { extractInlineAttachmentUrls } from "../../utils/url.js";
import { isServerAttachmentImage } from "../../config.js";

export { extractInlineAttachmentUrls };

export interface InlineAttachmentEmbedProps {
  content?: string;
  existingAttachmentUrls?: Set<string>;
  onPreview?: (attachment: Attachment) => void;
  className?: string;
}

export const InlineAttachmentEmbed: React.FC<InlineAttachmentEmbedProps> = ({
  content,
  existingAttachmentUrls,
  onPreview,
  className = "",
}) => {
  const inlineUrls = useMemo(() => {
    const extracted = extractInlineAttachmentUrls(content).filter(
      isServerAttachmentImage,
    );
    if (!extracted.length) return [];
    if (!existingAttachmentUrls || existingAttachmentUrls.size === 0)
      return extracted;

    // 过滤掉已经在 message.attachments 中展示过的同名或同源附件
    return extracted.filter((url) => {
      const fileName = url.split("/attachments/")[1]?.split("?")[0];
      return !Array.from(existingAttachmentUrls).some(
        (existing) => fileName && existing.includes(fileName),
      );
    });
  }, [content, existingAttachmentUrls]);

  if (inlineUrls.length === 0) return null;

  return (
    <div
      className={`mt-2 ${
        inlineUrls.length === 1
          ? "flex flex-wrap gap-2"
          : "grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl"
      } ${className}`}
    >
      {inlineUrls.map((url) => {
        const rawFileName =
          url.split("/attachments/")[1]?.split("?")[0] || "image.png";
        const fileName = decodeURIComponent(rawFileName);

        return (
          <ImageAttachment
            key={url}
            attachment={{
              id: url,
              url,
              fileName,
              fileSize: 0,
              mimeType: `image/${fileName.split(".").pop() || "png"}`,
            }}
            onPreview={onPreview}
          />
        );
      })}
    </div>
  );
};
