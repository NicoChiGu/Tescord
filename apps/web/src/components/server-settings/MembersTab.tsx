import React, { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
  const [rolePickerState, setRolePickerState] = useState<{
    memberId: string;
    anchorRect: DOMRect;
  } | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const rolePickerRef = useRef<HTMLDivElement>(null);
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

  // 监听次菜单外部点击与快捷键关闭
  useEffect(() => {
    if (!rolePickerState) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        rolePickerRef.current &&
        !rolePickerRef.current.contains(e.target as Node)
      ) {
        setRolePickerState(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRolePickerState(null);
      }
    };

    const handleScrollOrResize = () => {
      setRolePickerState(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [rolePickerState]);

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
      // 依 Discord 体验：连续多选不自动关闭，方便连续管理
    } catch (err: any) {
      toast.error(
        err?.message ||
          t("server:members.roleUpdateFailed", {
            defaultValue: "分配角色失败",
          }),
      );
    }
  };

  const handleOpenRolePicker = (
    e: React.MouseEvent<HTMLButtonElement>,
    memberId: string,
  ) => {
    e.stopPropagation();
    if (rolePickerState?.memberId === memberId) {
      setRolePickerState(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setRolePickerState({ memberId, anchorRect: rect });
      setRoleSearch("");
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

  const renderActionButtons = (
    m: GuildMember,
    canManageThisMember: boolean,
    isMemberOwner: boolean,
  ) => (
    <>
      {/* 修改昵称按钮 */}
      {(canManageThisMember || m.userId === currentUser?.id) && (
        <button
          type="button"
          onClick={() => {
            setEditingNicknameUserId(m.userId);
            setTempNickname(m.nickname || "");
          }}
          title={t("server:members.editNickname")}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          <Edit2 className="w-4 h-4" />
        </button>
      )}

      {/* 踢出成员 */}
      {canManageThisMember && (
        <button
          type="button"
          onClick={() => handleKick(m)}
          title={t("server:members.kick")}
          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
        >
          <UserX className="w-4 h-4" />
        </button>
      )}

      {/* 封禁成员 */}
      {canManageThisMember && (
        <button
          type="button"
          onClick={() => handleBan(m)}
          title={t("server:members.ban")}
          className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
        >
          <Ban className="w-4 h-4" />
        </button>
      )}

      {/* 所有者转让入口 */}
      {isOwner && !isMemberOwner && onTransferOwnership && (
        <button
          type="button"
          onClick={() => handleTransfer(m)}
          title={t("server:members.transferOwnership")}
          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
        >
          <Crown className="w-4 h-4" />
        </button>
      )}
    </>
  );

  const renderRolePickerPortal = () => {
    if (!rolePickerState) return null;
    const { memberId, anchorRect } = rolePickerState;
    const member = guild.members?.find((m) => m.userId === memberId);
    if (!member) return null;

    const currentRoleIds = parseRoleIds(member.roleIds);

    const pickerWidth = 240;
    const pickerHeight = 280;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const openUpward = spaceBelow < pickerHeight && spaceAbove > spaceBelow;

    const top = openUpward
      ? Math.max(8, anchorRect.top - pickerHeight - 6)
      : Math.min(window.innerHeight - pickerHeight - 8, anchorRect.bottom + 6);

    let left = anchorRect.left;
    if (left + pickerWidth > window.innerWidth - 12) {
      left = window.innerWidth - pickerWidth - 12;
    }
    if (left < 12) left = 12;

    const filteredRoles = roles
      .filter((r) => !r.isDefault && r.name !== "@everyone")
      .filter((r) =>
        roleSearch.trim()
          ? r.name.toLowerCase().includes(roleSearch.toLowerCase())
          : true,
      );

    return createPortal(
      <div
        ref={rolePickerRef}
        data-testid="role-picker-popover"
        style={{
          position: "fixed",
          top: `${top}px`,
          left: `${left}px`,
          width: `${pickerWidth}px`,
          zIndex: 99999,
        }}
        className="rounded-xl bg-[#1e1f22] border border-white/10 shadow-2xl p-2 animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[300px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-2 py-1 flex items-center justify-between">
          <span>{t("server:roles.title")}</span>
          <button
            type="button"
            onClick={() => setRolePickerState(null)}
            className="text-gray-400 hover:text-white cursor-pointer p-0.5 rounded"
            aria-label={t("common:close", { defaultValue: "关闭" })}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 角色即时搜索框 */}
        <div className="relative my-1 px-1">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            data-testid="role-picker-search-input"
            value={roleSearch}
            onChange={(e) => setRoleSearch(e.target.value)}
            placeholder={t("server:roles.searchRoles", {
              defaultValue: "搜索身份组...",
            })}
            autoFocus
            className="w-full bg-[#111214] border border-white/10 rounded-lg pl-8 pr-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#5865f2] transition-colors"
          />
        </div>

        {/* 角色列表 */}
        <div className="flex-1 overflow-y-auto space-y-0.5 custom-scrollbar pr-1 mt-1">
          {filteredRoles.length === 0 ? (
            <div className="py-4 text-center text-xs text-gray-500">
              {t("server:roles.noRolesFound", {
                defaultValue: "未找到匹配的身份组",
              })}
            </div>
          ) : (
            filteredRoles.map((r) => {
              const isAssigned = currentRoleIds.includes(r.id);
              const canAssignThisRole = isOwner || actorHighestPos > r.position;

              return (
                <button
                  key={r.id}
                  type="button"
                  data-testid={`role-option-${r.id}`}
                  disabled={!canAssignThisRole}
                  onClick={async () => {
                    await handleToggleMemberRole(member, r.id);
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
                        ? "bg-[#5865f2]/20 text-[#5865f2] font-semibold cursor-pointer hover:bg-[#5865f2]/30"
                        : "text-gray-300 hover:bg-white/5 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: r.color || "#5865f2",
                      }}
                    />
                    <span className="truncate">{r.name}</span>
                  </div>
                  {isAssigned && (
                    <Check className="w-3.5 h-3.5 shrink-0 text-[#5865f2]" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>,
      document.body,
    );
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

          const isEditingNick = editingNicknameUserId === m.userId;

          return (
            <div
              key={m.userId}
              data-testid={`member-row-${m.userId}`}
              className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 hover:bg-white/[0.02] transition-colors border-b border-white/5 last:border-b-0"
            >
              {/* 1. 成员基础信息列：sm:w-60 md:w-64 shrink-0 严格固定宽度，确保第2列角色列起始线 100% 绝对一致 */}
              <div className="w-full sm:w-60 md:w-64 shrink-0 flex items-center justify-between sm:justify-start gap-3 min-w-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <img
                    src={
                      resolveServerUrl(u?.avatarUrl) ||
                      "https://api.dicebear.com/7.x/bottts/svg?seed=" + m.userId
                    }
                    alt={u?.username || "user"}
                    className="w-10 h-10 rounded-full bg-[#1e1f22] object-cover ring-2 ring-white/10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
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
                            className="bg-[#1e1f22] border border-white/10 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-[#5865f2] w-28"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveNickname(m.userId)}
                            className="p-1 rounded bg-[#248046] text-white hover:bg-[#1a6334]"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingNicknameUserId(null)}
                            className="p-1 rounded bg-gray-600 text-white hover:bg-gray-700"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-bold text-white truncate max-w-[130px]">
                            {m.nickname ||
                              u?.username ||
                              t("server:members.unknownMember", {
                                defaultValue: "未知成员",
                              })}
                          </span>
                          {m.nickname && (
                            <span className="text-xs text-gray-400 truncate max-w-[80px]">
                              ({u?.username})
                            </span>
                          )}
                        </>
                      )}
                      {isMemberOwner && (
                        <span
                          title={t("server:members.ownerBadge")}
                          className="text-amber-400 p-0.5 rounded shrink-0"
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

                {/* 移动端操作按钮组（置于第1行右侧） */}
                <div className="flex sm:hidden items-center gap-1 shrink-0">
                  {renderActionButtons(m, canManageThisMember, isMemberOwner)}
                </div>
              </div>

              {/* 2. 身份组徽章列表与添加角色按钮：在桌面端左对齐且所有行起始位置严格在同一垂线上 */}
              <div className="flex-1 min-w-0 flex items-center flex-wrap sm:flex-nowrap gap-1.5 py-1 overflow-x-auto no-scrollbar">
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
                          type="button"
                          onClick={() => handleToggleMemberRole(m, r.id)}
                          className="text-gray-400 hover:text-rose-400 transition-colors ml-0.5 text-xs font-bold leading-none cursor-pointer"
                          title={t("common:remove", { defaultValue: "移除" })}
                        >
                          ×
                        </button>
                      )}
                  </span>
                ))}

                {/* 添加角色 + 按钮：与徽章尺寸高度 h-6 完全统一在一条线上 */}
                {canManageThisMember && (
                  <button
                    type="button"
                    data-testid={`add-role-btn-${m.userId}`}
                    onClick={(e) => handleOpenRolePicker(e, m.userId)}
                    className="h-6 w-6 inline-flex items-center justify-center rounded-full bg-[#1e1f22] hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/10 shrink-0 cursor-pointer shadow-sm"
                    title={t("server:members.editRoles")}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 3. 桌面端操作按钮组：右对齐 */}
              <div className="hidden sm:flex items-center justify-end gap-1 shrink-0 ml-auto">
                {renderActionButtons(m, canManageThisMember, isMemberOwner)}
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

      {/* 次菜单 Portal 顶层挂载 */}
      {renderRolePickerPortal()}
    </div>
  );
};
