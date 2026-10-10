import React, { useState } from "react";
import {
  X,
  Hash,
  Volume2,
  ShieldCheck,
  Radio,
  Network,
  Server,
  Share2,
  Layers,
  Lock,
} from "lucide-react";
import {
  Channel,
  ChannelCategory,
  ChannelType,
  Guild,
  StreamTransmissionMode,
} from "@tescord/types";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { getErrorMessage } from "../../i18n/index.js";
import { Select } from "../ui/Select.js";

interface CreateChannelModalProps {
  isOpen: boolean;
  guildId: string;
  guild?: Guild | null;
  categories?: ChannelCategory[];
  initialCategoryId?: string | null;
  onClose: () => void;
  onChannelCreated: (channel: Channel) => void;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  isOpen,
  guildId,
  guild,
  categories = [],
  initialCategoryId = null,
  onClose,
  onChannelCreated,
}) => {
  const { t } = useTranslation(["modals", "common", "admin", "errors"]);
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("TEXT");
  const [parentId, setParentId] = useState<string | null>(initialCategoryId);
  const [topic, setTopic] = useState("");
  const [voiceMode, setVoiceMode] = useState<"sfu" | "p2p_mesh">("sfu");
  const [streamMode, setStreamMode] = useState<StreamTransmissionMode>("sfu");
  const [bitrate, setBitrate] = useState<number>(64000);
  const [isE2EE, setIsE2EE] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setParentId(initialCategoryId || null);
      setName("");
      setTopic("");
      setVoiceMode("sfu");
      setStreamMode("sfu");
      setBitrate(64000);
      setIsE2EE(false);
      setIsPrivate(false);
      setSelectedRoleIds([]);
      setSelectedUserIds([]);
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
          name:
            type === "TEXT"
              ? name.trim().toLowerCase().replace(/\s+/g, "-")
              : name.trim(),
          type,
          parentId: parentId || undefined,
          topic: topic.trim() || undefined,
          isE2EE,
          isPrivate,
          allowedRoleIds: isPrivate ? selectedRoleIds : undefined,
          allowedUserIds: isPrivate ? selectedUserIds : undefined,
          ...(type === "VOICE" ? { voiceMode, streamMode, bitrate } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("modals:createChannel.failed"),
        );
      }

      const createdChannel: Channel = await res.json();
      onChannelCreated(createdChannel);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#313338] text-discord-textNormal w-full max-w-md rounded-lg shadow-2xl overflow-hidden border border-[#3f4147] max-h-[90vh] flex flex-col">
        {/* 标题 */}
        <div className="relative px-6 pt-6 pb-2 shrink-0">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-discord-textMuted hover:text-discord-textHeader transition"
            title={t("common:close")}
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold text-discord-textHeader">
            {t("modals:createChannel.title")}
          </h2>
          <p className="text-xs text-discord-textMuted mt-1">
            {t("modals:createChannel.subtitle")}
          </p>
        </div>

        {/* 表单内容 */}
        <form
          onSubmit={handleSubmit}
          className="px-6 py-4 space-y-4 overflow-y-auto flex-1"
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* 频道类型切换 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:createChannel.typeLabel")}
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
                  <div className="font-semibold text-sm">
                    {t("modals:createChannel.textType")}
                  </div>
                  <div className="text-xs text-discord-textMuted">
                    {t("modals:createChannel.textTypeDesc")}
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
                  <div className="font-semibold text-sm">
                    {t("modals:createChannel.voiceType")}
                  </div>
                  <div className="text-xs text-discord-textMuted">
                    {t("modals:createChannel.voiceTypeDesc")}
                  </div>
                </div>
              </label>
            </div>

            {type === "VOICE" && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                  音频传输架构 (Audio Transmission Topology)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    data-testid="create-channel-voicemode-sfu"
                    onClick={() => setVoiceMode("sfu")}
                    className={`p-2.5 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                      voiceMode === "sfu"
                        ? "bg-discord-brand/10 border-discord-brand text-white"
                        : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Radio className="w-3.5 h-3.5 text-discord-brand" />
                      <span className="text-xs font-bold">边缘 SFU</span>
                    </div>
                    <p className="text-[10px] text-gray-400">稳定多播转发</p>
                  </div>

                  <div
                    data-testid="create-channel-voicemode-mesh"
                    onClick={() => setVoiceMode("p2p_mesh")}
                    className={`p-2.5 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                      voiceMode === "p2p_mesh"
                        ? "bg-discord-brand/10 border-discord-brand text-white"
                        : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Network className="w-3.5 h-3.5 text-discord-brand" />
                      <span className="text-xs font-bold">纯 Mesh</span>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      P2P + Anycast TURN
                    </p>
                  </div>
                </div>
              </div>
            )}

            {type === "VOICE" && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                  直播推流架构 (Video Streaming Topology)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <div
                    data-testid="create-channel-streammode-sfu"
                    onClick={() => setStreamMode("sfu")}
                    className={`p-2 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                      streamMode === "sfu"
                        ? "bg-discord-brand/10 border-discord-brand text-white"
                        : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <Server className="w-3.5 h-3.5 text-discord-brand" />
                      <span className="text-[11px] font-bold">边缘 SFU</span>
                    </div>
                    <p className="text-[10px] text-gray-400">多人分发</p>
                  </div>

                  <div
                    data-testid="create-channel-streammode-direct"
                    onClick={() => setStreamMode("p2p_direct")}
                    className={`p-2 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                      streamMode === "p2p_direct"
                        ? "bg-discord-brand/10 border-discord-brand text-white"
                        : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <Share2 className="w-3.5 h-3.5 text-discord-brand" />
                      <span className="text-[11px] font-bold">P2P Mesh</span>
                    </div>
                    <p className="text-[10px] text-gray-400">直连单播</p>
                  </div>

                  <div
                    data-testid="create-channel-streammode-relay"
                    onClick={() => setStreamMode("p2p_relay")}
                    className={`p-2 rounded-lg border cursor-pointer transition flex flex-col justify-between ${
                      streamMode === "p2p_relay"
                        ? "bg-discord-brand/10 border-discord-brand text-white"
                        : "bg-[#2b2d31] border-[#383a40] text-gray-300 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <Layers className="w-3.5 h-3.5 text-discord-brand" />
                      <span className="text-[11px] font-bold">Mesh Tree</span>
                    </div>
                    <p className="text-[10px] text-gray-400">接力转发</p>
                  </div>
                </div>

                {/* 语音推流码率滑块 */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-discord-textMuted flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-discord-brand" />
                      <span>
                        {t("modals:editChannel.bitrateTitle", {
                          defaultValue: "音频推流码率 (Opus Bitrate)",
                        })}
                      </span>
                    </label>
                    <span className="font-mono text-xs font-bold text-discord-brand bg-discord-brand/10 px-2 py-0.5 rounded border border-discord-brand/20">
                      {Math.round(bitrate / 1000)} kbps
                    </span>
                  </div>
                  <input
                    type="range"
                    min="8000"
                    max="128000"
                    step="8000"
                    value={bitrate}
                    onChange={(e) => setBitrate(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#1e1f22] rounded-lg appearance-none cursor-pointer accent-discord-brand"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                    <span>8 kbps (省流)</span>
                    <span>64 kbps (标准)</span>
                    <span>96 kbps (高清)</span>
                    <span>128 kbps (Hi-Fi)</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 频道名称 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:createChannel.nameLabel")}{" "}
              <span className="text-red-400">*</span>
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
                placeholder={t("modals:createChannel.namePlaceholder")}
                className="w-full bg-[#1e1f22] text-discord-textHeader pl-8 pr-3 py-2.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent focus:border-discord-brand"
                data-testid="create-channel-name-input"
              />
            </div>
          </div>

          {/* 所属分类 */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
              {t("modals:createChannel.categoryLabel")}
            </label>
            <Select
              value={parentId || ""}
              onChange={(val) => setParentId(val || null)}
              options={[
                { value: "", label: t("modals:createChannel.noCategory") },
                ...categories.map((cat) => ({
                  value: cat.id,
                  label: `📁 ${cat.name}`,
                })),
              ]}
              data-testid="channel-category-select"
            />
          </div>

          {/* 频道话题 (仅文字频道) */}
          {type === "TEXT" && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted mb-2">
                {t("modals:createChannel.topicLabel")}
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={t("modals:createChannel.topicPlaceholder")}
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
                  {t("modals:createChannel.e2ee")}
                </div>
                <div className="text-[11px] text-discord-textMuted">
                  {t("modals:createChannel.e2eeDesc")}
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

          {/* 私密频道选项 (Private Channel) */}
          <div className="bg-[#2b2d31] p-3 rounded-lg border border-[#383a40] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <Lock className="w-5 h-5 text-discord-brand" />
                <div>
                  <div className="text-sm font-semibold text-discord-textHeader">
                    {t("modals:createChannel.privateChannel")}
                  </div>
                  <div className="text-[11px] text-discord-textMuted">
                    {t("modals:createChannel.privateChannelDesc")}
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                data-testid="create-channel-private-switch"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="w-4 h-4 rounded text-discord-brand focus:ring-discord-brand cursor-pointer"
              />
            </div>

            {/* 若开启私密频道，展开身份组与成员选择 */}
            {isPrivate && (
              <div className="pt-2 border-t border-[#383a40]/60 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                  {t("modals:createChannel.whoCanAccess")}
                </div>

                {/* 身份组列表 */}
                {guild?.roles && guild.roles.filter((r) => !r.isDefault).length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-gray-400">
                      {t("modals:editChannel.permissions.roles")}
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                      {guild.roles
                        .filter((r) => !r.isDefault)
                        .map((role) => {
                          const isChecked = selectedRoleIds.includes(role.id);
                          return (
                            <label
                              key={role.id}
                              className="flex items-center justify-between p-1.5 rounded bg-[#1e1f22]/60 hover:bg-[#1e1f22] cursor-pointer text-xs transition"
                            >
                              <div className="flex items-center space-x-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: role.color || "#99aab5" }}
                                />
                                <span className="text-discord-textHeader font-medium">
                                  {role.name}
                                </span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedRoleIds((prev) =>
                                    isChecked
                                      ? prev.filter((id) => id !== role.id)
                                      : [...prev, role.id],
                                  );
                                }}
                                className="w-3.5 h-3.5 rounded text-discord-brand"
                              />
                            </label>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* 成员列表 */}
                {guild?.members && guild.members.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] font-semibold text-gray-400">
                      {t("modals:editChannel.permissions.members")}
                    </div>
                    <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                      {guild.members.map((member) => {
                        const isChecked = selectedUserIds.includes(member.userId);
                        return (
                          <label
                            key={member.userId}
                            className="flex items-center justify-between p-1.5 rounded bg-[#1e1f22]/60 hover:bg-[#1e1f22] cursor-pointer text-xs transition"
                          >
                            <span className="text-discord-textHeader font-medium truncate max-w-[200px]">
                              {member.nickname || member.userId}
                            </span>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedUserIds((prev) =>
                                  isChecked
                                    ? prev.filter((id) => id !== member.userId)
                                    : [...prev, member.userId],
                                );
                              }}
                              className="w-3.5 h-3.5 rounded text-discord-brand"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-discord-textHeader hover:underline px-3 py-2"
            >
              {t("common:cancel")}
            </button>
            <button
              type="submit"
              data-testid="create-channel-submit-btn"
              disabled={isSubmitting || !name.trim()}
              className="bg-discord-brand hover:bg-discord-brandHover text-white px-5 py-2.5 rounded font-medium text-sm transition shadow-md disabled:opacity-50"
            >
              {isSubmitting
                ? t("modals:createChannel.submitting")
                : t("modals:createChannel.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
