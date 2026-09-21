import { prisma } from "../db.js";
import { AuditLogAction, AuditLogEntry } from "@tescord/types";

export class AuditLogService {
  /**
   * 记录一条服务器审计日志
   */
  public async logAction(params: {
    guildId: string;
    userId: string;
    action: AuditLogAction | string;
    targetId?: string | null;
    targetName?: string | null;
    changes?: Record<string, { old?: any; new?: any }> | null;
    reason?: string | null;
  }): Promise<AuditLogEntry> {
    const changesJson = params.changes ? JSON.stringify(params.changes) : null;

    const log = await prisma.auditLog.create({
      data: {
        guildId: params.guildId,
        userId: params.userId,
        action: params.action,
        targetId: params.targetId || null,
        targetName: params.targetName || null,
        changesJson,
        reason: params.reason || null,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return {
      id: log.id,
      guildId: log.guildId,
      userId: log.userId,
      user: log.user
        ? {
            id: log.user.id,
            username: log.user.username,
            avatarUrl: log.user.avatarUrl,
            email: "",
            status: "ONLINE",
            createdAt: "",
          }
        : undefined,
      action: log.action,
      targetId: log.targetId,
      targetName: log.targetName,
      changesJson: log.changesJson,
      changes: params.changes || undefined,
      reason: log.reason,
      createdAt: log.createdAt.toISOString(),
    };
  }

  /**
   * 分页查询公会审计日志
   */
  public async getGuildAuditLogs(
    guildId: string,
    options?: { limit?: number; before?: string; action?: string },
  ): Promise<AuditLogEntry[]> {
    const limit = options?.limit || 50;
    const where: any = { guildId };

    if (options?.action) {
      where.action = options.action;
    }

    if (options?.before) {
      where.createdAt = {
        lt: new Date(options.before),
      };
    }

    const logs = await prisma.auditLog.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return logs.map((log) => {
      let changes: Record<string, { old?: any; new?: any }> | undefined =
        undefined;
      if (log.changesJson) {
        try {
          changes = JSON.parse(log.changesJson);
        } catch {
          changes = undefined;
        }
      }

      return {
        id: log.id,
        guildId: log.guildId,
        userId: log.userId,
        user: log.user
          ? {
              id: log.user.id,
              username: log.user.username,
              avatarUrl: log.user.avatarUrl,
              email: "",
              status: "ONLINE",
              createdAt: "",
            }
          : undefined,
        action: log.action,
        targetId: log.targetId,
        targetName: log.targetName,
        changesJson: log.changesJson,
        changes,
        reason: log.reason,
        createdAt: log.createdAt.toISOString(),
      };
    });
  }
}

export const auditLogService = new AuditLogService();
