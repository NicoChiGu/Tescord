import { Prisma } from "@prisma/client";
import {
  Channel,
  GatewayEvents,
  GatewayOpCode,
  Message,
  PaginatedResult,
  User,
  UserPresence,
} from "@tescord/types";
import { prisma } from "../db.js";
import { gatewayManager } from "../gateway.js";
import { cacheStore } from "../cache.js";

const clampPage = (value: number, fallback: number, max: number) =>
  Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;

export class DMService {
  private dmKey(userAId: string, userBId: string): string {
    return [userAId, userBId].sort().join(":");
  }

  async hasSharedGuild(userAId: string, userBId: string): Promise<boolean> {
    return Boolean(
      await prisma.guildMember.findFirst({
        where: {
          userId: userAId,
          guild: { members: { some: { userId: userBId } } },
        },
        select: { id: true },
      }),
    );
  }

  async getOrCreateDMChannel(
    callerId: string,
    recipientIdOrName: string,
  ): Promise<Channel> {
    const [caller, recipient] = await Promise.all([
      prisma.user.findUnique({ where: { id: callerId } }),
      prisma.user.findFirst({
        where: {
          OR: [
            { id: recipientIdOrName.trim() },
            { username: recipientIdOrName.trim() },
          ],
        },
      }),
    ]);
    if (!caller || caller.isBanned) throw new Error("当前账号不可用");
    if (!recipient || recipient.isBanned) throw new Error("目标用户不存在或不可用");
    if (caller.id === recipient.id) throw new Error("无法与自己建立私信会话");

    const dmKey = this.dmKey(caller.id, recipient.id);
    const include = {
      recipients: { include: { user: true } },
      messages: {
        take: 1,
        orderBy: [{ sequence: "desc" as const }, { id: "desc" as const }],
        include: { author: true },
      },
    };
    let channel = await prisma.channel.findUnique({ where: { dmKey }, include });

    if (!channel) {
      const allowed =
        caller.role === "SUPER_ADMIN" ||
        (await this.hasSharedGuild(caller.id, recipient.id));
      if (!allowed) throw new Error("仅允许同一服务器成员之间首次建立私信");
      try {
        channel = await prisma.channel.create({
          data: {
            name: "direct-message",
            type: "DM",
            dmKey,
            guildId: null,
            isE2EE: false,
            recipients: {
              create: [{ userId: caller.id }, { userId: recipient.id }],
            },
          },
          include,
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        channel = await prisma.channel.findUnique({ where: { dmKey }, include });
      }
    }
    if (!channel) throw new Error("私信会话创建失败");

    await prisma.channelRecipient.updateMany({
      where: { channelId: channel.id, userId: caller.id },
      data: { isClosed: false },
    });
    const fresh = await prisma.channel.findUniqueOrThrow({
      where: { id: channel.id },
      include,
    });
    const [callerPresence, recipientPresence] = await Promise.all([
      cacheStore.getUserPresence(caller.id),
      cacheStore.getUserPresence(recipient.id),
    ]);
    const dmPresences = new Map<string, UserPresence>();
    if (callerPresence) dmPresences.set(caller.id, callerPresence);
    if (recipientPresence) dmPresences.set(recipient.id, recipientPresence);

    const formatted = this.formatDMChannel(fresh, caller.id, 0, dmPresences);
    gatewayManager.sendToUser(caller.id, {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.DM_CHANNEL_CREATE,
      d: formatted,
    });
    return formatted;
  }

  async getDMChannels(
    userId: string,
    page = 1,
    pageSize = 50,
  ): Promise<PaginatedResult<Channel>> {
    page = clampPage(page, 1, 100000);
    pageSize = clampPage(pageSize, 50, 100);
    const where = { userId, isClosed: false, channel: { type: "DM" } };
    const [total, rows] = await prisma.$transaction([
      prisma.channelRecipient.count({ where }),
      prisma.channelRecipient.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: {
            include: {
              recipients: { include: { user: true } },
              messages: {
                take: 1,
                orderBy: [{ sequence: "desc" }, { id: "desc" }],
                include: { author: true },
              },
            },
          },
        },
        orderBy: [
          { channel: { updatedAt: "desc" } },
          { channelId: "desc" },
        ],
      }),
    ]);

    // 收集所有私信参与者的用户 ID 并批量水合实时在线状态
    const recipientUserIds = Array.from(
      new Set(
        rows.flatMap((row) =>
          (row.channel?.recipients || [])
            .map((r: any) => r.userId)
            .filter(Boolean),
        ),
      ),
    );
    const presences = await cacheStore.batchGetPresences(recipientUserIds);

