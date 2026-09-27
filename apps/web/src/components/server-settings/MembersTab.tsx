import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Guild, GuildMember, Role, parseRoleIds } from "@tescord/types";
import {
  Search,
  Plus,
  Shield,
  Crown,
  MoreVertical,
  UserX,
  Ban,
  Edit2,
  Check,
  X,
} from "lucide-react";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { resolveServerUrl } from "../../config.js";
import { dialog } from "../../stores/useDialogStore.js";
import { toast } from "../../stores/useToastStore.js";
import { usePermissions } from "../../hooks/usePermissions.js";

interface MembersTabProps {
  guild: Guild;
  roles: Role[];
  onUpdateMember: (
    targetUserId: string,
    data: { roleIds?: string[]; nickname?: string | null },
  ) => Promise<void>;
  onKickMember: (targetUserId: string, reason?: string) => Promise<void>;
  onBanMember: (targetUserId: string, reason?: string) => Promise<void>;
  onTransferOwnership?: (newOwnerId: string) => Promise<void>;
}

export const MembersTab: React.FC<MembersTabProps> = ({
  guild,
  roles,
  onUpdateMember,
  onKickMember,
  onBanMember,
  onTransferOwnership,
}) => {
  const { t } = useTranslation(["server", "common", "errors"]);
  const { user: currentUser } = useAuthStore();
  const [search, setSearch] = useState("");
  const [activeRolePickerUserId, setActiveRolePickerUserId] = useState<
    string | null
  >(null);
  const [editingNicknameUserId, setEditingNicknameUserId] = useState<
    string | null
  >(null);
  const [tempNickname, setTempNickname] = useState("");

  const permissions = usePermissions(guild);
  const isOwner =
    permissions.isOwner ||
    guild.ownerId === currentUser?.id ||
    currentUser?.role === "SUPER_ADMIN" ||
    (currentUser as any)?.role === "ADMIN";

  // 计算当前用户最高角色权重
  const actorHighestPos = useMemo(() => {
    if (isOwner) return Infinity;
    const currentMember = guild.members?.find(
      (m) => m.userId === currentUser?.id,
    );
    if (!currentMember) return 0;
    const myRoleIds = parseRoleIds(currentMember.roleIds);
    const myRoles = roles.filter((r) => myRoleIds.includes(r.id));
    if (myRoles.length === 0) return 0;
    return Math.max(...myRoles.map((r) => r.position));
  }, [guild, currentUser, roles, isOwner]);

  // 计算某个目标成员的最高角色权重
  const getMemberHighestPos = (member: GuildMember) => {
    if (member.userId === guild.ownerId) return Infinity;
    const mRoleIds = parseRoleIds(member.roleIds);
    const mRoles = roles.filter((r) => mRoleIds.includes(r.id));
    if (mRoles.length === 0) return 0;
    return Math.max(...mRoles.map((r) => r.position));
  };

  const filteredMembers = useMemo(() => {
    const list = guild.members || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((m) => {
      const u = m.user;
      return (
        m.nickname?.toLowerCase().includes(q) ||
        u?.username.toLowerCase().includes(q)
      );
    });
  }, [guild.members, search]);

  const roleMap = useMemo(() => {
    return new Map(roles.map((r) => [r.id, r]));
  }, [roles]);

  const handleToggleMemberRole = async (
    member: GuildMember,
    roleId: string,
  ) => {
    const currentRoleIds = parseRoleIds(member.roleIds);
    const isAssigned = currentRoleIds.includes(roleId);
    const newRoleIds = isAssigned
      ? currentRoleIds.filter((id) => id !== roleId)
      : [...currentRoleIds, roleId];

    try {
      await onUpdateMember(member.userId, { roleIds: newRoleIds });
      setActiveRolePickerUserId(null); // 单选即关
    } catch (err: any) {
      toast.error(
        err?.message ||
          t("server:members.roleUpdateFailed", {
            defaultValue: "分配角色失败",
          }),
      );
    }
  };

  const handleSaveNickname = async (userId: string) => {
    try {
      await onUpdateMember(userId, { nickname: tempNickname.trim() || null });
      setEditingNicknameUserId(null);
    } catch (err: any) {
      toast.error(
        err?.message ||
          t("server:members.nicknameUpdateFailed", {
            defaultValue: "更新昵称失败",
          }),
      );
    }
  };

  const handleKick = async (member: GuildMember) => {
    const name =
      member.nickname ||
      member.user?.username ||
      t("server:members.defaultMemberName", { defaultValue: "该成员" });
    const reason = await dialog.prompt({
      title: t("server:members.kickConfirmTitle"),
      description: t("server:members.kickConfirmDesc", { name }),
      placeholder: t("server:members.searchPlaceholder"),
      confirmText: t("server:members.kick"),
    });
    if (reason !== null) {
      try {
        await onKickMember(member.userId, reason || undefined);
        toast.success(
          t("server:members.kickSuccess", {
            defaultValue: "已将成员 “{{name}}” 踢出服务器",
            name,
          }),
        );
      } catch (err: any) {
        toast.error(err?.message || t("errors:UNKNOWN_ERROR"));
      }
    }
  };

  const handleBan = async (member: GuildMember) => {
    const name =
      member.nickname ||
      member.user?.username ||
      t("server:members.defaultMemberName", { defaultValue: "该成员" });
    const reason = await dialog.prompt({
      title: t("server:members.banConfirmTitle"),
      description: t("server:members.banConfirmDesc", { name }),
      placeholder: t("server:bans.searchPlaceholder"),
      confirmText: t("server:members.ban"),
      required: false,
    });
    if (reason !== null) {
      try {
        await onBanMember(member.userId, reason || undefined);
        toast.success(
          t("server:members.banSuccess", {
            defaultValue: "已封禁成员 “{{name}}”",
            name,
          }),
        );
      } catch (err: any) {
        toast.error(err?.message || t("errors:UNKNOWN_ERROR"));
      }
    }
  };

  const handleTransfer = async (member: GuildMember) => {
    const name =
      member.nickname ||
      member.user?.username ||
      t("server:members.defaultMemberName", { defaultValue: "该成员" });
    const confirmed = await dialog.confirm({
      title: t("server:members.transferOwnership"),
      description: t("server:members.transferConfirmDesc", {
        defaultValue:
          "您确认将服务器的所有权转让给 “{{name}}” 吗？此操作无法撤销，转让后您将失去该服务器的最高所有者权限！",
        name,
      }),
      variant: "danger",
      requireSecurityCode: true,
      confirmText: t("common:confirm"),
    });
    if (!confirmed) return;

    if (onTransferOwnership) {
      try {
        await onTransferOwnership(member.userId);
        toast.success(
          t("server:members.transferSuccess", {
            defaultValue: "已成功将服务器所有权转让给 “{{name}}”",
            name,
          }),
        );
      } catch (err: any) {
        toast.error(err?.message || t("errors:UNKNOWN_ERROR"));
      }
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">
            {t("server:members.title")} ({guild.members?.length || 0})
          </h2>
          <p className="text-xs text-gray-400">
            {t("server:members.membersCount", {
              count: guild.members?.length || 0,
            })}
          </p>
        </div>

        {/* 搜索框 */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("server:members.searchPlaceholder")}
            className="w-full bg-[#1e1f22] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] transition-colors"
          />
        </div>
      </div>

      {/* 成员列表渲染 */}
      <div className="rounded-xl bg-[#2b2d31]/40 border border-white/5 divide-y divide-white/5 overflow-hidden">
        {filteredMembers.map((m) => {
          const u = m.user;
          const isMemberOwner = m.userId === guild.ownerId;
          const targetPos = getMemberHighestPos(m);
          // 能否处置该成员（必须是 Owner 或者自己最高权重严格大于对方）
          const canManageThisMember =
            m.userId !== currentUser?.id &&
            !isMemberOwner &&
            (isOwner || actorHighestPos > targetPos);

          const memberRoles = parseRoleIds(m.roleIds)
            .map((id) => roleMap.get(id))
            .filter(Boolean) as Role[];

          const isRolePickerOpen = activeRolePickerUserId === m.userId;
          const isEditingNick = editingNicknameUserId === m.userId;

          return (
            <div
              key={m.userId}
              className="p-4 grid grid-cols-1 sm:grid-cols-[minmax(180px,1.2fr)_minmax(180px,2fr)_auto] items-center gap-4 hover:bg-white/[0.02] transition-colors border-b border-white/5 last:border-b-0"
            >
              {/* 成员基础信息 */}
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={
                    resolveServerUrl(u?.avatarUrl) ||
                    "https://api.dicebear.com/7.x/bottts/svg?seed=" + m.userId
                  }
                  alt={u?.username || "user"}
                  className="w-10 h-10 rounded-full bg-[#1e1f22] object-cover ring-2 ring-white/10 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {isEditingNick ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={tempNickname}
                          onChange={(e) => setTempNickname(e.target.value)}
                          placeholder={t("server:members.nicknamePlaceholder", {
                            defaultValue: "输入服务器昵称",
                          })}
                          className="bg-[#1e1f22] border border-white/10 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-[#5865f2]"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveNickname(m.userId)}
                          className="p-1 rounded bg-[#248046] text-white hover:bg-[#1a6334]"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setEditingNicknameUserId(null)}
                          className="p-1 rounded bg-gray-600 text-white hover:bg-gray-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-sm font-bold text-white truncate">
                          {m.nickname ||
                            u?.username ||
                            t("server:members.unknownMember", {
                              defaultValue: "未知成员",
                            })}
                        </span>
                        {m.nickname && (
                          <span className="text-xs text-gray-400 truncate">
                            ({u?.username})
                          </span>
                        )}
                      </>
                    )}
                    {isMemberOwner && (
                      <span
                        title={t("server:members.ownerBadge")}
                        className="text-amber-400 p-0.5 rounded"
                      >
                        <Crown className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    {t("server:members.table.joined")}：
                    {new Date(m.joinedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* 身份组列表与分配（单行居中排列，Badge与Plus按钮中心对齐在一条线上） */}
              <div className="flex items-center flex-nowrap overflow-x-auto gap-1.5 py-1 min-w-0 no-scrollbar">
                {memberRoles.map((r) => (
                  <span
                    key={r.id}
                    className="h-6 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 rounded-full bg-[#1e1f22] border border-white/10 text-white shrink-0 shadow-sm"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: r.color || "#5865f2" }}
                    />
                    <span className="truncate max-w-[120px]">{r.name}</span>
                    {canManageThisMember &&
                      (isOwner || actorHighestPos > r.position) && (
                        <button
                          onClick={() => handleToggleMemberRole(m, r.id)}
                          className="text-gray-400 hover:text-rose-400 transition-colors ml-0.5 text-xs font-bold leading-none cursor-pointer"
                          title={t("common:remove", { defaultValue: "移除" })}
                        >
                          ×
                        </button>
                      )}
                  </span>
                ))}

                {/* 添加角色按钮与弹出浮层 */}
                {canManageThisMember && (
                  <div className="relative shrink-0">
                    <button
                      onClick={() =>
                        setActiveRolePickerUserId(
                          isRolePickerOpen ? null : m.userId,
                        )
                      }
                      className="h-6 w-6 inline-flex items-center justify-center rounded-full bg-[#1e1f22] hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/10 cursor-pointer shadow-sm"
                      title={t("server:members.editRoles")}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>

                    {isRolePickerOpen && (
                      <div className="absolute right-0 bottom-full mb-2 w-52 rounded-xl bg-[#1e1f22] border border-white/10 shadow-2xl p-2 z-30 space-y-1 animate-in fade-in duration-100 max-h-56 overflow-y-auto">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1 flex items-center justify-between">
                          <span>{t("server:roles.title")}</span>
                          <button
                            type="button"
                            onClick={() => setActiveRolePickerUserId(null)}
                            className="text-gray-400 hover:text-white cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {roles
                          .filter((r) => !r.isDefault && r.name !== "@everyone")
                          .map((r) => {
                            const isAssigned = parseRoleIds(m.roleIds).includes(
                              r.id,
                            );
                            const canAssignThisRole =
                              isOwner || actorHighestPos > r.position;

                            return (
                              <button
                                key={r.id}
                                disabled={!canAssignThisRole}
                                onClick={async () => {
                                  await handleToggleMemberRole(m, r.id);
                                }}
                                title={
                                  !canAssignThisRole
                                    ? t("server:roles.cannotAssignHigherRole", {
                                        defaultValue:
                                          "该身份组权重高于或等同于您拥有的最高身份组",
                                      })
                                    : undefined
                                }
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left ${
                                  !canAssignThisRole
                                    ? "opacity-40 cursor-not-allowed text-gray-500"
                                    : isAssigned
                                      ? "bg-[#5865f2]/20 text-[#5865f2] font-semibold cursor-pointer"
                                      : "text-gray-300 hover:bg-white/5 cursor-pointer"
                                }`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <span
                                    className="w-2 h-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor: r.color || "#5865f2",
                                    }}
                                  />
                                  <span className="truncate">{r.name}</span>
                                </div>
                                {isAssigned && (
                                  <Check className="w-3.5 h-3.5 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 操作按钮组 (固定右对齐) */}
              <div className="flex items-center justify-end gap-1 shrink-0">
                {/* 修改昵称按钮 */}
                {(canManageThisMember || m.userId === currentUser?.id) && (
                  <button
                    onClick={() => {
                      setEditingNicknameUserId(m.userId);
                      setTempNickname(m.nickname || "");
                    }}
                    title={t("server:members.editNickname")}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}

                {/* 踢出成员 */}
                {canManageThisMember && (
                  <button
                    onClick={() => handleKick(m)}
                    title={t("server:members.kick")}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                )}

                {/* 封禁成员 */}
                {canManageThisMember && (
                  <button
                    onClick={() => handleBan(m)}
                    title={t("server:members.ban")}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                )}

                {/* 所有者转让入口 */}
                {isOwner && !isMemberOwner && onTransferOwnership && (
                  <button
                    onClick={() => handleTransfer(m)}
                    title={t("server:members.transferOwnership")}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    <Crown className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredMembers.length === 0 && (
          <div className="p-8 text-center text-xs text-gray-500">
            {t("server:members.noMembersFound", {
              defaultValue: "未找到匹配的成员",
            })}
          </div>
        )}
      </div>

      {/* 浮层全局点击遮罩 (Backdrop) */}
      {activeRolePickerUserId && (
        <div
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setActiveRolePickerUserId(null)}
        />
      )}
    </div>
  );
};
