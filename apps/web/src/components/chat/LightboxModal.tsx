import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Attachment } from "@tescord/types";
import { Download, Maximize2, Share2, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  loadAttachmentBlob,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";

interface LightboxModalProps {
  attachment: Attachment | null;
  onClose: () => void;
  fallbackUrl?: string;
  onForward?: (attachment: Attachment) => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  attachment,
  onClose,
  fallbackUrl,
  onForward,
}) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 缩放与平移状态
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // 引用与交互控制
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialPosX: 0,
    initialPosY: 0,
    hasMoved: false,
  });

  // 缩放上限与下限
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 6.0;

  // 重置缩放和平移
  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // 显示临时轻提示
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    const timer = setTimeout(() => setToastMessage(null), 2000);
    return () => clearTimeout(timer);
  }, []);

  // 键盘快捷键 (ESC 关闭或重置)
  useEffect(() => {
    if (!attachment) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (scale > 1) {
          resetZoom();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachment, onClose, scale, resetZoom]);

  // 切换附件时重置状态
  useEffect(() => {
    setShowOriginal(false);
    resetZoom();
  }, [attachment?.id, resetZoom]);

  // 加载图片资源（支持本地 fallbackUrl 秒开）
  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const controller = new AbortController();

    setError(undefined);

    // 如果提供了本地 Blob / ObjectUrl 且未要求强制查看原图，优先直接呈现
    if (fallbackUrl && !showOriginal) {
      setImageUrl(fallbackUrl);
      return;
    }

    setImageUrl(undefined);
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
        if (cancelled) return;
        // 若远程访问凭证报错但有 fallbackUrl，则优雅降级为本地预览
        if (fallbackUrl) {
          setImageUrl(fallbackUrl);
        } else {
          setError(cause instanceof Error ? cause.message : "图片加载失败");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment?.id, showOriginal, fallbackUrl]);

  // 鼠标滚轮以光标所在物理位置为锚点缩放 (Mouse-Centered Zoom)
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const container = viewportRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // 鼠标相对于视口中心位置
      const mouseX = e.clientX - centerX;
      const mouseY = e.clientY - centerY;

      // 缩放比例增量
      const zoomFactor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const newScale = Math.min(
        Math.max(Number((scale * zoomFactor).toFixed(3)), MIN_SCALE),
        MAX_SCALE,
      );

      if (newScale === scale) return;

      if (newScale <= 1.0) {
        // 缩小至 1x 或更小时平滑回正
        setScale(newScale);
        setPosition({ x: 0, y: 0 });
      } else {
        // 保持鼠标指针所指像素在屏幕上静止：Tx' = mouseX - (newScale/oldScale)*(mouseX - Tx)
        const ratio = newScale / scale;
        const newPosX = mouseX - ratio * (mouseX - position.x);
        const newPosY = mouseY - ratio * (mouseY - position.y);
        setScale(newScale);
        setPosition({ x: newPosX, y: newPosY });
      }
    },
    [scale, position],
  );

  // 注册非 passive 的 wheel 事件监听器，阻止浏览器默认滚动
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleWheel(e);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [handleWheel]);

  // 按钮单步放大 / 缩小（以视口正中心为锚点）
  const handleZoomStep = (delta: number) => {
    const newScale = Math.min(
      Math.max(Number((scale * delta).toFixed(2)), MIN_SCALE),
      MAX_SCALE,
    );
    if (newScale <= 1.0) {
      setScale(newScale);
      setPosition({ x: 0, y: 0 });
    } else {
      const ratio = newScale / scale;
      setScale(newScale);
      setPosition((prev) => ({
        x: prev.x * ratio,
        y: prev.y * ratio,
      }));
    }
  };

  // 鼠标拖拽平移 (Drag to Pan)
  const handleMouseDown = (e: React.MouseEvent) => {
    // 仅响应鼠标左键且放大比例 > 1 时允许拖拽
    if (e.button !== 0 || scale <= 1) return;
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialPosX: position.x,
      initialPosY: position.y,
      hasMoved: false,
    };
    setIsDragging(true);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragRef.current.hasMoved = true;
      }
      setPosition({
        x: dragRef.current.initialPosX + dx,
        y: dragRef.current.initialPosY + dy,
      });
    };

    const handleMouseUp = () => {
      dragRef.current.isDragging = false;
      setIsDragging(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // 双击切换缩放 (1x <=> 2x)
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      resetZoom();
    } else {
      const container = viewportRef.current;
      if (!container) {
        setScale(2);
        return;
      }
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - (rect.left + rect.width / 2);
      const mouseY = e.clientY - (rect.top + rect.height / 2);
      const newScale = 2.0;
      const ratio = newScale / scale;
      setScale(newScale);
      setPosition({
        x: mouseX - ratio * mouseX,
        y: mouseY - ratio * mouseY,
      });
    }
  };

  if (!attachment) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${attachment.fileName}`}
      onClick={(e) => {
        // 若在拖拽中释放则不误触发关闭
        if (dragRef.current.hasMoved) return;
        onClose();
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] select-none overflow-hidden"
    >
      {/* 顶部轻提示 (Toast) */}
      {toastMessage && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-[#1e1f22]/95 border border-[#3f4147] text-white text-xs rounded-full shadow-2xl animate-fade-in flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 右上角 Discord 风格工具栏 */}
      <div
        onClick={(event) => event.stopPropagation()}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex items-center gap-1.5 text-white/85 z-20 bg-[#1e1f22]/80 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-[#3f4147]/80 shadow-lg"
      >
        {/* 缩小 */}
        <button
          type="button"
          onClick={() => handleZoomStep(1 / 1.25)}
          disabled={scale <= MIN_SCALE}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-40 transition"
          title="缩小"
          aria-label="缩小图片"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        {/* 缩放比例指示与一键重置 */}
        <button
          type="button"
          onClick={resetZoom}
          className="px-1.5 py-0.5 min-w-[42px] text-center text-[11px] font-mono rounded hover:bg-white/10 hover:text-white transition"
          title="点击重置为 100%"
          aria-label="重置缩放"
        >
          {Math.round(scale * 100)}%
        </button>

        {/* 放大 */}
        <button
          type="button"
          onClick={() => handleZoomStep(1.25)}
          disabled={scale >= MAX_SCALE}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-40 transition"
          title="放大"
          aria-label="放大图片"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-4 bg-white/20 mx-1" />

        {/* 查看原图 */}
        <button
          type="button"
          onClick={() => setShowOriginal(true)}
          disabled={showOriginal}
          className="px-2 py-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-50 inline-flex gap-1 items-center text-xs transition"
          title="查看原图"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">原图</span>
        </button>

        {/* 转发按钮 */}
        <button
          type="button"
          onClick={() => {
            if (onForward) {
              onForward(attachment);
            } else {
              showToast("转发功能正在接入中...");
            }
          }}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white transition"
          title="转发"
          aria-label="转发图片"
        >
          <Share2 className="w-4 h-4" />
        </button>

        {/* 下载原图 */}
        <button
          type="button"
          onClick={() =>
            void openAttachmentDownload(attachment).catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "下载失败"),
            )
          }
          className="p-1.5 rounded hover:bg-white/10 hover:text-white transition"
          title="下载原图"
          aria-label="下载原图"
        >
          <Download className="w-4 h-4" />
        </button>

        {/* 关闭预览 */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-red-500/80 hover:text-white transition"
          title="关闭预览 (ESC)"
          aria-label="关闭预览"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 图像视口与交互容器 */}
      <div
        ref={viewportRef}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden"
      >
        {imageUrl ? (
          <div
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            style={{
              transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
              transition: isDragging ? "none" : "transform 0.12s ease-out",
            }}
            className={`flex items-center justify-center ${
              scale > 1
                ? isDragging
                  ? "cursor-grabbing"
                  : "cursor-grab"
                : "cursor-zoom-in"
            }`}
          >
            <img
              src={imageUrl}
              alt={attachment.fileName}
              draggable={false}
              className="max-w-[85vw] max-h-[75vh] object-contain rounded shadow-2xl pointer-events-auto"
            />
          </div>
        ) : (
          <div className="text-white/70 text-sm">
            {error || "图片加载中..."}
          </div>
        )}

        {/* 底部信息条 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none text-xs text-white/60 bg-black/60 px-3 py-1 rounded-full truncate max-w-[90vw]">
          {attachment.fileName}
          {showOriginal ? " · 原图" : ""}
          {scale !== 1 ? ` · 缩放 ${Math.round(scale * 100)}%` : ""}
        </div>
      </div>
    </div>
  );
};
