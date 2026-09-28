import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, ImageOff, RefreshCw } from "lucide-react";
import type { Attachment } from "@tescord/types";
import { loadAttachmentBlob } from "../../services/attachmentAccess.js";

export interface ImageAttachmentProps {
  attachment: Attachment;
  onPreview?: (attachment: Attachment) => void;
  onLoadSuccess?: () => void;
  className?: string;
}

export const ImageAttachment: React.FC<ImageAttachmentProps> = ({
  attachment,
  onPreview,
  onLoadSuccess,
  className = "",
}) => {
  const { t } = useTranslation("chat");
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [imageUrl, setImageUrl] = useState<string>();
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setStatus("loading");
    void loadAttachmentBlob(attachment, "preview", controller.signal)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, retryCount]);

  return (
    <div
      style={{ contain: "layout style" }}
      className={`relative group/att rounded-lg overflow-hidden border border-[#3f4147] max-w-sm max-h-64 min-h-[36px] w-fit h-fit bg-[#1e1f22] flex items-center justify-center ${className}`}
    >
      {status === "loading" && (
        <div
          data-testid="image-skeleton"
          className="w-64 h-36 aspect-video max-w-full bg-[#2b2d31] animate-pulse flex flex-col items-center justify-center text-discord-textMuted/60 gap-2"
        >
          <ImageIcon className="w-8 h-8" />
          <span className="text-xs">{t("lightbox.loading")}</span>
        </div>
      )}
      {status === "error" && (
        <div
          data-testid="image-load-error"
          className="w-72 min-h-[140px] bg-[#2b2d31] p-4 flex flex-col items-center justify-center text-center gap-2 border border-red-500/20"
        >
          <ImageOff className="w-6 h-6 text-red-400" />
          <span className="text-xs text-discord-textNormal truncate max-w-[200px]">
            {attachment.fileName}
          </span>
          <span className="text-[11px] text-red-400">
            {t("lightbox.loadFailed")}
          </span>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#35373c] hover:bg-[#3f4147] text-white text-xs rounded"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("lightbox.retry")}
          </button>
        </div>
      )}
      {imageUrl && status !== "error" && (
        <button
          type="button"
          onClick={() => onPreview?.(attachment)}
          className={
            status === "loaded"
              ? "block w-fit h-fit"
              : "absolute opacity-0 pointer-events-none"
          }
          aria-label={t("lightbox.previewAria", {
            fileName: attachment.fileName,
          })}
        >
          <img
            src={imageUrl}
            alt={attachment.fileName}
            loading="lazy"
            decoding="async"
            onLoad={() => {
              setStatus("loaded");
              onLoadSuccess?.();
            }}
            onError={() => setStatus("error")}
            className="block max-w-full max-h-64 object-contain transition duration-200 group-hover/att:scale-105"
          />
        </button>
      )}
    </div>
  );
};
