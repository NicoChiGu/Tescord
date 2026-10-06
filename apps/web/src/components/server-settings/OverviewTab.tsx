import { GuildIcon } from "../ui/GuildIcon.js";
import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "../../i18n/index.js";
import { GifIconEditor } from "./GifIconEditor.js";
import type { PresignedUploadResponse } from "@tescord/types";
import { Guild } from "@tescord/types";
import { Camera, Copy, Check, UploadCloud } from "lucide-react";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";
import { ImageCropModal } from "../modals/ImageCropModal.js";

interface OverviewTabProps {
  guild: Guild;
  onUpdateGuild: (data: {
    name?: string;
    iconUrl?: string | null;
    description?: string | null;
    isPublic?: boolean;
  }) => Promise<void>;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  guild,
  onUpdateGuild,
}) => {
  const { t } = useTranslation(["server", "common", "errors"]);
  const { getAuthHeaders } = useAuthStore();
  const [name, setName] = useState(guild.name || "");
  const [iconUrl, setIconUrl] = useState(guild.iconUrl || "");
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [pendingUploadUrl, setPendingUploadUrl] = useState<string | null>(null);
  const [description, setDescription] = useState(guild.description || "");
  const [isPublic, setIsPublic] = useState(Boolean(guild.isPublic));
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [gifFile, setGifFile] = useState<File>();
  const uploadController = useRef<AbortController>();
  const uploadRevision = useRef(0);
  const pendingUploadRef = useRef<string | null>(null);

  const discardPendingUpload = (fileUrl: string): void => {
    void fetch(`${API_BASE}/api/guilds/${guild.id}/pending-icon`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ fileUrl }),
      keepalive: true,
    }).catch(() => {
      // The grant expires server-side; a failed best-effort cleanup must not
      // block navigation or overwrite the user's next selection.
    });
  };

  useEffect(() => {
    return () => {
      uploadRevision.current++;
      uploadController.current?.abort();
      if (pendingUploadRef.current) {
        discardPendingUpload(pendingUploadRef.current);
        pendingUploadRef.current = null;
      }
    };
  }, [guild.id]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);
  useEffect(
    () => () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    },
    [cropSrc],
  );

  const hasChanges =
    name.trim() !== (guild.name || "").trim() ||
    (pendingUploadUrl !== null && pendingUploadUrl !== (guild.iconUrl || "")) ||
    (pendingUploadUrl === null &&
      iconUrl.trim() !== (guild.iconUrl || "").trim()) ||
    description.trim() !== (guild.description || "").trim() ||
    isPublic !== Boolean(guild.isPublic);

  const handleReset = () => {
    uploadRevision.current++;
    uploadController.current?.abort();
    setIsUploading(false);
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    if (pendingUploadRef.current) {
      discardPendingUpload(pendingUploadRef.current);
      pendingUploadRef.current = null;
    }
    setPendingUploadUrl(null);
    setName(guild.name || "");
    setIconUrl(guild.iconUrl || "");
    setDescription(guild.description || "");
    setIsPublic(Boolean(guild.isPublic));
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(guild.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadRevision.current++;
    uploadController.current?.abort();
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("errors:FILE_TOO_LARGE"));
      e.target.value = "";
      return;
    }
    if (file.type === "image/gif" || /\.gif$/i.test(file.name)) {
      setGifFile(file);
      setIsCropModalOpen(false);
      setCropSrc(null);
      e.target.value = "";
      return;
    }
    setGifFile(undefined);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setIsCropModalOpen(true);
    e.target.value = "";
  };

  const handleUploadCropped = async (croppedBlob: Blob) => {
    const rawType = (croppedBlob.type || "").toLowerCase();
    const mimeType = rawType.includes("png")
      ? "image/png"
      : rawType.includes("jpeg") || rawType.includes("jpg")
        ? "image/jpeg"
        : "image/webp";
    const ext =
      mimeType === "image/png"
        ? ".png"
        : mimeType === "image/jpeg"
          ? ".jpg"
          : ".webp";
    const fileName = `guild_icon_${Date.now()}${ext}`;

    // 本地即时生成 Blob 预览，避免在点击保存前向 CDN/服务端发起 GET 请求产生 404
    const localBlob = URL.createObjectURL(croppedBlob);
    let previewCommitted = false;

    const controller = new AbortController();
    uploadController.current = controller;
    const revision = ++uploadRevision.current;
    let grantUrl: string | undefined;
    setIsUploading(true);
    try {
      const res = await fetch(`${API_BASE}/api/attachments/presigned-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          fileName,
          fileSize: croppedBlob.size,
          mimeType,
          purpose: "guild-icon",
          guildId: guild.id,
        }),
        signal: controller.signal,
      });
      if (!res.ok)
        throw await res.json().catch(() => ({ code: "UPLOAD_FAILED" }));
      const grant = (await res.json()) as PresignedUploadResponse;
      grantUrl = grant.fileUrl;
      if (controller.signal.aborted || revision !== uploadRevision.current)
        throw new DOMException("Cancelled", "AbortError");
      const uploadRes = await fetch(resolveServerUrl(grant.uploadUrl), {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          ...(grant.requiresAuth ? getAuthHeaders() : {}),
        },
        body: croppedBlob,
        signal: controller.signal,
      });
      if (!uploadRes.ok)
        throw await uploadRes.json().catch(() => ({ code: "UPLOAD_FAILED" }));
      if (controller.signal.aborted || revision !== uploadRevision.current)
        throw new DOMException("Cancelled", "AbortError");
      const previousPending = pendingUploadRef.current;
      pendingUploadRef.current = grant.fileUrl;
      setPendingUploadUrl(grant.fileUrl);
      if (previousPending && previousPending !== grant.fileUrl)
        discardPendingUpload(previousPending);
      grantUrl = undefined;
      setPreviewBlobUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return localBlob;
      });
      previewCommitted = true;
      toast.success(t("server:overview.iconUploadSuccess"));
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError"))
        toast.error(getErrorMessage(err));
      throw err;
    } finally {
      if (grantUrl) discardPendingUpload(grantUrl);
      if (!previewCommitted) URL.revokeObjectURL(localBlob);
      if (revision === uploadRevision.current) setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("errors:GUILD_NAME_REQUIRED"));
      return;
    }
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const targetIconUrl =
        pendingUploadUrl !== null ? pendingUploadUrl : iconUrl;
      await onUpdateGuild({
        name: name.trim(),
        iconUrl: targetIconUrl.trim() || null,
        description: description.trim() || null,
        isPublic,
      });
      pendingUploadRef.current = null;
      setIconUrl(targetIconUrl);
      setPendingUploadUrl(null);
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
        setPreviewBlobUrl(null);
      }
      setSaveSuccess(true);
      toast.success(t("server:overview.saveSuccess"));
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      toast.error(err.message || t("errors:UNKNOWN_ERROR"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">
          {t("server:overview.title")}
        </h2>
        <p className="text-xs text-gray-400">
          {t("server:overview.descriptionPlaceholder")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
        {/* 图标预览与上传 */}
        <div className="flex flex-col items-center md:items-start space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-300">
            {t("server:overview.iconLabel")}
          </label>
          <div className="relative group cursor-pointer w-28 h-28 rounded-full bg-[#1e1f22] border-2 border-dashed border-white/20 hover:border-[#5865f2] flex items-center justify-center overflow-hidden transition-all shadow-lg">
            {previewBlobUrl || iconUrl ? (
              <GuildIcon
                src={previewBlobUrl || resolveServerUrl(iconUrl)}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-3xl font-extrabold text-white">
                {name ? name.substring(0, 2).toUpperCase() : "TS"}
              </div>
            )}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity text-white">
              <Camera className="w-6 h-6 mb-1" />
              <span className="text-[10px] font-bold">
                {t("server:overview.changeIcon")}
              </span>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isUploading}
            />
          </div>
          <div className="text-[11px] text-gray-400 text-center md:text-left">
            {t("server:overview.iconRecommendation", {
              defaultValue:
                "推荐尺寸至少为 512x512，上传时支持拖拽缩放裁剪与自动压缩。",
            })}
            {isUploading && (
              <span className="text-[#5865f2] block font-semibold animate-pulse">
                {t("common:uploading", { defaultValue: "正在上传文件..." })}
              </span>
            )}
          </div>
        </div>

        {/* 基础表单输入 */}
        <div className="md:col-span-2 space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">
              {t("server:overview.nameLabel")}{" "}
              <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("server:overview.namePlaceholder")}
              className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">
              {t("server:overview.descriptionLabel")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("server:overview.descriptionPlaceholder")}
              rows={3}
              className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] transition-colors resize-none"
            />
          </div>

          {/* 公开状态开关 */}
          <div className="pt-2">
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#1e1f22] border border-white/5">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">
                  {t("server:overview.publicTitle")}
                </div>
                <p className="text-xs text-discord-textMuted">
                  {t("server:overview.publicDesc")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="toggle-guild-public-btn"
                aria-checked={isPublic}
                onClick={() => setIsPublic(!isPublic)}
                className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
                  isPublic ? "bg-discord-brand" : "bg-white/10"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                    isPublic ? "translate-x-6" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {t("server:overview.guildIdLabel")}
          </span>
          <code className="text-xs bg-[#1e1f22] px-2 py-1 rounded text-gray-300 border border-white/5 select-all">
            {guild.id}
          </code>
          <button
            onClick={handleCopyId}
            className="flex items-center gap-1 text-xs text-[#5865f2] hover:text-[#4752c4] transition-colors"
          >
            {copiedId ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>{t("common:copied")}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{t("common:copy")} ID</span>
              </>
            )}
          </button>
        </div>

        {/* 浮动提示或操作栏 */}
        {hasChanges && (
          <div className="flex items-center gap-3 bg-[#111214] px-4 py-2 rounded-xl border border-white/10 shadow-xl animate-in slide-in-from-bottom-2">
            <span className="text-xs text-amber-400 font-medium">
              {t("server:overview.unsavedChanges")}
            </span>
            <button
              onClick={handleReset}
              className="text-xs text-gray-300 hover:underline px-2 py-1"
            >
              {t("server:overview.reset")}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isUploading}
              className="px-4 py-1.5 rounded-md bg-[#248046] hover:bg-[#1a6334] text-white text-xs font-semibold shadow transition-colors"
            >
              {isSaving
                ? t("server:overview.saving")
                : t("server:overview.saveChanges")}
            </button>
          </div>
        )}

        {!hasChanges && saveSuccess && (
          <div className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
            <Check className="w-4 h-4" />
            <span>{t("server:overview.saveSuccess")}</span>
          </div>
        )}
      </div>

      {gifFile && (
        <GifIconEditor
          file={gifFile}
          guildId={guild.id}
          onClose={() => setGifFile(undefined)}
          onConfirm={(fileUrl, preview) => {
            const previous = pendingUploadRef.current;
            pendingUploadRef.current = fileUrl;
            setPendingUploadUrl(fileUrl);
            if (previous && previous !== fileUrl)
              discardPendingUpload(previous);
            setPreviewBlobUrl((old) => {
              if (old) URL.revokeObjectURL(old);
              return URL.createObjectURL(preview);
            });
            toast.success(t("server:overview.iconUploadSuccess"));
          }}
        />
      )}
      {/* 图标裁剪与压缩 Modal */}
      <ImageCropModal
        isOpen={isCropModalOpen}
        imageSrc={cropSrc}
        onClose={() => {
          uploadRevision.current++;
          uploadController.current?.abort();
          setIsUploading(false);
          setIsCropModalOpen(false);
          if (cropSrc) {
            URL.revokeObjectURL(cropSrc);
            setCropSrc(null);
          }
        }}
        onConfirm={handleUploadCropped}
        isCircular={true}
      />
    </div>
  );
};
