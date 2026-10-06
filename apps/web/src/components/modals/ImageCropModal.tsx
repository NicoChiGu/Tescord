import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "../../i18n/index.js";
import type { GuildIconCrop } from "@tescord/types";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (croppedBlob: Blob) => Promise<void> | void;
  aspectRatio?: number;
  isCircular?: boolean;
  onConfirmCrop?: (crop: GuildIconCrop) => Promise<void>;
  controls?: React.ReactNode;
  resetKey?: string;
  busy?: boolean;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  onClose,
  onConfirm,
  aspectRatio = 1,
  isCircular = true,
  onConfirmCrop,
  controls,
  resetKey,
  busy = false,
}) => {
  const { t } = useTranslation(["modals", "common"]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef(false);
  useEffect(() => {
    active.current = isOpen;
    return () => {
      active.current = false;
    };
  }, [isOpen]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 打开新图片时重置缩放和偏移
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setIsProcessing(false);
      setError(undefined);
    }
  }, [isOpen, resetKey ?? imageSrc]);

  const viewportSize = 256;
  const baseScale =
    imageSize.width > 0 && imageSize.height > 0
      ? Math.max(
          viewportSize / imageSize.width,
          viewportSize / imageSize.height,
        )
      : 1;
  const baseRenderWidth = imageSize.width * baseScale;
  const baseRenderHeight = imageSize.height * baseScale;

  const clampPan = useCallback(
    (next: { x: number; y: number }, nextZoom = zoom) => {
      const maxX = Math.max(0, (baseRenderWidth * nextZoom - viewportSize) / 2);
      const maxY = Math.max(
        0,
        (baseRenderHeight * nextZoom - viewportSize) / 2,
      );
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    [baseRenderHeight, baseRenderWidth, zoom],
  );

  useEffect(() => {
    setPan((previous) => clampPan(previous));
  }, [clampPan]);

  // Pointer Events 同时覆盖鼠标、触控笔与手机触摸拖拽。
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      setPan(
        clampPan({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        }),
      );
    },
    [clampPan, isDragging, dragStart],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setIsDragging(false);
    },
    [],
  );

  // 注册非 passive 的原生 wheel 事件监听器，阻止浏览器默认滚动并执行平滑缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setZoom((prev) => {
        const next = Math.min(3, Math.max(1, +(prev + delta).toFixed(2)));
        setPan((current) => clampPan(current, next));
        return next;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [clampPan]);

  // 生成裁切并压缩后的 WebP Blob (512x512)
  const handleCropAndSave = async () => {
    if (!imgRef.current) return;
    if (busy || isProcessing || !imageSize.width) return;
    setIsProcessing(true);
    setError(undefined);
    try {
      const img = imgRef.current;
      if (onConfirmCrop) {
        const size = viewportSize / (baseScale * zoom);
        await onConfirmCrop({
          left: Math.max(
            0,
            Math.min(
              img.naturalWidth - size,
              (img.naturalWidth - size) / 2 - pan.x / (baseScale * zoom),
            ),
          ),
          top: Math.max(
            0,
            Math.min(
              img.naturalHeight - size,
              (img.naturalHeight - size) / 2 - pan.y / (baseScale * zoom),
            ),
          ),
          size,
        });
        if (active.current) onClose();
        return;
      }
      const targetSize = 512;
      const canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext("2d");

      if (!ctx) throw new Error(t("modals:cropModal.processingFailed"));

      // 计算缩放比例与居中基准
      const naturalWidth = img.naturalWidth || 512;
      const naturalHeight = img.naturalHeight || 512;

      // 取景框内的渲染尺寸
      const renderBaseScale = Math.max(
        viewportSize / naturalWidth,
        viewportSize / naturalHeight,
      );
      const currentRenderWidth = naturalWidth * renderBaseScale * zoom;
      const currentRenderHeight = naturalHeight * renderBaseScale * zoom;

      // 映射到 512x512 目标画布的坐标与尺寸
      const outputScale = targetSize / viewportSize;
      const drawWidth = currentRenderWidth * outputScale;
      const drawHeight = currentRenderHeight * outputScale;

      // 居中基准 + 偏移量放缩
      const centerOffsetX = (targetSize - drawWidth) / 2;
      const centerOffsetY = (targetSize - drawHeight) / 2;
      const drawX = centerOffsetX + pan.x * outputScale;
      const drawY = centerOffsetY + pan.y * outputScale;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      // 检测当前浏览器是否支持导出 WebP 格式（iOS Safari 部分版本会静默降级为 PNG）
      let exportType = "image/webp";
      let exportQuality = 0.88;
      try {
        const testCanvas = document.createElement("canvas");
        testCanvas.width = 1;
        testCanvas.height = 1;
        if (!testCanvas.toDataURL("image/webp").startsWith("data:image/webp")) {
          exportType = "image/jpeg";
          exportQuality = 0.9;
        }
      } catch {
        exportType = "image/jpeg";
        exportQuality = 0.9;
      }

      const encode = (type: string, quality: number) =>
        new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, type, quality),
        );
      const blob =
        (await encode(exportType, exportQuality)) ||
        (await encode("image/png", 1));
      if (!blob) throw new Error(t("modals:cropModal.processingFailed"));
      if (!active.current) return;
      await onConfirm(blob);
      if (active.current) onClose();
    } catch (err: unknown) {
      if (
        active.current &&
        !(err instanceof DOMException && err.name === "AbortError")
      )
        setError(getErrorMessage(err));
    } finally {
      if (active.current) setIsProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("modals:cropModal.title")}
      className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        className="bg-[#313338] w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题 */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/5">
          <h3 className="text-white text-base font-bold">
            {t("modals:cropModal.title", { defaultValue: "编辑图标尺寸" })}
          </h3>
          <button
            onClick={onClose}
            aria-label={t("common:cancel")}
            className="text-gray-400 hover:text-white transition p-1 rounded-lg hover:bg-white/5 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {controls && (
          <div className="px-6 pt-4" aria-busy={busy}>
            {controls}
          </div>
        )}

        {/* 提示文案 */}
        <div className="px-6 pt-3 text-xs text-discord-textMuted">
          {t("modals:cropModal.description", {
            defaultValue: "拖拽以平移取景位置，使用滑块调整缩放尺寸。",
          })}
        </div>

        {/* 交互视口取景框 */}
        <div className="p-6 flex flex-col items-center justify-center">
          <div
            ref={containerRef}
            data-testid="image-crop-container"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative w-64 h-64 overflow-hidden rounded-2xl bg-[#1e1f22] cursor-grab active:cursor-grabbing select-none border border-white/10 shadow-inner flex items-center justify-center"
            style={{ touchAction: "none" }}
          >
            {/* 待裁剪图片 */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt={t("modals:cropModal.previewAlt")}
              draggable={false}
              onLoad={(event) => {
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
              }}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                width: `${baseRenderWidth}px`,
                height: `${baseRenderHeight}px`,
                maxWidth: "none",
                maxHeight: "none",
                pointerEvents: "none",
                transition: isDragging ? "none" : "transform 0.05s ease-out",
              }}
            />

            {/* 半透明遮罩取景框：圆形或圆角矩形 */}
            <div className="absolute inset-0 pointer-events-none">
              <div
                className={`w-full h-full border-2 border-discord-brand/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ${
                  isCircular ? "rounded-full" : "rounded-xl"
                }`}
              />
            </div>
          </div>

          {/* 缩放滑块控件 */}
          <div className="w-64 mt-5 flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-full accent-discord-brand cursor-pointer h-1.5 bg-[#1e1f22] rounded-lg"
            />
            <ZoomIn className="w-4 h-4 text-gray-400 shrink-0" />
          </div>
        </div>

        {error && (
          <div role="alert" className="px-6 pb-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {/* 底部操作按钮 */}
        <div className="px-6 py-4 bg-[#2b2d31] flex items-center justify-end gap-3 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:underline transition"
          >
            {t("common:cancel", { defaultValue: "取消" })}
          </button>
          <button
            type="button"
            onClick={handleCropAndSave}
            disabled={isProcessing || busy || !imageSize.width}
            className="px-5 py-2 rounded-lg text-xs font-semibold bg-discord-brand hover:bg-discord-brand/90 text-white flex items-center gap-2 shadow-lg transition disabled:opacity-50 cursor-pointer"
          >
            {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>
              {t("modals:cropModal.confirmBtn", {
                defaultValue: "确认并上传",
              })}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
