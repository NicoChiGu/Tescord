import React, { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  GuildIconCrop,
  GuildIconMetadata,
  PresignedUploadResponse,
} from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { getErrorMessage } from "../../i18n/index.js";
import { toast } from "../../stores/useToastStore.js";
import { ImageCropModal } from "../modals/ImageCropModal.js";

export function GifIconEditor({
  file,
  guildId,
  onClose,
  onConfirm,
}: {
  file: File;
  guildId: string;
  onClose: () => void;
  onConfirm: (fileUrl: string, preview: Blob) => void;
}) {
  const { t } = useTranslation(["server", "common"]);
  const [metadata, setMetadata] = useState<GuildIconMetadata>();
  const [source, setSource] = useState<string>();
  const [preview, setPreview] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [loadedFrame, setLoadedFrame] = useState(-1);
  const [output, setOutput] = useState<"animated" | "frame">("animated");
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [error, setError] = useState<string>();
  const sourceRef = useRef<string>();
  const originalUrl = useRef<string>();
  const resultRef = useRef<string>();
  const active = useRef(true);
  const generation = useRef(0);
  const processController = useRef<AbortController>();
  const frameObjectUrl = useRef<string>();
  const request = async (
    action: string,
    body: object,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(
      `${API_BASE}/api/guilds/${encodeURIComponent(guildId)}/icon/${action}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...useAuthStore.getState().getAuthHeaders(),
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!response.ok)
      throw await response.json().catch(() => ({ code: "UPLOAD_FAILED" }));
    return response;
  };
  const discard = (fileUrl: string) =>
    void fetch(
      `${API_BASE}/api/guilds/${encodeURIComponent(guildId)}/pending-icon`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...useAuthStore.getState().getAuthHeaders(),
        },
        body: JSON.stringify({ fileUrl }),
        keepalive: true,
      },
    ).catch(() => {});
  useEffect(() => {
    active.current = true;
    const revision = ++generation.current;
    sourceRef.current = undefined;
    resultRef.current = undefined;
    const controller = new AbortController();
    void (async () => {
      if (file.size > 10 * 1024 * 1024) throw { code: "FILE_TOO_LARGE" };
      const response = await fetch(
        `${API_BASE}/api/attachments/presigned-url`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...useAuthStore.getState().getAuthHeaders(),
          },
          body: JSON.stringify({
            fileName: "guild_icon.gif",
            fileSize: file.size,
            mimeType: "image/gif",
            purpose: "guild-icon",
            guildId,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw await response.json();
      const grant = (await response.json()) as PresignedUploadResponse;
      if (controller.signal.aborted || generation.current !== revision) {
        discard(grant.fileUrl);
        return;
      }
      sourceRef.current = grant.fileUrl;
      const upload = await fetch(resolveServerUrl(grant.uploadUrl), {
        method: "PUT",
        headers: {
          "Content-Type": "image/gif",
          ...(grant.requiresAuth
            ? useAuthStore.getState().getAuthHeaders()
            : {}),
        },
        body: file,
        signal: controller.signal,
      });
      if (!upload.ok) throw await upload.json();
      const meta = (await (
        await request("metadata", { fileUrl: grant.fileUrl }, controller.signal)
      ).json()) as GuildIconMetadata;
      if (
        !active.current ||
        controller.signal.aborted ||
        generation.current !== revision
      )
        return;
      originalUrl.current = URL.createObjectURL(file);
      setSource(grant.fileUrl);
      setMetadata(meta);
      if (playing) setPreview(originalUrl.current);
    })().catch((cause) => {
      if (!controller.signal.aborted && active.current)
        setError(getErrorMessage(cause));
    });
    return () => {
      active.current = false;
      generation.current++;
      controller.abort();
      processController.current?.abort();
      if (sourceRef.current) discard(sourceRef.current);
      if (resultRef.current) discard(resultRef.current);
      if (originalUrl.current) URL.revokeObjectURL(originalUrl.current);
      if (frameObjectUrl.current) URL.revokeObjectURL(frameObjectUrl.current);
    };
  }, [file, guildId]);
  useEffect(() => {
    if (!source || playing) {
      if (playing && originalUrl.current) setPreview(originalUrl.current);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const timer = setTimeout(() => {
      void request("preview", { fileUrl: source, frame }, controller.signal)
        .then((response) => response.blob())
        .then((blob) => {
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          if (frameObjectUrl.current)
            URL.revokeObjectURL(frameObjectUrl.current);
          frameObjectUrl.current = objectUrl;
          setPreview(objectUrl);
          setLoadedFrame(frame);
        })
        .catch((cause) => {
          if (!controller.signal.aborted) toast.error(getErrorMessage(cause));
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, frame, playing]);
  const confirm = async (crop: GuildIconCrop) => {
    if (!source || !active.current) return;
    const revision = generation.current;
    const controller = new AbortController();
    processController.current?.abort();
    processController.current = controller;
    let processedUrl: string | undefined;
    try {
      const processed = (await (
        await request(
          "process",
          { fileUrl: source, output, frame, crop },
          controller.signal,
        )
      ).json()) as { fileUrl: string };
      processedUrl = processed.fileUrl;
      if (
        controller.signal.aborted ||
        !active.current ||
        generation.current !== revision
      )
        return;
      resultRef.current = processed.fileUrl;
      // Use the server-decoded frame for the settings preview, including iOS.
      const blob = await (
        await request(
          "preview",
          { fileUrl: processed.fileUrl, frame: 0 },
          controller.signal,
        )
      ).blob();
      if (
        controller.signal.aborted ||
        !active.current ||
        generation.current !== revision
      )
        return;
      onConfirm(processed.fileUrl, blob);
      resultRef.current = undefined;
      processedUrl = undefined;
    } catch (cause) {
      if (
        !controller.signal.aborted &&
        active.current &&
        generation.current === revision
      )
        toast.error(getErrorMessage(cause));
      throw cause;
    } finally {
      if (processedUrl) {
        discard(processedUrl);
        if (resultRef.current === processedUrl) resultRef.current = undefined;
      }
    }
  };
  if (!metadata || !preview)
    return (
      <div
        className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label={t("server:gifIcon.title")}
      >
        <div className="bg-discord-channelList p-6 rounded-xl max-w-sm text-discord-textNormal">
          <div role="status" className="flex items-center gap-3">
            {!error && <Loader2 className="animate-spin w-5 h-5" />}
            {error || t("server:gifIcon.preparing")}
          </div>
          <button className="mt-4 px-4 py-2" onClick={onClose}>
            {t("common:cancel")}
          </button>
        </div>
      </div>
    );
  return (
    <ImageCropModal
      isOpen
      imageSrc={preview}
      resetKey={source}
      onClose={onClose}
      onConfirm={() => {}}
      onConfirmCrop={confirm}
      busy={!playing && loadedFrame !== frame}
      controls={
        <div
          className="space-y-3 text-sm text-discord-textNormal"
          data-testid="gif-icon-controls"
        >
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="gif-icon-animated"
              aria-pressed={output === "animated"}
              onClick={() => {
                setOutput("animated");
                setPlaying(true);
              }}
              className={`flex-1 rounded px-3 py-2 ${output === "animated" ? "bg-discord-brand" : "bg-black/20"}`}
            >
              {t("server:gifIcon.keepAnimation")}
            </button>
            <button
              type="button"
              data-testid="gif-icon-static"
              aria-pressed={output === "frame"}
              onClick={() => {
                setOutput("frame");
                setPlaying(false);
              }}
              className={`flex-1 rounded px-3 py-2 ${output === "frame" ? "bg-discord-brand" : "bg-black/20"}`}
            >
              {t("server:gifIcon.useFrame")}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="min-w-11 min-h-11 flex items-center justify-center"
              disabled={output === "frame"}
              onClick={() => setPlaying((value) => !value)}
              aria-label={t(
                playing ? "server:gifIcon.pause" : "server:gifIcon.play",
              )}
            >
              {playing ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              data-testid="gif-icon-frame"
              min={0}
              max={metadata.frames - 1}
              step={1}
              value={frame}
              aria-label={t("server:gifIcon.selectFrame")}
              className="min-w-0 flex-1 accent-discord-brand"
              onChange={(event) => {
                setFrame(Number(event.target.value));
                setPlaying(false);
              }}
            />
            <span className="tabular-nums text-xs">
              {frame + 1}/{metadata.frames}
            </span>
          </div>
        </div>
      }
    />
  );
}
