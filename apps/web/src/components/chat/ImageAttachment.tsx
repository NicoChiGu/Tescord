import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, ImageOff, RefreshCw, Loader2 } from "lucide-react";
import type { Attachment } from "@tescord/types";
import { loadMediaBlob } from "../../services/attachmentAccess.js";

export interface ImageAttachmentProps {
  attachment:
    | Attachment
    | { id?: string; url: string; fileName?: string; mimeType?: string };
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
  const [status, setStatus] = useState<
    "loading" | "renewing" | "loaded" | "error"
  >("loading");
  const [imageUrl, setImageUrl] = useState<string>();
  const [retryCount, setRetryCount] = useState(0);

  const fileName =
    attachment.fileName ||
    (typeof attachment.url === "string"
      ? attachment.url.split("/").pop()?.split("?")[0] || ""
      : "");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setStatus("loading");
    setImageUrl(undefined);

    void loadMediaBlob(
      "fileSize" in attachment ? attachment : attachment.url,
      "preview",
      controller.signal,
      () => {
        if (!cancelled) setStatus("renewing");
      },
    )
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
  }, [attachment.id || attachment.url, retryCount]);

  return (
    <div
      style={{ contain: "layout style" }}
      className={`relative group/att rounded-lg overflow-hidden border border-[#3f4147] max-w-sm max-h-64 min-h-[36px] w-fit h-fit bg-[#1e1f22] flex items-center justify-center select-none ${className}`}
    >
      {/* 1. 初始加载态：优雅流光骨架屏 + 微光脉冲 */}
      {status === "loading" && (
        <div
          data-testid="image-skeleton"
          className="relative w-64 h-40 aspect-video max-w-full bg-[#2b2d31] animate-pulse overflow-hidden flex flex-col items-center justify-center text-discord-textMuted/40"
        >
          {/* Shimmer 光效 */}
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent pointer-events-none" />
          <div className="relative flex items-center justify-center">
            <ImageIcon className="w-8 h-8 opacity-40 animate-pulse" />
            <Loader2 className="absolute w-5 h-5 text-discord-brand/70 animate-spin" />
          </div>
        </div>
      )}

      {/* 2. Token 过期静默换签中态：平滑旋转光晕环，无文字打扰 */}
      {status === "renewing" && (
        <div
          data-testid="image-renewing"
          className="relative w-64 h-40 aspect-video max-w-full bg-[#232428] overflow-hidden flex items-center justify-center border border-discord-brand/30"
        >
          {/* 呼吸光环 */}
          <div className="absolute inset-0 bg-discord-brand/5 animate-pulse" />
          <div className="relative flex items-center justify-center p-3 rounded-full bg-[#2b2d31]/80 shadow-lg border border-discord-brand/40">
            <RefreshCw className="w-6 h-6 text-discord-brand animate-spin drop-shadow-[0_0_8px_rgba(88,101,242,0.5)]" />
          </div>
        </div>
      )}

      {/* 3. 加载异常态 */}
      {status === "error" && (
        <div
          data-testid="image-load-error"
          className="w-56 h-36 bg-[#2b2d31]/90 p-3 flex flex-col items-center justify-center text-center gap-2 border border-red-500/20 rounded-lg"
        >
          <div className="p-2 rounded-full bg-[#1e1f22] border border-red-500/30 text-red-400/80 shadow-inner">
            <ImageOff className="w-5 h-5" />
          </div>
          <span className="text-[11px] text-red-400 font-medium">
            {t("lightbox.loadFailed")}
          </span>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            aria-label={t("lightbox.retry")}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#35373c] hover:bg-[#3f4147] hover:text-white text-discord-textNormal text-xs rounded transition duration-150 hover:scale-105 active:scale-95 shadow"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t("lightbox.retry")}</span>
          </button>
        </div>
      )}

      {/* 4. 成功渲染态：平滑淡入呈现 */}
      {imageUrl && status !== "error" && (
        <button
          type="button"
          onClick={() => {
            const fullAttachment: Attachment =
              "fileSize" in attachment
                ? (attachment as Attachment)
                : {
                    id: attachment.id || attachment.url,
                    url: attachment.url,
                    fileName,
                    fileSize: 0,
                    mimeType:
                      attachment.mimeType ||
                      `image/${fileName.split(".").pop() || "png"}`,
                  };
            onPreview?.(fullAttachment);
          }}
          className={
            status === "loaded"
              ? "block w-fit h-fit"
              : "absolute opacity-0 pointer-events-none"
          }
          aria-label={t("lightbox.previewAria", { fileName })}
        >
          <img
            src={imageUrl}
            alt={fileName}
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
