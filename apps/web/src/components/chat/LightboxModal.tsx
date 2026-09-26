import React, { useEffect, useState } from "react";
import type { Attachment } from "@tescord/types";
import { Download, Maximize2, X } from "lucide-react";
import {
  loadAttachmentBlob,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";

interface LightboxModalProps {
  attachment: Attachment | null;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  attachment,
  onClose,
}) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachment, onClose]);
  useEffect(() => setShowOriginal(false), [attachment?.id]);
  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setImageUrl(undefined);
    setError(undefined);
    void loadAttachmentBlob(
      attachment,
      showOriginal ? "original" : "preview",
      controller.signal,
    )
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "图片加载失败");
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment?.id, showOriginal]);
  if (!attachment) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${attachment.fileName}`}
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex items-center gap-2 text-white/85 z-10"
      >
        <button
          type="button"
          onClick={() => setShowOriginal(true)}
          disabled={showOriginal}
          className="px-2 py-2 rounded hover:bg-white/10 disabled:opacity-50 inline-flex gap-1 items-center text-xs"
          title="查看原图"
        >
          <Maximize2 className="w-4 h-4" />
          查看原图
        </button>
        <button
          type="button"
          onClick={() =>
            void openAttachmentDownload(attachment).catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "下载失败"),
            )
          }
          className="p-2 rounded hover:bg-white/10"
          title="下载原图"
          aria-label="下载原图"
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded hover:bg-white/10"
          aria-label="关闭预览"
        >
          <X className="w-6 h-6" />
        </button>
      </div>
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-w-full max-h-[85dvh] flex flex-col items-center justify-center pt-10"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={attachment.fileName}
            className="max-w-full max-h-[75dvh] object-contain rounded shadow-2xl"
          />
        ) : (
          <div className="text-white/70 text-sm">
            {error || "图片加载中..."}
          </div>
        )}
        <div className="mt-3 text-xs text-white/60 truncate max-w-[90vw]">
          {attachment.fileName}
          {showOriginal ? " · 原图" : ""}
        </div>
      </div>
    </div>
  );
};
