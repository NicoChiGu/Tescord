import { useMemo } from "react";
import { Guild, PermissionFlags, hasPermission, computePermissions } from "@tescord/types";
import { useAuthStore } from "../stores/useAuthStore.js";

export interface PermissionsResult {
  isOwner: boolean;
  canManageChannels: boolean;
  canManageGuild: boolean;
  canManageMessages: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  canCreateInvite: boolean;
  rawPermissions: number;
}

export function usePermissions(
  guild?: Guild | null,
  targetUserId?: string
): PermissionsResult {
  const { user: currentUser } = useAuthStore();
  const userId = targetUserId || currentUser?.id;

  return useMemo(() => {
    // 默认空权限
    const noPerms: PermissionsResult = {
      isOwner: false,
      canManageChannels: false,
      canManageGuild: false,
      canManageMessages: false,
      canKickMembers: false,
      canBanMembers: false,
      canCreateInvite: false,
      rawPermissions: 0,
    };

    if (!guild || !userId) return noPerms;

    // 1. 服务器所有者拥有所有最高特权
    const isOwner = guild.ownerId === userId;
    // 兼容初始超管账号
    const isSuperAdmin = currentUser?.id === userId && (currentUser?.username === "admin" || currentUser?.username === "Jackey");

    if (isOwner || isSuperAdmin) {
      return {
        isOwner: true,
        canManageChannels: true,
        canManageGuild: true,
        canManageMessages: true,
        canKickMembers: true,
        canBanMembers: true,
        canCreateInvite: true,
        rawPermissions: PermissionFlags.ADMINISTRATOR,
      };
    }

    // 2. 查找成员角色
    const member = guild.members?.find((m) => m.userId === userId);
    if (!member) return noPerms;

    const guildRoles = guild.roles || [];
    const memberRoles = guildRoles.filter((r) => member.roleIds?.includes(r.id));
    const userPerms = computePermissions(memberRoles);

    return {
      isOwner: false,
      canManageChannels: hasPermission(userPerms, PermissionFlags.MANAGE_CHANNELS),
      canManageGuild: hasPermission(userPerms, PermissionFlags.MANAGE_GUILD),
      canManageMessages: hasPermission(userPerms, PermissionFlags.MANAGE_MESSAGES),
      canKickMembers: hasPermission(userPerms, PermissionFlags.KICK_MEMBERS),
      canBanMembers: hasPermission(userPerms, PermissionFlags.BAN_MEMBERS),
      canCreateInvite: hasPermission(userPerms, PermissionFlags.CREATE_INVITE),
      rawPermissions: userPerms,
    };
  }, [guild, userId, currentUser]);
}
