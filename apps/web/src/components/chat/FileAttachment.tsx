import React, { useEffect, useRef, useState } from "react";
import type { Attachment } from "@tescord/types";
import { Download, FileText, RefreshCw } from "lucide-react";
import { resolveServerUrl } from "../../config.js";
import {
  getAttachmentAccess,
  openAttachmentDownload,
} from "../../services/attachmentAccess.js";

interface FileAttachmentProps {
  attachment: Attachment;
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  attachment,
}) => {
  const isAudio = attachment.mimeType.startsWith("audio/");
  const isVideo = attachment.mimeType.startsWith("video/");
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
          setError(cause instanceof Error ? cause.message : "预览不可用");
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, isAudio, isVideo]);

  const retryMedia = () => {
    void getAttachmentAccess(attachment, true)
      .then((access) => {
        setMediaUrl(resolveServerUrl(access.url));
        setMediaFailed(false);
        setError(undefined);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "预览不可用"),
      );
  };
  const onMediaError = () => {
    if (mediaRetryCount.current++ === 0) retryMedia();
    else setMediaFailed(true);
  };
  const download = () => {
    void openAttachmentDownload(attachment).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "下载失败"),
    );
  };

  return (
    <div className="flex flex-col gap-2 bg-[#2b2d31] p-2.5 rounded-lg border border-[#3f4147] w-full max-w-sm text-discord-textNormal">
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
        <FileText className="w-7 h-7 text-discord-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <div
            className="text-xs font-medium truncate"
            title={attachment.fileName}
          >
            {attachment.fileName}
          </div>
          <div className="text-[10px] text-discord-textMuted">
            {(attachment.fileSize / 1024).toFixed(1)} KB ·{" "}
            {attachment.mimeType || "文件"}
          </div>
        </div>
        {(mediaFailed || error) && (isAudio || isVideo) && (
          <button
            type="button"
            onClick={retryMedia}
            title="重新获取预览"
            aria-label="重新获取预览"
            className="p-1 text-discord-textMuted hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={download}
          title={`下载 ${attachment.fileName}`}
          aria-label={`下载 ${attachment.fileName}`}
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
