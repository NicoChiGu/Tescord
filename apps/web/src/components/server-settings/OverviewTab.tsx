import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Guild } from "@tescord/types";
import { Camera, Copy, Check, UploadCloud } from "lucide-react";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";

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
  const [description, setDescription] = useState(guild.description || "");
  const [isPublic, setIsPublic] = useState(Boolean(guild.isPublic));
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const hasChanges =
    name.trim() !== (guild.name || "").trim() ||
    iconUrl.trim() !== (guild.iconUrl || "").trim() ||
    description.trim() !== (guild.description || "").trim() ||
    isPublic !== Boolean(guild.isPublic);

  const handleReset = () => {
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mimeType = file.type || "image/png";

    setIsUploading(true);
    try {
      // 1. 获取预签名上传链接
      const res = await fetch(`${API_BASE}/api/attachments/presigned-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          purpose: "guild-icon",
          guildId: guild.id,
        }),
      });

      if (!res.ok) throw new Error("获取上传凭证失败");
      const { uploadUrl, fileUrl, requiresAuth } = await res.json();

      // 2. 直传文件 (经 resolveServerUrl 自愈相对路径走 Vite 代理)
      const targetUploadUrl = resolveServerUrl(uploadUrl);
      const uploadRes = await fetch(targetUploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          ...(requiresAuth ? getAuthHeaders() : {}),
        },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("上传文件到存储服务失败");
      setIconUrl(fileUrl);
    } catch (err: any) {
      toast.error(err.message || "上传图标失败");
    } finally {
      setIsUploading(false);
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
      await onUpdateGuild({
        name: name.trim(),
        iconUrl: iconUrl.trim() || null,
        description: description.trim() || null,
        isPublic,
      });
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
            {iconUrl ? (
              <img
                src={resolveServerUrl(iconUrl)}
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
              <span className="text-[10px] font-bold">{t("server:overview.changeIcon")}</span>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={isUploading}
            />
          </div>
          <div className="text-[11px] text-gray-400 text-center md:text-left">
            推荐尺寸至少为 512x512。
            {isUploading && (
              <span className="text-[#5865f2] block font-semibold animate-pulse">
                正在上传文件...
              </span>
            )}
          </div>
        </div>

        {/* 基础表单输入 */}
        <div className="md:col-span-2 space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-2">
              {t("server:overview.nameLabel")} <span className="text-rose-500">*</span>
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
              图标网络直链 (URL 可选)
            </label>
            <input
              type="text"
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              placeholder="https://example.com/icon.png"
              className="w-full bg-[#1e1f22] border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] transition-colors"
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
          <span className="text-xs text-gray-400">{t("server:overview.guildIdLabel")}</span>
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
              disabled={isSaving}
              className="px-4 py-1.5 rounded-md bg-[#248046] hover:bg-[#1a6334] text-white text-xs font-semibold shadow transition-colors"
            >
              {isSaving ? t("server:overview.saving") : t("server:overview.saveChanges")}
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
    </div>
  );
};
