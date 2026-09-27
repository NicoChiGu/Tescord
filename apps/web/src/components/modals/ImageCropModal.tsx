import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (croppedBlob: Blob) => Promise<void> | void;
  aspectRatio?: number;
  isCircular?: boolean;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  onClose,
  onConfirm,
  aspectRatio = 1,
  isCircular = true,
}) => {
  const { t } = useTranslation(["modals", "common"]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 打开新图片时重置缩放和偏移
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setIsProcessing(false);
    }
  }, [isOpen, imageSrc]);

  // 鼠标拖拽平移
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((prev) => Math.min(3, Math.max(1, +(prev + delta).toFixed(2))));
  };

  // 生成裁切并压缩后的 WebP Blob (512x512)
  const handleCropAndSave = async () => {
    if (!imgRef.current) return;
    setIsProcessing(true);
    try {
      const img = imgRef.current;
      const targetSize = 512;
      const canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext("2d");

      if (!ctx) throw new Error("无法创建画布上下文");

      // 视口取景框尺寸 (固定 256x256)
      const viewportSize = 256;
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

      // 导出极小体积的 WebP 图片 (质量 0.85)
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            setIsProcessing(false);
            return;
          }
          try {
            await onConfirm(blob);
            onClose();
          } finally {
            setIsProcessing(false);
          }
        },
        "image/webp",
        0.85,
      );
    } catch (err) {
      console.error("图片裁剪压缩失败:", err);
      setIsProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        className="bg-[#313338] w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border border-white/10 flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题 */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/5">
          <h3 className="text-white text-base font-bold">
            {t("modals:cropModal.title", { defaultValue: "编辑图标尺寸" })}
          </h3>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-gray-400 hover:text-white transition p-1 rounded-lg hover:bg-white/5 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            className="relative w-64 h-64 overflow-hidden rounded-2xl bg-[#1e1f22] cursor-grab active:cursor-grabbing select-none border border-white/10 shadow-inner flex items-center justify-center"
          >
            {/* 待裁剪图片 */}
            <img
              ref={imgRef}
              src={imageSrc}
              alt="crop preview"
              draggable={false}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
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

        {/* 底部操作按钮 */}
        <div className="px-6 py-4 bg-[#2b2d31] flex items-center justify-end gap-3 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:underline transition"
          >
            {t("common:cancel", { defaultValue: "取消" })}
          </button>
          <button
            type="button"
            onClick={handleCropAndSave}
            disabled={isProcessing}
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