    const items = await Promise.all(
      rows.map(async (row) => {
        const unreadCount = await prisma.message.count({
          where: {
            channelId: row.channelId,
            authorId: { not: userId },
            sequence: { gt: row.lastReadSequence },
          },
        });
        return this.formatDMChannel(row.channel, userId, unreadCount, presences);
      }),
    );
    return {
      items,
      pageInfo: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async closeDMChannel(userId: string, channelId: string): Promise<void> {
    const result = await prisma.channelRecipient.updateMany({
      where: { channelId, userId, channel: { type: "DM" } },
      data: { isClosed: true },
    });
    if (result.count !== 1) throw new Error("私信会话不存在或无权访问");
    gatewayManager.sendToUser(userId, {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.DM_CHANNEL_DELETE,
      d: { channelId },
    });
  }

  async markAsRead(
    userId: string,
    channelId: string,
    requestedSequence: number,
  ): Promise<number> {
    if (!Number.isSafeInteger(requestedSequence) || requestedSequence < 0) {
      throw new Error("无效的已读序号");
    }
    const channel = await prisma.channel.findFirst({
      where: { id: channelId, type: "DM", recipients: { some: { userId } } },
      select: { nextMessageSequence: true },
    });
    if (!channel) throw new Error("私信会话不存在或无权访问");
    const boundedSequence = Math.min(requestedSequence, channel.nextMessageSequence);
    const { lastReadSequence, unreadCount } = await prisma.$transaction(async (tx) => {
      await tx.channelRecipient.updateMany({
        where: { channelId, userId, lastReadSequence: { lt: boundedSequence } },
        data: { lastReadSequence: boundedSequence, lastReadAt: new Date() },
      });
      const recipient = await tx.channelRecipient.findUniqueOrThrow({
        where: { channelId_userId: { channelId, userId } },
        select: { lastReadSequence: true },
      });
      const unreadCount = await tx.message.count({
        where: {
          channelId,
          authorId: { not: userId },
          sequence: { gt: recipient.lastReadSequence },
        },
      });
      return { lastReadSequence: recipient.lastReadSequence, unreadCount };
    });
    gatewayManager.sendToUser(userId, {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.DM_CHANNEL_UPDATE,
      d: { channelId, unreadCount, lastReadSequence },
    });
    return lastReadSequence;
  }

  async isParticipant(userId: string, channelId: string): Promise<boolean> {
    return Boolean(
      await prisma.channelRecipient.findUnique({
        where: { channelId_userId: { channelId, userId } },
        select: { id: true },
      }),
    );
  }

  async getParticipantIds(channelId: string): Promise<string[]> {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { type: true, recipients: { select: { userId: true } } },
    });
    if (!channel || channel.type !== "DM" || channel.recipients.length !== 2) return [];
    return channel.recipients.map((item) => item.userId);
  }

  private publicUser(
    user: any,
    presence?: UserPresence | null,
    isSelf = false,
  ): User {
    const isOnline =
      presence &&
      presence.status !== "OFFLINE" &&
      presence.status !== "INVISIBLE";
    const effectiveStatus = isSelf
      ? presence?.status || user.status || "ONLINE"
      : isOnline
        ? presence.status
        : "OFFLINE";
    const canShowActivity = isOnline && user.showActivity !== false;

    return {
      id: user.id,
      username: user.username,
      email: "",
      avatarUrl: user.avatarUrl,
      status: effectiveStatus,
      customStatus:
        presence?.customStatus !== undefined
          ? presence.customStatus
          : user.customStatus,
      activities: canShowActivity ? presence?.activities : undefined,
      bio: user.bio,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt?.toISOString(),
    };
  }

  private formatDMChannel(
    channel: any,
    currentUserId: string,
    unreadCount = 0,
    presences?: Map<string, UserPresence>,
  ): Channel {
    const recipients = (channel.recipients || []).map((item: any) =>
      this.publicUser(
        item.user,
        presences?.get(item.user.id),
        item.user.id === currentUserId,
      ),
    );
    const other = recipients.find((item: User) => item.id !== currentUserId);
    const rawMessage = channel.messages?.[0];
    const lastMessage: Message | undefined = rawMessage
      ? {
          id: rawMessage.id,
          channelId: rawMessage.channelId,
          authorId: rawMessage.authorId,
          author: {
            id: rawMessage.author.id,
            username: rawMessage.author.username,
            avatarUrl: rawMessage.author.avatarUrl,
          },
          content: rawMessage.content,
          isEncrypted: rawMessage.isEncrypted,
          sequence: rawMessage.sequence,
          createdAt: rawMessage.createdAt.toISOString(),
          updatedAt: rawMessage.updatedAt.toISOString(),
        }
      : undefined;
    return {
      id: channel.id,
      guildId: null,
      name: other?.username || "私信",
      type: "DM",
      topic: other?.customStatus || other?.bio || null,
      parentId: null,
      position: 0,
      isE2EE: false,
      recipients,
      lastMessage,
      unreadCount,
      createdAt: channel.createdAt.toISOString(),
    };
  }
}

export const dmService = new DMService();
