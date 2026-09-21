import React, { useState, useEffect } from "react";
import { X, Hash, Volume2, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import { Channel, Guild } from "@tescord/types";
import { API_BASE } from "../../config.js";

interface EditChannelModalProps {
  isOpen: boolean;
  channel: Channel | null;
  guild?: Guild | null;
  onClose: () => void;
  onChannelUpdated?: (channel: Channel) => void;
  onChannelDeleted?: (channelId: string) => void;
}

export const EditChannelModal: React.FC<EditChannelModalProps> = ({
  isOpen,
  channel,
  guild,
  onClose,
  onChannelUpdated,
  onChannelDeleted,
}) => {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (channel) {
      setName(channel.name || "");
      setTopic(channel.topic || "");
      setError(null);
      setConfirmDelete(false);
    }
  }, [channel, isOpen]);

  // ESC 快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !channel) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("频道名称不能为空");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/channels/${channel.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          topic: topic.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "更新频道失败");
      }

      const updatedChannel: Channel = await res.json();
      onChannelUpdated?.(updatedChannel);
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
      const res = await fetch(`${API_BASE}/api/channels/${channel.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "删除频道失败");
      }

      onChannelDeleted?.(channel.id);
      onClose();
    } catch (err: any) {
      setError(err.message || "网络连接异常");
    } finally {
      setIsDeleting(false);
    }
  };

  const isVoice = channel.type === "VOICE";

  return (
    <div
      data-testid="edit-channel-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-[#313338] text-discord-textNormal w-full max-w-lg rounded-xl shadow-2xl overflow-hidden border border-[#3f4147] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题 */}
        <div className="relative px-6 pt-6 pb-4 border-b border-[#232428] flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              {isVoice ? (
                <Volume2 className="w-5 h-5 text-gray-400" />
              ) : (
                <Hash className="w-5 h-5 text-gray-400" />
              )}
              <h2 className="text-lg font-bold text-discord-textHeader">
                编辑频道设置
              </h2>
            </div>
            <p className="text-xs text-discord-textMuted mt-1">
              配置 #{channel.name} 频道的名称、简介与安全属性
            </p>
          </div>
          <button
            data-testid="close-edit-channel-btn"
            onClick={onClose}
            className="text-discord-textMuted hover:text-discord-textHeader p-1 rounded-md hover:bg-white/5 transition"
            title="关闭 (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 频道名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              频道名称
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3 text-gray-400 select-none">
                {isVoice ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <Hash className="w-4 h-4" />
                )}
              </span>
              <input
                type="text"
                data-testid="edit-channel-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：general, 唠嗑茶水间"
                className="w-full bg-[#1e1f22] text-discord-textNormal border border-black/50 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-discord-brand transition placeholder-gray-500"
                maxLength={100}
                required
              />
            </div>
          </div>

          {/* 频道话题 / 简介 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                频道话题 (Topic)
              </label>
              <span className="text-[11px] text-discord-textMuted">
                {topic.length} / 1024
              </span>
            </div>
            <textarea
              data-testid="edit-channel-topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="告诉大家这个频道可以讨论哪些话题，或者设置一些规则..."
              rows={3}
              maxLength={1024}
              className="w-full bg-[#1e1f22] text-discord-textNormal border border-black/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-discord-brand transition placeholder-gray-500 resize-none"
            />
          </div>

          {/* 频道属性信息卡片 */}
          <div className="bg-[#2b2d31] p-3.5 rounded-lg border border-[#383a40] space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              频道属性
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">频道类型</span>
              <span className="font-medium text-gray-200">
                {isVoice ? "语音与实时媒体频道" : "纯文本与富媒体频道"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">端到端加密防护 (E2EE)</span>
              {channel.isE2EE ? (
                <div className="flex items-center gap-1.5 text-discord-green bg-[#23a55a18] px-2 py-0.5 rounded border border-discord-green/30">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="font-semibold text-[11px]">已激活</span>
                </div>
              ) : (
                <span className="text-gray-500 text-[11px]">未开启</span>
              )}
            </div>
          </div>

          {/* 危险操作区：删除频道 */}
          <div className="pt-2 border-t border-[#3f4147]">
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3.5 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-red-400">删除频道</h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  删除后该频道内的所有聊天与媒体记录将被永久清除。
                </p>
              </div>
              <button
                type="button"
                data-testid="delete-channel-btn"
                onClick={handleDelete}
                disabled={isDeleting}
                className={`px-3 py-1.5 rounded text-xs font-medium transition shrink-0 flex items-center gap-1.5 ${
                  confirmDelete
                    ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                    : "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{confirmDelete ? "确认永久删除" : "删除频道"}</span>
              </button>
            </div>
          </div>
        </form>

        {/* 底部操作按钮 */}
        <div className="bg-[#2b2d31] px-6 py-4 flex items-center justify-end gap-3 border-t border-[#232428]">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isDeleting}
            className="text-xs text-white hover:underline px-3 py-2 font-medium transition"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="save-channel-btn"
            onClick={handleSubmit}
            disabled={isSubmitting || isDeleting || !name.trim()}
            className="bg-discord-brand hover:bg-discord-brand/80 text-white text-xs font-medium px-5 py-2 rounded-md transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>保存中...</span>
              </>
            ) : (
              <span>保存更改</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
