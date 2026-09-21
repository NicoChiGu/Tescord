import React, { useState } from "react";
import { X, Hash, Volume2, ShieldCheck } from "lucide-react";
import { Channel, ChannelCategory, ChannelType } from "@tescord/types";
import { API_BASE } from "../../config.js";

interface CreateChannelModalProps {
  isOpen: boolean;
  guildId: string;
  categories?: ChannelCategory[];
  initialCategoryId?: string | null;
  onClose: () => void;
  onChannelCreated: (channel: Channel) => void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  guildId,
  categories = [],
  initialCategoryId = null,
  onClose,
  onChannelCreated,
}) => {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("TEXT");
  const [parentId, setParentId] = useState<string | null>(initialCategoryId);
  const [topic, setTopic] = useState("");
  const [isE2EE, setIsE2EE] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setParentId(initialCategoryId || null);
      setName("");
      setTopic("");
      setIsE2EE(false);
      setError(null);
    }
  }, [isOpen, initialCategoryId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/guilds/${guildId}/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          type,
          parentId: parentId || undefined,
          topic: topic.trim() || undefined,
          isE2EE,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建频道失败");
      }

      const createdChannel: Channel = await res.json();
      onChannelCreated(createdChannel);
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
        <div className="relative px-6 pt-6 pb-2">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-discord-textMuted hover:text-discord-textHeader transition"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-discord-textHeader">
            创建频道
          </h2>
          <p className="text-xs text-discord-textMuted mt-1">
            在当前服务器内建立新的沟通交流阵地。
          </p>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* 频道类型切换 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              频道类型
            </label>
            <div className="space-y-2">
              <label
                className={`flex items-center p-3 rounded-lg cursor-pointer transition border ${
                  type === "TEXT"
                    ? "bg-[#3f4147] border-discord-brand text-discord-textHeader"
                    : "bg-[#2b2d31] border-transparent hover:bg-[#35373c] text-discord-textNormal"
                }`}
              >
                <input
                  type="radio"
                  name="channelType"
                  value="TEXT"
                  checked={type === "TEXT"}
                  onChange={() => setType("TEXT")}
                  className="hidden"
                />
                <Hash className="w-6 h-6 mr-3 text-discord-textMuted flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-sm">文字频道 (Text)</div>
                  <div className="text-xs text-discord-textMuted">
                    发布富文本消息、文件、截图与 Emoji 点赞
                  </div>
                </div>
              </label>

              <label
                className={`flex items-center p-3 rounded-lg cursor-pointer transition border ${
                  type === "VOICE"
                    ? "bg-[#3f4147] border-discord-brand text-discord-textHeader"
                    : "bg-[#2b2d31] border-transparent hover:bg-[#35373c] text-discord-textNormal"
                }`}
              >
                <input
                  type="radio"
                  name="channelType"
                  value="VOICE"
                  checked={type === "VOICE"}
                  onChange={() => setType("VOICE")}
                  className="hidden"
                />
                <Volume2 className="w-6 h-6 mr-3 text-discord-textMuted flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-sm">语音频道 (Voice)</div>
                  <div className="text-xs text-discord-textMuted">
                    低延迟语音连麦、屏幕分享直播与 AI 降噪
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* 频道名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              频道名称 <span className="text-red-400">*</span>
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center text-discord-textMuted pointer-events-none select-none">
                {type === "TEXT" ? "#" : "🔊"}
              </span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：极客日常"
                className="w-full bg-[#1e1f22] text-discord-textHeader pl-8 pr-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent focus:border-discord-brand"
                data-testid="create-channel-name-input"
              />
            </div>
          </div>

          {/* 所属分类 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              所属分类
            </label>
            <select
              value={parentId || ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="w-full bg-[#1e1f22] text-discord-textHeader px-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent cursor-pointer"
              data-testid="channel-category-select"
            >
              <option value="">(无分类 / 顶部独立频道)</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  📁 {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* 频道话题 (仅文字频道) */}
          {type === "TEXT" && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
                频道话题 (选填)
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="简单介绍这个频道的讨论内容..."
                className="w-full bg-[#1e1f22] text-discord-textHeader px-3 py-2 rounded text-sm focus:outline-none focus:ring-1 focus:ring-discord-brand transition"
              />
            </div>
          )}

          {/* E2EE 端到端加密选项 */}
          <div className="bg-[#2b2d31] p-3 rounded-lg flex items-center justify-between border border-[#383a40]">
            <div className="flex items-center space-x-2.5">
              <ShieldCheck className="w-5 h-5 text-discord-green" />
              <div>
                <div className="text-sm font-semibold text-discord-textHeader">
                  端到端加密 (E2EE)
                </div>
                <div className="text-[11px] text-discord-textMuted">
                  客户端本地密文封装，服务端不保存明文
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={isE2EE}
              onChange={(e) => setIsE2EE(e.target.checked)}
              className="w-4 h-4 rounded text-discord-brand focus:ring-discord-brand cursor-pointer"
            />
          </div>

          {/* 底部按钮 */}
          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-discord-textHeader hover:underline px-3 py-2"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="bg-discord-brand hover:bg-discord-brandHover text-white px-5 py-2.5 rounded font-medium text-sm transition shadow-md disabled:opacity-50"
            >
              {isSubmitting ? "创建中..." : "创建频道"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
