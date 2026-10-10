import { prisma } from "../db.js";
import {
  ALL_PERMISSIONS,
  PermissionFlags,
  hasPermission,
  Role,
  computeEffectivePermissions,
  OverwriteTargetType,
  ErrorCode,
} from "@tescord/types";

export class PermissionService {
  public readonly allPermissionBits = ALL_PERMISSIONS.reduce(
    (bits, permission) => bits | permission.flag,
    0,
  );

  /**
   * 确保指定公会存在基础 @everyone 角色，若无则自动创建
   */
  public async ensureEveryoneRole(guildId: string): Promise<any> {
    let everyoneRole = await prisma.role.findFirst({
      where: {
        guildId,
        OR: [{ isDefault: true }, { name: "@everyone" }],
      },
    });

    if (!everyoneRole) {
      const defaultPerms =
        PermissionFlags.VIEW_CHANNEL |
        PermissionFlags.SEND_MESSAGES |
        PermissionFlags.ADD_REACTIONS |
        PermissionFlags.ATTACH_FILES |
        PermissionFlags.READ_MESSAGE_HISTORY |
        PermissionFlags.CONNECT |
        PermissionFlags.SPEAK |
        PermissionFlags.STREAM |
        PermissionFlags.CHANGE_NICKNAME;

      everyoneRole = await prisma.role.create({
        data: {
          guildId,
          name: "@everyone",
          color: null,
          hoist: false,
          position: 0,
          permissions: defaultPerms,
          isDefault: true,
        },
      });
    } else if (!everyoneRole.isDefault) {
      everyoneRole = await prisma.role.update({
        where: { id: everyoneRole.id },
        data: { isDefault: true },
      });
    }

    return everyoneRole;
  }

  /**
   * 校验用户在指定公会是否具有某个权限位
   */
  public async hasGuildPermission(
    userId: string,
    guildId: string,
    flag: PermissionFlags,
  ): Promise<boolean> {
    const totalPermissions = await this.getGuildPermissionBits(userId, guildId);
    return totalPermissions !== null && hasPermission(totalPermissions, flag);
  }

  /** Returns the actor's effective guild permission mask, or null if they are not a member. */
  public async getGuildPermissionBits(
    userId: string,
    guildId: string,
  ): Promise<number | null> {
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return null;

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (guild.ownerId === userId || actor?.role === "SUPER_ADMIN") {
      return this.allPermissionBits;
    }

    const member = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    if (!member) return null;

    const everyoneRole = await this.ensureEveryoneRole(guildId);
    let totalPermissions = everyoneRole.permissions;
    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(member.roleIds || "[]");
    } catch {
      roleIds = [];
    }

