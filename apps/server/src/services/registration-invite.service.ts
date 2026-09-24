import crypto from "node:crypto";
import { prisma } from "../db.js";
import type {
  RegistrationInviteDTO,
  CreateRegistrationInviteDTO,
  RegistrationInviteListResponse,
} from "@tescord/types";

export class RegistrationInviteService {
  /**
   * 生成唯一高熵邀请码或验证自定义邀请码
   */
  private async generateUniqueCode(customCode?: string): Promise<string> {
    if (customCode && customCode.trim()) {
      const code = customCode.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{4,32}$/.test(code)) {
        throw new Error(
          "自定义邀请码格式不合规（限 4-32 位大写字母、数字、下划线或连字符）",
        );
      }
      const existing = await prisma.registrationInvite.findUnique({
        where: { code },
      });
      if (existing) {
        throw new Error("该邀请码已存在，请换一个");
      }
      return code;
    }

    // 自动生成形如 ABCD-EF12-34GH 的易读格式
    for (let i = 0; i < 10; i++) {
      const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
      const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      const existing = await prisma.registrationInvite.findUnique({
        where: { code },
      });
      if (!existing) {
        return code;
      }
    }
    // 降级使用 UUID
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  }

  /**
   * 创建新的全站注册邀请码
   */
  public async createInvite(
    dto: CreateRegistrationInviteDTO,
    adminId: string,
  ): Promise<RegistrationInviteDTO> {
    const code = await this.generateUniqueCode(dto.customCode);
    const maxUses =
      typeof dto.maxUses === "number" && dto.maxUses >= 0
        ? Math.floor(dto.maxUses)
        : 1;

    let expiresAt: Date | null = null;
    if (dto.expiresInDays && dto.expiresInDays > 0) {
      expiresAt = new Date(
        Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000,
      );
    }

    const invite = await prisma.$transaction(async (tx) => {
      const created = await tx.registrationInvite.create({
        data: {
          code,
          note: dto.note?.trim() || null,
          createdById: adminId,
          maxUses,
          uses: 0,
          isRevoked: false,
          expiresAt,
        },
        include: {
          createdBy: {
            select: { username: true },
          },
        },
      });

      await tx.platformAuditLog.create({
        data: {
          actorId: adminId,
          action: "REGISTRATION_INVITE_CREATE",
          targetType: "REGISTRATION_INVITE",
          targetId: code,
          targetName: dto.note || code,
          detailsJson: JSON.stringify({
            code,
            note: dto.note,
            maxUses,
            expiresAt,
          }),
        },
      });

      return created;
    });

    return {
      code: invite.code,
      note: invite.note,
      createdById: invite.createdById,
      createdByName: invite.createdBy?.username,
      maxUses: invite.maxUses,
      uses: invite.uses,
      isRevoked: invite.isRevoked,
      expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
      createdAt: invite.createdAt.toISOString(),
      updatedAt: invite.updatedAt.toISOString(),
      registeredUserCount: 0,
    };
  }

  /**
   * 分页获取注册邀请码列表
   */
  public async listInvites(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: "all" | "active" | "expired" | "exhausted" | "revoked";
  }): Promise<RegistrationInviteListResponse> {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const now = new Date();
    const where: any = {};

    if (options.search && options.search.trim()) {
      const q = options.search.trim();
      where.OR = [{ code: { contains: q } }, { note: { contains: q } }];
    }

    if (options.status) {
      if (options.status === "revoked") {
        where.isRevoked = true;
      } else if (options.status === "active") {
        where.isRevoked = false;
        where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
        // maxUses === 0 或 uses < maxUses
      } else if (options.status === "expired") {
        where.isRevoked = false;
        where.expiresAt = { lte: now };
      }
    }

    const [total, rawInvites] = await Promise.all([
      prisma.registrationInvite.count({ where }),
      prisma.registrationInvite.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: { select: { username: true } },
          _count: { select: { registeredUsers: true } },
        },
      }),
    ]);

    const invites: RegistrationInviteDTO[] = rawInvites.map((inv) => ({
      code: inv.code,
      note: inv.note,
      createdById: inv.createdById,
      createdByName: inv.createdBy?.username,
      maxUses: inv.maxUses,
      uses: inv.uses,
      isRevoked: inv.isRevoked,
      expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
      createdAt: inv.createdAt.toISOString(),
      updatedAt: inv.updatedAt.toISOString(),
      registeredUserCount: inv._count?.registeredUsers || inv.uses,
    }));

    return {
      invites,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 变更邀请码作废/激活状态
   */
  public async setRevoked(
    code: string,
    isRevoked: boolean,
    adminId: string,
  ): Promise<RegistrationInviteDTO> {
    const existing = await prisma.registrationInvite.findUnique({
      where: { code },
      include: { createdBy: { select: { username: true } } },
    });
    if (!existing) {
      throw new Error("未找到指定的邀请码");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.registrationInvite.update({
        where: { code },
        data: { isRevoked },
        include: { createdBy: { select: { username: true } } },
      });

      await tx.platformAuditLog.create({
        data: {
          actorId: adminId,
          action: isRevoked
            ? "REGISTRATION_INVITE_REVOKE"
            : "REGISTRATION_INVITE_RESTORE",
          targetType: "REGISTRATION_INVITE",
          targetId: code,
          detailsJson: JSON.stringify({ isRevoked }),
        },
      });

      return res;
    });

    return {
      code: updated.code,
      note: updated.note,
      createdById: updated.createdById,
      createdByName: updated.createdBy?.username,
      maxUses: updated.maxUses,
      uses: updated.uses,
      isRevoked: updated.isRevoked,
      expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * 删除邀请码
   */
  public async deleteInvite(
    code: string,
    adminId: string,
  ): Promise<{ success: boolean }> {
    const existing = await prisma.registrationInvite.findUnique({
      where: { code },
    });
    if (!existing) {
      throw new Error("未找到指定的邀请码");
    }

    await prisma.$transaction(async (tx) => {
      await tx.registrationInvite.delete({
        where: { code },
      });

      await tx.platformAuditLog.create({
        data: {
          actorId: adminId,
          action: "REGISTRATION_INVITE_DELETE",
          targetType: "REGISTRATION_INVITE",
          targetId: code,
          detailsJson: JSON.stringify({ deletedCode: code }),
        },
      });
    });

    return { success: true };
  }

  /**
   * 校验邀请码有效性（不消耗）
   */
  public async validateInvite(code: string, tx: any = prisma): Promise<any> {
    const normalizedCode = code.trim().toUpperCase();
    const invite = await tx.registrationInvite.findUnique({
      where: { code: normalizedCode },
    });

    if (!invite) {
      throw new Error("邀请码无效或不存在");
    }

    if (invite.isRevoked) {
      throw new Error("该邀请码已被管理员作废");
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new Error("该邀请码已过期");
    }

    if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
      throw new Error("该邀请码使用次数已达上限");
    }

    return invite;
  }
}

export const registrationInviteService = new RegistrationInviteService();
