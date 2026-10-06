import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Attachment } from "@tescord/types";
import {
  Box,
  Download,
  Loader2,
  RotateCw,
  Maximize2,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  loadAttachmentBlob,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";
import { formatNumber, formatDimension } from "../../utils/fileType.js";
import { StlViewerCanvas, type StlModelStats } from "./StlViewerCanvas.js";

interface StlPreviewModalProps {
  attachment: Attachment | null;
  onClose: () => void;
}

export const StlPreviewModal: React.FC<StlPreviewModalProps> = ({
  attachment,
  onClose,
}) => {
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation("common");

  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StlModelStats | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [resetTrigger, setResetTrigger] = useState(0);

  // 加载 STL 二进制数据
  const loadData = useCallback(async (att: Attachment) => {
    setLoading(true);
    setError(null);
    setBuffer(null);
    setStats(null);

    try {
      const blob = await loadAttachmentBlob(att, "original");
      const arrayBuffer = await blob.arrayBuffer();
      setBuffer(arrayBuffer);
    } catch (err) {
      console.error("[StlPreviewModal] Failed to load STL blob:", err);
      setError(
        err instanceof Error ? err.message : t("stlPreview.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (attachment) {
      void loadData(attachment);
    } else {
      setBuffer(null);
      setError(null);
      setStats(null);
    }
  }, [attachment, loadData]);

  // ESC 键盘事件监听
  useEffect(() => {
    if (!attachment) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

  const handleDownload = () => {
    void openAttachmentDownload(attachment).catch((err) => {
      console.error("[StlPreviewModal] Download error:", err);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("stlPreview.title")}
      data-testid="stl-preview-modal"
      className="fixed inset-0 z-[120] flex flex-col bg-black/90 backdrop-blur-md animate-in fade-in duration-200 select-none"
    >
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#111214]/80 border-b border-white/10 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 rounded-lg bg-discord-brand/20 text-discord-brand shrink-0">
            <Box className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate max-w-xs sm:max-w-md">
                {attachment.fileName}
              </span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-discord-brand/20 text-discord-brand shrink-0">
                {t("stlPreview.tag")}
              </span>
            </div>
            <div className="text-xs text-white/50">
              {(attachment.fileSize / 1024).toFixed(1)} KB
            </div>
          </div>
        </div>

        {/* 顶部操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            title={t("stlPreview.download")}
            aria-label={t("stlPreview.downloadAria")}
            data-testid="stl-download-button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("stlPreview.download")}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("stlPreview.close")}
            aria-label={t("stlPreview.closeAria")}
            data-testid="stl-close-button"
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 3D 渲染主视口区域 */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex items-center justify-center">
        {loading && (
          <div
            data-testid="stl-loading-indicator"
            className="flex flex-col items-center gap-3 text-white/80"
          >
            <Loader2 className="w-8 h-8 animate-spin text-discord-brand" />
            <span className="text-sm">{t("stlPreview.loading")}</span>
          </div>
        )}

        {error && !loading && (
          <div
            data-testid="stl-error-container"
            className="flex flex-col items-center gap-3 max-w-sm px-6 py-5 bg-[#2b2d31]/90 rounded-xl border border-red-500/30 text-center"
          >
            <AlertCircle className="w-8 h-8 text-red-400" />
            <span className="text-sm text-red-200">{error}</span>
            <button
              type="button"
              onClick={() => void loadData(attachment)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-discord-brand hover:bg-discord-brandHover text-white text-xs font-medium rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("stlPreview.retry")}
            </button>
          </div>
        )}

        {buffer && !loading && !error && (
          <StlViewerCanvas
            data={buffer}
            autoRotate={autoRotate}
            resetTrigger={resetTrigger}
            onStatsReady={setStats}
            className="w-full h-full"
          />
        )}

        {/* 底部浮动控制与物理统计面板 */}
        {buffer && !loading && !error && (
          <div className="absolute bottom-5 inset-x-0 flex flex-col items-center gap-2 pointer-events-none px-4">
            <div
              data-testid="stl-control-panel"
              className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 px-4 py-2 rounded-2xl bg-[#111214]/90 backdrop-blur-md border border-white/10 text-xs text-white pointer-events-auto shadow-2xl"
            >
              {/* 三角面数统计 */}
              {stats && (
                <div
                  data-testid="stl-triangles-stat"
                  className="flex items-center gap-1.5 text-white/70"
                >
                  <span className="text-white/40">{t("stlPreview.triangles")}:</span>
                  <span className="font-semibold text-white">
                    {formatNumber(stats.triangleCount)}
                  </span>
                </div>
              )}

              {/* 外包围盒尺寸统计 */}
              {stats && (
                <div
                  data-testid="stl-dimensions-stat"
                  className="flex items-center gap-1.5 text-white/70 border-l border-white/10 pl-3 sm:pl-4"
                >
                  <span className="text-white/40">{t("stlPreview.dimensions")}:</span>
                  <span className="font-semibold text-white">
                    {t("stlPreview.dimensionsValue", {
                      x: formatDimension(stats.dimensions.x),
                      y: formatDimension(stats.dimensions.y),
                      z: formatDimension(stats.dimensions.z),
                    })}
                  </span>
                </div>
              )}

              {/* 视角控制按钮组 */}
              <div className="flex items-center gap-1 border-l border-white/10 pl-3 sm:pl-4">
                {/* 重置视角 */}
                <button
                  type="button"
                  onClick={() => setResetTrigger((n) => n + 1)}
                  title={t("stlPreview.resetCamera")}
                  aria-label={t("stlPreview.resetCameraAria")}
                  data-testid="stl-reset-camera-btn"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>{t("stlPreview.resetCamera")}</span>
                </button>

                {/* 自动慢速旋转开关 */}
                <button
                  type="button"
                  onClick={() => setAutoRotate((prev) => !prev)}
                  title={t("stlPreview.autoRotate")}
                  aria-label={
                    autoRotate
                      ? t("stlPreview.autoRotateOn")
                      : t("stlPreview.autoRotateOff")
                  }
                  data-testid="stl-auto-rotate-btn"
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors ${
                    autoRotate
                      ? "bg-discord-brand text-white font-medium shadow"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${autoRotate ? "animate-spin" : ""}`}
                  />
                  <span>{t("stlPreview.autoRotate")}</span>
                </button>
              </div>
            </div>

            {/* 操作提示小标签 */}
            <div className="text-[11px] text-white/40 pointer-events-none drop-shadow">
              {t("stlPreview.dragHint")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StlPreviewModal;
