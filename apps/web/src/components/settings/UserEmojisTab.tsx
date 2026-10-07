import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CustomEmoji } from "@tescord/types";
import { Upload, Trash2, Smile, Loader2, Copy, Check } from "lucide-react";
import { useEmojiStore } from "../../stores/useEmojiStore.js";
import { resolveServerUrl } from "../../config.js";
import { toast } from "../../stores/useToastStore.js";
import { dialog } from "../../stores/useDialogStore.js";

export const UserEmojisTab: React.FC = () => {
  const { t } = useTranslation(["settings", "common", "errors"]);
  const { userEmojis, fetchUserEmojis, uploadUserEmoji, deleteUserEmoji } =
    useEmojiStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [emojiName, setEmojiName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    void fetchUserEmojis();
  }, [fetchUserEmojis]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const isGif =
      file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
    if (isGif && file.size > 2 * 1024 * 1024) {
      toast.error(
        t("errors:EMOJI_FILE_TOO_LARGE", {
          defaultValue: "GIF表情限制在2MB以内",
        }),
      );
      e.target.value = "";
      return;
    }
    if (!isGif && file.size > 5 * 1024 * 1024) {
      toast.error(
        t("errors:FILE_TOO_LARGE", { defaultValue: "图片大小不能超过5MB" }),
      );
      e.target.value = "";
      return;
    }

    const cleanDefaultName = file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .slice(0, 32);

    setSelectedFile(file);
    setEmojiName(
      cleanDefaultName.length >= 2
        ? cleanDefaultName
        : `emoji_${Date.now() % 1000}`,
    );
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleCancelUpload = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setEmojiName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    const trimmed = emojiName.trim();
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(trimmed)) {
      toast.error(
        t("errors:EMOJI_NAME_INVALID", {
          defaultValue: "表情名称必须为 2-32 位字母、数字或下划线",
        }),
      );
      return;
    }

    if (userEmojis.length >= 50) {
      toast.error(
        t("errors:EMOJI_LIMIT_REACHED", {
          defaultValue: "个人表情数量已达上限 (50个)",
        }),
      );
      return;
    }

    setIsUploading(true);
    try {
      await uploadUserEmoji(trimmed, selectedFile);
      toast.success(
        t("common:saveSuccess", { defaultValue: "上传表情成功！" }),
      );
      handleCancelUpload();
    } catch (err: any) {
      toast.error(
        err.message || t("common:networkError", { defaultValue: "上传失败" }),
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (emoji: CustomEmoji) => {
    const confirmed = await dialog.confirm({
      title: t("settings:myEmojis", { defaultValue: "我的表情" }),
      description: t("common:confirmDelete", {
        defaultValue: "确定要删除此表情吗？此操作无法撤销。",
      }),
      confirmText: t("common:delete", { defaultValue: "删除" }),
      cancelText: t("common:cancel", { defaultValue: "取消" }),
      variant: "danger",
    });

    if (!confirmed) return;

    try {
      await deleteUserEmoji(emoji.id);
      toast.success(t("common:deleteSuccess", { defaultValue: "删除成功" }));
    } catch (err: any) {
      toast.error(
        err.message || t("common:networkError", { defaultValue: "删除失败" }),
      );
    }
  };

  const handleCopyTag = (emoji: CustomEmoji) => {
    const tag = emoji.animated
      ? `<a:${emoji.name}:${emoji.id}>`
      : `<:${emoji.name}:${emoji.id}>`;
    void navigator.clipboard.writeText(tag);
    setCopiedId(emoji.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题与配额展示 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#3f4147]">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Smile className="w-5 h-5 text-[#5865f2]" />
            <span>{t("settings:myEmojis", { defaultValue: "我的表情" })}</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1 max-w-xl">
            {t("settings:myEmojisDesc", {
              defaultValue:
                "管理您上传的个人表情包，可在任何频道或私信中自由发送。GIF 限制在 2MB 以内，静态图限制在 1MB 以内。",
            })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[#1e1f22] border border-[#3f4147] text-gray-300">
            {userEmojis.length}/50
          </div>
          <button
            type="button"
            disabled={userEmojis.length >= 50 || isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg shadow transition select-none cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>{t("common:upload", { defaultValue: "上传" })}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* 正在上传编辑卡片 */}
      {selectedFile && previewUrl && (
        <form
          onSubmit={handleSubmitUpload}
          className="bg-[#2b2d31] border border-[#5865f2]/40 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4 animate-in fade-in"
        >
          <div className="w-16 h-16 rounded-lg bg-[#1e1f22] border border-[#3f4147] flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={previewUrl}
              alt="Preview"
              className="w-14 h-14 object-contain"
            />
          </div>

          <div className="flex-1 w-full space-y-1">
            <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wide">
              {t("common:name", { defaultValue: "表情名称" })}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-400 font-mono text-sm">
                :
              </span>
              <input
                type="text"
                value={emojiName}
                onChange={(e) =>
                  setEmojiName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
                }
                placeholder="my_sticker"
                maxLength={32}
                className="w-full bg-[#1e1f22] text-sm text-white pl-6 pr-6 py-1.5 rounded-lg border border-[#3f4147] focus:outline-none focus:border-[#5865f2] font-mono"
              />
              <span className="absolute right-3 top-2 text-gray-400 font-mono text-sm">
                :
              </span>
            </div>
            <p className="text-[10px] text-gray-400">
              {selectedFile.type === "image/gif"
                ? `GIF 动图 (${(selectedFile.size / 1024).toFixed(1)} KB)`
                : `静态图片 (${(selectedFile.size / 1024).toFixed(1)} KB)`}
            </p>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <button
              type="button"
              onClick={handleCancelUpload}
              disabled={isUploading}
              className="px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition"
            >
              {t("common:cancel", { defaultValue: "取消" })}
            </button>
            <button
              type="submit"
              disabled={isUploading || !emojiName.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#5865f2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow transition"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{t("common:save", { defaultValue: "保存" })}</span>
            </button>
          </div>
        </form>
      )}

      {/* 表情网格列表 */}
      {userEmojis.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {userEmojis.map((emoji) => (
            <div
              key={emoji.id}
              className="group relative bg-[#2b2d31] hover:bg-[#35373c] border border-[#3f4147] hover:border-[#4e5058] rounded-xl p-3 flex flex-col items-center justify-center transition"
            >
              <div className="w-14 h-14 flex items-center justify-center mb-2 bg-[#1e1f22] rounded-lg">
                <img
                  src={resolveServerUrl(emoji.imageUrl)}
                  alt={emoji.name}
                  className="w-10 h-10 object-contain transition-transform group-hover:scale-110"
                  loading="lazy"
                />
              </div>

              <div className="w-full text-center truncate text-xs font-mono font-medium text-gray-200">
                :{emoji.name}:
              </div>

              {emoji.animated && (
                <span className="text-[9px] uppercase tracking-wider text-[#5865f2] font-bold mt-0.5">
                  GIF
                </span>
              )}

              {/* 悬浮操作栏 */}
              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleCopyTag(emoji)}
                  title="复制表情代码"
                  className="p-1 rounded-md bg-[#1e1f22]/90 hover:bg-[#1e1f22] text-gray-300 hover:text-white transition"
                >
                  {copiedId === emoji.id ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(emoji)}
                  title={t("common:delete", { defaultValue: "删除" })}
                  className="p-1 rounded-md bg-[#1e1f22]/90 hover:bg-rose-500/20 text-gray-300 hover:text-rose-400 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-[#3f4147] rounded-2xl bg-[#2b2d31]/30">
          <div className="w-14 h-14 rounded-full bg-[#1e1f22] flex items-center justify-center mb-3 text-gray-400">
            <Smile className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-semibold text-white mb-1">
            {t("settings:myEmojis", { defaultValue: "尚未添加个人表情" })}
          </h3>
          <p className="text-xs text-gray-400 max-w-sm mb-4">
            {t("settings:myEmojisDesc", {
              defaultValue:
                "支持 JPEG、PNG、WebP、GIF。上传专属表情包，在任意聊天或频道随心发送！",
            })}
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded-lg shadow transition"
          >
            <Upload className="w-4 h-4" />
            <span>{t("common:upload", { defaultValue: "上传" })}</span>
          </button>
        </div>
      )}
    </div>
  );
};