    if (roleIds.length > 0) {
      const roles = await prisma.role.findMany({
        where: { id: { in: roleIds }, guildId },
      });
      totalPermissions = roles.reduce(
        (permissions, role) => permissions | role.permissions,
        totalPermissions,
      );
    }
    return totalPermissions;
  }

  /**
   * 获取成员在公会中的最高角色权重 (position)
   * Owner 拥有无穷大权重 Infinity
   * 无独立角色的普通成员为 0 (等同于 @everyone)
   */
  public async getMemberHighestRolePosition(
    userId: string,
    guildId: string,
  ): Promise<number> {
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return -1;
    if (guild.ownerId === userId) return Infinity;

    const member = await prisma.guildMember.findUnique({
      where: {
        guildId_userId: { guildId, userId },
      },
    });
    if (!member) return -1;

    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(member.roleIds || "[]");
    } catch {
      roleIds = [];
    }

    if (roleIds.length === 0) return 0;

    const roles = await prisma.role.findMany({
      where: {
        id: { in: roleIds },
        guildId,
      },
      select: { position: true },
    });

    if (roles.length === 0) return 0;
    return Math.max(...roles.map((r) => r.position));
  }

  /**
   * 校验操作者是否能够管理目标角色 (防越权)
   * 规则：
   * 1. Owner 可以管理任意角色；
   * 2. 操作者自身必须拥有 MANAGE_ROLES 权限；
   * 3. 目标角色的 position 必须严格小于操作者的最高角色 position (除非是编辑 @everyone 角色权限位)；
   * 4. @everyone 角色不可被删除，不可修改其 position。
   */
  public async canManageRole(
    actorUserId: string,
    guildId: string,
    targetRole: { id?: string; position: number; isDefault?: boolean },
  ): Promise<boolean> {
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return false;
    const actorUser = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (guild.ownerId === actorUserId || actorUser?.role === "SUPER_ADMIN")
      return true;

    const hasManageRoles = await this.hasGuildPermission(
      actorUserId,
      guildId,
      PermissionFlags.MANAGE_ROLES,
    );
    if (!hasManageRoles) return false;

    const actorHighestPos = await this.getMemberHighestRolePosition(
      actorUserId,
      guildId,
    );

    // 操作者最高权重大于目标角色权重
    return actorHighestPos > targetRole.position;
  }

  /**
   * 校验操作者是否能够处置目标成员 (修改角色/修改昵称/踢出/封禁等)
   * 规则：
   * 1. 禁止处置自身 (如封禁自己)；
   * 2. Owner 拥有最高处置权；
   * 3. 任何人都不可处置 Owner；
   * 4. 操作者的最高角色 position 必须严格大于目标成员的最高角色 position。
   */
  public async canManageMember(
    actorUserId: string,
    targetUserId: string,
    guildId: string,
  ): Promise<boolean> {
    if (actorUserId === targetUserId) return false;

    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return false;

    // 任何人无法处置 Owner
    if (guild.ownerId === targetUserId) return false;
    // Owner 可以处置任何非 Owner
    if (guild.ownerId === actorUserId) return true;

    const actorHighestPos = await this.getMemberHighestRolePosition(
      actorUserId,
      guildId,
    );
    const targetHighestPos = await this.getMemberHighestRolePosition(
      targetUserId,
      guildId,
    );

    return actorHighestPos > targetHighestPos;
  }

  /**
   * 计算用户在频道内的有效权限位掩码
   */
  public async getChannelPermissionBits(
    userId: string,
    channelId: string,
  ): Promise<number | null> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        recipients: true,
        overwrites: true,
        parent: {
          include: {
            overwrites: true,
          },
        },
      },
    });
    if (!channel) return null;

    if (!channel.guildId) {
      const isRecipient = channel.recipients.some((r) => r.userId === userId);
      if (!isRecipient) return null;
      return (
        PermissionFlags.VIEW_CHANNEL |
        PermissionFlags.SEND_MESSAGES |
        PermissionFlags.ATTACH_FILES |
        PermissionFlags.READ_MESSAGE_HISTORY |
        PermissionFlags.ADD_REACTIONS |
        PermissionFlags.CONNECT |
        PermissionFlags.SPEAK |
        PermissionFlags.STREAM
      );
    }

    const guildId = channel.guildId;
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return null;

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (guild.ownerId === userId || actor?.role === "SUPER_ADMIN") {
      return this.allPermissionBits;
    }

    const member = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    if (!member) return null;

    await this.ensureEveryoneRole(guildId);
    const guildRoles = await prisma.role.findMany({
      where: { guildId },
    });

    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(member.roleIds || "[]");
    } catch {
      roleIds = [];
    }

    return computeEffectivePermissions({
      userId,
      isOwner: guild.ownerId === userId,
      isSuperAdmin: actor?.role === "SUPER_ADMIN",
      userRoleIds: roleIds,
      guildRoles: guildRoles.map((r) => ({
        id: r.id,
        guildId: r.guildId,
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        position: r.position,
        permissions: r.permissions,
        isDefault: r.isDefault,
        createdAt: r.createdAt.toISOString(),
      })),
      channelOverwrites: (channel.overwrites || []).map((o) => ({
        id: o.id,
        guildId: o.guildId,
        channelId: o.channelId,
        categoryId: o.categoryId,
        targetType: o.targetType as OverwriteTargetType,
        targetId: o.targetId,
        allow: o.allow,
        deny: o.deny,
      })),
      categoryOverwrites: (channel.parent?.overwrites || []).map((o) => ({
        id: o.id,
        guildId: o.guildId,
        channelId: o.channelId,
        categoryId: o.categoryId,
        targetType: o.targetType as OverwriteTargetType,
        targetId: o.targetId,
        allow: o.allow,
        deny: o.deny,
      })),
    });
  }

  /**
   * 校验用户在频道内是否拥有指定权限
   */
  public async hasChannelPermission(
    userId: string,
    channelId: string,
    flag: PermissionFlags,
  ): Promise<boolean> {
    const bits = await this.getChannelPermissionBits(userId, channelId);
    return bits !== null && hasPermission(bits, flag);
  }

  /**
   * 计算用户在分类内的有效权限位掩码
   */
  public async getCategoryPermissionBits(
    userId: string,
    categoryId: string,
  ): Promise<number | null> {
    const category = await prisma.channelCategory.findUnique({
      where: { id: categoryId },
      include: {
        overwrites: true,
      },
    });
    if (!category) return null;

    const guildId = category.guildId;
    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return null;

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (guild.ownerId === userId || actor?.role === "SUPER_ADMIN") {
      return this.allPermissionBits;
    }

    const member = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    if (!member) return null;

    await this.ensureEveryoneRole(guildId);
    const guildRoles = await prisma.role.findMany({
      where: { guildId },
    });

    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(member.roleIds || "[]");
    } catch {
      roleIds = [];
    }

    return computeEffectivePermissions({
      userId,
      isOwner: guild.ownerId === userId,
      isSuperAdmin: actor?.role === "SUPER_ADMIN",
      userRoleIds: roleIds,
      guildRoles: guildRoles.map((r) => ({
        id: r.id,
        guildId: r.guildId,
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        position: r.position,
        permissions: r.permissions,
        isDefault: r.isDefault,
        createdAt: r.createdAt.toISOString(),
      })),
      categoryOverwrites: (category.overwrites || []).map((o) => ({
        id: o.id,
        guildId: o.guildId,
        channelId: o.channelId,
        categoryId: o.categoryId,
        targetType: o.targetType as OverwriteTargetType,
        targetId: o.targetId,
        allow: o.allow,
        deny: o.deny,
      })),
    });
  }

  /**
   * 校验用户在分类内是否拥有指定权限
   */
  public async hasCategoryPermission(
    userId: string,
    categoryId: string,
    flag: PermissionFlags,
  ): Promise<boolean> {
    const bits = await this.getCategoryPermissionBits(userId, categoryId);
    return bits !== null && hasPermission(bits, flag);
  }

  /**
   * 校验操作者是否能够管理频道权限覆写 (防越权)
   */
  public async canManageChannelPermissions(
    actorUserId: string,
    channelId: string,
    targetType: OverwriteTargetType,
    targetId: string,
    allow: number,
    deny: number,
  ): Promise<{ ok: boolean; code?: ErrorCode; message?: string }> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel || !channel.guildId) {
      return {
        ok: false,
        code: ErrorCode.CHANNEL_NOT_FOUND,
        message: "频道不存在",
      };
    }
    const guildId = channel.guildId;

    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) {
      return {
        ok: false,
        code: ErrorCode.GUILD_NOT_FOUND,
        message: "服务器不存在",
      };
    }

    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });

    if (guild.ownerId === actorUserId || actor?.role === "SUPER_ADMIN") {
      return { ok: true };
    }

    const canManageRoles = await this.hasGuildPermission(
      actorUserId,
      guildId,
      PermissionFlags.MANAGE_ROLES,
    );
    const canManageChannels = await this.hasChannelPermission(
      actorUserId,
      channelId,
      PermissionFlags.MANAGE_CHANNELS,
    );
    if (!canManageRoles && !canManageChannels) {
      return {
        ok: false,
        code: ErrorCode.CHANNEL_PERMISSION_DENIED,
        message: "缺少管理频道或角色权限",
      };
    }

    const actorHighestPos = await this.getMemberHighestRolePosition(
      actorUserId,
      guildId,
    );
    const actorEffectiveBits =
      (await this.getChannelPermissionBits(actorUserId, channelId)) || 0;

    const extraBits = (allow | deny) & ~actorEffectiveBits;
    if (extraBits !== 0) {
      return {
        ok: false,
        code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
        message: "无法授予自身未持有的权限位",
      };
    }

    if (targetType === "ROLE") {
      const targetRole = await prisma.role.findUnique({
        where: { id: targetId },
      });
      if (!targetRole || targetRole.guildId !== guildId) {
        return {
          ok: false,
          code: ErrorCode.GUILD_ROLE_NOT_FOUND,
          message: "目标身份组不存在",
        };
      }
      if (!targetRole.isDefault && targetRole.position >= actorHighestPos) {
        return {
          ok: false,
          code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
          message: "无法管理层级高于或等于自身的身份组覆写",
        };
      }
    } else {
      if (targetId === guild.ownerId) {
        return {
          ok: false,
          code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
          message: "无法覆盖服务器所有者的权限",
        };
      }
      const targetPos = await this.getMemberHighestRolePosition(
        targetId,
        guildId,
      );
      if (targetPos >= actorHighestPos) {
        return {
          ok: false,
          code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
          message: "无法管理层级高于或等于自身的成员覆写",
        };
      }
    }

    return { ok: true };
  }

  /**
   * 校验操作者是否能够管理分类权限覆写 (防越权)
   */
  public async canManageCategoryPermissions(
    actorUserId: string,
    categoryId: string,
    targetType: OverwriteTargetType,
    targetId: string,
    allow: number,
    deny: number,
  ): Promise<{ ok: boolean; code?: ErrorCode; message?: string }> {
    const category = await prisma.channelCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return {
        ok: false,
        code: ErrorCode.CATEGORY_NOT_FOUND,
        message: "分类不存在",
      };
    }
    const guildId = category.guildId;

    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) {
      return {
        ok: false,
        code: ErrorCode.GUILD_NOT_FOUND,
        message: "服务器不存在",
      };
    }

    const actor = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });

    if (guild.ownerId === actorUserId || actor?.role === "SUPER_ADMIN") {
      return { ok: true };
    }

    const canManageRoles = await this.hasGuildPermission(
      actorUserId,
      guildId,
      PermissionFlags.MANAGE_ROLES,
    );
    const canManageChannels = await this.hasGuildPermission(
      actorUserId,
      guildId,
      PermissionFlags.MANAGE_CHANNELS,
    );
    if (!canManageRoles && !canManageChannels) {
      return {
        ok: false,
        code: ErrorCode.CHANNEL_PERMISSION_DENIED,
        message: "缺少管理频道或角色权限",
      };
    }

    const actorHighestPos = await this.getMemberHighestRolePosition(
      actorUserId,
      guildId,
    );
    const actorEffectiveBits =
      (await this.getCategoryPermissionBits(actorUserId, categoryId)) || 0;

    const extraBits = (allow | deny) & ~actorEffectiveBits;
    if (extraBits !== 0) {
      return {
        ok: false,
        code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
        message: "无法授予自身未持有的权限位",
      };
    }

    if (targetType === "ROLE") {
      const targetRole = await prisma.role.findUnique({
        where: { id: targetId },
      });
      if (!targetRole || targetRole.guildId !== guildId) {
        return {
          ok: false,
          code: ErrorCode.GUILD_ROLE_NOT_FOUND,
          message: "目标身份组不存在",
        };
      }
      if (!targetRole.isDefault && targetRole.position >= actorHighestPos) {
        return {
          ok: false,
          code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
          message: "无法管理层级高于或等于自身的身份组覆写",
        };
      }
    } else {
      if (targetId === guild.ownerId) {
        return {
          ok: false,
          code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
          message: "无法覆盖服务器所有者的权限",
        };
      }
      const targetPos = await this.getMemberHighestRolePosition(
        targetId,
        guildId,
      );
      if (targetPos >= actorHighestPos) {
        return {
          ok: false,
          code: ErrorCode.CHANNEL_HIERARCHY_VIOLATION,
          message: "无法管理层级高于或等于自身的成员覆写",
        };
      }
    }

    return { ok: true };
  }
}

export const permissionService = new PermissionService();
