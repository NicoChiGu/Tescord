import React, { useEffect } from "react";
import { X, Download, ExternalLink } from "lucide-react";

interface LightboxModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  fileName?: string;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  isOpen,
  imageUrl,
  fileName = "image.png",
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
    >
      {/* 顶部操作条 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute top-4 right-4 flex items-center space-x-3 text-white/80"
      >
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white p-2 rounded-full hover:bg-white/10 transition"
          title="在新窗口打开原图"
        >
          <ExternalLink className="w-5 h-5" />
        </a>
        <a
          href={imageUrl}
          download={fileName}
          className="hover:text-white p-2 rounded-full hover:bg-white/10 transition"
          title="下载图片"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          onClick={onClose}
          className="hover:text-white p-2 rounded-full hover:bg-white/10 transition"
          title="关闭预览 (ESC)"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* 图像容器 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-w-5xl max-h-[85vh] flex flex-col items-center justify-center select-none"
      >
        <img
          src={imageUrl}
          alt={fileName}
          className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl border border-white/10"
        />
        <div className="mt-3 text-xs text-white/60 truncate max-w-lg">
          {fileName}
        </div>
      </div>
    </div>
  );
};
