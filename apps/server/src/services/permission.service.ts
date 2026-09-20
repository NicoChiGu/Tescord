import { prisma } from "../db.js";
import { PermissionFlags, hasPermission } from "@tescord/types";

export class PermissionService {
  /**
   * 校验用户在指定公会是否具有某个权限位
   */
  public async hasGuildPermission(
    userId: string,
    guildId: string,
    flag: PermissionFlags,
  ): Promise<boolean> {
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return false;

    // 服务器 Owner 自动豁免，拥有最高特权
    if (guild.ownerId === userId) return true;

    const member = await prisma.guildMember.findUnique({
      where: {
        guildId_userId: { guildId, userId },
      },
    });
    if (!member) return false;

    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(member.roleIds || "[]");
    } catch {
      roleIds = [];
    }

    if (roleIds.length === 0) {
      // 默认权限：查看、发言、连麦、说话
      const defaultPerms =
        PermissionFlags.VIEW_CHANNEL |
        PermissionFlags.SEND_MESSAGES |
        PermissionFlags.ADD_REACTIONS |
        PermissionFlags.CONNECT |
        PermissionFlags.SPEAK;
      return hasPermission(defaultPerms, flag);
    }

    const roles = await prisma.role.findMany({
      where: {
        id: { in: roleIds },
        guildId,
      },
    });

    const totalPermissions = roles.reduce((acc, r) => acc | r.permissions, 0);
    return hasPermission(totalPermissions, flag);
  }

  /**
   * 校验用户在频道所属的公会中是否拥有指定权限
   */
  public async hasChannelPermission(
    userId: string,
    channelId: string,
    flag: PermissionFlags,
  ): Promise<boolean> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) return false;
    return this.hasGuildPermission(userId, channel.guildId, flag);
  }
}

export const permissionService = new PermissionService();
