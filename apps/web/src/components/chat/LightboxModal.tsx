import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Attachment, DownloadProgress } from "@tescord/types";
import {
  Download,
  Loader2,
  Maximize2,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
  Sparkles,
} from "lucide-react";
import {
  loadAttachmentBlob,
  discardAttachmentBlob,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";

interface LightboxModalProps {
  attachment: Attachment | null;
  onClose: () => void;
  fallbackUrl?: string;
  onForward?: (attachment: Attachment) => void;
}

// 辅助计算：限制放大后平移坐标在安全视口范围内，防止图片移出视野
const clampPosition = (
  x: number,
  y: number,
  targetScale: number,
  imgEl: HTMLImageElement | null,
  containerEl: HTMLDivElement | null,
) => {
  if (targetScale <= 1 || !imgEl || !containerEl) {
    return { x: 0, y: 0 };
  }
  const containerW = containerEl.clientWidth;
  const containerH = containerEl.clientHeight;
  const imgW = imgEl.clientWidth * targetScale;
  const imgH = imgEl.clientHeight * targetScale;

  const maxPanX = Math.max(0, (imgW - containerW) / 2 + 30);
  const maxPanY = Math.max(0, (imgH - containerH) / 2 + 30);

  return {
    x: Math.min(maxPanX, Math.max(-maxPanX, x)),
    y: Math.min(maxPanY, Math.max(-maxPanY, y)),
  };
};

export const LightboxModal: React.FC<LightboxModalProps> = ({
  attachment,
  onClose,
  fallbackUrl,
  onForward,
}) => {
  const { t } = useTranslation("chat");

  const [showOriginal, setShowOriginal] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<DownloadProgress>();
  const [originalReady, setOriginalReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const activeObjectUrl = useRef<string>();

  // 缩放与平移状态
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // 1x 状态下单指下滑退出状态 (Swipe down to dismiss)
  const [dismissOffset, setDismissOffset] = useState(0);
  const [dismissOpacity, setDismissOpacity] = useState(1);

  // 引用与交互控制
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // 鼠标拖拽平移引用
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialPosX: 0,
    initialPosY: 0,
    hasMoved: false,
  });

  // 触控手势引用
  const touchStateRef = useRef<{
    mode: "none" | "pending" | "pan" | "pinch" | "swipe-down";
    startX1: number;
    startY1: number;
    startX2: number;
    startY2: number;
    initialDist: number;
    initialScale: number;
    initialPosX: number;
    initialPosY: number;
    midX: number;
    midY: number;
  }>({
    mode: "none",
    startX1: 0,
    startY1: 0,
    startX2: 0,
    startY2: 0,
    initialDist: 0,
    initialScale: 1,
    initialPosX: 0,
    initialPosY: 0,
    midX: 0,
    midY: 0,
  });

  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });

  // 缩放上限与下限
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 6.0;

  // 重置缩放和平移
  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setDismissOffset(0);
    setDismissOpacity(1);
  }, []);

  // 显示临时轻提示
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    const timer = setTimeout(() => setToastMessage(null), 2500);
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
    setOriginalReady(false);
    setImageUrl(fallbackUrl);
    setLoadProgress(undefined);
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    activeObjectUrl.current = undefined;
    resetZoom();
  }, [attachment?.id, resetZoom]);

  useEffect(
    () => () => {
      if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    },
    [],
  );

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

    setLoadProgress({ loaded: 0, phase: "downloading" });
    void loadAttachmentBlob(
      attachment,
      showOriginal ? "original" : "preview",
      controller.signal,
      undefined,
      (progress) => {
        if (!cancelled) setLoadProgress(progress);
      },
    )
      .then(async (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoadProgress({
          loaded: blob.size,
          total: blob.size,
          phase: "decoding",
        });
        const decoded = new Image();
        decoded.src = objectUrl;
        try {
          await decoded.decode();
        } catch {
          throw new Error(t("lightbox.loadFailed"));
        }
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (activeObjectUrl.current)
          URL.revokeObjectURL(activeObjectUrl.current);
        activeObjectUrl.current = objectUrl;
        setImageUrl(objectUrl);
        setOriginalReady(showOriginal);
        setLoadProgress(undefined);
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          if (objectUrl && objectUrl !== activeObjectUrl.current)
            URL.revokeObjectURL(objectUrl);
          return;
        }
        if (objectUrl)
          discardAttachmentBlob(
            attachment,
            showOriginal ? "original" : "preview",
          );
        if (objectUrl && objectUrl !== activeObjectUrl.current)
          URL.revokeObjectURL(objectUrl);
        setLoadProgress(undefined);
        setError(
          cause instanceof Error ? cause.message : t("lightbox.loadFailed"),
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl && objectUrl !== activeObjectUrl.current)
        URL.revokeObjectURL(objectUrl);
    };
  }, [attachment?.id, showOriginal, fallbackUrl, t, loadAttempt]);

  // 以指定屏幕坐标为锚点进行缩放 (Point-Centered Zoom)
  const zoomToPoint = useCallback(
    (clientX: number, clientY: number, targetScale: number) => {
      const container = viewportRef.current;
      if (!container) {
        setScale(targetScale);
        return;
      }
      const rect = container.getBoundingClientRect();
      const mouseX = clientX - (rect.left + rect.width / 2);
      const mouseY = clientY - (rect.top + rect.height / 2);

      if (targetScale <= 1.0) {
        setScale(targetScale);
        setPosition({ x: 0, y: 0 });
      } else {
        const ratio = targetScale / scale;
        const newPosX = mouseX - ratio * (mouseX - position.x);
        const newPosY = mouseY - ratio * (mouseY - position.y);
        const clamped = clampPosition(
          newPosX,
          newPosY,
          targetScale,
          imageRef.current,
          viewportRef.current,
        );
        setScale(targetScale);
        setPosition(clamped);
      }
    },
    [scale, position],
  );

  // 鼠标滚轮以光标所在物理位置为锚点缩放 (Mouse-Centered Zoom)
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const container = viewportRef.current;
      if (!container) return;

      const zoomFactor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const newScale = Math.min(
        Math.max(Number((scale * zoomFactor).toFixed(3)), MIN_SCALE),
        MAX_SCALE,
      );

      if (newScale === scale) return;
      zoomToPoint(e.clientX, e.clientY, newScale);
    },
    [scale, zoomToPoint],
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
      const clamped = clampPosition(
        position.x * ratio,
        position.y * ratio,
        newScale,
        imageRef.current,
        viewportRef.current,
      );
      setScale(newScale);
      setPosition(clamped);
    }
  };

  // 鼠标拖拽平移 (Drag to Pan on Desktop)
  const handleMouseDown = (e: React.MouseEvent) => {
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
      const clamped = clampPosition(
        dragRef.current.initialPosX + dx,
        dragRef.current.initialPosY + dy,
        scale,
        imageRef.current,
        viewportRef.current,
      );
      setPosition(clamped);
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

  // 双击快速切换 1x <=> 2x
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      resetZoom();
    } else {
      zoomToPoint(e.clientX, e.clientY, 2.0);
    }
  };

  // 移动端 Touch 触控手势系统（双指缩放、双击、放大平移、1x下滑退出）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      dragRef.current.hasMoved = false;

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchStateRef.current = {
          mode: "pending",
          startX1: touch.clientX,
          startY1: touch.clientY,
          startX2: 0,
          startY2: 0,
          initialDist: 0,
          initialScale: scale,
          initialPosX: position.x,
          initialPosY: position.y,
          midX: 0,
          midY: 0,
        };
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        const rect = el.getBoundingClientRect();
        const midX =
          (t1.clientX + t2.clientX) / 2 - (rect.left + rect.width / 2);
        const midY =
          (t1.clientY + t2.clientY) / 2 - (rect.top + rect.height / 2);

        dragRef.current.hasMoved = true;
        touchStateRef.current = {
          mode: "pinch",
          startX1: t1.clientX,
          startY1: t1.clientY,
          startX2: t2.clientX,
          startY2: t2.clientY,
          initialDist: dist,
          initialScale: scale,
          initialPosX: position.x,
          initialPosY: position.y,
          midX,
          midY,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStateRef.current.mode === "none") return;
      e.preventDefault();

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - touchStateRef.current.startX1;
        const dy = touch.clientY - touchStateRef.current.startY1;

        if (Math.hypot(dx, dy) > 6) {
          dragRef.current.hasMoved = true;
        }

        if (touchStateRef.current.mode === "pending") {
          // 判定意图：1x 下滑退出还是放大平移
          if (scale <= 1 && dy > 6 && dy > Math.abs(dx) * 1.1) {
            touchStateRef.current.mode = "swipe-down";
          } else if (scale > 1) {
            touchStateRef.current.mode = "pan";
          } else {
            touchStateRef.current.mode = "none";
          }
        }

        if (touchStateRef.current.mode === "swipe-down") {
          const offset = Math.max(0, dy);
          setDismissOffset(offset);
          setDismissOpacity(Math.max(0.15, 1 - offset / 380));
        } else if (touchStateRef.current.mode === "pan") {
          const clamped = clampPosition(
            touchStateRef.current.initialPosX + dx,
            touchStateRef.current.initialPosY + dy,
            scale,
            imageRef.current,
            el,
          );
          setPosition(clamped);
        }
      } else if (
        e.touches.length === 2 &&
        touchStateRef.current.mode === "pinch"
      ) {
        dragRef.current.hasMoved = true;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        const {
          initialDist,
          initialScale,
          initialPosX,
          initialPosY,
          midX,
          midY,
        } = touchStateRef.current;

        if (initialDist > 0) {
          const factor = dist / initialDist;
          const newScale = Math.min(
            Math.max(Number((initialScale * factor).toFixed(3)), MIN_SCALE),
            MAX_SCALE,
          );
          const ratio = newScale / initialScale;
          const newPosX = midX - ratio * (midX - initialPosX);
          const newPosY = midY - ratio * (midY - initialPosY);

          const clamped = clampPosition(
            newPosX,
            newPosY,
            newScale,
            imageRef.current,
            el,
          );
          setScale(newScale);
          setPosition(clamped);
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchStateRef.current.mode === "swipe-down") {
        if (dismissOffset > 90) {
          onClose();
          return;
        } else {
          // 回弹归位
          setDismissOffset(0);
          setDismissOpacity(1);
        }
      }

      // 如果双指缩放结束且缩小到小于 1x，弹性回正
      if (e.touches.length === 0) {
        if (scale < 1) {
          resetZoom();
        } else if (scale > 1) {
          const clamped = clampPosition(
            position.x,
            position.y,
            scale,
            imageRef.current,
            el,
          );
          setPosition(clamped);
        }

        // 移动端双击（Double Tap）检测
        if (!dragRef.current.hasMoved && e.changedTouches.length > 0) {
          const touch = e.changedTouches[0];
          const now = Date.now();
          const last = lastTapRef.current;
          if (
            now - last.time < 320 &&
            Math.hypot(touch.clientX - last.x, touch.clientY - last.y) < 32
          ) {
            lastTapRef.current = { time: 0, x: 0, y: 0 };
            if (scale > 1) {
              resetZoom();
            } else {
              zoomToPoint(touch.clientX, touch.clientY, 2.0);
            }
          } else {
            lastTapRef.current = {
              time: now,
              x: touch.clientX,
              y: touch.clientY,
            };
          }
        }

        touchStateRef.current.mode = "none";
      }
    };

    const onTouchCancel = () => {
      setDismissOffset(0);
      setDismissOpacity(1);
      touchStateRef.current.mode = "none";
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [scale, position, dismissOffset, onClose, resetZoom, zoomToPoint]);

  // 点击外部关闭：点击黑色空白遮罩区域立即关闭，拖拽后松手不误触
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (dragRef.current.hasMoved) return;
    onClose();
  };

  // 下载获取链接
  const handleDownload = async () => {
    if (isDownloading || !attachment) return;
    setIsDownloading(true);
    try {
      await openAttachmentDownload(attachment);
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : "";
      showToast(
        detail
          ? `${t("lightbox.downloadFailed")}: ${detail}`
          : t("lightbox.downloadFailed"),
      );
    } finally {
      setIsDownloading(false);
    }
  };

  if (!attachment) return null;

  return (
    <div
      role="dialog"
      data-testid="lightbox-modal"
      aria-modal="true"
      aria-label={t("lightbox.previewAria", { fileName: attachment.fileName })}
      onClick={handleBackdropClick}
      style={{
        backgroundColor: `rgba(0, 0, 0, ${0.9 * dismissOpacity})`,
        transition:
          dismissOffset > 0 ? "none" : "background-color 0.18s ease-out",
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] select-none overflow-hidden touch-none"
    >
      {/* 顶部轻提示 (Toast) */}
      {toastMessage && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-[#1e1f22]/95 border border-[#3f4147] text-white text-xs rounded-full shadow-2xl animate-fade-in flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 右上角 Discord 风格工具栏 */}
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          opacity: dismissOpacity,
          transition: dismissOffset > 0 ? "none" : "opacity 0.18s ease-out",
        }}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 flex items-center gap-1.5 text-white/85 z-20 bg-[#1e1f22]/80 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-[#3f4147]/80 shadow-lg"
      >
        {/* 缩小 */}
        <button
          type="button"
          onClick={() => handleZoomStep(1 / 1.25)}
          disabled={scale <= MIN_SCALE}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-40 transition"
          title={t("lightbox.zoomOut")}
          aria-label={t("lightbox.zoomOutAria")}
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        {/* 缩放比例指示与一键重置 */}
        <button
          type="button"
          onClick={resetZoom}
          className="px-1.5 py-0.5 min-w-[42px] text-center text-[11px] font-mono rounded hover:bg-white/10 hover:text-white transition"
          title={t("lightbox.resetZoom")}
          aria-label={t("lightbox.resetZoomAria")}
        >
          {Math.round(scale * 100)}%
        </button>

        {/* 放大 */}
        <button
          type="button"
          onClick={() => handleZoomStep(1.25)}
          disabled={scale >= MAX_SCALE}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-40 transition"
          title={t("lightbox.zoomIn")}
          aria-label={t("lightbox.zoomInAria")}
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-4 bg-white/20 mx-1" />

        {/* 查看原图 / HD 高清徽章 */}
        {originalReady ? (
          <div
            data-testid="lightbox-hd-badge"
            className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-1.5 text-xs font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-fadeIn select-none"
            title={t("lightbox.hdBadge")}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t("lightbox.hdBadge")}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowOriginal(true);
              setLoadAttempt((n) => n + 1);
            }}
            disabled={Boolean(loadProgress)}
            className="px-2 py-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-50 inline-flex gap-1 items-center text-xs transition"
            title={t("lightbox.viewOriginalTitle")}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {t("lightbox.viewOriginal")}
            </span>
          </button>
        )}

        {/* 转发按钮 */}
        <button
          type="button"
          onClick={() => {
            if (onForward) {
              onForward(attachment);
            } else {
              showToast(t("lightbox.forwardInProgress"));
            }
          }}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white transition"
          title={t("lightbox.forward")}
          aria-label={t("lightbox.forwardAria")}
        >
          <Share2 className="w-4 h-4" />
        </button>

        {/* 下载原图（带圆形加载条与防重点击） */}
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          className="p-1.5 rounded hover:bg-white/10 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed transition"
          title={t("lightbox.download")}
          aria-label={t("lightbox.downloadAria")}
        >
          {isDownloading ? (
            <Loader2 className="w-4 h-4 animate-spin text-discord-brand" />
          ) : (
            <Download className="w-4 h-4" />
          )}
        </button>

        {/* 关闭预览 */}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded hover:bg-red-500/80 hover:text-white transition"
          title={t("lightbox.close")}
          aria-label={t("lightbox.closeAria")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 图像视口与交互容器 */}
      <div
        ref={viewportRef}
        onClick={handleBackdropClick}
        className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden touch-none"
      >
        {imageUrl ? (
          <div
            onClick={(event) => event.stopPropagation()}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            style={{
              transform: `translate3d(${position.x}px, ${position.y + dismissOffset}px, 0) scale(${scale})`,
              transition:
                isDragging || dismissOffset > 0
                  ? "none"
                  : "transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)",
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
              ref={imageRef}
              src={imageUrl}
              alt={attachment.fileName}
              draggable={false}
              className="max-w-[85vw] max-h-[75vh] object-contain rounded shadow-2xl pointer-events-auto select-none transition-all duration-300 ease-in-out animate-fadeIn"
            />
          </div>
        ) : (
          <div className="text-white/70 text-sm">
            {error || t("lightbox.loading")}
          </div>
        )}

        {(loadProgress || error) && (
          <div
            data-testid="lightbox-load-status"
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-auto bg-[#1e1f22]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3 animate-fadeIn min-w-[200px]">
              {loadProgress ? (
                <>
                  {/* SVG 环形进度条 (Radial Progress) */}
                  <div className="relative w-20 h-20 flex items-center justify-center">
                    <svg
                      viewBox="0 0 80 80"
                      className="w-full h-full -rotate-90"
                    >
                      {/* 底轨 */}
                      <circle
                        cx="40"
                        cy="40"
                        r="32"
                        stroke="rgba(255, 255, 255, 0.1)"
                        strokeWidth="5"
                        fill="none"
                      />
                      {/* 动态进度轨 (周长 C = 2 * PI * 32 ≈ 201.06) */}
                      <circle
                        cx="40"
                        cy="40"
                        r="32"
                        stroke="#5865F2"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={201.06}
                        strokeDashoffset={(() => {
                          const percent = loadProgress.total
                            ? Math.min(
                                100,
                                Math.round(
                                  (loadProgress.loaded / loadProgress.total) *
                                    100,
                                ),
                              )
                            : loadProgress.phase === "decoding"
                              ? 100
                              : 0;
                          return 201.06 * (1 - percent / 100);
                        })()}
                        fill="none"
                        className="transition-[stroke-dashoffset] duration-200"
                      />
                    </svg>
                    {/* 环形中心状态数值 */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      {loadProgress.phase === "decoding" ? (
                        <Loader2 className="w-6 h-6 animate-spin text-discord-brand" />
                      ) : (
                        <span className="text-sm font-bold font-mono text-white">
                          {loadProgress.total
                            ? `${Math.min(100, Math.round((loadProgress.loaded / loadProgress.total) * 100))}%`
                            : "..."}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 状态文本与下载体积 */}
                  <div className="text-center space-y-1">
                    <div className="text-xs font-medium text-white/90">
                      {t(
                        loadProgress.phase === "decoding"
                          ? "lightbox.decoding"
                          : "lightbox.loading",
                      )}
                    </div>
                    {loadProgress.phase === "downloading" && (
                      <div className="text-[11px] font-mono text-discord-textMuted">
                        {t("lightbox.downloadProgress", {
                          loaded: (loadProgress.loaded / 1048576).toFixed(1),
                          total: loadProgress.total
                            ? (loadProgress.total / 1048576).toFixed(1)
                            : "?",
                        })}
                      </div>
                    )}
                  </div>

                  {/* 兼容 E2E 测试 expect(status.locator("progress")).toBeVisible() */}
                  <progress
                    aria-label={t("lightbox.loading")}
                    className="w-28 h-1 accent-discord-brand bg-white/10 rounded overflow-hidden"
                    max={loadProgress.total || 1}
                    value={
                      loadProgress.total
                        ? Math.min(loadProgress.loaded, loadProgress.total)
                        : undefined
                    }
                  />
                </>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-red-400 text-xs font-medium">
                    {error}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLoadAttempt((n) => n + 1)}
                    className="rounded bg-discord-brand hover:bg-discord-brand/80 px-4 py-1.5 text-xs text-white font-medium transition"
                  >
                    {t("common:retry")}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {/* 底部信息条 */}
        <div
          data-testid="lightbox-image-info"
          style={{
            opacity: dismissOpacity,
            transition: dismissOffset > 0 ? "none" : "opacity 0.18s ease-out",
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none text-xs text-white/60 bg-black/60 px-3 py-1 rounded-full truncate max-w-[90vw] inline-flex items-center gap-1.5"
        >
          <span>{attachment.fileName}</span>
          {originalReady ? (
            <span className="inline-flex items-center gap-1">
              <span> · {t("lightbox.originalBadge")}</span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[9px] border border-emerald-500/30">
                HD
              </span>
            </span>
          ) : (
            ""
          )}
          {scale !== 1
            ? ` · ${t("lightbox.zoomBadge", { percent: Math.round(scale * 100) })}`
            : ""}
        </div>
      </div>
    </div>
  );
};
