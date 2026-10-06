import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Attachment } from "@tescord/types";
import { Box, Download, Eye, FileText, RefreshCw } from "lucide-react";
import { resolveServerUrl } from "../../config.js";
import {
  getAttachmentAccess,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";
import { isStlFile } from "../../utils/fileType.js";

interface FileAttachmentProps {
  attachment: Attachment;
  onPreviewStl?: (attachment: Attachment) => void;
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  attachment,
  onPreviewStl,
}) => {
  const { t } = useTranslation("chat");
  const isAudio = attachment.mimeType.startsWith("audio/");
  const isVideo = attachment.mimeType.startsWith("video/");
  const isStl = isStlFile(attachment.mimeType, attachment.fileName);

  const [mediaUrl, setMediaUrl] = useState<string>();
  const [mediaFailed, setMediaFailed] = useState(false);
  const [error, setError] = useState<string>();
  const mediaRetryCount = useRef(0);

  useEffect(() => {
    if (!isAudio && !isVideo) return;
    let cancelled = false;
    void getAttachmentAccess(attachment)
      .then((access) => {
        if (!cancelled) setMediaUrl(resolveServerUrl(access.url));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : t("stlPreview.loadFailed"),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, isAudio, isVideo, t]);

  const retryMedia = () => {
    void getAttachmentAccess(attachment, true)
      .then((access) => {
        setMediaUrl(resolveServerUrl(access.url));
        setMediaFailed(false);
        setError(undefined);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : t("stlPreview.loadFailed"),
        ),
      );
  };
  const onMediaError = () => {
    if (mediaRetryCount.current++ === 0) retryMedia();
    else setMediaFailed(true);
  };
  const download = () => {
    void openAttachmentDownload(attachment).catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : t("lightbox.downloadFailed"),
      ),
    );
  };

  return (
    <div
      data-testid="file-attachment-card"
      className="flex flex-col gap-2 bg-[#2b2d31] p-2.5 rounded-lg border border-[#3f4147] w-full max-w-sm text-discord-textNormal"
    >
      {mediaUrl && !mediaFailed && isAudio && (
        <audio
          controls
          preload="none"
          src={mediaUrl}
          onError={onMediaError}
          className="w-full"
        />
      )}
      {mediaUrl && !mediaFailed && isVideo && (
        <video
          controls
          preload="metadata"
          src={mediaUrl}
          onError={onMediaError}
          className="w-full max-h-64 rounded"
        />
      )}
      <div className="flex items-center gap-2 min-w-0">
        {isStl ? (
          <div
            data-testid="file-stl-icon"
            className="p-1 rounded-md bg-discord-brand/20 text-discord-brand shrink-0"
          >
            <Box className="w-5 h-5" />
          </div>
        ) : (
          <FileText className="w-7 h-7 text-discord-brand shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={`text-xs font-medium truncate ${
              isStl && onPreviewStl
                ? "cursor-pointer hover:underline text-discord-interactiveHover hover:text-white"
                : ""
            }`}
            title={attachment.fileName}
            onClick={
              isStl && onPreviewStl ? () => onPreviewStl(attachment) : undefined
            }
          >
            {attachment.fileName}
          </div>
          <div className="text-[10px] text-discord-textMuted flex items-center gap-1">
            <span>{(attachment.fileSize / 1024).toFixed(1)} KB</span>
            <span>·</span>
            <span>
              {isStl ? t("stlPreview.tag") : attachment.mimeType || "File"}
            </span>
          </div>
        </div>

        {/* 3D 在线预览按钮 */}
        {isStl && onPreviewStl && (
          <button
            type="button"
            onClick={() => onPreviewStl(attachment)}
            title={t("stlPreview.previewButton")}
            aria-label={t("stlPreview.previewButtonAria")}
            data-testid="file-stl-preview-btn"
            className="p-1 text-discord-textMuted hover:text-white transition-colors"
          >
            <Eye className="w-4 h-4" />
          </button>
        )}

        {(mediaFailed || error) && (isAudio || isVideo) && (
          <button
            type="button"
            onClick={retryMedia}
            title={t("lightbox.retry")}
            aria-label={t("lightbox.retry")}
            className="p-1 text-discord-textMuted hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={download}
          title={`${t("lightbox.download")}: ${attachment.fileName}`}
          aria-label={`${t("lightbox.download")}: ${attachment.fileName}`}
          className="p-1 text-discord-textMuted hover:text-white"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
      {error && (
        <span role="alert" className="text-xs text-red-400">
          {error}
        </span>
      )}
    </div>
  );
};

