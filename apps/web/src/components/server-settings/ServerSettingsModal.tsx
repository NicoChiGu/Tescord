import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Guild, Role } from "@tescord/types";
import {
  X,
  Sliders,
  Shield,
  Users,
  Link,
  Ban,
  FileText,
  Trash2,
  ChevronLeft,
  Smile,
} from "lucide-react";
import { OverviewTab } from "./OverviewTab.js";
import { RolesTab } from "./RolesTab.js";
import { EmojisTab } from "./EmojisTab.js";
import { MembersTab } from "./MembersTab.js";
import { BansTab } from "./BansTab.js";
import { InvitesTab } from "./InvitesTab.js";
import { AuditLogTab } from "./AuditLogTab.js";
import { DeleteGuildModal } from "./DeleteGuildModal.js";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";
import { usePermissions } from "../../hooks/usePermissions.js";

interface ServerSettingsModalProps {
  isOpen: boolean;
  guild: Guild | null;
  onClose: () => void;
  onGuildUpdated?: (guild: Guild) => void;
  onGuildDeleted?: (guildId: string) => void;
}

type TabType =
  | "overview"
  | "roles"
  | "emojis"
  | "members"
  | "invites"
  | "bans"
  | "audit-log";

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  isOpen,
  guild,
  onClose,
  onGuildUpdated,
  onGuildDeleted,
}) => {
  const { t } = useTranslation(["server", "contextMenu", "common", "errors"]);
  const { user: currentUser, token } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [mobileView, setMobileView] = useState<"menu" | "detail">("menu");
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [roles, setRoles] = useState<Role[]>(guild?.roles || []);

  const permissions = usePermissions(guild);
  const isOwner =
    permissions.isOwner ||
    guild?.ownerId === currentUser?.id ||
    currentUser?.role === "SUPER_ADMIN" ||
    (currentUser as any)?.role === "ADMIN";

  useEffect(() => {
    if (isOpen) setMobileView("menu");
  }, [isOpen, guild?.id]);

  const selectTab = (tab: TabType) => {
    setActiveTab(tab);
    setMobileView("detail");
  };

  // 监听键盘 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDeleteModalOpen) {
          setIsDeleteModalOpen(false);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDeleteModalOpen, onClose]);

  // 同步 roles 列表
  useEffect(() => {
    if (guild?.roles) {
      setRoles(guild.roles);
    }
  }, [guild?.roles]);

  // 拉取最新角色列表
  const refreshRoles = async () => {
    if (!guild) return;
    try {
      const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/roles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRoles(data);
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen && guild) {
      refreshRoles();
    }
  }, [isOpen, guild?.id]);

  if (!isOpen || !guild) return null;

  // 1. 更新服务器基本信息
  const handleUpdateGuild = async (data: {
    name?: string;
    iconUrl?: string | null;
    description?: string | null;
    isPublic?: boolean;
  }) => {
    const res = await fetch(`${API_BASE}/api/guilds/${guild.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:overview.updateFailed", {
            defaultValue: "更新服务器信息失败",
          }),
      );
    }
    const updated = await res.json();
    if (onGuildUpdated) {
      onGuildUpdated({ ...guild, ...updated });
    }
  };

  // 2. 解散/删除服务器
  const handleDeleteGuild = async () => {
    const res = await fetch(`${API_BASE}/api/guilds/${guild.id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ nameConfirmation: guild.name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:deleteModal.deleteFailed", {
            defaultValue: "解散服务器失败",
          }),
      );
    }
    if (onGuildDeleted) {
      onGuildDeleted(guild.id);
    }
    onClose();
  };

  // 3. 转让所有权
  const handleTransferOwnership = async (newOwnerId: string) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/transfer-ownership`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newOwnerId }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:members.transferFailed", {
            defaultValue: "转让所有权失败",
          }),
      );
    }
    const updated = await res.json();
    if (onGuildUpdated) {
      onGuildUpdated({ ...guild, ...updated });
    }
    toast.success(
      t("server:members.transferSuccessNotice", {
        defaultValue: "服务器所有权已成功转让！",
      }),
    );
  };

  // 4. 创建角色
  const handleCreateRole = async (name?: string): Promise<Role> => {
    const res = await fetch(`${API_BASE}/api/guilds/${guild.id}/roles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:roles.createFailed", { defaultValue: "创建身份组失败" }),
      );
    }
    const newRole = await res.json();
    await refreshRoles();
    return newRole;
  };

  // 5. 修改角色
  const handleUpdateRole = async (
    roleId: string,
    data: {
      name?: string;
      color?: string | null;
      hoist?: boolean;
      permissions?: number;
    },
  ) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/roles/${roleId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:roles.updateFailed", { defaultValue: "更新身份组失败" }),
      );
    }
    const updated = await res.json();
    setRoles((prev) => prev.map((r) => (r.id === roleId ? updated : r)));
  };

  // 6. 删除角色
  const handleDeleteRole = async (roleId: string) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/roles/${roleId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:roles.deleteFailed", { defaultValue: "删除身份组失败" }),
      );
    }
    setRoles((prev) => prev.filter((r) => r.id !== roleId));
  };

  // 7. 更新成员属性 (角色/昵称)
  const handleUpdateMember = async (
    targetUserId: string,
    data: { roleIds?: string[]; nickname?: string | null },
  ) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/members/${targetUserId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:members.updateFailed", {
            defaultValue: "更新成员信息失败",
          }),
      );
    }
    const updatedMember = await res.json();
    if (onGuildUpdated) {
      const nextMembers = (guild.members || []).map((m) =>
        m.userId === targetUserId ? updatedMember : m,
      );
      onGuildUpdated({ ...guild, members: nextMembers });
    }
  };

  // 8. 踢出成员
  const handleKickMember = async (targetUserId: string, reason?: string) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/members/${targetUserId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:members.kickFailed", { defaultValue: "踢出成员失败" }),
      );
    }
    if (onGuildUpdated) {
      const nextMembers = (guild.members || []).filter(
        (m) => m.userId !== targetUserId,
      );
      onGuildUpdated({ ...guild, members: nextMembers });
    }
  };

  // 9. 封禁成员
  const handleBanMember = async (targetUserId: string, reason?: string) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/bans/${targetUserId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:members.banFailed", { defaultValue: "封禁成员失败" }),
      );
    }
    if (onGuildUpdated) {
      const nextMembers = (guild.members || []).filter(
        (m) => m.userId !== targetUserId,
      );
      onGuildUpdated({ ...guild, members: nextMembers });
    }
  };

  // 10. 解除封禁
  const handleUnbanMember = async (targetUserId: string) => {
    const res = await fetch(
      `${API_BASE}/api/guilds/${guild.id}/bans/${targetUserId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          t("server:bans.unbanFailed", { defaultValue: "解除封禁失败" }),
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-0 sm:p-4 md:p-6 lg:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="server-settings-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col md:flex-row w-full h-[100dvh] min-h-0 sm:h-[88vh] sm:max-h-[850px] sm:max-w-4xl md:max-w-5xl bg-[#313338] text-white sm:rounded-2xl shadow-2xl overflow-hidden border border-transparent sm:border-[#3f4147] animate-in zoom-in-95 duration-150"
      >
        {/* 移动端右上角统一关闭按钮 (依照用户个人设置设计) */}
        <div className="md:hidden absolute top-2.5 right-3 flex items-center z-50">
          <button
            type="button"
            data-testid="close-server-settings-mobile-btn"
            onClick={onClose}
            aria-label={t("server:serverSettingsClose", {
              defaultValue: "关闭服务器设置",
            })}
            className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-gray-300 hover:text-white bg-[#1e1f22]/90 transition-all cursor-pointer shadow-md"
            title={`${t("common:close")} (ESC)`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 左侧：分类导航栏 */}
        <div
          data-testid="server-settings-menu"
          className={`${mobileView === "detail" ? "hidden md:flex" : "flex"} w-full md:w-60 flex-1 md:flex-none min-h-0 bg-[#2b2d31] p-5 md:p-6 flex-col justify-between select-none border-r border-[#1f2023] overflow-y-auto overscroll-contain`}
        >
          <div className="space-y-6">
            <div className="px-2 pr-12 md:pr-2">
              <h3 className="text-sm font-bold text-white truncate">
                {guild.name}
              </h3>
              <span className="text-[10px] uppercase font-extrabold tracking-wider text-gray-400">
                {t("server:serverSettings")}
              </span>
            </div>

            <div className="space-y-4">
              {/* 分组 1：服务器设置 */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                  {t("server:groups.serverSettings")}
                </div>
                <button
                  onClick={() => selectTab("overview")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "overview"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Sliders className="w-4 h-4" />
                  <span>{t("server:nav.overview")}</span>
                </button>
                <button
                  data-testid="server-settings-roles-tab"
                  onClick={() => selectTab("roles")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "roles"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>{t("server:nav.roles")}</span>
                </button>
                <button
                  data-testid="server-settings-emojis-tab"
                  onClick={() => selectTab("emojis")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "emojis"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Smile className="w-4 h-4" />
                  <span>{t("server:emojis", { defaultValue: "表情" })}</span>
                </button>
              </div>

              {/* 分组 2：用户管理 */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                  {t("server:groups.userManagement")}
                </div>
                <button
                  onClick={() => selectTab("members")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "members"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>{t("server:nav.members")}</span>
                </button>
                <button
                  onClick={() => selectTab("invites")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "invites"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Link className="w-4 h-4" />
                  <span>{t("server:nav.invites")}</span>
                </button>
                <button
                  onClick={() => selectTab("bans")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "bans"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Ban className="w-4 h-4" />
                  <span>{t("server:nav.bans")}</span>
                </button>
              </div>

              {/* 分组 3：审查与日志 */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                  {t("server:groups.security")}
                </div>
                <button
                  onClick={() => selectTab("audit-log")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "audit-log"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>{t("server:nav.auditLog")}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 危险区入口：仅限服务器所有者 */}
          {isOwner && (
            <div className="pt-4 border-t border-white/5">
              <button
                onClick={() => setIsDeleteModalOpen(true)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>{t("server:nav.deleteServer")}</span>
              </button>
            </div>
          )}
        </div>

        {/* 右侧：主配置画布 */}
        <div
          data-testid="server-settings-detail"
          className={`${mobileView === "menu" ? "hidden md:flex" : "flex"} flex-1 flex-col min-w-0 min-h-0 bg-[#313338] relative`}
        >
          <div className="md:hidden flex items-center gap-2 h-14 shrink-0 px-3 pr-14 border-b border-white/10 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              data-testid="server-settings-back"
              onClick={() => setMobileView("menu")}
              className="p-2 rounded-lg hover:bg-white/10 text-white"
              aria-label={t("server:serverSettingsBack", {
                defaultValue: "返回服务器设置目录",
              })}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold truncate">
              {t(
                `server:nav.${activeTab === "audit-log" ? "auditLog" : activeTab}`,
              )}
            </span>
          </div>
          {/* 桌面端内容与独立工具列的水平容器 */}
          <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
            {/* 桌面端 Discord 经典右侧独立工具列 (悬浮在右上侧，内容右侧，位于滚动条左侧) */}
            <div className="hidden md:flex flex-col items-center absolute top-8 right-6 z-30 select-none pointer-events-auto">
              <button
                type="button"
                data-testid="close-server-settings-btn"
                onClick={onClose}
                aria-label={t("common:close", { defaultValue: "关闭" })}
                className="w-9 h-9 rounded-full border-2 border-white/20 hover:border-white flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer shadow-lg bg-[#313338]/60 backdrop-blur-sm"
                title={`${t("common:close")} (ESC)`}
              >
                <X className="w-5 h-5" />
              </button>
              <span className="text-[10px] font-bold text-gray-400 mt-1.5 select-none tracking-wide">
                ESC
              </span>
            </div>

            {/* 内容画布容器 */}
            {activeTab === "roles" ? (
              <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col pr-0 md:pr-16">
                <RolesTab
                  guild={guild}
                  roles={roles}
                  onCreateRole={handleCreateRole}
                  onUpdateRole={handleUpdateRole}
                  onDeleteRole={handleDeleteRole}
                />
              </div>
            ) : (
              <div className="flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-10 py-5 md:py-10 pr-4 md:pr-20 pb-[max(1.25rem,env(safe-area-inset-bottom))] custom-scrollbar">
                {activeTab === "overview" && (
                  <OverviewTab
                    guild={guild}
                    onUpdateGuild={handleUpdateGuild}
                  />
                )}

                {activeTab === "emojis" && <EmojisTab guild={guild} />}

                {activeTab === "members" && (
                  <MembersTab
                    guild={guild}
                    roles={roles}
                    onUpdateMember={handleUpdateMember}
                    onKickMember={handleKickMember}
                    onBanMember={handleBanMember}
                    onTransferOwnership={handleTransferOwnership}
                  />
                )}

                {activeTab === "invites" && <InvitesTab guild={guild} />}

                {activeTab === "bans" && (
                  <BansTab guild={guild} onUnbanMember={handleUnbanMember} />
                )}

                {activeTab === "audit-log" && <AuditLogTab guild={guild} />}
              </div>
            )}
          </div>
        </div>

        {/* 删除服务器安全确认弹窗 */}
        <DeleteGuildModal
          isOpen={isDeleteModalOpen}
          guildName={guild.name}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={handleDeleteGuild}
        />
      </div>
    </div>
  );
};
