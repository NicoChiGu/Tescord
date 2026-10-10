import { FastifyInstance } from "fastify";
import { GatewayOpCode, Relationship, RelationshipType } from "@tescord/types";
import { prisma } from "../db.js";
import { cacheStore } from "../cache.js";
import { gatewayManager } from "../gateway.js";
import { AuthService } from "./auth.service.js";

export class RelationshipService {
  private fastify: FastifyInstance;
  private authService: AuthService;

  constructor(fastify: FastifyInstance, authService: AuthService) {
    this.fastify = fastify;
    this.authService = authService;
  }

  /**
   * 获取当前用户的所有关系（好友、待处理申请、屏蔽）
   */
  public async getRelationships(userId: string): Promise<Relationship[]> {
    const list = await prisma.relationship.findMany({
      where: { userId },
      include: {
        targetUser: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(
      list.map(async (r) => {
        const formattedUser = this.authService.formatUser(r.targetUser);
        const presence = await cacheStore.getUserPresence(r.targetUserId);
        if (presence?.status) {
          formattedUser.status = presence.status;
          formattedUser.customStatus = presence.customStatus || null;
          if (presence.activities && formattedUser.showActivity !== false) {
            formattedUser.activities = presence.activities;
          }
        }

        return {
          id: r.id,
          userId: r.userId,
          targetUserId: r.targetUserId,
          type: r.type as RelationshipType,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          targetUser: formattedUser,
        };
      }),
    );
  }

  /**
   * 通过完整唯一识别码（如 Nick#12312）发送好友申请
   * 包含：
   * 1. 严格格式校验（前缀#5位数字）
   * 2. 前缀大小写不敏感匹配
   * 3. 边界拦截（不能加自己、已是好友、已在待处理）
   * 4. 双方互发申请时自动直接结为好友
   * 5. WebSocket 网关实时单播通知双方
   */
  public async sendFriendRequest(
    userId: string,
    rawIdentifier: string,
  ): Promise<Relationship> {
    const identifier = rawIdentifier.trim();
    const match = identifier.match(/^(.+)#([0-9]{5})$/);
    if (!match) {
      throw new Error("请输入完整的用户标识，例如 用户名#12345");
    }

    const prefix = match[1].trim();
    const discriminator = match[2];

    if (!prefix) {
      throw new Error("请输入完整的用户标识，例如 用户名#12345");
    }

    // 寻找匹配目标用户（优先按 discriminator 缩小范围，再不区分大小写精确比对前缀）
    const candidates = await prisma.user.findMany({
      where: { discriminator },
    });

    const target = candidates.find((u) => {
      const uPrefix = u.username.split("#")[0];
      return uPrefix.toLowerCase() === prefix.toLowerCase();
    });

    if (!target) {
      throw new Error(
        "找不到符合该识别码的用户，请检查拼写并确保包含 #5位数字",
      );
    }

    if (target.id === userId) {
      throw new Error("你不能添加自己为好友哦");
    }

    if (target.isBanned) {
      throw new Error("该用户目前不可用");
    }

    // 检查现有关系
    const existing = await prisma.relationship.findUnique({
      where: {
        userId_targetUserId: {
          userId,
          targetUserId: target.id,
        },
      },
    });

    if (existing?.type === "FRIEND") {
      throw new Error("你们已经是好友了");
    }
    if (existing?.type === "PENDING_OUTGOING") {
      throw new Error("好友申请已在待处理中，请耐心等待对方同意");
    }
    if (existing?.type === "BLOCKED") {
      throw new Error("无法向该用户发送好友申请");
    }

    // 检查对方是否已经向我发送过申请（互发申请自动直接结为好友）
    const reverse = await prisma.relationship.findUnique({
      where: {
        userId_targetUserId: {
          userId: target.id,
          targetUserId: userId,
        },
      },
    });

    const currentUserRecord = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (reverse?.type === "PENDING_OUTGOING") {
      // 双方互发，直接结为好友
      await prisma.$transaction([
        prisma.relationship.upsert({
          where: { userId_targetUserId: { userId, targetUserId: target.id } },
          create: { userId, targetUserId: target.id, type: "FRIEND" },
          update: { type: "FRIEND" },
        }),
        prisma.relationship.upsert({
          where: {
            userId_targetUserId: { userId: target.id, targetUserId: userId },
          },
          create: { userId: target.id, targetUserId: userId, type: "FRIEND" },
          update: { type: "FRIEND" },
        }),
      ]);

      const myRel = await prisma.relationship.findUnique({
        where: { userId_targetUserId: { userId, targetUserId: target.id } },
        include: { targetUser: true },
      });
      const targetRel = await prisma.relationship.findUnique({
        where: {
          userId_targetUserId: { userId: target.id, targetUserId: userId },
        },
        include: { targetUser: true },
      });

      const formattedMyRel = {
        id: myRel!.id,
        userId: myRel!.userId,
        targetUserId: myRel!.targetUserId,
        type: "FRIEND" as RelationshipType,
        createdAt: myRel!.createdAt.toISOString(),
        updatedAt: myRel!.updatedAt.toISOString(),
        targetUser: this.authService.formatUser(myRel!.targetUser),
      };

      const formattedTargetRel = {
        id: targetRel!.id,
        userId: targetRel!.userId,
        targetUserId: targetRel!.targetUserId,
        type: "FRIEND" as RelationshipType,
        createdAt: targetRel!.createdAt.toISOString(),
        updatedAt: targetRel!.updatedAt.toISOString(),
        targetUser: this.authService.formatUser(targetRel!.targetUser),
      };

      // 网关单播推送双方
      gatewayManager.sendToUser(userId, {
        op: GatewayOpCode.DISPATCH,
        t: "RELATIONSHIP_UPDATE",
        d: formattedMyRel,
      });
      gatewayManager.sendToUser(target.id, {
        op: GatewayOpCode.DISPATCH,
        t: "RELATIONSHIP_UPDATE",
        d: formattedTargetRel,
      });

      return formattedMyRel;
    }

    // 正常发起单向申请
    await prisma.$transaction([
      prisma.relationship.upsert({
        where: { userId_targetUserId: { userId, targetUserId: target.id } },
        create: { userId, targetUserId: target.id, type: "PENDING_OUTGOING" },
        update: { type: "PENDING_OUTGOING" },
      }),
      prisma.relationship.upsert({
        where: {
          userId_targetUserId: { userId: target.id, targetUserId: userId },
        },
        create: {
          userId: target.id,
          targetUserId: userId,
          type: "PENDING_INCOMING",
        },
        update: { type: "PENDING_INCOMING" },
      }),
    ]);

    const myRel = await prisma.relationship.findUnique({
      where: { userId_targetUserId: { userId, targetUserId: target.id } },
      include: { targetUser: true },
    });
    const targetRel = await prisma.relationship.findUnique({
      where: {
        userId_targetUserId: { userId: target.id, targetUserId: userId },
      },
      include: { targetUser: true },
    });

    const formattedMyRel = {
      id: myRel!.id,
      userId: myRel!.userId,
      targetUserId: myRel!.targetUserId,
      type: "PENDING_OUTGOING" as RelationshipType,
      createdAt: myRel!.createdAt.toISOString(),
      updatedAt: myRel!.updatedAt.toISOString(),
      targetUser: this.authService.formatUser(myRel!.targetUser),
    };

    const formattedTargetRel = {
      id: targetRel!.id,
      userId: targetRel!.userId,
      targetUserId: targetRel!.targetUserId,
      type: "PENDING_INCOMING" as RelationshipType,
      createdAt: targetRel!.createdAt.toISOString(),
      updatedAt: targetRel!.updatedAt.toISOString(),
      targetUser: this.authService.formatUser(targetRel!.targetUser),
    };

    // 网关单播
    gatewayManager.sendToUser(userId, {
      op: GatewayOpCode.DISPATCH,
      t: "RELATIONSHIP_ADD",
      d: formattedMyRel,
    });
    gatewayManager.sendToUser(target.id, {
      op: GatewayOpCode.DISPATCH,
      t: "RELATIONSHIP_ADD",
      d: formattedTargetRel,
    });

    return formattedMyRel;
  }

  /**
   * 接受好友申请
   */
  public async acceptFriendRequest(
    userId: string,
    targetUserId: string,
  ): Promise<Relationship> {
    const existing = await prisma.relationship.findUnique({
      where: {
        userId_targetUserId: { userId, targetUserId },
      },
    });

    if (!existing || existing.type !== "PENDING_INCOMING") {
      throw new Error("未找到待接受的好友申请");
    }

    await prisma.$transaction([
      prisma.relationship.update({
        where: { userId_targetUserId: { userId, targetUserId } },
        data: { type: "FRIEND" },
      }),
      prisma.relationship.update({
        where: {
          userId_targetUserId: { userId: targetUserId, targetUserId: userId },
        },
        data: { type: "FRIEND" },
      }),
    ]);

    const myRel = await prisma.relationship.findUnique({
      where: { userId_targetUserId: { userId, targetUserId } },
      include: { targetUser: true },
    });
    const targetRel = await prisma.relationship.findUnique({
      where: {
        userId_targetUserId: { userId: targetUserId, targetUserId: userId },
      },
      include: { targetUser: true },
    });

    const formattedMyRel = {
      id: myRel!.id,
      userId: myRel!.userId,
      targetUserId: myRel!.targetUserId,
      type: "FRIEND" as RelationshipType,
      createdAt: myRel!.createdAt.toISOString(),
      updatedAt: myRel!.updatedAt.toISOString(),
      targetUser: this.authService.formatUser(myRel!.targetUser),
    };

    const formattedTargetRel = {
      id: targetRel!.id,
      userId: targetRel!.userId,
      targetUserId: targetRel!.targetUserId,
      type: "FRIEND" as RelationshipType,
      createdAt: targetRel!.createdAt.toISOString(),
      updatedAt: targetRel!.updatedAt.toISOString(),
      targetUser: this.authService.formatUser(targetRel!.targetUser),
    };

    gatewayManager.sendToUser(userId, {
      op: GatewayOpCode.DISPATCH,
      t: "RELATIONSHIP_UPDATE",
      d: formattedMyRel,
    });
    gatewayManager.sendToUser(targetUserId, {
      op: GatewayOpCode.DISPATCH,
      t: "RELATIONSHIP_UPDATE",
      d: formattedTargetRel,
    });

    return formattedMyRel;
  }

  /**
   * 解除好友关系、拒绝申请或取消申请
   */
  public async removeRelationship(
    userId: string,
    targetUserId: string,
  ): Promise<{ success: boolean }> {
    const existing = await prisma.relationship.findUnique({
      where: {
        userId_targetUserId: { userId, targetUserId },
      },
    });

    if (!existing) {
      return { success: true };
    }

    await prisma.$transaction([
      prisma.relationship.deleteMany({
        where: {
          OR: [
            { userId, targetUserId },
            { userId: targetUserId, targetUserId: userId },
          ],
        },
      }),
    ]);

    // 网关单播通知双方关系移除
    gatewayManager.sendToUser(userId, {
      op: GatewayOpCode.DISPATCH,
      t: "RELATIONSHIP_REMOVE",
      d: { userId, targetUserId },
    });
    gatewayManager.sendToUser(targetUserId, {
      op: GatewayOpCode.DISPATCH,
      t: "RELATIONSHIP_REMOVE",
      d: { userId: targetUserId, targetUserId: userId },
    });

    return { success: true };
  }
}
