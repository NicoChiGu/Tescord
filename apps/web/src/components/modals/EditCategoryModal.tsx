import React, { useState, useEffect } from "react";
import { X, Trash2, AlertTriangle, FolderEdit } from "lucide-react";
import { ChannelCategory } from "@tescord/types";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { getErrorMessage } from "../../i18n/index.js";

interface EditCategoryModalProps {
  isOpen: boolean;
  category: ChannelCategory | null;
  onClose: () => void;
  onCategoryUpdated?: (category: ChannelCategory) => void;
  onCategoryDeleted?: (categoryId: string) => void;
}

export const EditCategoryModal: React.FC<EditCategoryModalProps> = ({
  isOpen,
  category,
  onClose,
  onCategoryUpdated,
  onCategoryDeleted,
}) => {
  const { t } = useTranslation(["modals", "common", "admin", "errors"]);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (category) {
      setName(category.name || "");
      setError(null);
      setConfirmDelete(false);
    }
  }, [category, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !category) return null;

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
      const res = await fetch(`${API_BASE}/api/categories/${category.id}`, {
        method: "PATCH",
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
        throw new Error(getErrorMessage(data) || t("common:saveFailed", "更新分类失败"));
      }

      const updatedCategory: ChannelCategory = await res.json();
      onCategoryUpdated?.(updatedCategory);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/categories/${category.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || t("common:deleteFailed", "删除分类失败"));
      }

      onCategoryDeleted?.(category.id);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
      setIsDeleting(false);
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
            <FolderEdit className="w-5 h-5 text-discord-blurple" />
            <h2 className="text-xl font-bold text-discord-textHeader">
              {t("modals:editCategory.title")}
            </h2>
          </div>
          <p className="text-xs text-discord-textMuted mt-1">
            {t("modals:editCategory.subtitle")}
          </p>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* 分类名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:editCategory.nameLabel")}{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modals:editCategory.namePlaceholder")}
              maxLength={30}
              className="w-full bg-[#1e1f22] text-discord-textNormal px-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-blurple border border-transparent focus:border-transparent transition"
              data-testid="edit-category-name-input"
            />
          </div>

          {/* 危险操作区：删除分类 */}
          <div className="pt-2 border-t border-[#3f4147]/60">
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t("modals:editCategory.deleteCategory")}
                  </h4>
                  <p className="text-[11px] text-discord-textMuted mt-1 leading-relaxed">
                    {t("modals:editCategory.deleteWarning")}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition flex items-center gap-1.5 ${
                    confirmDelete
                      ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                      : "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                  }`}
                  data-testid="delete-category-btn"
                >
                  <Trash2 className="w-3 h-3" />
                  {isDeleting
                    ? t("modals:editCategory.deleting")
                    : confirmDelete
                    ? t("modals:editCategory.confirmDelete")
                    : t("modals:editCategory.deleteCategory")}
                </button>
              </div>
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
              disabled={isSubmitting || !name.trim() || name.trim() === category.name}
              className="px-5 py-2 text-sm font-medium bg-discord-blurple hover:bg-discord-blurpleHover text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              data-testid="save-category-btn"
            >
              {isSubmitting
                ? t("modals:editCategory.saving")
                : t("modals:editCategory.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
