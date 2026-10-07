import React, { useMemo, useState } from "react";
import { X, Sparkles, Server } from "lucide-react";
import { Guild } from "@tescord/types";
import { useTranslation } from "react-i18next";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { getErrorMessage } from "../../i18n/index.js";
import { toast } from "../../stores/useToastStore.js";

const createIdenticon = (seed: string): string => {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D unavailable");

  let hash = 2166136261;
  for (const char of seed) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  context.fillStyle = `hsl(${hash % 360}, 34%, 20%)`;
  context.fillRect(0, 0, 160, 160);
  context.fillStyle = `hsl(${hash % 360}, 72%, 68%)`;
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 3; column++) {
      hash ^= hash << 13;
      hash ^= hash >>> 17;
      hash ^= hash << 5;
      if ((hash & 1) === 0) continue;
      context.fillRect(16 + column * 26, 16 + row * 26, 26, 26);
      if (column !== 2) {
        context.fillRect(16 + (4 - column) * 26, 16 + row * 26, 26, 26);
      }
    }
  }
  return canvas.toDataURL("image/png");
};

interface CreateGuildModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGuildCreated: (guild: Guild) => void;
  onOpenJoinModal: () => void;
}

export const CreateGuildModal: React.FC<CreateGuildModalProps> = ({
  isOpen,
  onClose,
  onGuildCreated,
  onOpenJoinModal,
}) => {
  const { t, i18n } = useTranslation(["modals", "common", "admin", "errors"]);
  const { user } = useAuthStore();
  const { getAuthHeaders } = useAuthStore();
  const [guildName, setGuildName] = useState(() =>
    user
      ? t("modals:createGuild.defaultName", { username: user.displayName })
      : t("modals:createGuild.defaultFallbackName", "我的极客服务器"),
  );
  const [iconSeed, setIconSeed] = useState(() =>
    Math.random().toString(36).substring(7),
  );
  const [error, setError] = useState<string | null>(null);
  const iconUrl = useMemo(() => createIdenticon(iconSeed), [iconSeed]);
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [canCreate, setCanCreate] = useState<boolean>(true);

  React.useEffect(() => {
    if (!isOpen) return;
    if (user?.role === "SUPER_ADMIN") {
      setCanCreate(true);
      return;
    }
    fetch(`${API_BASE}/api/auth/registration-status`)
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.allowNonSuperAdminCreateGuild === "boolean") {
          setCanCreate(data.allowNonSuperAdminCreateGuild);
        }
      })
      .catch(() => {});
  }, [isOpen, user?.role]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guildName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const authHeaders = getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/guilds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          name: guildName.trim(),
          isPublic,
          locale: i18n.language,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("modals:createGuild.failed"),
        );
      }

      const createdGuild: Guild = await res.json();
      let guild = createdGuild;
      let pendingFileUrl: string | null = null;
      try {
        const iconBlob = await fetch(iconUrl).then((response) =>
          response.blob(),
        );
        const grantResponse = await fetch(
          `${API_BASE}/api/attachments/presigned-url`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({
              fileName: `guild_icon_${Date.now()}.png`,
              fileSize: iconBlob.size,
              mimeType: "image/png",
              purpose: "guild-icon",
              guildId: createdGuild.id,
            }),
          },
        );
        if (!grantResponse.ok) throw new Error(t("errors:UPLOAD_FAILED"));
        const grant: {
          uploadUrl: string;
          fileUrl: string;
          requiresAuth: boolean;
        } = await grantResponse.json();
        pendingFileUrl = grant.fileUrl;

        const uploadResponse = await fetch(resolveServerUrl(grant.uploadUrl), {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            ...(grant.requiresAuth ? authHeaders : {}),
          },
          body: iconBlob,
        });
        if (!uploadResponse.ok) throw new Error(t("errors:UPLOAD_FAILED"));

        const updateResponse = await fetch(
          `${API_BASE}/api/guilds/${createdGuild.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ iconUrl: grant.fileUrl }),
          },
        );
        if (!updateResponse.ok) throw new Error(t("errors:UPLOAD_FAILED"));
        const updated: Guild = await updateResponse.json();
        guild = { ...createdGuild, iconUrl: updated.iconUrl };
        pendingFileUrl = null;
      } catch {
        // Guild creation has succeeded. Keep it visible and report only the
        // icon failure; retrying the form would create a duplicate guild.
        toast.error(t("modals:createGuild.iconUploadFailed"));
      } finally {
        if (pendingFileUrl) {
          void fetch(`${API_BASE}/api/guilds/${createdGuild.id}/pending-icon`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ fileUrl: pendingFileUrl }),
            keepalive: true,
          }).catch(() => {
            // The server also expires abandoned upload grants.
          });
        }
      }
      onGuildCreated(guild);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#313338] text-discord-textNormal w-full max-w-md rounded-lg shadow-2xl overflow-hidden border border-[#3f4147]">
        {/* 标题 */}
        <div className="relative px-6 pt-6 pb-2 text-center">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-discord-textMuted hover:text-discord-textHeader transition"
            title={t("common:close")}
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold text-discord-textHeader">
            {t("modals:createGuild.title")}
          </h2>
          <p className="text-xs text-discord-textMuted mt-1">
            {t("modals:createGuild.subtitle")}
          </p>
        </div>

        {/* 限制态：仅允许加入已有服务器 */}
        {!canCreate ? (
          <div className="px-6 py-6 space-y-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Server className="w-6 h-6" />
            </div>
            <p className="text-xs text-discord-textMuted leading-relaxed">
              {t("modals:createGuildRestrictedNotice")}
            </p>
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenJoinModal();
                }}
                className="bg-discord-brand hover:bg-discord-brandHover text-white px-5 py-2.5 rounded font-medium text-sm transition shadow-md flex items-center space-x-2"
              >
                <span>{t("modals:createGuild.haveInvite")}</span>
              </button>
            </div>
          </div>
        ) : (
          /* 表单内容 */
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded">
                {error}
              </div>
            )}

            {/* 服务器图标挑选 */}
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="relative group">
                <img
                  src={iconUrl}
                  alt={t("modals:createGuild.randomIcon")}
                  className="w-20 h-20 rounded-full border-2 border-discord-brand bg-[#2b2d31] p-1 shadow-md transition group-hover:scale-105"
                />
                <button
                  type="button"
                  onClick={() =>
                    setIconSeed(Math.random().toString(36).substring(7))
                  }
                  disabled={isSubmitting}
                  className="absolute -bottom-1 -right-1 bg-discord-brand hover:bg-discord-brand/80 text-white p-1.5 rounded-full shadow-lg transition"
                  title={t("modals:createGuild.randomIcon")}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="text-[11px] text-discord-textMuted">
                {t("modals:createGuild.randomIconTip")}
              </span>
            </div>

            {/* 服务器名称 */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
                {t("modals:createGuild.nameLabel")}{" "}
                <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={guildName}
                onChange={(e) => setGuildName(e.target.value)}
                placeholder={t("modals:createGuild.namePlaceholder")}
                className="w-full bg-[#1e1f22] text-discord-textHeader px-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent focus:border-discord-brand"
              />
            </div>

            {/* 是否公开 */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[#1e1f22] border border-white/5">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-discord-textHeader">
                  {t("modals:createGuild.isPublicTitle")}
                </div>
                <p className="text-[11px] text-discord-textMuted">
                  {t("modals:createGuild.isPublicDesc")}
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="create-guild-is-public-checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="w-4 h-4 rounded text-discord-brand focus:ring-discord-brand bg-[#2b2d31] border-gray-600 cursor-pointer"
              />
            </div>

            {/* 底部按钮栏 */}
            <div className="pt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenJoinModal();
                }}
                className="text-xs text-discord-brand hover:underline font-medium"
              >
                {t("modals:createGuild.haveInvite")}
              </button>

              <button
                type="submit"
                disabled={isSubmitting || !guildName.trim()}
                className="bg-discord-brand hover:bg-discord-brandHover text-white px-5 py-2.5 rounded font-medium text-sm transition shadow-md disabled:opacity-50 flex items-center space-x-1.5"
              >
                <Server className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? t("modals:createGuild.submitting")
                    : t("modals:createGuild.submit")}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
