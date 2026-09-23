import React, { useState, useRef, useEffect } from "react";
import { ImageIcon, ImageOff, RefreshCw } from "lucide-react";
import { Attachment } from "@tescord/types";
import { resolveServerUrl } from "../../config.js";

export interface ImageAttachmentProps {
  attachment: Attachment;
  onPreview?: (attachment: Attachment) => void;
  className?: string;
}

export const ImageAttachment: React.FC<ImageAttachmentProps> = ({
  attachment,
  onPreview,
  className = "",
}) => {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [retryCount, setRetryCount] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const baseUrl = resolveServerUrl(attachment.url);
  const imageUrl =
    retryCount > 0
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}_retry=${retryCount}`
      : baseUrl;

  // 处理图片从缓存中瞬间完成加载的情况
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete) {
      if (imgRef.current.naturalWidth > 0) {
        setStatus("loaded");
      }
    }
  }, [imageUrl]);

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus("loading");
    setRetryCount((prev) => prev + 1);
  };

  return (
    <div
      className={`relative group/att rounded-lg overflow-hidden border border-[#3f4147] max-w-sm max-h-64 min-h-[100px] bg-[#1e1f22] ${className}`}
    >
      {/* 1. 骨架屏占位：在完全加载成功前持续呈现 */}
      {status === "loading" && (
        <div
          data-testid="image-skeleton"
          className="w-72 h-48 bg-[#2b2d31] animate-pulse flex flex-col items-center justify-center select-none text-discord-textMuted/40 space-y-2"
        >
          <div className="p-3 bg-[#35373c]/50 rounded-full">
            <ImageIcon className="w-8 h-8 text-discord-textMuted/60" />
          </div>
          <span className="text-[11px] text-discord-textMuted/60 font-medium">
            图片加载中...
          </span>
        </div>
      )}

      {/* 2. 加载失败错误兜底卡片 */}
      {status === "error" && (
        <div
          data-testid="image-load-error"
          className="w-72 min-h-[140px] bg-[#2b2d31] p-4 flex flex-col items-center justify-center text-center space-y-2 select-none border border-red-500/20"
        >
          <div className="p-2.5 bg-red-500/10 rounded-full text-red-400">
            <ImageOff className="w-6 h-6" />
          </div>
          <div className="space-y-0.5">
            <div
              className="text-xs font-medium text-discord-textNormal truncate max-w-[200px]"
              title={attachment.fileName}
            >
              {attachment.fileName}
            </div>
            <div className="text-[11px] text-red-400 font-medium">
              图片加载失败
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center space-x-1.5 px-3 py-1 bg-[#35373c] hover:bg-[#3f4147] text-white text-xs font-medium rounded transition active:scale-95"
            title="重新尝试加载图片"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>点击重试</span>
          </button>
        </div>
      )}

      {/* 3. 真实图片元素：在后台加载，完全 onLoad 后平滑淡入并支持点击放大预览 */}
      {status !== "error" && (
        <div
          onClick={() => {
            if (status === "loaded") {
              onPreview?.(attachment);
            }
          }}
          className={`cursor-pointer transition-opacity duration-300 ${
            status === "loaded"
              ? "opacity-100"
              : "opacity-0 absolute inset-0 pointer-events-none"
          }`}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt={attachment.fileName}
            loading="lazy"
            decoding="async"
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
            className="w-full h-full object-cover transition duration-200 group-hover/att:scale-105"
          />
          {status === "loaded" && (
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/att:opacity-100 transition flex items-center justify-center text-white text-xs space-x-1 font-medium pointer-events-none select-none">
              <span>点击放大预览</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
