import React, { useState, useEffect } from "react";
import {
  X,
  Hash,
  Volume2,
  ShieldCheck,
  Trash2,
  AlertTriangle,
  Radio,
  Network,
  Server,
  Share2,
  Layers,
} from "lucide-react";
import { Channel, Guild, StreamTransmissionMode } from "@tescord/types";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { getErrorMessage } from "../../i18n/index.js";

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
  const { t } = useTranslation(["modals", "common", "admin", "errors"]);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState<"sfu" | "p2p_mesh">("sfu");
  const [streamMode, setStreamMode] = useState<StreamTransmissionMode>("sfu");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (channel) {
      setName(channel.name || "");
      setTopic(channel.topic || "");
      setParentId(channel.parentId || null);
      setVoiceMode(channel.voiceMode || "sfu");
      setStreamMode(channel.streamMode || "sfu");
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
      setError(t("errors:CHANNEL_NAME_REQUIRED"));
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
          parentId: parentId || null,
          ...(channel.type === "VOICE" ? { voiceMode, streamMode } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:saveFailed", "更新频道失败"),
        );
      }

      const updatedChannel: Channel = await res.json();
      onChannelUpdated?.(updatedChannel);
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
      const res = await fetch(`${API_BASE}/api/channels/${channel.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:deleteFailed", "删除频道失败"),
        );
      }

      onChannelDeleted?.(channel.id);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
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
                {t("modals:editChannel.title")}
              </h2>
            </div>
            <p className="text-xs text-discord-textMuted mt-1">
              {t("modals:editChannel.subtitle", { name: channel.name })}
            </p>
          </div>
          <button
            data-testid="close-edit-channel-btn"
            onClick={onClose}
            className="text-discord-textMuted hover:text-discord-textHeader p-1 rounded-md hover:bg-white/5 transition"
            title={t("common:close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表单内容 */}
        <form
          onSubmit={handleSubmit}
          className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto"
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 频道名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:editChannel.nameLabel")}
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
                placeholder={t("modals:editChannel.namePlaceholder")}
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
                {t("modals:editChannel.topicLabel")}
              </label>
              <span className="text-[11px] text-discord-textMuted">
                {topic.length} / 1024
              </span>
            </div>
            <textarea
              data-testid="edit-channel-topic-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("modals:editChannel.topicPlaceholder")}
              rows={3}
              maxLength={1024}
              className="w-full bg-[#1e1f22] text-discord-textNormal border border-black/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-discord-brand transition placeholder-gray-500 resize-none"
            />
          </div>

          {/* 所属分类 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:createChannel.categoryLabel")}
            </label>
            <select
              value={parentId || ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="w-full bg-[#1e1f22] text-discord-textNormal border border-black/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-discord-brand transition cursor-pointer"
              data-testid="edit-channel-category-select"
            >
              <option value="">{t("modals:createChannel.noCategory")}</option>
              {guild?.categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  📁 {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* 语音频道传输拓扑设置 */}
          {isVoice && (
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                音频传输架构 (Audio Transmission Topology)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 选项 1: SFU */}
                <div
                  data-testid="edit-channel-voicemode-sfu"
                  onClick={() => setVoiceMode("sfu")}
                  className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                    voiceMode === "sfu"
                      ? "bg-discord-brand/10 border-discord-brand text-white"
                      : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Radio
                        className={`w-4 h-4 ${
                          voiceMode === "sfu"
                            ? "text-discord-brand"
                            : "text-gray-400"
                        }`}
                      />
                      <span className="text-xs font-bold">
                        边缘转发 (SFU)
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      经由 Cloudflare Anycast 边缘服务器转发，适合多人规模通话，连接更稳定。
                    </p>
                  </div>
                  <div className="mt-2 text-[10px] text-discord-brand font-semibold">
                    {voiceMode === "sfu" && "✓ 当前已启用"}
                  </div>
                </div>

                {/* 选项 2: P2P Mesh */}
                <div
                  data-testid="edit-channel-voicemode-mesh"
                  onClick={() => setVoiceMode("p2p_mesh")}
                  className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                    voiceMode === "p2p_mesh"
                      ? "bg-discord-brand/10 border-discord-brand text-white"
                      : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Network
                        className={`w-4 h-4 ${
                          voiceMode === "p2p_mesh"
                            ? "text-discord-brand"
                            : "text-gray-400"
                        }`}
                      />
                      <span className="text-xs font-bold">
                        纯网状直连 (P2P Mesh)
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      客户端间端到端直连，零服务器延迟；受限时由 Anycast TURN 智能穿透，绝不降级 SFU。
                    </p>
                  </div>
                  <div className="mt-2 text-[10px] text-discord-brand font-semibold">
                    {voiceMode === "p2p_mesh" && "✓ 当前已启用"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 直播推流传输拓扑设置 */}
          {isVoice && (
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                直播推流架构 (Video Streaming Topology)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* 选项 1: SFU */}
                <div
                  data-testid="edit-channel-streammode-sfu"
                  onClick={() => setStreamMode("sfu")}
                  className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                    streamMode === "sfu"
                      ? "bg-discord-brand/10 border-discord-brand text-white"
                      : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Server
                        className={`w-4 h-4 ${
                          streamMode === "sfu"
                            ? "text-discord-brand"
                            : "text-gray-400"
                        }`}
                      />
                      <span className="text-xs font-bold">
                        边缘转发 (SFU)
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      中央边缘分发，主播仅推一路，适合多人观看。
                    </p>
                  </div>
                  <div className="mt-2 text-[10px] text-discord-brand font-semibold">
                    {streamMode === "sfu" && "✓ 当前已启用"}
                  </div>
                </div>

                {/* 选项 2: P2P Mesh */}
                <div
                  data-testid="edit-channel-streammode-direct"
                  onClick={() => setStreamMode("p2p_direct")}
                  className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                    streamMode === "p2p_direct"
                      ? "bg-discord-brand/10 border-discord-brand text-white"
                      : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Share2
                        className={`w-4 h-4 ${
                          streamMode === "p2p_direct"
                            ? "text-discord-brand"
                            : "text-gray-400"
                        }`}
                      />
                      <span className="text-xs font-bold">
                        P2P Mesh (直连)
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      主播单播直连每位观众，零服务器流量消耗。
                    </p>
                  </div>
                  <div className="mt-2 text-[10px] text-discord-brand font-semibold">
                    {streamMode === "p2p_direct" && "✓ 当前已启用"}
                  </div>
                </div>

                {/* 选项 3: Mesh Tree */}
                <div
                  data-testid="edit-channel-streammode-relay"
                  onClick={() => setStreamMode("p2p_relay")}
                  className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                    streamMode === "p2p_relay"
                      ? "bg-discord-brand/10 border-discord-brand text-white"
                      : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Layers
                        className={`w-4 h-4 ${
                          streamMode === "p2p_relay"
                            ? "text-discord-brand"
                            : "text-gray-400"
                        }`}
                      />
                      <span className="text-xs font-bold">
                        Mesh Tree (Beta)
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      观众多级树状中继分发，降低主播上行压力。
                    </p>
                  </div>
                  <div className="mt-2 text-[10px] text-discord-brand font-semibold">
                    {streamMode === "p2p_relay" && "✓ 当前已启用"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 频道属性信息卡片 */}
          <div className="bg-[#2b2d31] p-3.5 rounded-lg border border-[#383a40] space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              {t("modals:editChannel.attributes")}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">
                {t("modals:createChannel.typeLabel")}
              </span>
              <span className="font-medium text-gray-200">
                {isVoice
                  ? t("modals:editChannel.voiceTypeDesc")
                  : t("modals:editChannel.textTypeDesc")}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">
                {t("modals:createChannel.e2ee")}
              </span>
              {channel.isE2EE ? (
                <div className="flex items-center gap-1.5 text-discord-green bg-[#23a55a18] px-2 py-0.5 rounded border border-discord-green/30">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="font-semibold text-[11px]">
                    {t("modals:editChannel.e2eeActive")}
                  </span>
                </div>
              ) : (
                <span className="text-gray-500 text-[11px]">
                  {t("modals:editChannel.e2eeInactive")}
                </span>
              )}
            </div>
          </div>

          {/* 危险操作区：删除频道 */}
          <div className="pt-2 border-t border-[#3f4147]">
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3.5 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-red-400">
                  {t("modals:editChannel.deleteChannel")}
                </h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {t("modals:editChannel.deleteWarning")}
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
                <span>
                  {confirmDelete
                    ? t("modals:editChannel.confirmDelete")
                    : t("modals:editChannel.deleteChannel")}
                </span>
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
            {t("common:cancel")}
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
                <span>{t("modals:editChannel.saving")}</span>
              </>
            ) : (
              <span>{t("modals:editChannel.save")}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
