import { useMemo } from "react";
import {
  Guild,
  PermissionFlags,
  hasPermission,
  computePermissions,
  parseRoleIds,
} from "@tescord/types";
import { useAuthStore } from "../stores/useAuthStore.js";

export interface PermissionsResult {
  isOwner: boolean;
  canManageChannels: boolean;
  canManageGuild: boolean;
  canManageRoles: boolean;
  canManageMessages: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  canCreateInvite: boolean;
  canViewAuditLog: boolean;
  canManageNicknames: boolean;
  canChangeNickname: boolean;
  rawPermissions: number;
}

export function usePermissions(
  guild?: Guild | null,
  targetUserId?: string,
): PermissionsResult {
  const { user: currentUser } = useAuthStore();
  const userId = targetUserId || currentUser?.id;

  return useMemo(() => {
    // 默认空权限
    const noPerms: PermissionsResult = {
      isOwner: false,
      canManageChannels: false,
      canManageGuild: false,
      canManageRoles: false,
      canManageMessages: false,
      canKickMembers: false,
      canBanMembers: false,
      canCreateInvite: false,
      canViewAuditLog: false,
      canManageNicknames: false,
      canChangeNickname: false,
      rawPermissions: 0,
    };

    if (!guild || !userId) return noPerms;

    // 1. 服务器所有者拥有所有最高特权
    const isOwner = guild.ownerId === userId;
    // 兼容初始超管账号
    const isSuperAdmin =
      currentUser?.id === userId &&
      (currentUser?.username === "admin" || currentUser?.username === "Jackey");

    if (isOwner || isSuperAdmin) {
      return {
        isOwner: true,
        canManageChannels: true,
        canManageGuild: true,
        canManageRoles: true,
        canManageMessages: true,
        canKickMembers: true,
        canBanMembers: true,
        canCreateInvite: true,
        canViewAuditLog: true,
        canManageNicknames: true,
        canChangeNickname: true,
        rawPermissions: 0x7fffffff,
      };
    }

    // 2. 查找成员角色与基础 @everyone 角色
    const member = guild.members?.find((m) => m.userId === userId);
    if (!member) return noPerms;

    const guildRoles = guild.roles || [];
    const everyoneRole = guildRoles.find(
      (r) => r.isDefault || r.name === "@everyone",
    );
    const memberRoleIds = parseRoleIds(member.roleIds);
    const memberRoles = guildRoles.filter((r) => memberRoleIds.includes(r.id));

    let userPerms = everyoneRole ? everyoneRole.permissions : 0;
    userPerms = computePermissions(memberRoles) | userPerms;

    return {
      isOwner: false,
      canManageChannels: hasPermission(
        userPerms,
        PermissionFlags.MANAGE_CHANNELS,
      ),
      canManageGuild: hasPermission(userPerms, PermissionFlags.MANAGE_GUILD),
      canManageRoles: hasPermission(userPerms, PermissionFlags.MANAGE_ROLES),
      canManageMessages: hasPermission(
        userPerms,
        PermissionFlags.MANAGE_MESSAGES,
      ),
      canKickMembers: hasPermission(userPerms, PermissionFlags.KICK_MEMBERS),
      canBanMembers: hasPermission(userPerms, PermissionFlags.BAN_MEMBERS),
      canCreateInvite: hasPermission(userPerms, PermissionFlags.CREATE_INVITE),
      canViewAuditLog: hasPermission(userPerms, PermissionFlags.VIEW_AUDIT_LOG),
      canManageNicknames: hasPermission(
        userPerms,
        PermissionFlags.MANAGE_NICKNAMES,
      ),
      canChangeNickname: hasPermission(
        userPerms,
        PermissionFlags.CHANGE_NICKNAME,
      ),
      rawPermissions: userPerms,
    };
  }, [guild, userId, currentUser]);
}
