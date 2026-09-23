import React, { useState, useEffect } from "react";
import {
  X,
  Compass,
  KeyRound,
  Users,
  Plus,
  Loader2,
  Check,
  Search,
} from "lucide-react";
import { PublicGuild } from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";

interface DiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGuildJoined: (guildId: string) => void;
  onOpenCreateModal: () => void;
}

export const DiscoveryModal: React.FC<DiscoveryModalProps> = ({
  isOpen,
  onClose,
  onGuildJoined,
  onOpenCreateModal,
}) => {
  const { getAuthHeaders } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"discovery" | "invite">(
    "discovery",
  );

  // 公开探索列表状态
  const [publicGuilds, setPublicGuilds] = useState<PublicGuild[]>([]);
  const [isLoadingGuilds, setIsLoadingGuilds] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [joiningGuildId, setJoiningGuildId] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  // 邀请码加入状态
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // 打开弹窗时拉取公开服务器
  useEffect(() => {
    if (isOpen) {
      fetchPublicGuilds();
    }
  }, [isOpen]);

  const fetchPublicGuilds = async () => {
    setIsLoadingGuilds(true);
    setDiscoveryError(null);
    try {
      const res = await fetch(`${API_BASE}/api/discovery/guilds`, {
        headers: {
          ...getAuthHeaders(),
        },
      });
      if (!res.ok) {
        throw new Error("获取公开社区列表失败");
      }
      const data: PublicGuild[] = await res.json();
      setPublicGuilds(data);
    } catch (err: any) {
      setDiscoveryError(err.message || "无法连接到服务器");
    } finally {
      setIsLoadingGuilds(false);
    }
  };

  // 点击加入公开服务器
  const handleJoinPublicGuild = async (guildId: string) => {
    setJoiningGuildId(guildId);
    setDiscoveryError(null);
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guildId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "加入服务器失败");
      }

      const result = await res.json();
      onGuildJoined(result.id || guildId);
      onClose();
    } catch (err: any) {
      setDiscoveryError(err.message || "加入服务器异常");
    } finally {
      setJoiningGuildId(null);
    }
  };

  // 提交邀请码加入
  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = inviteCode.trim().split("/").pop() || "";
    if (!cleanCode) return;

    setIsSubmittingInvite(true);
    setInviteError(null);

    try {
      const res = await fetch(`${API_BASE}/api/invites/${cleanCode}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
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
      setInviteError(err.message || "网络连接异常");
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  if (!isOpen) return null;

  const filteredGuilds = publicGuilds.filter(
    (g) =>
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (g.description &&
        g.description.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  return (
    <div
      data-testid="discovery-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-4"
    >
      <div
        data-testid="discovery-modal"
        className="bg-[#313338] text-discord-textNormal w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-[#3f4147] flex flex-col max-h-[85vh]"
      >
        {/* 弹窗顶部 Header */}
        <div className="relative px-6 pt-6 pb-4 border-b border-[#3f4147]/60 flex-shrink-0 bg-[#2b2d31]">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-discord-textMuted hover:text-discord-textHeader transition p-1 rounded-full hover:bg-white/5"
            title="关闭 (ESC)"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-discord-brand/20 text-discord-brand flex items-center justify-center">
              <Compass className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-discord-textHeader">
                探索与加入服务器
              </h2>
              <p className="text-xs text-discord-textMuted mt-0.5">
                发现并加入精彩的公共社区，或通过邀请码直达私密空间。
              </p>
            </div>
          </div>

          {/* Tab 导航 */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab("discovery")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "discovery"
                  ? "bg-discord-brand text-white shadow-sm"
                  : "text-discord-textMuted hover:text-white hover:bg-white/5"
              }`}
            >
              <Compass className="w-4 h-4" />
              <span>探索公共社区</span>
            </button>
            <button
              onClick={() => setActiveTab("invite")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "invite"
                  ? "bg-discord-brand text-white shadow-sm"
                  : "text-discord-textMuted hover:text-white hover:bg-white/5"
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>使用邀请码</span>
            </button>
          </div>
        </div>

        {/* 主内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeTab === "discovery" && (
            <>
              {/* 搜索框 */}
              <div className="relative">
                <Search className="w-4 h-4 text-discord-textMuted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索服务器名称或话题介绍..."
                  className="w-full bg-[#1e1f22] text-discord-textHeader pl-10 pr-4 py-2.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-discord-brand border border-transparent focus:border-discord-brand transition placeholder-gray-500"
                />
              </div>

              {discoveryError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3.5 py-2.5 rounded-lg">
                  {discoveryError}
                </div>
              )}

              {/* 加载中 */}
              {isLoadingGuilds && (
                <div className="py-12 flex flex-col items-center justify-center text-discord-textMuted gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-discord-brand" />
                  <span className="text-xs">正在发现精彩社区...</span>
                </div>
              )}

              {/* 服务器卡片网格 */}
              {!isLoadingGuilds && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {filteredGuilds.map((g) => {
                    const resolvedIcon = g.iconUrl
                      ? resolveServerUrl(g.iconUrl)
                      : null;
                    return (
                      <div
                        key={g.id}
                        data-testid={`public-guild-card-${g.id}`}
                        className="bg-[#2b2d31] hover:bg-[#35373c] border border-white/5 rounded-xl p-4 flex flex-col justify-between transition-all duration-200 group shadow-sm hover:shadow-md"
                      >
                        <div className="flex items-start gap-3">
                          {resolvedIcon ? (
                            <img
                              src={resolvedIcon}
                              alt={g.name}
                              className="w-12 h-12 rounded-2xl object-cover bg-[#1e1f22] flex-shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-2xl bg-discord-brand/20 text-discord-brand font-bold text-lg flex items-center justify-center flex-shrink-0">
                              {g.name.slice(0, 1).toUpperCase()}
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm font-semibold text-discord-textHeader truncate group-hover:text-white">
                              {g.name}
                            </h3>
                            <p className="text-[11px] text-discord-textMuted line-clamp-2 mt-1 leading-relaxed">
                              {g.description ||
                                "一个充满活力的 Tescord 极客社区。"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between border-t border-white/5 pt-3 mt-3">
                          <div className="flex items-center gap-1.5 text-discord-textMuted text-[11px]">
                            <Users className="w-3.5 h-3.5" />
                            <span>{g.memberCount} 位成员</span>
                          </div>

                          {g.isJoined ? (
                            <button
                              disabled
                              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-white/10 text-gray-300 text-xs font-semibold cursor-default"
                            >
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>已加入</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleJoinPublicGuild(g.id)}
                              disabled={joiningGuildId === g.id}
                              data-testid={`join-guild-btn-${g.id}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-discord-brand hover:bg-discord-brand/80 active:bg-discord-brand/70 text-white text-xs font-semibold transition disabled:opacity-50 cursor-pointer shadow-sm"
                            >
                              {joiningGuildId === g.id && (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              )}
                              <span>加入服务器</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 空结果 */}
              {!isLoadingGuilds && filteredGuilds.length === 0 && (
                <div className="py-12 flex flex-col items-center justify-center text-discord-textMuted gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                    <Compass className="w-6 h-6 text-gray-500" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-300">
                      暂无找到匹配的公开社区
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      您可以尝试更换搜索词，或创建属于自己的服务器。
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "invite" && (
            <form
              onSubmit={handleInviteSubmit}
              className="space-y-4 max-w-lg mx-auto py-4"
            >
              {inviteError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3.5 py-2.5 rounded-lg">
                  {inviteError}
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
                    className="w-full bg-[#1e1f22] text-discord-textHeader px-3.5 py-2.5 pl-10 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-discord-brand transition border border-transparent focus:border-discord-brand font-mono placeholder-gray-500"
                  />
                  <KeyRound className="w-4 h-4 text-discord-textMuted absolute left-3.5 pointer-events-none" />
                </div>
                <p className="text-[11px] text-discord-textMuted mt-1.5">
                  输入由服务器管理员或好友分发的 8 位专属邀请码。
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmittingInvite || !inviteCode.trim()}
                  className="w-full bg-discord-brand hover:bg-discord-brand/80 active:bg-discord-brand/70 text-white font-semibold py-2.5 px-4 rounded-lg text-xs transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                >
                  {isSubmittingInvite && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>加入服务器</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* 弹窗底部操作 Footer */}
        <div className="bg-[#2b2d31] px-6 py-4 border-t border-[#3f4147]/60 flex items-center justify-between text-xs text-discord-textMuted flex-shrink-0">
          <span>还没有心仪的圈子？</span>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenCreateModal();
            }}
            className="flex items-center gap-1.5 text-discord-brand hover:underline font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>创建专属服务器</span>
          </button>
        </div>
      </div>
    </div>
  );
};
