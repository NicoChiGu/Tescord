import React, { useState, useEffect } from "react";
import { X, Trash2, AlertTriangle, FolderEdit } from "lucide-react";
import { ChannelCategory } from "@tescord/types";
import { API_BASE } from "../../config.js";

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
      setError("分类名称不能为空");
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
        throw new Error(data.error || "更新分类失败");
      }

      const updatedCategory: ChannelCategory = await res.json();
      onCategoryUpdated?.(updatedCategory);
      onClose();
    } catch (err: any) {
      setError(err.message || "网络连接异常");
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
        throw new Error(data.error || "删除分类失败");
      }

      onCategoryDeleted?.(category.id);
      onClose();
    } catch (err: any) {
      setError(err.message || "删除分类失败");
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
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <FolderEdit className="w-5 h-5 text-discord-blurple" />
            <h2 className="text-xl font-bold text-discord-textHeader">
              编辑分类
            </h2>
          </div>
          <p className="text-xs text-discord-textMuted mt-1">
            修改分类名称或进行维护管理。
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
              分类名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入分类名称"
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
                    删除该分类
                  </h4>
                  <p className="text-[11px] text-discord-textMuted mt-1 leading-relaxed">
                    分类下的所有频道将被自动保留并移至未分类区域，不会丢失任何聊天数据。
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
                    ? "正在删除..."
                    : confirmDelete
                    ? "确认永久删除分类？"
                    : "删除分类"}
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
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || name.trim() === category.name}
              className="px-5 py-2 text-sm font-medium bg-discord-blurple hover:bg-discord-blurpleHover text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              data-testid="save-category-btn"
            >
              {isSubmitting ? "保存中..." : "保存修改"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
