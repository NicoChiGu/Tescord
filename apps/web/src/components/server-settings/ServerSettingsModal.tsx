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
} from "lucide-react";
import { OverviewTab } from "./OverviewTab.js";
import { RolesTab } from "./RolesTab.js";
import { MembersTab } from "./MembersTab.js";
import { BansTab } from "./BansTab.js";
import { InvitesTab } from "./InvitesTab.js";
import { AuditLogTab } from "./AuditLogTab.js";
import { DeleteGuildModal } from "./DeleteGuildModal.js";
import { API_BASE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { toast } from "../../stores/useToastStore.js";

interface ServerSettingsModalProps {
  isOpen: boolean;
  guild: Guild | null;
  onClose: () => void;
  onGuildUpdated?: (guild: Guild) => void;
  onGuildDeleted?: (guildId: string) => void;
}

type TabType =
  "overview" | "roles" | "members" | "invites" | "bans" | "audit-log";

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
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [roles, setRoles] = useState<Role[]>(guild?.roles || []);

  const isOwner = guild?.ownerId === currentUser?.id;

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
      throw new Error(err.error || "更新服务器信息失败");
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
      throw new Error(err.error || "解散服务器失败");
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
      throw new Error(err.error || "转让所有权失败");
    }
    const updated = await res.json();
    if (onGuildUpdated) {
      onGuildUpdated({ ...guild, ...updated });
    }
    toast.success("服务器所有权已成功转让！");
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
      throw new Error(err.error || "创建身份组失败");
    }
    const newRole = await res.json();
    setRoles((prev) => [...prev, newRole]);
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
      throw new Error(err.error || "更新身份组失败");
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
      throw new Error(err.error || "删除身份组失败");
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
      throw new Error(err.error || "更新成员信息失败");
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
      throw new Error(err.error || "踢出成员失败");
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
      throw new Error(err.error || "封禁成员失败");
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
      throw new Error(err.error || "解除封禁失败");
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
        className="relative flex w-full h-full sm:h-[88vh] sm:max-h-[850px] sm:max-w-4xl md:max-w-5xl bg-[#313338] text-white sm:rounded-2xl shadow-2xl overflow-hidden border border-transparent sm:border-[#3f4147] animate-in zoom-in-95 duration-150"
      >
        {/* 左侧：分类导航栏 */}
        <div className="w-60 bg-[#2b2d31] p-6 flex flex-col justify-between shrink-0 select-none border-r border-[#1f2023]">
          <div className="space-y-6">
            <div className="px-2">
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
                  onClick={() => setActiveTab("overview")}
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
                  onClick={() => setActiveTab("roles")}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === "roles"
                      ? "bg-white/10 text-white"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>{t("server:nav.roles")}</span>
                </button>
              </div>

              {/* 分组 2：用户管理 */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1">
                  {t("server:groups.userManagement")}
                </div>
                <button
                  onClick={() => setActiveTab("members")}
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
                  onClick={() => setActiveTab("invites")}
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
                  onClick={() => setActiveTab("bans")}
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
                  onClick={() => setActiveTab("audit-log")}
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
        <div className="flex-1 flex flex-col min-w-0 bg-[#313338] relative">
          {/* 右上角固定关闭按钮与 ESC 提示 */}
          <div className="absolute top-4 right-4 sm:top-6 sm:right-8 flex flex-col items-center z-40">
            <button
              data-testid="close-server-settings-btn"
              onClick={onClose}
              className="w-9 h-9 rounded-full border-2 border-white/20 hover:border-white flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              title={`${t("common:close")} (ESC)`}
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-[10px] font-bold text-gray-400 mt-1 select-none">
              ESC
            </span>
          </div>

          {/* 内容画布容器 */}
          <div className="flex-1 overflow-y-auto px-10 py-10 max-w-4xl">
            {activeTab === "overview" && (
              <OverviewTab guild={guild} onUpdateGuild={handleUpdateGuild} />
            )}

            {activeTab === "roles" && (
              <RolesTab
                guild={guild}
                roles={roles}
                onCreateRole={handleCreateRole}
                onUpdateRole={handleUpdateRole}
                onDeleteRole={handleDeleteRole}
              />
            )}

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
