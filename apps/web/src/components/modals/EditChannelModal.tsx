import React, { useState, useEffect, useMemo } from "react";
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
  Lock,
  Plus,
  RotateCcw,
  Check,
  Minus,
  Users,
  Shield,
  User,
} from "lucide-react";
import {
  Channel,
  Guild,
  StreamTransmissionMode,
  PermissionFlags,
  PermissionOverwrite,
  OverwriteTargetType,
  CHANNEL_TEXT_PERMISSIONS,
  CHANNEL_VOICE_PERMISSIONS,
  ALL_PERMISSIONS,
} from "@tescord/types";
import { useTranslation } from "react-i18next";
import { API_BASE } from "../../config.js";
import { getErrorMessage } from "../../i18n/index.js";
import { Select } from "../ui/Select.js";

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
  const { t } = useTranslation(["modals", "common", "server", "errors"]);
  const [activeTab, setActiveTab] = useState<"overview" | "permissions">(
    "overview",
  );
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState<"sfu" | "p2p_mesh">("sfu");
  const [streamMode, setStreamMode] = useState<StreamTransmissionMode>("sfu");
  const [bitrate, setBitrate] = useState<number>(64000);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 权限覆写状态
  const [overwrites, setOverwrites] = useState<PermissionOverwrite[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>("everyone");
  const [selectedTargetType, setSelectedTargetType] =
    useState<OverwriteTargetType>("ROLE");
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);

  const everyoneRole = useMemo(() => {
    return guild?.roles?.find((r) => r.isDefault || r.name === "@everyone");
  }, [guild]);

  useEffect(() => {
    if (channel) {
      setName(channel.name || "");
      setTopic(channel.topic || "");
      setParentId(channel.parentId || null);
      setVoiceMode(channel.voiceMode || "sfu");
      setStreamMode(channel.streamMode || "sfu");
      setBitrate(channel.bitrate || 64000);
      setOverwrites(channel.overwrites || []);
      setError(null);
      setConfirmDelete(false);
      setConfirmSync(false);
      setActiveTab("overview");

      if (everyoneRole) {
        setSelectedTargetId(everyoneRole.id);
        setSelectedTargetType("ROLE");
      }
    }
  }, [channel, isOpen, everyoneRole]);

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

  const isVoice = channel.type === "VOICE";
  const parentCategory = channel.parentId
    ? guild?.categories?.find((c) => c.id === channel.parentId)
    : null;
  const isSyncedWithCategory = !!(channel.parentId && overwrites.length === 0);

  const channelPermissionsList = isVoice
    ? CHANNEL_VOICE_PERMISSIONS
    : CHANNEL_TEXT_PERMISSIONS;

  // 当前选中目标的覆写
  const currentOverwrite = overwrites.find(
    (o) =>
      o.targetId === selectedTargetId && o.targetType === selectedTargetType,
  );
  const currentAllow = currentOverwrite?.allow || 0;
  const currentDeny = currentOverwrite?.deny || 0;

  // 私密频道检测：@everyone 是否被 deny 了 VIEW_CHANNEL
  const everyoneOverwrite = everyoneRole
    ? overwrites.find(
        (o) => o.targetId === everyoneRole.id && o.targetType === "ROLE",
      )
    : null;
  const isPrivateChannel = !!(
    everyoneOverwrite &&
    (everyoneOverwrite.deny & PermissionFlags.VIEW_CHANNEL) ===
      PermissionFlags.VIEW_CHANNEL
  );

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
          name:
            channel.type === "TEXT"
              ? name.trim().toLowerCase().replace(/\s+/g, "-")
              : name.trim(),
          topic: topic.trim(),
          parentId: parentId || null,
          ...(channel.type === "VOICE"
            ? { voiceMode, streamMode, bitrate }
            : {}),
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

  // 切换单个权限位的状态 (Allow, Inherit, Deny)
  const handleTogglePermission = async (
    flag: PermissionFlags,
    newState: "ALLOW" | "INHERIT" | "DENY",
  ) => {
    let newAllow = currentAllow;
    let newDeny = currentDeny;

    if (newState === "ALLOW") {
      newAllow = (newAllow | flag) >>> 0;
      newDeny = (newDeny & ~flag) >>> 0;
    } else if (newState === "DENY") {
      newDeny = (newDeny | flag) >>> 0;
      newAllow = (newAllow & ~flag) >>> 0;
    } else {
      newAllow = (newAllow & ~flag) >>> 0;
      newDeny = (newDeny & ~flag) >>> 0;
    }

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(
        `${API_BASE}/api/channels/${channel.id}/permissions/${selectedTargetId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            targetType: selectedTargetType,
            allow: newAllow,
            deny: newDeny,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:saveFailed", "更新权限覆写失败"),
        );
      }

      const updatedChannel: Channel = await res.json();
      setOverwrites(updatedChannel.overwrites || []);
      onChannelUpdated?.(updatedChannel);
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 快捷切换私密频道
  const handleTogglePrivate = async () => {
    if (!everyoneRole) return;
    const currentlyPrivate = isPrivateChannel;
    const currentEvAllow = everyoneOverwrite?.allow || 0;
    const currentEvDeny = everyoneOverwrite?.deny || 0;

    const newDeny = currentlyPrivate
      ? (currentEvDeny & ~PermissionFlags.VIEW_CHANNEL) >>> 0
      : (currentEvDeny | PermissionFlags.VIEW_CHANNEL) >>> 0;
    const newAllow = (currentEvAllow & ~PermissionFlags.VIEW_CHANNEL) >>> 0;

    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(
        `${API_BASE}/api/channels/${channel.id}/permissions/${everyoneRole.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            targetType: "ROLE",
            allow: newAllow,
            deny: newDeny,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || "切换私密频道失败");
      }

      const updatedChannel: Channel = await res.json();
      setOverwrites(updatedChannel.overwrites || []);
      onChannelUpdated?.(updatedChannel);
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 与分类同步权限
  const handleSyncWithCategory = async () => {
    if (!confirmSync) {
      setConfirmSync(true);
      return;
    }

    setIsSyncing(true);
    setError(null);
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(`${API_BASE}/api/channels/${channel.id}/sync`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || "同步分类权限失败");
      }

      const updatedChannel: Channel = await res.json();
      setOverwrites(updatedChannel.overwrites || []);
      setConfirmSync(false);
      onChannelUpdated?.(updatedChannel);
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    } finally {
      setIsSyncing(false);
    }
  };

  // 删除当前选中目标的覆写
  const handleDeleteCurrentOverwrite = async () => {
    if (selectedTargetId === everyoneRole?.id) return;
    try {
      const token = localStorage.getItem("tescord_access_token");
      const res = await fetch(
        `${API_BASE}/api/channels/${channel.id}/permissions/${selectedTargetId}`,
        {
          method: "DELETE",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || "删除覆写失败");
      }

      const updatedChannel: Channel = await res.json();
      setOverwrites(updatedChannel.overwrites || []);
      if (everyoneRole) {
        setSelectedTargetId(everyoneRole.id);
        setSelectedTargetType("ROLE");
      }
      onChannelUpdated?.(updatedChannel);
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  return (
    <div
      data-testid="edit-channel-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-[#313338] text-discord-textNormal w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden border border-[#3f4147] animate-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题与 Tab 导航 */}
        <div className="relative px-6 pt-5 pb-3 border-b border-[#232428] shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {isVoice ? (
                <Volume2 className="w-5 h-5 text-gray-400" />
              ) : (
                <Hash className="w-5 h-5 text-gray-400" />
              )}
              <div>
                <h2 className="text-lg font-bold text-discord-textHeader">
                  {t("modals:editChannel.title")}
                </h2>
                <p className="text-xs text-discord-textMuted">
                  {t("modals:editChannel.subtitle", { name: channel.name })}
                </p>
              </div>
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

          {/* Tab 栏 */}
          <div className="flex items-center gap-4 mt-4 border-b border-[#232428]/60">
            <button
              type="button"
              data-testid="edit-channel-tab-overview"
              onClick={() => setActiveTab("overview")}
              className={`pb-2 text-xs font-bold transition border-b-2 ${
                activeTab === "overview"
                  ? "border-discord-brand text-white"
                  : "border-transparent text-gray-400 hover:text-gray-300"
              }`}
            >
              {t("modals:editChannel.tabs.overview", { defaultValue: "概况" })}
            </button>
            <button
              type="button"
              data-testid="edit-channel-tab-permissions"
              onClick={() => setActiveTab("permissions")}
              className={`pb-2 text-xs font-bold transition border-b-2 flex items-center gap-1.5 ${
                activeTab === "permissions"
                  ? "border-discord-brand text-white"
                  : "border-transparent text-gray-400 hover:text-gray-300"
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>
                {t("modals:editChannel.tabs.permissions", {
                  defaultValue: "权限",
                })}
              </span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab 1: 概况 (Overview) */}
        {activeTab === "overview" && (
          <form
            onSubmit={handleSubmit}
            className="px-6 py-5 space-y-5 overflow-y-auto flex-1"
          >
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

            {/* 频道话题 */}
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
              <Select
                value={parentId || ""}
                onChange={(val) => setParentId(val || null)}
                options={[
                  { value: "", label: t("modals:createChannel.noCategory") },
                  ...(guild?.categories || []).map((cat) => ({
                    value: cat.id,
                    label: `📁 ${cat.name}`,
                  })),
                ]}
                data-testid="edit-channel-category-select"
              />
            </div>

            {/* 语音频道传输拓扑设置 */}
            {isVoice && (
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-discord-textMuted">
                  音频传输架构 (Audio Transmission Topology)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        经由 Cloudflare Anycast
                        边缘服务器转发，多人通话稳定流畅。
                      </p>
                    </div>
                  </div>

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
                        客户端间端到端直连，零服务器延迟，极低开销。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 音频推流比特率 */}
            {isVoice && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-discord-textMuted flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-discord-brand" />
                    <span>{t("modals:editChannel.bitrateTitle")}</span>
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
              </div>
            )}

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
        )}

        {/* Tab 2: 权限 (Permissions) */}
        {activeTab === "permissions" && (
          <div className="px-6 py-4 flex flex-col flex-1 overflow-hidden space-y-4">
            {/* 顶部控制横幅：私密频道开关 + 分类同步按钮 */}
            <div className="bg-[#2b2d31] p-3 rounded-lg border border-[#383a40] space-y-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Lock className="w-5 h-5 text-discord-brand" />
                  <div>
                    <div className="text-xs font-bold text-discord-textHeader">
                      {t("modals:editChannel.permissions.privateChannel")}
                    </div>
                    <div className="text-[11px] text-discord-textMuted">
                      {t("modals:editChannel.permissions.privateChannelDesc")}
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="channel-private-switch"
                  checked={isPrivateChannel}
                  onChange={handleTogglePrivate}
                  className="w-4 h-4 rounded text-discord-brand focus:ring-discord-brand cursor-pointer"
                />
              </div>

              {/* 分类同步状态 */}
              {parentCategory && (
                <div className="pt-2 border-t border-[#383a40]/60 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isSyncedWithCategory ? "bg-green-400" : "bg-yellow-400"
                      }`}
                    />
                    <span className="text-[11px] text-gray-300">
                      {isSyncedWithCategory
                        ? t("modals:editChannel.permissions.synced")
                        : t("modals:editChannel.permissions.unsynced")}
                    </span>
                  </div>
                  {!isSyncedWithCategory && (
                    <button
                      type="button"
                      data-testid="sync-with-category-btn"
                      onClick={handleSyncWithCategory}
                      disabled={isSyncing}
                      className={`text-xs px-2.5 py-1 rounded transition flex items-center gap-1.5 ${
                        confirmSync
                          ? "bg-yellow-500 hover:bg-yellow-600 text-black font-bold animate-pulse"
                          : "bg-white/10 hover:bg-white/15 text-gray-200"
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>
                        {confirmSync
                          ? "确认同步 (清除覆盖)？"
                          : t(
                              "modals:editChannel.permissions.syncWithCategory",
                            )}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 左右分栏：左侧覆写目标列表，右侧三态权限设置 */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 min-h-0 overflow-hidden">
              {/* 左侧目标列表 */}
              <div className="bg-[#2b2d31] rounded-lg border border-[#383a40] p-2 flex flex-col min-h-0">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#383a40] shrink-0">
                  <span className="text-xs font-bold uppercase text-gray-400">
                    {t("modals:editChannel.permissions.roles")} /{" "}
                    {t("modals:editChannel.permissions.members")}
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      data-testid="add-overwrite-btn"
                      onClick={() => setShowAddMenu(!showAddMenu)}
                      className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
                      title={t(
                        "modals:editChannel.permissions.addRoleOrMember",
                      )}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    {/* 添加身份组/成员下拉浮层 */}
                    {showAddMenu && (
                      <div className="absolute left-0 mt-1 w-48 bg-[#1e1f22] border border-[#383a40] rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto p-1 animate-in fade-in zoom-in-95">
                        <div className="text-[10px] uppercase font-bold text-gray-500 px-2 py-1">
                          {t("modals:editChannel.permissions.roles")}
                        </div>
                        {guild?.roles
                          ?.filter(
                            (r) =>
                              !r.isDefault &&
                              !overwrites.some(
                                (o) =>
                                  o.targetId === r.id &&
                                  o.targetType === "ROLE",
                              ),
                          )
                          .map((role) => (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => {
                                setSelectedTargetId(role.id);
                                setSelectedTargetType("ROLE");
                                setShowAddMenu(false);
                              }}
                              className="w-full text-left px-2 py-1.5 rounded hover:bg-discord-brand text-xs text-gray-200 flex items-center gap-1.5"
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{
                                  backgroundColor: role.color || "#99aab5",
                                }}
                              />
                              <span className="truncate">{role.name}</span>
                            </button>
                          ))}

                        <div className="text-[10px] uppercase font-bold text-gray-500 px-2 py-1 pt-2 border-t border-[#383a40]/60">
                          {t("modals:editChannel.permissions.members")}
                        </div>
                        {guild?.members
                          ?.filter(
                            (m) =>
                              !overwrites.some(
                                (o) =>
                                  o.targetId === m.userId &&
                                  o.targetType === "MEMBER",
                              ),
                          )
                          .map((m) => (
                            <button
                              key={m.userId}
                              type="button"
                              onClick={() => {
                                setSelectedTargetId(m.userId);
                                setSelectedTargetType("MEMBER");
                                setShowAddMenu(false);
                              }}
                              className="w-full text-left px-2 py-1.5 rounded hover:bg-discord-brand text-xs text-gray-200 flex items-center gap-1.5"
                            >
                              <User className="w-3 h-3 text-gray-400" />
                              <span className="truncate">
                                {m.nickname || m.userId}
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1 overflow-y-auto flex-1 pr-1">
                  {/* @everyone 默认目标 */}
                  {everyoneRole && (
                    <button
                      type="button"
                      data-testid="overwrite-target-everyone"
                      onClick={() => {
                        setSelectedTargetId(everyoneRole.id);
                        setSelectedTargetType("ROLE");
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition flex items-center gap-2 ${
                        selectedTargetId === everyoneRole.id &&
                        selectedTargetType === "ROLE"
                          ? "bg-discord-brand text-white font-bold"
                          : "text-gray-300 hover:bg-[#35373c]"
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>@everyone</span>
                    </button>
                  )}

                  {/* 其它已覆写的身份组 */}
                  {guild?.roles
                    ?.filter((r) =>
                      overwrites.some(
                        (o) => o.targetId === r.id && o.targetType === "ROLE",
                      ),
                    )
                    .map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          setSelectedTargetId(role.id);
                          setSelectedTargetType("ROLE");
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition flex items-center justify-between ${
                          selectedTargetId === role.id &&
                          selectedTargetType === "ROLE"
                            ? "bg-discord-brand text-white font-bold"
                            : "text-gray-300 hover:bg-[#35373c]"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: role.color || "#99aab5",
                            }}
                          />
                          <span className="truncate">{role.name}</span>
                        </div>
                      </button>
                    ))}

                  {/* 其它已覆写的成员 */}
                  {overwrites
                    .filter((o) => o.targetType === "MEMBER")
                    .map((ow) => {
                      const member = guild?.members?.find(
                        (m) => m.userId === ow.targetId,
                      );
                      return (
                        <button
                          key={ow.targetId}
                          type="button"
                          onClick={() => {
                            setSelectedTargetId(ow.targetId);
                            setSelectedTargetType("MEMBER");
                          }}
                          className={`w-full text-left px-2 py-1.5 rounded text-xs transition flex items-center justify-between ${
                            selectedTargetId === ow.targetId &&
                            selectedTargetType === "MEMBER"
                              ? "bg-discord-brand text-white font-bold"
                              : "text-gray-300 hover:bg-[#35373c]"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <User className="w-3.5 h-3.5" />
                            <span className="truncate">
                              {member?.nickname || ow.targetId}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>

                {/* 移除覆写按钮 */}
                {selectedTargetId !== everyoneRole?.id && (
                  <button
                    type="button"
                    onClick={handleDeleteCurrentOverwrite}
                    className="mt-2 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1.5 rounded transition flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>
                      {t("modals:editChannel.permissions.resetOverwrite")}
                    </span>
                  </button>
                )}
              </div>

              {/* 右侧三态权限设置区 */}
              <div className="sm:col-span-2 bg-[#2b2d31] rounded-lg border border-[#383a40] p-3 flex flex-col min-h-0">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-400 pb-2 mb-2 border-b border-[#383a40] shrink-0 flex items-center justify-between">
                  <span>
                    {t("modals:editChannel.permissions.advancedPermissions")}
                  </span>
                </div>

                <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                  {channelPermissionsList.map((flag) => {
                    const permDef = ALL_PERMISSIONS.find(
                      (p) => p.flag === flag,
                    );
                    const isAllowed = (currentAllow & flag) === flag;
                    const isDenied = (currentDeny & flag) === flag;
                    const isInherit = !isAllowed && !isDenied;

                    return (
                      <div
                        key={flag}
                        className="flex items-center justify-between p-2 rounded bg-[#1e1f22]/60 hover:bg-[#1e1f22] transition border border-[#383a40]/30"
                      >
                        <div className="pr-3">
                          <div className="text-xs font-bold text-gray-200">
                            {permDef?.name ||
                              `Permission (1<<${Math.log2(flag)})`}
                          </div>
                          <div className="text-[10px] text-gray-400 line-clamp-1">
                            {permDef?.description || ""}
                          </div>
                        </div>

                        {/* 三态按钮组 (Deny / Inherit / Allow) */}
                        <div className="flex items-center rounded-lg bg-[#2b2d31] border border-[#383a40] p-0.5 shrink-0">
                          {/* 拒绝 (Deny) */}
                          <button
                            type="button"
                            data-testid={`perm-${flag}-deny`}
                            onClick={() => handleTogglePermission(flag, "DENY")}
                            className={`p-1.5 rounded transition flex items-center justify-center ${
                              isDenied
                                ? "bg-red-600 text-white shadow-sm"
                                : "text-gray-400 hover:text-red-400 hover:bg-white/5"
                            }`}
                            title={t("modals:editChannel.permissions.deny")}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>

                          {/* 继承 (Inherit) */}
                          <button
                            type="button"
                            data-testid={`perm-${flag}-inherit`}
                            onClick={() =>
                              handleTogglePermission(flag, "INHERIT")
                            }
                            className={`p-1.5 rounded transition flex items-center justify-center ${
                              isInherit
                                ? "bg-gray-500 text-white shadow-sm"
                                : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                            }`}
                            title={t("modals:editChannel.permissions.inherit")}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          {/* 允许 (Allow) */}
                          <button
                            type="button"
                            data-testid={`perm-${flag}-allow`}
                            onClick={() =>
                              handleTogglePermission(flag, "ALLOW")
                            }
                            className={`p-1.5 rounded transition flex items-center justify-center ${
                              isAllowed
                                ? "bg-green-600 text-white shadow-sm"
                                : "text-gray-400 hover:text-green-400 hover:bg-white/5"
                            }`}
                            title={t("modals:editChannel.permissions.allow")}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 底部操作按钮 */}
        <div className="bg-[#2b2d31] px-6 py-3.5 flex items-center justify-end gap-3 border-t border-[#232428] shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isDeleting}
            className="text-xs text-white hover:underline px-3 py-2 font-medium transition"
          >
            {t("common:cancel")}
          </button>
          {activeTab === "overview" && (
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
          )}
        </div>
      </div>
    </div>
  );
};
