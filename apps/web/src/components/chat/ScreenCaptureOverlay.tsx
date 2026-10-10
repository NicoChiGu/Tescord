import React, { useState, useRef, useEffect, useCallback } from "react";
import { Copy, Download, Send, X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ScreenCaptureOverlayProps {
  imageSrc: string;
  onClose: () => void;
  onComplete?: (blob: Blob, dataUrl: string) => void;
}

interface Rect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export const ScreenCaptureOverlay: React.FC<ScreenCaptureOverlayProps> = ({
  imageSrc,
  onClose,
  onComplete,
}) => {
  const { t } = useTranslation("chat");
  const [rect, setRect] = useState<Rect | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const getNormalizedRect = useCallback(() => {
    if (!rect) return null;
    const x = Math.min(rect.startX, rect.currentX);
    const y = Math.min(rect.startY, rect.currentY);
    const w = Math.abs(rect.currentX - rect.startX);
    const h = Math.abs(rect.currentY - rect.startY);
    return { x, y, w, h };
  }, [rect]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isFinished) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    setRect({
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
    });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !rect) return;
    setRect((prev) =>
      prev
        ? {
            ...prev,
            currentX: e.clientX,
            currentY: e.clientY,
          }
        : null,
    );
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const norm = getNormalizedRect();
    if (norm && norm.w > 10 && norm.h > 10) {
      setIsFinished(true);
    } else {
      setRect(null);
    }
  };

  const cropImage = useCallback(async (): Promise<{
    blob: Blob | null;
    dataUrl: string | null;
  }> => {
    const norm = getNormalizedRect();
    if (!norm || norm.w <= 0 || norm.h <= 0)
      return { blob: null, dataUrl: null };

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const scaleX = img.naturalWidth / window.innerWidth;
        const scaleY = img.naturalHeight / window.innerHeight;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(norm.w * scaleX);
        canvas.height = Math.round(norm.h * scaleY);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ blob: null, dataUrl: null });
          return;
        }

        ctx.drawImage(
          img,
          Math.round(norm.x * scaleX),
          Math.round(norm.y * scaleY),
          canvas.width,
          canvas.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );

        const dataUrl = canvas.toDataURL("image/png");
        canvas.toBlob((blob) => {
          resolve({ blob, dataUrl });
        }, "image/png");
      };
      img.onerror = () => resolve({ blob: null, dataUrl: null });
      img.src = imageSrc;
    });
  }, [getNormalizedRect, imageSrc]);

  const handleCopy = useCallback(async () => {
    const { blob, dataUrl } = await cropImage();
    if (!dataUrl) return;

    let copied = false;
    if (
      typeof window !== "undefined" &&
      window.electronAPI?.writeClipboardImage
    ) {
      copied = await window.electronAPI.writeClipboardImage(dataUrl);
    }

    if (!copied && blob && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        copied = true;
      } catch {}
    }

    showToast(t("chat:screenCapture.cropCopied", "截图已复制到剪贴板"));
    setTimeout(() => {
      onClose();
    }, 600);
  }, [cropImage, onClose, showToast, t]);

  const handleSave = useCallback(async () => {
    const { dataUrl, blob } = await cropImage();
    if (!dataUrl) return;

    if (typeof window !== "undefined" && window.electronAPI?.saveImageFile) {
      const saved = await window.electronAPI.saveImageFile(
        dataUrl,
        `tescord-screenshot-${Date.now()}.png`,
      );
      if (saved) {
        showToast(t("chat:screenCapture.cropSaved", "截图已保存"));
        setTimeout(() => onClose(), 600);
      }
      return;
    }

    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tescord-screenshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t("chat:screenCapture.cropSaved", "截图已保存"));
      setTimeout(() => onClose(), 600);
    }
  }, [cropImage, onClose, showToast, t]);

  const handleSendToChat = useCallback(async () => {
    const { blob, dataUrl } = await cropImage();
    if (blob && dataUrl && onComplete) {
      onComplete(blob, dataUrl);
    }
    onClose();
  }, [cropImage, onComplete, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && isFinished) {
        handleCopy();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isFinished, handleCopy]);

  const norm = getNormalizedRect();

  return (
    <div
      ref={containerRef}
      data-testid="screen-capture-overlay"
      className="fixed inset-0 z-[99999] select-none cursor-crosshair overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        backgroundImage: `url(${imageSrc})`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
      }}
    >
      {/* 暗色遮罩层 */}
      <div className="absolute inset-0 bg-black/45 pointer-events-none" />

      {/* 选区矩形高亮打孔与边框 */}
      {norm && (
        <div
          data-testid="screen-capture-selection"
          className="absolute border-2 border-[#5865f2] shadow-2xl pointer-events-none"
          style={{
            left: norm.x,
            top: norm.y,
            width: norm.w,
            height: norm.h,
            backgroundImage: `url(${imageSrc})`,
            backgroundPosition: `-${norm.x}px -${norm.y}px`,
            backgroundSize: `${window.innerWidth}px ${window.innerHeight}px`,
            backgroundRepeat: "no-repeat",
          }}
        >
          {/* 尺寸标签 */}
          <div className="absolute -top-6 left-0 bg-[#1e1f22]/90 text-white text-[10px] font-mono px-2 py-0.5 rounded shadow">
            {Math.round(norm.w)} × {Math.round(norm.h)}
          </div>
        </div>
      )}

      {/* 选区完成后的操作工具条 */}
      {isFinished && norm && (
        <div
          data-testid="screen-capture-actions"
          className="absolute z-10 flex items-center gap-1.5 bg-[#1e1f22]/95 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-[#3f4147] shadow-2xl pointer-events-auto"
          style={{
            left: Math.min(
              Math.max(16, norm.x + norm.w - 200),
              window.innerWidth - 220,
            ),
            top:
              norm.y + norm.h + 8 + 40 > window.innerHeight
                ? Math.max(16, norm.y - 48)
                : norm.y + norm.h + 8,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="capture-copy-btn"
            onClick={handleCopy}
            className="p-1.5 rounded hover:bg-white/10 text-white/90 hover:text-white transition flex items-center gap-1 text-xs"
            title={t("chat:screenCapture.copy", "复制到剪贴板")}
          >
            <Copy className="w-3.5 h-3.5 text-[#5865f2]" />
            <span>{t("chat:screenCapture.copyShort", "复制")}</span>
          </button>

          <button
            type="button"
            data-testid="capture-save-btn"
            onClick={handleSave}
            className="p-1.5 rounded hover:bg-white/10 text-white/90 hover:text-white transition flex items-center gap-1 text-xs"
            title={t("chat:screenCapture.save", "保存图片")}
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t("chat:screenCapture.saveShort", "保存")}</span>
          </button>

          {onComplete && (
            <button
              type="button"
              data-testid="capture-send-btn"
              onClick={handleSendToChat}
              className="p-1.5 rounded hover:bg-white/10 text-white/90 hover:text-white transition flex items-center gap-1 text-xs"
              title={t("chat:screenCapture.send", "发送到聊天")}
            >
              <Send className="w-3.5 h-3.5 text-blue-400" />
              <span>{t("chat:screenCapture.sendShort", "发送")}</span>
            </button>
          )}

          <div className="w-[1px] h-4 bg-white/20 mx-0.5" />

          <button
            type="button"
            data-testid="capture-cancel-btn"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400 transition"
            title={t("chat:screenCapture.cancel", "取消 (ESC)")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 轻提示 Toast */}
      {toastMessage && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-[#1e1f22]/95 border border-[#3f4147] text-white text-xs rounded-full shadow-2xl flex items-center gap-2 pointer-events-none animate-fade-in">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
