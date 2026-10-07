import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  AdminGuildItem,
  AdminOverviewStats,
  AdminUpdateUserDTO,
  AdminUpdateUserResult,
  AdminUserItem,
  GatewayEvents,
  GatewayOpCode,
  PaginatedResult,
  SystemBroadcastDTO,
  SystemRole,
  SystemSettingsDTO,
} from "@tescord/types";
import { prisma } from "../db.js";
import { gatewayManager } from "../gateway.js";

const pageValue = (value: number | undefined, fallback: number, max: number) =>
  Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), max)
    : fallback;

export class AdminService {
  async getOverviewStats(): Promise<AdminOverviewStats> {
    const [totalUsers, totalGuilds, totalMessages] = await prisma.$transaction([
      prisma.user.count(),
      prisma.guild.count(),
      prisma.message.count(),
    ]);
    return {
      totalUsers,
      onlineUsers: gatewayManager.getOnlineUserCount(),
      totalGuilds,
      totalMessages,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }

  async listUsers(query: {
    search?: string;
    role?: SystemRole;
    banned?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<AdminUserItem>> {
    const page = pageValue(query.page, 1, 100000);
    const pageSize = pageValue(query.pageSize, 50, 100);
    const search = query.search?.trim();
    const where: any = {
      ...(search
        ? {
            OR: [
              { username: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(typeof query.banned === "boolean" ? { isBanned: query.banned } : {}),
    };
    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { _count: { select: { memberships: true, messages: true } } },
      }),
    ]);
    return {
      items: users.map((user) => this.formatUser(user)),
      pageInfo: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async updateUser(
    actorId: string,
    userId: string,
    dto: AdminUpdateUserDTO,
  ): Promise<AdminUpdateUserResult> {
    if (
      actorId === userId &&
      (dto.isBanned === true || (dto.role && dto.role !== "SUPER_ADMIN"))
    ) {
      throw new Error("不能封禁自己或移除自己的超级管理员身份");
    }
    const temporaryPassword = dto.resetPassword
      ? crypto.randomBytes(18).toString("base64url")
      : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (!target) throw new Error("目标用户不存在");
      const removesActiveSuperAdmin =
        target.role === "SUPER_ADMIN" &&
        !target.isBanned &&
        (dto.isBanned === true || (dto.role && dto.role !== "SUPER_ADMIN"));
      if (removesActiveSuperAdmin) {
        const activeSuperAdmins = await tx.user.count({
          where: { role: "SUPER_ADMIN", isBanned: false },
        });
        if (activeSuperAdmins <= 1)
          throw new Error("必须保留至少一名未封禁的超级管理员");
      }

      const passwordHash = temporaryPassword
        ? await bcrypt.hash(temporaryPassword, 12)
        : undefined;
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(dto.role ? { role: dto.role } : {}),
          ...(typeof dto.isBanned === "boolean"
            ? { isBanned: dto.isBanned }
            : {}),
          ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
          sessionVersion: { increment: 1 },
        },
        include: { _count: { select: { memberships: true, messages: true } } },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.platformAuditLog.create({
        data: {
          actorId,
          action: "ADMIN_USER_UPDATE",
          targetType: "USER",
          targetId: userId,
          targetName: user.username,
          detailsJson: JSON.stringify({
            role: dto.role,
            isBanned: dto.isBanned,
            passwordReset: Boolean(dto.resetPassword),
          }),
        },
      });
      return user;
    });
    gatewayManager.disconnectUser(userId);
    return { user: this.formatUser(updated), temporaryPassword };
  }

  async listGuilds(query: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<AdminGuildItem>> {
    const page = pageValue(query.page, 1, 100000);
    const pageSize = pageValue(query.pageSize, 50, 100);
    const where = query.search?.trim()
      ? { name: { contains: query.search.trim() } }
      : {};
    const [total, guilds] = await prisma.$transaction([
      prisma.guild.count({ where }),
      prisma.guild.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          owner: { select: { id: true, username: true } },
          _count: { select: { members: true, channels: true } },
        },
      }),
    ]);
    return {
      items: guilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
        description: guild.description,
        ownerId: guild.ownerId,
        ownerName: guild.owner.username,
        memberCount: guild._count.members,
        channelCount: guild._count.channels,
        createdAt: guild.createdAt.toISOString(),
      })),
      pageInfo: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async forceDeleteGuild(
    actorId: string,
    guildId: string,
    nameConfirmation: string,
  ): Promise<string[]> {
    const memberIds = await prisma.$transaction(async (tx) => {
      const guild = await tx.guild.findUnique({
        where: { id: guildId },
        include: { members: { select: { userId: true } } },
      });
      if (!guild) throw new Error("服务器不存在");
      if (guild.name !== nameConfirmation)
        throw new Error("服务器名称确认不匹配");
      await tx.platformAuditLog.create({
        data: {
          actorId,
          action: "ADMIN_GUILD_DELETE",
          targetType: "GUILD",
          targetId: guild.id,
          targetName: guild.name,
          detailsJson: JSON.stringify({
            affectedMemberCount: guild.members.length,
          }),
        },
      });
      await tx.guild.delete({ where: { id: guildId } });
      return guild.members.map((member) => member.userId);
    });
    for (const userId of memberIds) {
      gatewayManager.sendToUser(userId, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.GUILD_DELETE,
        d: { guildId, unavailable: false },
      });
    }
    return memberIds;
  }

  async broadcastMessage(
    actorId: string,
    dto: Omit<SystemBroadcastDTO, "id" | "createdAt" | "senderName"> & {
      senderName: string;
    },
  ): Promise<SystemBroadcastDTO> {
    const payload: SystemBroadcastDTO = {
      id: `bcast_${crypto.randomUUID()}`,
      title: dto.title.slice(0, 120),
      content: dto.content.slice(0, 2000),
      severity: dto.severity,
      senderName: dto.senderName,
      createdAt: new Date().toISOString(),
    };
    await prisma.platformAuditLog.create({
      data: {
        actorId,
        action: "SYSTEM_BROADCAST",
        targetType: "SYSTEM",
        detailsJson: JSON.stringify({
          severity: payload.severity,
          title: payload.title,
        }),
      },
    });
    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.SYSTEM_BROADCAST,
      d: payload,
    });
    return payload;
  }

  async getSettings(): Promise<SystemSettingsDTO> {
    const settings = await prisma.systemSetting.findMany();
    const map = new Map(
      settings.map((setting) => [setting.key, setting.value]),
    );
    return {
      allowRegistration: map.get("allow_registration") !== "false",
      requireInviteCode: map.get("require_invite_code") === "true",
      maintenanceMode: map.get("maintenance_mode") === "true",
      systemAnnouncement: map.get("system_announcement") || "",
      allowNonSuperAdminCreateGuild:
        map.get("allow_non_super_admin_create_guild") !== "false",
    };
  }

  async updateSettings(
    actorId: string,
    dto: Partial<SystemSettingsDTO>,
  ): Promise<SystemSettingsDTO> {
    const previous = await this.getSettings();
    await prisma.$transaction(async (tx) => {
      const entries: Array<[string, string | boolean | undefined]> = [
        ["allow_registration", dto.allowRegistration],
        ["require_invite_code", dto.requireInviteCode],
        ["maintenance_mode", dto.maintenanceMode],
        ["system_announcement", dto.systemAnnouncement?.slice(0, 2000)],
        [
          "allow_non_super_admin_create_guild",
          dto.allowNonSuperAdminCreateGuild,
        ],
      ];
      for (const [key, value] of entries) {
        if (value === undefined) continue;
        await tx.systemSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        });
      }
      await tx.platformAuditLog.create({
        data: {
          actorId,
          action: "SYSTEM_SETTINGS_UPDATE",
          targetType: "SYSTEM",
          detailsJson: JSON.stringify(dto),
        },
      });
    });
    const next = await this.getSettings();
    await gatewayManager.setMaintenanceMode(
      Boolean(next.maintenanceMode),
      next.systemAnnouncement || "",
    );
    return next;
  }

  private formatUser(user: any): AdminUserItem {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      status: user.status,
      customStatus: user.customStatus,
      bio: user.bio,
      role: (user.role as SystemRole) || "USER",
      isBanned: user.isBanned,
      mustChangePassword: user.mustChangePassword,
      guildCount: user._count.memberships,
      messageCount: user._count.messages,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}

export const adminService = new AdminService();
