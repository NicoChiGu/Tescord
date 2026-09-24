import React, { useState, useEffect } from "react";
import { X, FolderPlus } from "lucide-react";
import { ChannelCategory } from "@tescord/types";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { getErrorMessage } from "../../i18n/index.js";

interface CreateCategoryModalProps {
  isOpen: boolean;
  guildId: string;
  onClose: () => void;
  onCategoryCreated?: (category: ChannelCategory) => void;
}

export const CreateCategoryModal: React.FC<CreateCategoryModalProps> = ({
  isOpen,
  guildId,
  onClose,
  onCategoryCreated,
}) => {
  const { t } = useTranslation(["modals", "common", "admin", "errors"]);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("errors:CATEGORY_NAME_REQUIRED"));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/guilds/${guildId}/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || t("modals:createCategory.failed"));
      }

      const createdCategory: ChannelCategory = await res.json();
      onCategoryCreated?.(createdCategory);
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
        <div className="relative px-6 pt-6 pb-2">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-discord-textMuted hover:text-discord-textHeader transition"
            title={t("common:close")}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <FolderPlus className="w-5 h-5 text-discord-blurple" />
            <h2 className="text-xl font-bold text-discord-textHeader">
              {t("modals:createCategory.title")}
            </h2>
          </div>
          <p className="text-xs text-discord-textMuted mt-1">
            {t("modals:createCategory.subtitle")}
          </p>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* 分类名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:createCategory.nameLabel")}{" "}
              <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("modals:createCategory.namePlaceholder")}
                maxLength={30}
                className="w-full bg-[#1e1f22] text-discord-textNormal px-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-blurple border border-transparent focus:border-transparent transition"
                data-testid="create-category-name-input"
              />
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="pt-2 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-discord-textHeader hover:underline transition"
            >
              {t("common:cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2 text-sm font-medium bg-discord-blurple hover:bg-discord-blurpleHover text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              data-testid="submit-create-category-btn"
            >
              {isSubmitting
                ? t("modals:createCategory.submitting")
                : t("modals:createCategory.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
