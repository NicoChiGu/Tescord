import { GuildIcon } from "../ui/GuildIcon.js";
import { Select } from "../ui/Select.js";
import React, { useState, useEffect } from "react";
import {
  AdminOverviewStats,
  AdminUserItem,
  AdminGuildItem,
  SystemSettingsDTO,
  SystemRole,
  RegistrationInviteDTO,
  AdminStorageStats,
  AdminGcResult,
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
  Ban,
  KeyRound,
  Trash2,
  Megaphone,
  Sliders,
  X,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Ticket,
  Plus,
  Copy,
  Check,
  ChevronLeft,
  HardDrive,
  Database,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  API_BASE,
  resolveServerUrl,
  getRegistrationInviteUrl,
} from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { useMaintenanceStore } from "../../stores/useMaintenanceStore.js";
import { dialog } from "../../stores/useDialogStore.js";
import { getErrorMessage } from "../../i18n/index.js";

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType =
  | "OVERVIEW"
  | "USERS"
  | "GUILDS"
  | "INVITES"
  | "SYSTEM"
  | "STORAGE";

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation(["admin", "common", "modals", "errors"]);
  const { getAuthHeaders } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>("OVERVIEW");
  const [mobileView, setMobileView] = useState<"menu" | "detail">("menu");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // 1. 概览数据
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);

  // 2. 用户管理数据
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [resetPwdUserId, setResetPwdUserId] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  );

  // 3. 公会管理数据
  const [guilds, setGuilds] = useState<AdminGuildItem[]>([]);
  const [guildSearch, setGuildSearch] = useState("");

  // 4. 系统设置与广播
  const [settings, setSettings] = useState<SystemSettingsDTO>({
    allowRegistration: true,
  });
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastContent, setBroadcastContent] = useState("");
  const [broadcastSeverity, setBroadcastSeverity] = useState<
    "INFO" | "WARNING" | "CRITICAL"
  >("INFO");

  // 5. 注册邀请码管理数据
  const [invites, setInvites] = useState<RegistrationInviteDTO[]>([]);
  const [inviteSearch, setInviteSearch] = useState("");
  const [isCreateInviteModalOpen, setIsCreateInviteModalOpen] = useState(false);
  const [newInviteNote, setNewInviteNote] = useState("");
  const [newInviteMaxUses, setNewInviteMaxUses] = useState(1);
  const [newInviteExpiresInDays, setNewInviteExpiresInDays] = useState<
    number | null
  >(7);
  const [newInviteCustomCode, setNewInviteCustomCode] = useState("");
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // 6. 存储管理数据
  const [storageStats, setStorageStats] = useState<AdminStorageStats | null>(
    null,
  );
  const [isCleaningStorage, setIsCleaningStorage] = useState(false);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2)} ${sizes[i]}`;
  };

  useEffect(() => {
    if (isOpen) {
      loadTabData(activeTab);
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (isOpen) setMobileView("menu");
  }, [isOpen]);

  const selectTab = (tab: TabType) => {
    setActiveTab(tab);
    setMobileView("detail");
  };

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
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            getErrorMessage(data) || t("admin:overview.loadFailed"),
          );
        }
        setStats(await res.json());
      } else if (tab === "USERS") {
        const url = userSearch
          ? `${API_BASE}/api/admin/users?search=${encodeURIComponent(userSearch)}`
          : `${API_BASE}/api/admin/users`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(getErrorMessage(data) || t("admin:users.loadFailed"));
        }
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.items || []);
      } else if (tab === "GUILDS") {
        const url = guildSearch
          ? `${API_BASE}/api/admin/guilds?search=${encodeURIComponent(guildSearch)}`
          : `${API_BASE}/api/admin/guilds`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            getErrorMessage(data) || t("admin:guilds.loadFailed"),
          );
        }
        const data = await res.json();
        setGuilds(Array.isArray(data) ? data : data.items || []);
      } else if (tab === "INVITES") {
        const url = inviteSearch
          ? `${API_BASE}/api/admin/registration-invites?search=${encodeURIComponent(inviteSearch)}`
          : `${API_BASE}/api/admin/registration-invites`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            getErrorMessage(data) || t("admin:invites.loadFailed"),
          );
        }
        const data = await res.json();
        setInvites(data.invites || []);
      } else if (tab === "SYSTEM") {
        const res = await fetch(`${API_BASE}/api/admin/settings`, { headers });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            getErrorMessage(data) || t("admin:system.loadFailed"),
          );
        }
        setSettings(await res.json());
      } else if (tab === "STORAGE") {
        const res = await fetch(`${API_BASE}/api/admin/storage/stats`, {
          headers,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            getErrorMessage(data) || t("admin:storage.actions.loadFailed"),
          );
        }
        setStorageStats(await res.json());
      }
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    } finally {
      setLoading(false);
    }
  };

  const handleRunGc = async () => {
    const confirmed = await dialog.confirm({
      title: t("admin:storage.actions.confirmTitle"),
      description: t("admin:storage.actions.confirmDesc"),
      variant: "danger",
      confirmText: t("admin:storage.actions.confirmBtn"),
      cancelText: t("admin:storage.actions.cancelBtn"),
    });
    if (!confirmed) return;

    setIsCleaningStorage(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/storage/gc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("admin:storage.actions.cleanFailed"),
        );
      }
      const result: AdminGcResult = await res.json();
      showSuccess(
        t("admin:storage.actions.cleanSuccess", {
          files: result.deletedPhysicalFiles,
          freed: formatBytes(result.freedBytes),
          duration: result.durationMs,
        }),
      );
      await loadTabData("STORAGE");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:INTERNAL_ERROR"));
    } finally {
      setIsCleaningStorage(false);
    }
  };

  // 用户操作：封禁/解封
  const handleToggleBan = async (targetUser: AdminUserItem) => {
    const actionText = targetUser.isBanned
      ? t("admin:users.unbanBtn")
      : t("admin:users.banBtn");
    const consequence = !targetUser.isBanned
      ? t("admin:users.confirmBanConsequence")
      : t("admin:users.confirmUnbanConsequence");
    const confirmed = await dialog.confirm({
      title: t("admin:users.confirmBanTitle", { action: actionText }),
      description: t("admin:users.confirmBanDesc", {
        action: actionText,
        username: targetUser.username,
        email: targetUser.email,
        consequence,
      }),
      variant: targetUser.isBanned ? "warning" : "danger",
      requireSecurityCode: true,
      confirmText: t("admin:users.confirmBanBtn", { action: actionText }),
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ isBanned: !targetUser.isBanned }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:saveFailed", "操作失败"),
        );
      }
      showSuccess(
        targetUser.isBanned
          ? t("admin:users.actionUnbanned")
          : t("admin:users.actionBanned"),
      );
      loadTabData("USERS");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 用户操作：修改角色
  const handleChangeRole = async (
    targetUser: AdminUserItem,
    newRole: SystemRole,
  ) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:saveFailed", "更新角色失败"),
        );
      }
      showSuccess(t("admin:users.roleUpdated", { role: newRole }));
      loadTabData("USERS");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 用户操作：重置密码
  const handleResetPassword = async (userId: string) => {
    const targetUser = users.find((u) => u.id === userId);
    const confirmed = await dialog.confirm({
      title: t("admin:users.resetPwdConfirmTitle"),
      description: t("admin:users.resetPwdConfirmDesc", {
        username: targetUser?.username || userId,
      }),
      variant: "danger",
      requireSecurityCode: true,
      confirmText: t("admin:users.resetPwdBtn"),
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ resetPassword: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("admin:users.resetPwdFailed"),
        );
      }
      const result = await res.json();
      setTemporaryPassword(result.temporaryPassword || null);
      showSuccess(t("admin:users.resetPwdSuccess"));
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 公会操作：强制解散
  const handleForceDeleteGuild = async (guildId: string, guildName: string) => {
    const confirmed = await dialog.confirm({
      title: t("admin:guilds.disbandConfirmTitle"),
      description: t("admin:guilds.disbandConfirmDesc", {
        name: guildName,
        id: guildId,
      }),
      variant: "danger",
      requireSecurityCode: true,
      confirmText: t("admin:guilds.forceDisband"),
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/guilds/${guildId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ nameConfirmation: guildName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("admin:guilds.disbandFailed"),
        );
      }
      showSuccess(t("admin:guilds.disbandSuccess"));
      loadTabData("GUILDS");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 系统操作：发送广播
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastContent.trim()) {
      setError(t("admin:system.fillBroadcastError"));
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("admin:system.broadcastFailed"),
        );
      }
      showSuccess(t("admin:system.broadcastPushed"));
      setBroadcastTitle("");
      setBroadcastContent("");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("admin:system.settingsFailed"),
        );
      }
      if (settings.maintenanceMode) {
        useMaintenanceStore.getState().setMaintenance({
          enabled: true,
          announcement: settings.systemAnnouncement || "",
        });
      } else {
        useMaintenanceStore.getState().clearMaintenance();
      }
      showSuccess(t("admin:system.settingsSaved"));
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 邀请码操作：创建新邀请码
  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingInvite(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/registration-invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          note: newInviteNote.trim() || undefined,
          maxUses: Number(newInviteMaxUses) >= 0 ? Number(newInviteMaxUses) : 1,
          expiresInDays: newInviteExpiresInDays,
          customCode: newInviteCustomCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          getErrorMessage(data) || t("admin:invites.createFailed"),
        );
      }
      showSuccess(t("admin:invites.createSuccess", { code: data.code }));
      setIsCreateInviteModalOpen(false);
      setNewInviteNote("");
      setNewInviteCustomCode("");
      loadTabData("INVITES");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    } finally {
      setIsCreatingInvite(false);
    }
  };

  // 邀请码操作：作废/恢复
  const handleToggleRevokeInvite = async (invite: RegistrationInviteDTO) => {
    const actionText = invite.isRevoked
      ? t("admin:invites.restoreValid")
      : t("admin:invites.revokeNow");
    const consequence = !invite.isRevoked
      ? t("admin:invites.revokeConsequence")
      : t("admin:invites.restoreConsequence");
    const confirmed = await dialog.confirm({
      title: t("admin:invites.toggleRevokeTitle", { action: actionText }),
      description: t("admin:invites.toggleRevokeDesc", {
        action: actionText,
        code: invite.code,
        consequence,
      }),
      variant: invite.isRevoked ? "warning" : "danger",
      confirmText: t("admin:users.confirmBanBtn", { action: actionText }),
    });
    if (!confirmed) return;

    try {
      const res = await fetch(
        `${API_BASE}/api/admin/registration-invites/${encodeURIComponent(invite.code)}/revoke`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ isRevoked: !invite.isRevoked }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:saveFailed", "操作失败"),
        );
      }
      showSuccess(
        t("admin:invites.actionSuccess", {
          code: invite.code,
          action: actionText,
        }),
      );
      loadTabData("INVITES");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 邀请码操作：物理删除
  const handleDeleteInvite = async (invite: RegistrationInviteDTO) => {
    const confirmed = await dialog.confirm({
      title: t("admin:invites.deleteInviteTitle"),
      description: t("admin:invites.deleteInviteDesc", { code: invite.code }),
      variant: "danger",
      requireSecurityCode: true,
      confirmText: t("common:delete"),
    });
    if (!confirmed) return;

    try {
      const res = await fetch(
        `${API_BASE}/api/admin/registration-invites/${encodeURIComponent(invite.code)}`,
        {
          method: "DELETE",
          headers: getAuthHeaders(),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          getErrorMessage(data) || t("common:deleteFailed", "删除失败"),
        );
      }
      showSuccess(t("admin:invites.deleteSuccess", { code: invite.code }));
      loadTabData("INVITES");
    } catch (err: any) {
      setError(getErrorMessage(err) || t("errors:NETWORK_ERROR"));
    }
  };

  // 邀请码操作：一键复制邀请链接
  const handleCopyInviteLink = (code: string) => {
    const inviteLink = getRegistrationInviteUrl(code);
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopiedCode(code);
      showSuccess(t("admin:invites.copySuccess", { link: inviteLink }));
      setTimeout(() => setCopiedCode(null), 2500);
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-0 sm:p-6 select-none">
      <div
        data-testid="admin-dashboard-modal"
        className="w-full max-w-5xl h-[100dvh] sm:h-[85vh] min-h-0 bg-[#313338] sm:rounded-xl flex flex-col md:flex-row overflow-hidden shadow-2xl border border-[#3f4147]"
      >
        {/* 左侧导航栏 */}
        <aside
          data-testid="admin-settings-menu"
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"} w-full md:w-56 flex-1 md:flex-none min-h-0 bg-[#2b2d31] p-4 flex-col border-r border-[#1f2023] overflow-y-auto overscroll-contain`}
        >
          <button
            type="button"
            onClick={onClose}
            className="md:hidden absolute right-4 top-4 p-2 rounded-lg text-discord-textMuted hover:text-white hover:bg-white/10"
            aria-label="关闭管理后台"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2 px-2 py-3 mb-4">
            <ShieldAlert className="w-6 h-6 text-amber-400" />
            <div>
              <h2 className="font-bold text-white text-sm">
                {t("admin:header.superAdminTitle")}
              </h2>
              <span className="text-[10px] text-discord-textMuted tracking-wider font-mono">
                {t("admin:header.superAdminBadge")}
              </span>
            </div>
          </div>

          <nav className="flex-1 space-y-1 text-sm">
            <button
              onClick={() => selectTab("OVERVIEW")}
              data-testid="admin-tab-overview"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "OVERVIEW"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>{t("admin:nav.overview")}</span>
            </button>

            <button
              onClick={() => selectTab("USERS")}
              data-testid="admin-tab-users"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "USERS"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Users className="w-4 h-4 text-blue-400" />
              <span>{t("admin:nav.users")}</span>
            </button>

            <button
              onClick={() => selectTab("GUILDS")}
              data-testid="admin-tab-guilds"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "GUILDS"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Server className="w-4 h-4 text-purple-400" />
              <span>{t("admin:nav.guilds")}</span>
            </button>

            <button
              onClick={() => selectTab("INVITES")}
              data-testid="admin-tab-invites"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "INVITES"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Ticket className="w-4 h-4 text-emerald-400" />
              <span>{t("admin:nav.invites")}</span>
            </button>

            <button
              onClick={() => selectTab("SYSTEM")}
              data-testid="admin-tab-system"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "SYSTEM"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <Sliders className="w-4 h-4 text-amber-400" />
              <span>{t("admin:nav.system")}</span>
            </button>

            <button
              onClick={() => selectTab("STORAGE")}
              data-testid="admin-tab-storage"
              className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg transition font-medium ${
                activeTab === "STORAGE"
                  ? "bg-[#3f4147] text-white"
                  : "text-discord-textMuted hover:bg-[#35373c] hover:text-white"
              }`}
            >
              <HardDrive className="w-4 h-4 text-cyan-400" />
              <span>{t("admin:nav.storage")}</span>
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
            <span>{t("admin:header.refreshData")}</span>
          </button>
        </aside>

        {/* 右侧主内容区 */}
        <main
          data-testid="admin-settings-detail"
          className={`${mobileView === "menu" ? "hidden md:flex" : "flex"} flex-1 flex-col min-w-0 min-h-0 bg-[#313338]`}
        >
          {/* 顶栏 */}
          <div className="h-14 shrink-0 border-b border-[#232428] px-3 md:px-6 flex items-center justify-between pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              data-testid="admin-settings-back"
              onClick={() => setMobileView("menu")}
              className="md:hidden mr-2 p-2 rounded-lg text-white hover:bg-white/10"
              aria-label="返回管理目录"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-lg text-white flex-1 min-w-0 truncate">
              {activeTab === "OVERVIEW" && t("admin:header.tabOverviewTitle")}
              {activeTab === "USERS" && t("admin:header.tabUsersTitle")}
              {activeTab === "GUILDS" && t("admin:header.tabGuildsTitle")}
              {activeTab === "INVITES" && t("admin:header.tabInvitesTitle")}
              {activeTab === "SYSTEM" && t("admin:header.tabSystemTitle")}
              {activeTab === "STORAGE" && t("admin:header.tabStorageTitle")}
            </h3>
            <button
              onClick={onClose}
              data-testid="close-admin-modal-btn"
              className="p-1.5 rounded-full hover:bg-[#3f4147] text-discord-textMuted hover:text-white transition"
              title={t("common:close")}
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
              <button
                onClick={() => setError(null)}
                className="hover:underline"
              >
                {t("common:close")}
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
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {loading && !stats && users.length === 0 && (
              <div className="h-full flex items-center justify-center text-discord-textMuted space-x-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t("admin:header.loadingData")}</span>
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
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:overview.totalUsers")}
                      </p>
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
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:overview.onlineUsers")}
                      </p>
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
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:overview.totalGuilds")}
                      </p>
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
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:overview.totalMessages")}
                      </p>
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
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:overview.uptime")}
                      </p>
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
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:overview.memory")}
                      </p>
                      <p className="text-2xl font-black text-white">
                        {stats.memoryUsageMb}{" "}
                        <span className="text-sm font-normal text-discord-textMuted">
                          MB
                        </span>
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
                    placeholder={t("admin:users.searchPlaceholder")}
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadTabData("USERS")}
                    className="bg-transparent text-white text-sm outline-none flex-1 placeholder:text-discord-textMuted"
                  />
                  <button
                    onClick={() => loadTabData("USERS")}
                    className="px-3 py-1 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                  >
                    {t("admin:users.searchBtn")}
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
                            src={resolveServerUrl(u.avatarUrl)}
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
                                {t("admin:users.superAdminRole")}
                              </span>
                            )}
                            {u.isBanned && (
                              <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                {t("admin:users.bannedBadge")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-discord-textMuted">
                            {u.email}
                          </p>
                        </div>
                      </div>

                      <div className="text-xs text-discord-textMuted space-x-3">
                        <span>
                          {t("admin:users.guildCount")} <b>{u.guildCount}</b>
                        </span>
                        <span>
                          {t("admin:users.messageCount")}{" "}
                          <b>{u.messageCount}</b>
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* 提权/降权 */}
                        {u.role !== "SUPER_ADMIN" ? (
                          <button
                            onClick={() => handleChangeRole(u, "SUPER_ADMIN")}
                            className="px-2 py-1 bg-[#3f4147] hover:bg-amber-600 text-white text-xs rounded transition"
                            title={t("admin:users.actions.promoteAdmin")}
                          >
                            {t("admin:users.promoteToAdmin")}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleChangeRole(u, "USER")}
                            className="px-2 py-1 bg-[#3f4147] hover:bg-zinc-700 text-discord-textMuted hover:text-white text-xs rounded transition"
                            title={t("admin:users.actions.demoteUser")}
                          >
                            {t("admin:users.demoteToUser")}
                          </button>
                        )}

                        {/* 重置密码 */}
                        <button
                          onClick={() => setResetPwdUserId(u.id)}
                          className="px-2 py-1 bg-[#3f4147] hover:bg-discord-brand text-white text-xs rounded transition flex items-center space-x-1"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>{t("admin:users.resetPwdBtn")}</span>
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
                          <span>
                            {u.isBanned
                              ? t("admin:users.unbanBtn")
                              : t("admin:users.banBtn")}
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}

                  {users.length === 0 && !loading && (
                    <div className="py-12 text-center text-discord-textMuted text-sm">
                      {t("admin:users.noUsers")}
                    </div>
                  )}
                </div>

                {/* 重置密码弹窗 */}
                {resetPwdUserId && (
                  <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-[#313338] p-6 rounded-xl border border-[#3f4147] max-w-sm w-full space-y-4 shadow-2xl">
                      <h4 className="font-bold text-white text-base">
                        {t("admin:users.resetDialogTitle")}
                      </h4>
                      {temporaryPassword ? (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-300">
                            {t("admin:users.resetDialogTip")}
                          </p>
                          <code className="block select-text break-all bg-[#1e1f22] p-3 rounded border border-amber-500/30 text-amber-200 text-sm">
                            {temporaryPassword}
                          </code>
                        </div>
                      ) : (
                        <p className="text-sm text-discord-textMuted">
                          {t("admin:users.resetDialogDesc")}
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
                          {t("common:cancel")}
                        </button>
                        {!temporaryPassword && (
                          <button
                            onClick={() => handleResetPassword(resetPwdUserId)}
                            className="px-4 py-1.5 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded"
                          >
                            {t("admin:users.generateAndReset")}
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
                    placeholder={t("admin:guilds.searchPlaceholder")}
                    value={guildSearch}
                    onChange={(e) => setGuildSearch(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && loadTabData("GUILDS")
                    }
                    className="bg-transparent text-white text-sm outline-none flex-1 placeholder:text-discord-textMuted"
                  />
                  <button
                    onClick={() => loadTabData("GUILDS")}
                    className="px-3 py-1 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                  >
                    {t("admin:guilds.searchBtn")}
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
                          <GuildIcon
                            src={resolveServerUrl(g.iconUrl)}
                            alt={g.name}
                            className="w-10 h-10 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-[#3f4147] flex items-center justify-center font-bold text-white text-xs">
                            {g.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-white text-sm">
                            {g.name}
                          </p>
                          <p className="text-xs text-discord-textMuted">
                            {t("admin:guilds.owner")} <b>{g.ownerName}</b> |{" "}
                            {t("admin:guilds.memberCount")}{" "}
                            <b>{g.memberCount}</b> |{" "}
                            {t("admin:guilds.channelCount")}{" "}
                            <b>{g.channelCount}</b>
                          </p>
                        </div>
                      </div>

                      <div>
                        <button
                          onClick={() => handleForceDeleteGuild(g.id, g.name)}
                          className="px-3 py-1 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white text-xs font-semibold rounded transition flex items-center space-x-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t("admin:guilds.forceDisband")}</span>
                        </button>
                      </div>
                    </div>
                  ))}

                  {guilds.length === 0 && !loading && (
                    <div className="py-12 text-center text-discord-textMuted text-sm">
                      {t("admin:guilds.noGuilds")}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: REGISTRATION INVITES */}
            {activeTab === "INVITES" && (
              <div className="space-y-4">
                {/* 顶栏控制：搜索与生成按钮 */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3 bg-[#1e1f22] px-3 py-2 rounded-lg border border-[#3f4147] flex-1 max-w-md">
                    <Search className="w-4 h-4 text-discord-textMuted" />
                    <input
                      type="text"
                      placeholder={t("admin:invites.searchPlaceholder")}
                      value={inviteSearch}
                      onChange={(e) => setInviteSearch(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && loadTabData("INVITES")
                      }
                      className="bg-transparent text-white text-sm outline-none flex-1 placeholder:text-discord-textMuted"
                    />
                    <button
                      onClick={() => loadTabData("INVITES")}
                      className="px-3 py-1 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                    >
                      {t("admin:invites.searchBtn")}
                    </button>
                  </div>

                  <button
                    onClick={() => setIsCreateInviteModalOpen(true)}
                    data-testid="create-invite-btn"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition flex items-center justify-center space-x-1.5 shadow-lg shadow-emerald-600/20"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t("admin:invites.createBtn")}</span>
                  </button>
                </div>

                {/* 邀请码列表 */}
                <div className="space-y-2">
                  {invites.map((inv) => {
                    const isExpired =
                      inv.expiresAt && new Date(inv.expiresAt) < new Date();
                    const isExhausted =
                      inv.maxUses > 0 && inv.uses >= inv.maxUses;
                    let statusLabel = t("admin:invites.statusValid");
                    let statusClass =
                      "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                    if (inv.isRevoked) {
                      statusLabel = t("admin:invites.statusRevoked");
                      statusClass =
                        "bg-rose-500/10 text-rose-400 border-rose-500/20";
                    } else if (isExpired) {
                      statusLabel = t("admin:invites.statusExpired");
                      statusClass =
                        "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
                    } else if (isExhausted) {
                      statusLabel = t("admin:invites.statusExhausted");
                      statusClass =
                        "bg-amber-500/10 text-amber-400 border-amber-500/20";
                    }

                    return (
                      <div
                        key={inv.code}
                        className="bg-[#2b2d31] p-3.5 rounded-lg border border-[#3f4147] flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-discord-brand/40 transition"
                      >
                        <div className="flex items-start space-x-3">
                          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0 mt-0.5">
                            <Ticket className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center space-x-2.5">
                              <span className="font-mono font-bold text-white text-base tracking-wider">
                                {inv.code}
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusClass}`}
                              >
                                {statusLabel}
                              </span>
                              {inv.note && (
                                <span className="text-xs text-gray-300 font-medium px-2 py-0.5 bg-[#1e1f22] rounded">
                                  {inv.note}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-discord-textMuted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span>
                                {t("admin:invites.usageProgress")}{" "}
                                <b className="text-white">
                                  {inv.uses} /{" "}
                                  {inv.maxUses === 0
                                    ? t("admin:invites.unlimited")
                                    : inv.maxUses}
                                </b>
                              </span>
                              <span>
                                {t("admin:invites.expiresAt")}{" "}
                                <b className="text-white">
                                  {inv.expiresAt
                                    ? new Date(inv.expiresAt).toLocaleString()
                                    : t("admin:invites.neverExpires")}
                                </b>
                              </span>
                              {inv.createdByName && (
                                <span>
                                  {t("admin:invites.creator")}{" "}
                                  <b>{inv.createdByName}</b>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 按钮操作栏 */}
                        <div className="flex items-center space-x-2 self-end md:self-center">
                          <button
                            onClick={() => handleCopyInviteLink(inv.code)}
                            title={t("admin:invites.copyLink")}
                            className="px-2.5 py-1.5 bg-[#3f4147] hover:bg-discord-brand text-white text-xs font-medium rounded transition flex items-center space-x-1"
                          >
                            {copiedCode === inv.code ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-400 font-bold">
                                  {t("admin:invites.copiedLink")}
                                </span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>{t("admin:invites.copyLink")}</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleToggleRevokeInvite(inv)}
                            className={`px-2.5 py-1.5 text-xs font-medium rounded transition ${
                              inv.isRevoked
                                ? "bg-amber-500/20 text-amber-400 hover:bg-amber-600 hover:text-white"
                                : "bg-rose-500/20 text-rose-400 hover:bg-rose-600 hover:text-white"
                            }`}
                          >
                            {inv.isRevoked
                              ? t("admin:invites.restoreValid")
                              : t("admin:invites.revokeNow")}
                          </button>

                          <button
                            onClick={() => handleDeleteInvite(inv)}
                            title={t("admin:invites.deleteTitle")}
                            className="p-1.5 text-discord-textMuted hover:text-rose-400 hover:bg-[#3f4147] rounded transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {invites.length === 0 && !loading && (
                    <div className="py-16 text-center text-discord-textMuted text-sm flex flex-col items-center justify-center space-y-2">
                      <Ticket className="w-8 h-8 opacity-40" />
                      <p>{t("admin:invites.noInvites")}</p>
                      <button
                        onClick={() => setIsCreateInviteModalOpen(true)}
                        className="text-xs text-[#5865f2] hover:underline"
                      >
                        {t("admin:invites.generateNewPrompt")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 5: SYSTEM BROADCAST & SETTINGS */}
            {activeTab === "SYSTEM" && (
              <div className="space-y-6">
                {/* 发送置顶广播 */}
                <div className="bg-[#2b2d31] p-5 rounded-xl border border-[#3f4147] space-y-4">
                  <div className="flex items-center space-x-2">
                    <Megaphone className="w-5 h-5 text-amber-400" />
                    <h4 className="font-bold text-white text-sm">
                      {t("admin:system.broadcastSectionTitle")}
                    </h4>
                  </div>

                  <form onSubmit={handleSendBroadcast} className="space-y-3">
                    <div>
                      <label className="text-xs text-discord-textMuted block mb-1">
                        {t("admin:system.broadcastTitleLabel")}
                      </label>
                      <input
                        type="text"
                        placeholder={t(
                          "admin:system.broadcastTitlePlaceholder",
                        )}
                        value={broadcastTitle}
                        onChange={(e) => setBroadcastTitle(e.target.value)}
                        className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-discord-textMuted block mb-1">
                          {t("admin:system.broadcastSeverityLevel")}
                        </label>
                        <Select
                          value={broadcastSeverity}
                          onChange={(val) =>
                            setBroadcastSeverity(
                              val as "INFO" | "WARNING" | "CRITICAL",
                            )
                          }
                          options={[
                            {
                              value: "INFO",
                              label: t("admin:system.severityInfo"),
                            },
                            {
                              value: "WARNING",
                              label: t("admin:system.severityWarning"),
                            },
                            {
                              value: "CRITICAL",
                              label: t("admin:system.severityCritical"),
                            },
                          ]}
                          triggerClassName="p-2 border border-[#3f4147] rounded"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-discord-textMuted block mb-1">
                        {t("admin:system.broadcastContentLabel")}
                      </label>
                      <textarea
                        rows={3}
                        placeholder={t(
                          "admin:system.broadcastContentPlaceholder",
                        )}
                        value={broadcastContent}
                        onChange={(e) => setBroadcastContent(e.target.value)}
                        className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      className="px-4 py-2 bg-discord-brand hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition"
                    >
                      {t("admin:system.sendBroadcastBtn")}
                    </button>
                  </form>
                </div>

                {/* 系统注册开关 */}
                <div className="bg-[#2b2d31] p-5 rounded-xl border border-[#3f4147] space-y-4">
                  <div className="flex items-center space-x-2">
                    <Sliders className="w-5 h-5 text-blue-400" />
                    <h4 className="font-bold text-white text-sm">
                      {t("admin:system.accessControlTitle")}
                    </h4>
                  </div>

                  <div className="flex items-center justify-between py-2 border-b border-[#3f4147]">
                    <div>
                      <p className="font-semibold text-white text-sm">
                        {t("admin:system.allowRegTitle")}
                      </p>
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:system.allowRegDesc")}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.allowRegistration}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            allowRegistration: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-discord-green"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between py-2 border-b border-[#3f4147]">
                    <div>
                      <p className="font-semibold text-white text-sm">
                        {t("admin:system.requireInviteTitle")}
                      </p>
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:system.requireInviteDesc")}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!settings.requireInviteCode}
                        disabled={!settings.allowRegistration}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            requireInviteCode: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-discord-brand"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between py-2 border-b border-[#3f4147]">
                    <div>
                      <p className="font-semibold text-white text-sm">
                        {t("admin:allowNonSuperAdminCreateGuildTitle")}
                      </p>
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:allowNonSuperAdminCreateGuildDesc")}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={
                          settings.allowNonSuperAdminCreateGuild !== false
                        }
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            allowNonSuperAdminCreateGuild: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-discord-green"></div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between py-2 border-b border-[#3f4147]">
                    <div>
                      <p className="font-semibold text-white text-sm">
                        {t("admin:system.maintenanceModeTitle")}
                      </p>
                      <p className="text-xs text-discord-textMuted">
                        {t("admin:system.maintenanceModeDesc")}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!settings.maintenanceMode}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            maintenanceMode: e.target.checked,
                          })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600" />
                    </label>
                  </div>

                  <div>
                    <label className="text-xs text-discord-textMuted block mb-1">
                      {t("admin:system.maintenanceNoticeLabel")}
                    </label>
                    <textarea
                      rows={2}
                      value={settings.systemAnnouncement || ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          systemAnnouncement: e.target.value,
                        })
                      }
                      className="w-full bg-[#1e1f22] p-2 rounded border border-[#3f4147] text-white text-sm outline-none resize-none"
                      placeholder={t(
                        "admin:system.maintenanceNoticePlaceholder",
                      )}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    className="px-4 py-2 bg-discord-green hover:bg-[#23a55a] text-white text-xs font-semibold rounded transition"
                  >
                    {t("admin:system.saveSettingsBtn")}
                  </button>
                </div>
              </div>
            )}

            {/* 6. 存储空间与数据维护 */}
            {activeTab === "STORAGE" && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-xl font-bold text-white mb-1">
                    {t("admin:storage.title")}
                  </h4>
                  <p className="text-sm text-discord-textMuted">
                    {t("admin:storage.subtitle")}
                  </p>
                </div>

                {/* 指标卡片网格 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* 总存储占用 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="p-3 bg-cyan-500/10 rounded-lg text-cyan-400">
                      <HardDrive className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-discord-textMuted font-medium truncate">
                        {t("admin:storage.cards.totalUsed")}
                      </p>
                      <p className="text-xl font-bold text-white truncate">
                        {formatBytes(storageStats?.totalUsedBytes || 0)}
                      </p>
                    </div>
                  </div>

                  {/* 有效附件 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400">
                      <Database className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-discord-textMuted font-medium truncate">
                        {t("admin:storage.cards.activeAttachments")}
                      </p>
                      <p className="text-xl font-bold text-white truncate">
                        {formatBytes(storageStats?.activeAttachmentBytes || 0)}
                      </p>
                      <p className="text-[11px] text-discord-textMuted">
                        {storageStats?.activeAttachmentCount || 0}{" "}
                        {t("admin:storage.cards.fileCount")}
                      </p>
                    </div>
                  </div>

                  {/* 已解绑待回收附件 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="p-3 bg-rose-500/10 rounded-lg text-rose-400">
                      <Trash2 className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-discord-textMuted font-medium truncate">
                        {t("admin:storage.cards.orphanedAttachments")}
                      </p>
                      <p className="text-xl font-bold text-white truncate">
                        {formatBytes(storageStats?.orphanedAttachmentBytes || 0)}
                      </p>
                      <p className="text-[11px] text-discord-textMuted">
                        {storageStats?.orphanedAttachmentCount || 0}{" "}
                        {t("admin:storage.cards.fileCount")}
                      </p>
                    </div>
                  </div>

                  {/* 废弃草稿孤儿文件 */}
                  <div className="bg-[#2b2d31] p-4 rounded-xl border border-[#3f4147] flex items-center space-x-4">
                    <div className="p-3 bg-amber-500/10 rounded-lg text-amber-400">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-discord-textMuted font-medium truncate">
                        {t("admin:storage.cards.orphanedDrafts")}
                      </p>
                      <p className="text-xl font-bold text-white truncate">
                        {formatBytes(storageStats?.orphanedDraftBytes || 0)}
                      </p>
                      <p className="text-[11px] text-discord-textMuted">
                        {storageStats?.orphanedDraftCount || 0}{" "}
                        {t("admin:storage.cards.fileCount")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 策略说明面板 */}
                <div className="bg-[#2b2d31] p-5 rounded-xl border border-[#3f4147] space-y-3">
                  <div className="flex items-center justify-between border-b border-[#3f4147] pb-3">
                    <h5 className="font-bold text-white text-sm flex items-center space-x-2">
                      <ShieldAlert className="w-4 h-4 text-discord-brand" />
                      <span>{t("admin:storage.policy.title")}</span>
                    </h5>
                    <span className="text-xs text-discord-textMuted">
                      {t("admin:storage.cards.lastGc")}:{" "}
                      {storageStats?.lastGcTimestamp
                        ? new Date(
                            storageStats.lastGcTimestamp,
                          ).toLocaleString()
                        : t("admin:storage.cards.never")}
                    </span>
                  </div>
                  <ul className="text-xs text-discord-textMuted space-y-2 leading-relaxed">
                    <li className="flex items-start space-x-2">
                      <span className="text-discord-green font-bold">•</span>
                      <span>{t("admin:storage.policy.rule1")}</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-discord-green font-bold">•</span>
                      <span>{t("admin:storage.policy.rule2")}</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-discord-green font-bold">•</span>
                      <span>{t("admin:storage.policy.rule3")}</span>
                    </li>
                  </ul>
                </div>

                {/* 一键清理操作栏 */}
                <div className="flex items-center justify-between p-4 bg-[#2b2d31] rounded-xl border border-[#3f4147]">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {t("admin:storage.actions.cleanNow")}
                    </p>
                    <p className="text-xs text-discord-textMuted">
                      {t("admin:storage.actions.confirmDesc")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRunGc}
                    disabled={isCleaningStorage}
                    data-testid="admin-run-gc-btn"
                    className="flex items-center space-x-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition shadow"
                  >
                    {isCleaningStorage ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t("admin:storage.actions.cleaning")}</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>{t("admin:storage.actions.cleanNow")}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 生成邀请码模态弹窗 */}
      {isCreateInviteModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 animate-fade-in">
          <div className="w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain bg-[#313338] rounded-xl border border-[#3f4147] p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#3f4147] pb-3">
              <div className="flex items-center space-x-2">
                <Ticket className="w-5 h-5 text-emerald-400" />
                <h4 className="font-bold text-white text-base">
                  {t("admin:invites.modal.title")}
                </h4>
              </div>
              <button
                onClick={() => setIsCreateInviteModalOpen(false)}
                className="text-discord-textMuted hover:text-white p-1 rounded transition"
                title={t("common:close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInvite} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">
                  {t("admin:invites.modal.noteLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("admin:invites.modal.notePlaceholder")}
                  value={newInviteNote}
                  onChange={(e) => setNewInviteNote(e.target.value)}
                  className="w-full bg-[#1e1f22] p-2.5 rounded-lg border border-[#3f4147] text-white text-sm outline-none focus:border-discord-brand transition"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">
                  {t("admin:invites.modal.maxUsesLabel")}
                </label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[1, 5, 10, 0].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setNewInviteMaxUses(count)}
                      className={`py-1.5 text-xs font-semibold rounded-lg border transition ${
                        newInviteMaxUses === count
                          ? "bg-discord-brand text-white border-discord-brand"
                          : "bg-[#1e1f22] text-gray-300 border-[#3f4147] hover:bg-[#2b2d31]"
                      }`}
                    >
                      {count === 0
                        ? t("admin:invites.unlimitedUses")
                        : t("admin:invites.usesCount", { count })}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={0}
                  value={newInviteMaxUses}
                  onChange={(e) => setNewInviteMaxUses(Number(e.target.value))}
                  placeholder={t("admin:invites.customUsesPlaceholder")}
                  className="w-full bg-[#1e1f22] p-2 rounded-lg border border-[#3f4147] text-white text-xs outline-none focus:border-discord-brand transition"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">
                  {t("admin:invites.modal.expiresLabel")}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: t("admin:invites.days1"), days: 1 },
                    { label: t("admin:invites.modal.days7"), days: 7 },
                    { label: t("admin:invites.modal.days30"), days: 30 },
                    { label: t("admin:invites.modal.permanent"), days: null },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setNewInviteExpiresInDays(item.days)}
                      className={`py-1.5 text-xs font-semibold rounded-lg border transition ${
                        newInviteExpiresInDays === item.days
                          ? "bg-discord-brand text-white border-discord-brand"
                          : "bg-[#1e1f22] text-gray-300 border-[#3f4147] hover:bg-[#2b2d31]"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">
                  {t("admin:invites.modal.customCodeLabel")}
                </label>
                <input
                  type="text"
                  placeholder={t("admin:invites.modal.customCodePlaceholder")}
                  value={newInviteCustomCode}
                  onChange={(e) =>
                    setNewInviteCustomCode(e.target.value.toUpperCase())
                  }
                  className="w-full bg-[#1e1f22] p-2.5 rounded-lg border border-[#3f4147] text-white text-sm uppercase font-mono tracking-wider outline-none focus:border-discord-brand transition"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#3f4147]">
                <button
                  type="button"
                  onClick={() => setIsCreateInviteModalOpen(false)}
                  className="px-4 py-2 text-xs text-gray-300 hover:text-white transition"
                >
                  {t("common:cancel")}
                </button>
                <button
                  type="submit"
                  disabled={isCreatingInvite}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {isCreatingInvite
                    ? t("admin:invites.modal.submitting")
                    : t("admin:invites.submitCreate")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
