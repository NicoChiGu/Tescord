import React, { useState } from "react";
import { X, Sparkles, Server } from "lucide-react";
import { Guild } from "@tescord/types";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";

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
  const { user } = useAuthStore();
  const [guildName, setGuildName] = useState(
    user ? `${user.username} 的私密小窝` : "我的极客服务器",
  );
  const [iconSeed, setIconSeed] = useState(() =>
    Math.random().toString(36).substring(7),
  );
  const [isPublic, setIsPublic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const iconUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${iconSeed}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guildName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/guilds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: guildName.trim(),
          iconUrl,
          isPublic,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建服务器失败");
      }

      const createdGuild: Guild = await res.json();
      onGuildCreated(createdGuild);
      onClose();
    } catch (err: any) {
      setError(err.message || "网络连接异常");
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
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold text-discord-textHeader">
            创建你的专属服务器
          </h2>
          <p className="text-xs text-discord-textMuted mt-1">
            服务器是您与同伴相聚、畅聊音视频并沉淀知识的极客空间。
          </p>
        </div>

        {/* 表单内容 */}
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
                alt="Guild Icon Preview"
                className="w-20 h-20 rounded-full border-2 border-discord-brand bg-[#2b2d31] p-1 shadow-md transition group-hover:scale-105"
              />
              <button
                type="button"
                onClick={() =>
                  setIconSeed(Math.random().toString(36).substring(7))
                }
                className="absolute -bottom-1 -right-1 bg-discord-brand hover:bg-discord-brand/80 text-white p-1.5 rounded-full shadow-lg transition"
                title="换一个图标"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="text-[11px] text-discord-textMuted">
              点击右下角星星随机换图标
            </span>
          </div>

          {/* 服务器名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              服务器名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={guildName}
              onChange={(e) => setGuildName(e.target.value)}
              placeholder="输入服务器名称..."
              className="w-full bg-[#1e1f22] text-discord-textHeader px-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent focus:border-discord-brand"
            />
          </div>

          {/* 是否公开 */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#1e1f22] border border-white/5">
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-discord-textHeader">在探索中心公开此服务器</div>
              <p className="text-[11px] text-discord-textMuted">允许其他人在公共社区大厅发现并直接加入</p>
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
              已经有邀请链接？点击加入
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !guildName.trim()}
              className="bg-discord-brand hover:bg-discord-brandHover text-white px-5 py-2.5 rounded font-medium text-sm transition shadow-md disabled:opacity-50 flex items-center space-x-1.5"
            >
              <Server className="w-4 h-4" />
              <span>{isSubmitting ? "创建中..." : "立即创建"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
