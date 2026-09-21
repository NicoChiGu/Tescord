import React, { useState } from "react";
import { X, KeyRound, Compass } from "lucide-react";
import { API_BASE } from "../../config.js";

interface JoinGuildModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGuildJoined: (guildId: string) => void;
  onOpenCreateModal: () => void;
}

export const JoinGuildModal: React.FC<JoinGuildModalProps> = ({
  isOpen,
  onClose,
  onGuildJoined,
  onOpenCreateModal,
}) => {
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = inviteCode.trim().split("/").pop() || "";
    if (!cleanCode) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/invites/${cleanCode}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "加入服务器失败，请核对邀请码");
      }

      const result = await res.json();
      onGuildJoined(result.guildId);
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
          <div className="w-12 h-12 rounded-full bg-discord-brand/20 text-discord-brand flex items-center justify-center mx-auto mb-2">
            <Compass className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-discord-textHeader">
            加入现有服务器
          </h2>
          <p className="text-xs text-discord-textMuted mt-1">
            输入好友分享给您的 8 位专属邀请码或邀请链接。
          </p>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              邀请码 / 邀请链接 <span className="text-red-400">*</span>
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="例如：7f503c71 或 http://.../invite/7f503c71"
                className="w-full bg-[#1e1f22] text-discord-textHeader px-3 py-2.5 pl-9 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent focus:border-discord-brand font-mono"
              />
              <KeyRound className="w-4 h-4 text-discord-textMuted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="text-[11px] text-discord-textMuted space-y-1 bg-[#2b2d31] p-2.5 rounded">
            <p className="font-semibold text-discord-textHeader">
              邀请链接示例：
            </p>
            <p className="font-mono text-discord-brand">7f503c71</p>
            <p className="font-mono">https://tescord.gg/7f503c71</p>
          </div>

          {/* 底部按钮 */}
          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCreateModal();
              }}
              className="text-xs text-discord-brand hover:underline font-medium"
            >
              没有邀请码？创建新服务器
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !inviteCode.trim()}
              className="bg-discord-brand hover:bg-discord-brandHover text-white px-5 py-2.5 rounded font-medium text-sm transition shadow-md disabled:opacity-50"
            >
              {isSubmitting ? "加入中..." : "加入服务器"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
