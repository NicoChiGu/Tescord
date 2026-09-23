import React, { useState, useEffect } from "react";
import {
  AdminOverviewStats,
  AdminUserItem,
  AdminGuildItem,
  SystemSettingsDTO,
  SystemRole,
} from "@tescord/types";
import {
  ShieldAlert,
  Users,
  Server,
  Activity,
  MessageSquare,
  Clock,
  Cpu,
  Search,
  CheckCircle2,
  XCircle,
  Ban,
  KeyRound,
  Trash2,
  Megaphone,
  Sliders,
  X,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { useMaintenanceStore } from "../../stores/useMaintenanceStore.js";

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = "OVERVIEW" | "USERS" | "GUILDS" | "SYSTEM";

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { getAuthHeaders } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>("OVERVIEW");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // 1. 概览数据
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);

  // 2. 用户管理数据
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  // 3. 公会管理数据
  const [guilds, setGuilds] = useState<AdminGuildItem[]>([]);
  const [guildSearch, setGuildSearch] = useState("");
  const [deleteGuildConfirmId, setDeleteGuildConfirmId] = useState<string | null>(
    null,
  );
  const [deleteGuildConfirmName, setDeleteGuildConfirmName] = useState("");

  // 4. 系统设置与广播
  const [settings, setSettings] = useState<SystemSettingsDTO>({
    allowRegistration: true,
  });
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastContent, setBroadcastContent] = useState("");
  const [broadcastSeverity, setBroadcastSeverity] = useState<
    "INFO" | "WARNING" | "CRITICAL"
  >("INFO");

  useEffect(() => {
    if (isOpen) {
      loadTabData(activeTab);
    }
  }, [isOpen, activeTab]);

  const showSuccess = (msg: string) => {
    setSuccessNotice(msg);
    setTimeout(() => setSuccessNotice(null), 3000);
  };

  const loadTabData = async (tab: TabType) => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      if (tab === "OVERVIEW") {
        const res = await fetch(`${API_BASE}/api/admin/overview`, { headers });
        if (!res.ok) throw new Error("加载系统概览指标失败");
        setStats(await res.json());
      } else if (tab === "USERS") {
        const url = userSearch
          ? `${API_BASE}/api/admin/users?search=${encodeURIComponent(userSearch)}`
          : `${API_BASE}/api/admin/users`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error("加载用户列表失败");
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.items || []);
      } else if (tab === "GUILDS") {
        const url = guildSearch
          ? `${API_BASE}/api/admin/guilds?search=${encodeURIComponent(guildSearch)}`
          : `${API_BASE}/api/admin/guilds`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error("加载公会列表失败");
        const data = await res.json();
        setGuilds(Array.isArray(data) ? data : data.items || []);
      } else if (tab === "SYSTEM") {
        const res = await fetch(`${API_BASE}/api/admin/settings`, { headers });
        if (!res.ok) throw new Error("加载系统设置失败");
        setSettings(await res.json());
      }
    } catch (err: any) {
      setError(err.message || "请求失败");
    } finally {
      setLoading(false);
    }
  };

  // 用户操作：封禁/解封
  const handleToggleBan = async (user: AdminUserItem) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ isBanned: !user.isBanned }),
      });
      if (!res.ok) throw new Error("操作失败");
      showSuccess(user.isBanned ? "账号已解封" : "账号已被封禁");
      loadTabData("USERS");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 用户操作：修改角色
  const handleChangeRole = async (user: AdminUserItem, newRole: SystemRole) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error("更新角色失败");
      showSuccess(`已将用户角色调整为 ${newRole}`);
      loadTabData("USERS");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 用户操作：重置密码
  const handleResetPassword = async (userId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ resetPassword: true }),
      });
      if (!res.ok) throw new Error("重置密码失败");
      const result = await res.json();
      setTemporaryPassword(result.temporaryPassword || null);
      showSuccess("临时密码已生成，旧会话已撤销");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 公会操作：强制解散
  const handleForceDeleteGuild = async (guildId: string, guildName: string) => {
    if (deleteGuildConfirmName !== guildName) {
      setError("请输入完整服务器名称以确认解散");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/guilds/${guildId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ nameConfirmation: deleteGuildConfirmName }),
      });
      if (!res.ok) throw new Error("强制解散服务器失败");
      showSuccess("违规服务器已强制解散并清理");
      setDeleteGuildConfirmId(null);
      setDeleteGuildConfirmName("");
      loadTabData("GUILDS");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 系统操作：发送广播
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastContent.trim()) {
      setError("请完整填写广播标题与内容");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/admin/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          title: broadcastTitle.trim(),
          content: broadcastContent.trim(),
          severity: broadcastSeverity,
        }),
      });
      if (!res.ok) throw new Error("发送广播失败");
      showSuccess("系统广播已成功推送给全平台所有在线用户！");
      setBroadcastTitle("");
      setBroadcastContent("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // 系统操作：保存维护设置
  const handleSaveSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("保存系统设置失败");
      if (settings.maintenanceMode) {
        useMaintenanceStore.getState().setMaintenance({
          enabled: true,
          announcement: settings.systemAnnouncement || "",
        });
      } else {
        useMaintenanceStore.getState().clearMaintenance();
      }
      showSuccess("系统维护设置已保存生效！");
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-4 sm:p-6 select-none">
      <div
        data-testid="admin-dashboard-modal"
        className="w-full max-w-5xl h-[85vh] bg-[#313338] rounded-xl flex overflow-hidden shadow-2xl border border-[#3f4147]"
      >
        {/* 左侧导航栏 */}
        <aside className="w-56 bg-[#2b2d31] p-4 flex flex-col border-r border-[#1f2023]">
          <div className="flex items-center space-x-2 px-2 py-3 mb-4">
            <ShieldAlert className="w-6 h-6 text-amber-400" />
            <div>
              <h2 className="font-bold text-white text-sm">
                超级管理员系统控制台
              </h2>
              <span className="text-[10px] text-discord-textMuted tracking-wider font-mono">
                SUPER_ADMIN
              </span>
            </div>
          </div>

          <nav className="flex-1 space-y-1 text-sm">
            <button
              onClick={() => setActiveTab("OVERVIEW")}
              data-testid="admin-tab-overview"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "OVERVIEW"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>运行概览</span>
            </button>

            <button
              onClick={() => setActiveTab("USERS")}
              data-testid="admin-tab-users"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "USERS"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Users className="w-4 h-4 text-blue-400" />
              <span>全平台用户</span>
            </button>

            <button
              onClick={() => setActiveTab("GUILDS")}
              data-testid="admin-tab-guilds"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "GUILDS"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Server className="w-4 h-4 text-purple-400" />
              <span>公会监管</span>
            </button>

            <button
              onClick={() => setActiveTab("SYSTEM")}
              data-testid="admin-tab-system"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "SYSTEM"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Sliders className="w-4 h-4 text-amber-400" />
              <span>广播与维护</span>
            </button>
          </nav>

          <button
            onClick={() => loadTabData(activeTab)}
            disabled={loading}
            className="flex items-center justify-center space-x-2 text-xs text-discord-textMuted hover:text-white py-2 border-t border-[#3f4147] transition mt-auto"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            />
            <span>刷新数据</span>
          </button>
        </aside>

        {/* 右侧主内容区 */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#313338]">
          {/* 顶栏 */}
          <div className="h-14 border-b border-[#232428] px-6 flex items-center justify-between">
            <h3 className="font-bold text-lg text-white">
              {activeTab === "OVERVIEW" && "系统运行状态看板"}
              {activeTab === "USERS" && "全局注册用户治理与审查"}
              {activeTab === "GUILDS" && "全平台服务器审查与解散"}
              {activeTab === "SYSTEM" && "全网在线广播与系统维护设置"}
            </h3>
            <button
              onClick={onClose}
              data-testid="close-admin-modal-btn"
              className="p-1.5 rounded-full hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
              title="按 ESC 或点击关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 提示条 */}
          {error && (
            <div className="bg-rose-500/10 border-b border-rose-500/20 px-6 py-2 flex items-center justify-between text-xs text-rose-400">
              <span className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{error}</span>
              </span>
              <button onClick={() => setError(null)} className="hover:underline">
                关闭
              </button>
            </div>
          )}

          {successNotice && (
            <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-2 flex items-center space-x-2 text-xs text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* 滚动容器 */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading && !stats && users.length === 0 && (
              <div className="h-full flex items-center justify-center text-discord-textMuted space-x-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>加载后台数据中...</span>
              </div>
            )}

            {/* TAB 1: OVERVIEW */}
            {activeTab === "OVERVIEW" && stats && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* 用户量 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                      <Users className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs text-discord-textMuted">全平台注册用户</p>
                      <p className="text-2xl font-black text-white">
                        {stats.totalUsers}
                      </p>
                    </div>
                  </div>

                  {/* 在线人数 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <Activity className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs text-discord-textMuted">网关实时在线</p>
                      <p className="text-2xl font-black text-white">
                        {stats.onlineUsers}
                      </p>
                    </div>
                  </div>

                  {/* 服务器数 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400">
                      <Server className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs text-discord-textMuted">公会 / 服务器总数</p>
                      <p className="text-2xl font-black text-white">
                        {stats.totalGuilds}
                      </p>
                    </div>
                  </div>

                  {/* 消息总量 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs text-discord-textMuted">全站消息总流水</p>
                      <p className="text-2xl font-black text-white">
                        {stats.totalMessages}
                      </p>
                    </div>
                  </div>

                  {/* 运行时间 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                      <Clock className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs text-discord-textMuted">服务运行时长</p>
                      <p className="text-lg font-bold text-white">
                        {Math.floor(stats.uptimeSeconds / 3600)}h{" "}
                        {Math.floor((stats.uptimeSeconds % 3600) / 60)}m{" "}
                        {stats.uptimeSeconds % 60}s
                      </p>
                    </div>
                  </div>

                  {/* 内存占用 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-400">
                      <Cpu className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs text-discord-textMuted">堆内存消耗</p>
                      <p className="text-2xl font-black text-white">
                        {stats.memoryUsageMb} <span className="text-sm font-normal text-discord-textMuted">MB</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: USERS */}
            {activeTab === "USERS" && (
              <div className="space-y-4">
                <div className="flex items-center space-x-3 bg-[#1e1f22] px-3 py-2 rounded-lg border border-[#3f4147]">
                  <Search className="w-4 h-4 text-discord-textMuted" />
                  <input
                    type="text"
                    placeholder="按用户名或邮箱模糊检索..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadTabData("USERS")}
                    className="bg-transparent text-white text-sm outline-none flex-1 placeholder:text-discord-textMuted"
                  />
                  <button
                    onClick={() => loadTabData("USERS")}
                    className="px-3 py-1 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                  >
                    搜索
                  </button>
                </div>

                <div className="space-y-2">
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className="bg-[#2b2d31] p-3 rounded-lg border border-[#3f4147] flex flex-wrap items-center justify-between gap-3 hover:border-discord-brand/50 transition"
                    >
                      <div className="flex items-center space-x-3 min-w-[240px]">
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt={u.username}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-discord-brand flex items-center justify-center font-bold text-white">
                            {u.username.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-white text-sm">
                              {u.username}
                            </span>
                            {u.role === "SUPER_ADMIN" && (
                              <span className="bg-rose-500/20 text-rose-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-500/30">
                                超级管理员
                              </span>
                            )}
                            {u.isBanned && (
                              <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                已封禁
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-discord-textMuted">{u.email}</p>
                        </div>
                      </div>

                      <div className="text-xs text-discord-textMuted space-x-3">
                        <span>加入公会: <b>{u.guildCount}</b></span>
                        <span>发送消息: <b>{u.messageCount}</b></span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* 提权/降权 */}
                        {u.role !== "SUPER_ADMIN" ? (
                          <button
                            onClick={() => handleChangeRole(u, "SUPER_ADMIN")}
                            className="px-2 py-1 bg-[#3f4147] hover:bg-amber-600 text-white text-xs rounded transition"
                            title="提升为超级管理员"
                          >
                            升为超管
                          </button>
                        ) : (
                          <button
                            onClick={() => handleChangeRole(u, "USER")}
                            className="px-2 py-1 bg-[#3f4147] hover:bg-zinc-700 text-discord-textMuted hover:text-white text-xs rounded transition"
                            title="撤销管理员身份"
                          >
                            降为普通用户
                          </button>
                        )}

                        {/* 重置密码 */}
                        <button
                          onClick={() => setResetPwdUserId(u.id)}
                          className="px-2 py-1 bg-[#3f4147] hover:bg-discord-brand text-white text-xs rounded transition flex items-center space-x-1"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>重置密码</span>
                        </button>

                        {/* 封禁/解封 */}
                        <button
                          onClick={() => handleToggleBan(u)}
                          className={`px-2 py-1 text-xs rounded font-semibold transition flex items-center space-x-1 ${
                            u.isBanned
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-rose-600 hover:bg-rose-700 text-white"
                          }`}
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>{u.isBanned ? "解封" : "封禁"}</span>
                        </button>
                      </div>
                    </div>
                  ))}

                  {users.length === 0 && !loading && (
                    <div className="py-12 text-center text-discord-textMuted text-sm">
                      未找到符合条件的用户
                    </div>
                  )}
                </div>

                {/* 重置密码弹窗 */}
                {resetPwdUserId && (
                  <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-[#313338] p-6 rounded-xl border border-[#3f4147] max-w-sm w-full space-y-4 shadow-2xl">
                      <h4 className="font-bold text-white text-base">重置用户登录密码</h4>
                      {temporaryPassword ? (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-300">该临时密码仅显示一次，请安全交给用户。用户登录后必须立即修改。</p>
                          <code className="block select-text break-all bg-[#1e1f22] p-3 rounded border border-amber-500/30 text-amber-200 text-sm">
                            {temporaryPassword}
                          </code>
                        </div>
                      ) : (
                        <p className="text-sm text-discord-textMuted">
                          系统将生成随机临时密码，并立即撤销该用户的全部旧会话。
                        </p>
                      )}
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => {
                            setResetPwdUserId(null);
                            setTemporaryPassword(null);
                          }}
                          className="px-4 py-1.5 text-xs text-discord-textMuted hover:text-white"
                        >
                          取消
                        </button>
                        {!temporaryPassword && (
                          <button
                            onClick={() => handleResetPassword(resetPwdUserId)}
                            className="px-4 py-1.5 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded"
                          >
                            生成并重置
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: GUILDS */}
            {activeTab === "GUILDS" && (
              <div className="space-y-4">
                <div className="flex items-center space-x-3 bg-[#1e1f22] px-3 py-2 rounded-lg border border-[#3f4147]">
                  <Search className="w-4 h-4 text-discord-textMuted" />
                  <input
                    type="text"
                    placeholder="按服务器名称搜索..."
                    value={guildSearch}
                    onChange={(e) => setGuildSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadTabData("GUILDS")}
                    className="bg-transparent text-white text-sm outline-none flex-1 placeholder:text-discord-textMuted"
                  />
                  <button
                    onClick={() => loadTabData("GUILDS")}
                    className="px-3 py-1 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                  >
                    搜索
                  </button>
                </div>

                <div className="space-y-2">
                  {guilds.map((g) => (
                    <div
                      key={g.id}
                      className="bg-[#2b2d31] p-3 rounded-lg border border-[#3f4147] flex items-center justify-between hover:border-discord-brand/50 transition"
                    >
                      <div className="flex items-center space-x-3">
                        {g.iconUrl ? (
                          <img
                            src={g.iconUrl}
                            alt={g.name}
                            className="w-10 h-10 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-[#3f4147] flex items-center justify-center font-bold text-white text-xs">
                            {g.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-white text-sm">{g.name}</p>
                          <p className="text-xs text-discord-textMuted">
                            所有者: <b>{g.ownerName}</b> | 成员数: <b>{g.memberCount}</b> | 频道数: <b>{g.channelCount}</b>
                          </p>
                        </div>
                      </div>

                      <div>
                        {deleteGuildConfirmId === g.id ? (
                          <div className="flex items-center space-x-2">
                            <input
                              value={deleteGuildConfirmName}
                              onChange={(event) => setDeleteGuildConfirmName(event.target.value)}
                              placeholder={`输入 ${g.name}`}
                              aria-label="输入服务器名称确认解散"
                              className="w-36 bg-[#1e1f22] border border-rose-500/40 rounded px-2 py-1 text-xs text-white outline-none"
                            />
                            <button
                              onClick={() => handleForceDeleteGuild(g.id, g.name)}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded"
                            >
                              确认
                            </button>
                            <button
                              onClick={() => {
                                setDeleteGuildConfirmId(null);
                                setDeleteGuildConfirmName("");
                              }}
                              className="px-2 py-1 text-xs text-discord-textMuted hover:text-white"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setDeleteGuildConfirmId(g.id);
                              setDeleteGuildConfirmName("");
                            }}
                            className="px-3 py-1 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-xs font-semibold rounded transition flex items-center space-x-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>强制解散</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {guilds.length === 0 && !loading && (
                    <div className="py-12 text-center text-discord-textMuted text-sm">
                      未发现相关服务器
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: SYSTEM BROADCAST & SETTINGS */}
            {activeTab === "SYSTEM" && (
              <div className="space-y-6">
                {/* 发送置顶广播 */}
                <div className="bg-[#2b2d31] p-5 rounded-xl border border-[#3f4147] space-y-4">
                  <div className="flex items-center space-x-2">
                    <Megaphone className="w-5 h-5 text-amber-400" />
                    <h4 className="font-bold text-white text-sm">向全平台在线用户推送置顶广播</h4>
                  </div>

                  <form onSubmit={handleSendBroadcast} className="space-y-3">
                    <div>
                      <label className="text-xs text-discord-textMuted block mb-1">广播标题</label>
                      <input
                        type="text"
                        placeholder="例如: 平台维护通知"
                        value={broadcastTitle}
                        onChange={(e) => setBroadcastTitle(e.target.value)}
                        className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-discord-textMuted block mb-1">通知等级</label>
                        <select
                          value={broadcastSeverity}
                          onChange={(e: any) => setBroadcastSeverity(e.target.value)}
                          className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none"
                        >
                          <option value="INFO">普通信息 (INFO)</option>
                          <option value="WARNING">警告预警 (WARNING)</option>
                          <option value="CRITICAL">严重通知 (CRITICAL)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-discord-textMuted block mb-1">广播详情内容</label>
                      <textarea
                        rows={3}
                        placeholder="输入全网推送通知详情..."
                        value={broadcastContent}
                        onChange={(e) => setBroadcastContent(e.target.value)}
                        className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="px-4 py-2 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                    >
                      即刻下发全局广播
                    </button>
                  </form>
                </div>

                {/* 系统注册开关 */}
                <div className="bg-[#2b2d31] p-5 rounded-xl border border-[#3f4147] space-y-4">
                  <div className="flex items-center space-x-2">
                    <Sliders className="w-5 h-5 text-blue-400" />
                    <h4 className="font-bold text-white text-sm">系统访问与注册控制</h4>
                  </div>

                  <div className="flex items-center justify-between py-2 border-b border-[#3f4147]">
                    <div>
                      <p className="font-semibold text-white text-sm">开放新用户注册</p>
                      <p className="text-xs text-discord-textMuted">
                        关闭后，外部访客将无法注册新账号，仅允许已有账号登录
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.allowRegistration}
                        onChange={(e) =>
                          setSettings({ ...settings, allowRegistration: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-discord-green"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between py-2 border-b border-[#3f4147]">
                    <div>
                      <p className="font-semibold text-white text-sm">维护模式</p>
                      <p className="text-xs text-discord-textMuted">普通用户将停止业务和通话连接，超级管理员仍可治理系统。</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={!!settings.maintenanceMode} onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })} className="sr-only peer" />
                      <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600" />
                    </label>
                  </div>

                  <div>
                    <label className="text-xs text-discord-textMuted block mb-1">维护提示</label>
                    <textarea rows={2} value={settings.systemAnnouncement || ""} onChange={(e) => setSettings({ ...settings, systemAnnouncement: e.target.value })} className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none resize-none" placeholder="向普通用户说明维护原因和预计恢复时间" />
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    className="px-4 py-2 bg-discord-green hover:bg-[#23a55a] text-white text-xs font-semibold rounded transition"
                  >
                    保存系统设置
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
