import fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { config } from "dotenv";
import { prisma, seedInitialData } from "./db.js";
import { AuthService } from "./services/auth.service.js";
import { gatewayManager } from "./gateway.js";
import { generateLiveKitToken } from "./livekit.js";
import { storageService } from "./services/storage.service.js";
import { permissionService } from "./services/permission.service.js";
import { e2eeService } from "./services/e2ee.service.js";
import {
  GatewayOpCode,
  GatewayEvents,
  LoginDTO,
  Message,
  RegisterDTO,
  UpdateProfileDTO,
  CreateGuildDTO,
  CreateChannelDTO,
  CreateInviteDTO,
  JoinInviteDTO,
  PresignedUploadRequest,
  PermissionFlags,
  buildSecurityHeaders,
  RegisterPreKeyDTO,
  E2eeKeyExchangePayload,
} from "@tescord/types";

config();

const server = fastify({
  logger: process.env.NODE_ENV === "development",
});

// 0. 注册基础链路安全与加固响应头 (HSTS, CSP, X-Content-Type-Options, etc.)
const securityHeaders = buildSecurityHeaders();
server.addHook("onSend", async (request, reply) => {
  for (const [headerKey, headerVal] of Object.entries(securityHeaders)) {
    reply.header(headerKey, headerVal);
  }
});

// 1. 注册跨域插件
await server.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

// 2. 注册静态资源插件 (支持本地直传文件的 HTTP 访问)
await server.register(fastifyStatic, {
  root: storageService.getUploadsDir(),
  prefix: "/uploads/",
  decorateReply: false,
});

// 3. 注册二进制上传 Content-Type 解析器 (用于本地直传附件)
const binaryTypes = [
  "application/octet-stream",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/plain",
];
for (const type of binaryTypes) {
  server.addContentTypeParser(
    type,
    { parseAs: "buffer" },
    (req, body, done) => {
      done(null, body);
    },
  );
}

// 4. 注册 JWT 鉴权插件
const jwtSecret =
  process.env.JWT_SECRET || "tescord_fallback_jwt_secret_dev_2026";
await server.register(fastifyJwt, {
  secret: jwtSecret,
});

// 5. 注册 WebSocket 插件
await server.register(websocket);

// 6. 注册鉴权服务
const authService = new AuthService(server);

// 辅助函数：从请求提取用户 ID
async function getUserIdFromRequest(
  request: FastifyRequest,
): Promise<string | null> {
  try {
    const decoded: any = await request.jwtVerify();
    return decoded?.sub || null;
  } catch {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const decoded: any = server.jwt.decode(
          authHeader.replace("Bearer ", ""),
        );
        if (decoded?.sub) return decoded.sub;
      } catch {}
    }
    const body: any = request.body;
    if (body?.userId) return body.userId;
    if (body?.authorId) return body.authorId;
    return null;
  }
}

// 7. 鉴权守卫中间件
server.decorate(
  "authenticate",
  async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: "认证失效或未提供有效令牌" });
    }
  },
);

// 健康检查
server.get("/health", async () => {
  return {
    status: "ok",
    service: "tescord-server",
    timestamp: new Date().toISOString(),
  };
});

// ==========================================
// 1. 用户与鉴权 API (Auth Routes)
// ==========================================

// 注册
server.post("/api/auth/register", async (request, reply) => {
  try {
    const body = request.body as RegisterDTO;
    if (!body?.email || !body?.password || !body?.username) {
      return reply.status(400).send({ error: "请完整填写用户名、邮箱和密码" });
    }
    const result = await authService.register(body);
    return {
      ...result,
      token: result.accessToken, // 兼容前端现有 token 字段
    };
  } catch (err: any) {
    return reply.status(400).send({ error: err.message || "注册失败" });
  }
});

// 登录 (支持用户名或邮箱)
server.post("/api/auth/login", async (request, reply) => {
  try {
    const body = request.body as any;
    const emailOrUsername = body.emailOrUsername || body.email;
    if (!emailOrUsername || !body.password) {
      return reply.status(400).send({ error: "请提供账号与密码" });
    }
    const result = await authService.login({
      emailOrUsername,
      password: body.password,
    });
    return {
      ...result,
      token: result.accessToken, // 兼容字段
    };
  } catch (err: any) {
    return reply.status(401).send({ error: err.message || "账号或密码错误" });
  }
});

// 双令牌无感刷新
server.post("/api/auth/refresh", async (request, reply) => {
  try {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) {
      return reply.status(400).send({ error: "未提供 refreshToken" });
    }
    const result = await authService.refresh(refreshToken);
    return {
      ...result,
      token: result.accessToken,
    };
  } catch (err: any) {
    return reply
      .status(401)
      .send({ error: err.message || "刷新令牌无效或已过期" });
  }
});

// 获取当前登录用户自身信息
server.get(
  "/api/auth/me",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ error: "用户不存在" });
    }
    return authService.formatUser(user);
  },
);

// 修改个人资料 (个性签名、在线状态、头像等)
server.patch(
  "/api/users/@me",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    try {
      const body = request.body as UpdateProfileDTO;
      const updated = await authService.updateProfile(userId, body);

      // 通过网关广播状态更新事件
      gatewayManager.broadcast({
        op: GatewayOpCode.DISPATCH,
        t: "USER_UPDATE",
        d: updated,
      });

      return updated;
    } catch (err: any) {
      return reply
        .status(400)
        .send({ error: err.message || "更新个人资料失败" });
    }
  },
);

// ==========================================
// 2. 公会与频道 API (Guilds & Channels)
// ==========================================

server.get("/api/guilds", async () => {
  const guilds = await prisma.guild.findMany({
    include: {
      channels: {
        orderBy: { position: "asc" },
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              avatarUrl: true,
              status: true,
              customStatus: true,
              createdAt: true,
            },
          },
        },
      },
      roles: {
        orderBy: { position: "asc" },
      },
    },
  });

  return guilds.map((g) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconUrl,
    ownerId: g.ownerId,
    createdAt: g.createdAt.toISOString(),
    channels: g.channels.map((c) => ({
      id: c.id,
      guildId: c.guildId,
      name: c.name,
      type: c.type as any,
      topic: c.topic,
      parentId: c.parentId,
      position: c.position,
      isE2EE: c.isE2EE,
      bitrate: c.bitrate,
      createdAt: c.createdAt.toISOString(),
    })),
    members: g.members.map((m) => ({
      userId: m.userId,
      guildId: m.guildId,
      nickname: m.nickname,
      roleIds: JSON.parse(m.roleIds || "[]"),
      joinedAt: m.joinedAt.toISOString(),
      user: m.user
        ? {
            ...m.user,
            createdAt: m.user.createdAt.toISOString(),
          }
        : undefined,
    })),
    roles: g.roles.map((r) => ({
      id: r.id,
      guildId: r.guildId,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions,
      createdAt: r.createdAt.toISOString(),
    })),
  }));
});

server.get("/api/guilds/:guildId/channels", async (request) => {
  const { guildId } = request.params as any;
  const channels = await prisma.channel.findMany({
    where: { guildId },
    orderBy: { position: "asc" },
  });
  return channels.map((c) => ({
    id: c.id,
    guildId: c.guildId,
    name: c.name,
    type: c.type,
    topic: c.topic,
    parentId: c.parentId,
    position: c.position,
    isE2EE: c.isE2EE,
    bitrate: c.bitrate,
    createdAt: c.createdAt.toISOString(),
  }));
});

// 创建公会 (Server)
server.post("/api/guilds", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  let owner = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!owner) {
    owner = await prisma.user.findFirst();
  }
  if (!owner) {
    return reply.status(401).send({ error: "创建服务器需要有效用户身份" });
  }

  const { name, iconUrl } = (request.body || {}) as CreateGuildDTO;
  if (!name || !name.trim()) {
    return reply.status(400).send({ error: "服务器名称不能为空" });
  }

  const guild = await prisma.guild.create({
    data: {
      name: name.trim(),
      iconUrl: iconUrl || null,
      ownerId: owner.id,
      channels: {
        create: [
          {
            name: "常规",
            type: "TEXT",
            topic: "日常聊天交流",
            position: 0,
          },
          {
            name: "日常闲聊",
            type: "VOICE",
            position: 1,
          },
        ],
      },
      roles: {
        create: [
          {
            name: "Admin",
            color: "#5865F2",
            hoist: true,
            position: 0,
            permissions: 0x7fffffff,
          },
        ],
      },
    },
    include: {
      channels: true,
      roles: true,
    },
  });

  const adminRole = guild.roles[0];
  const member = await prisma.guildMember.create({
    data: {
      guildId: guild.id,
      userId: owner.id,
      roleIds: JSON.stringify([adminRole.id]),
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          avatarUrl: true,
          status: true,
          customStatus: true,
          createdAt: true,
        },
      },
    },
  });

  const formattedGuild = {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    ownerId: guild.ownerId,
    createdAt: guild.createdAt.toISOString(),
    channels: guild.channels.map((c) => ({
      id: c.id,
      guildId: c.guildId,
      name: c.name,
      type: c.type as any,
      topic: c.topic,
      parentId: c.parentId,
      position: c.position,
      isE2EE: c.isE2EE,
      bitrate: c.bitrate,
      createdAt: c.createdAt.toISOString(),
    })),
    members: [
      {
        userId: member.userId,
        guildId: member.guildId,
        nickname: member.nickname,
        roleIds: [adminRole.id],
        joinedAt: member.joinedAt.toISOString(),
        user: member.user
          ? { ...member.user, createdAt: member.user.createdAt.toISOString() }
          : undefined,
      },
    ],
    roles: guild.roles.map((r) => ({
      id: r.id,
      guildId: r.guildId,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      position: r.position,
      permissions: r.permissions,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_CREATE,
    d: formattedGuild,
  });

  return formattedGuild;
});

// 生成专属邀请码 (Invite)
server.post("/api/guilds/:guildId/invites", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录后操作" });
  }

  const canInvite = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.CREATE_INVITE,
  );
  if (!canInvite) {
    return reply
      .status(403)
      .send({ error: "您没有在该服务器创建邀请码的权限" });
  }

  const body = (request.body || {}) as CreateInviteDTO;
  const maxUses = body.maxUses || 0;
  const expiresInHours = body.expiresInHours || 0;
  const expiresAt =
    expiresInHours > 0
      ? new Date(Date.now() + expiresInHours * 3600 * 1000)
      : null;
  const code = randomBytes(4).toString("hex");

  const invite = await prisma.invite.create({
    data: {
      code,
      guildId,
      inviterId: user.id,
      maxUses,
      expiresAt,
    },
  });

  return {
    code: invite.code,
    guildId: invite.guildId,
    inviterId: invite.inviterId,
    maxUses: invite.maxUses,
    uses: invite.uses,
    expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    createdAt: invite.createdAt.toISOString(),
  };
});

// 通过邀请码加入公会
server.post("/api/invites/:code/join", async (request, reply) => {
  const { code } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录后加入公会" });
  }

  const invite = await prisma.invite.findUnique({
    where: { code },
  });

  if (!invite) {
    return reply.status(404).send({ error: "邀请码不存在或已失效" });
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return reply.status(400).send({ error: "邀请链接已过期" });
  }

  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return reply.status(400).send({ error: "邀请链接使用次数已达上限" });
  }

  let member = await prisma.guildMember.findUnique({
    where: {
      guildId_userId: { guildId: invite.guildId, userId: user.id },
    },
    include: { user: true },
  });

  if (!member) {
    await prisma.invite.update({
      where: { code },
      data: { uses: { increment: 1 } },
    });

    member = await prisma.guildMember.create({
      data: {
        guildId: invite.guildId,
        userId: user.id,
        roleIds: "[]",
      },
      include: { user: true },
    });

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_MEMBER_ADD,
      d: {
        guildId: invite.guildId,
        member: {
          userId: member.userId,
          guildId: member.guildId,
          nickname: member.nickname,
          roleIds: [],
          joinedAt: member.joinedAt.toISOString(),
          user: member.user
            ? {
                ...member.user,
                createdAt: member.user.createdAt.toISOString(),
              }
            : undefined,
        },
      },
    });
  }

  return {
    success: true,
    guildId: invite.guildId,
  };
});

// 创建频道 (Channel)
server.post("/api/guilds/:guildId/channels", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const canManage = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.MANAGE_CHANNELS,
  );
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "缺少管理频道权限 (MANAGE_CHANNELS)" });
  }

  const { name, type, topic, parentId, isE2EE } = (request.body ||
    {}) as CreateChannelDTO;
  if (!name || !name.trim()) {
    return reply.status(400).send({ error: "频道名称不能为空" });
  }

  const maxPosChannel = await prisma.channel.findFirst({
    where: { guildId },
    orderBy: { position: "desc" },
  });
  const position = maxPosChannel ? maxPosChannel.position + 1 : 0;

  const channel = await prisma.channel.create({
    data: {
      guildId,
      name: name.trim().toLowerCase().replace(/\s+/g, "-"),
      type: type || "TEXT",
      topic: topic || null,
      parentId: parentId || null,
      position,
      isE2EE: !!isE2EE,
    },
  });

  const channelPayload = {
    id: channel.id,
    guildId: channel.guildId,
    name: channel.name,
    type: channel.type as any,
    topic: channel.topic,
    parentId: channel.parentId,
    position: channel.position,
    isE2EE: channel.isE2EE,
    bitrate: channel.bitrate,
    createdAt: channel.createdAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CHANNEL_CREATE,
    d: channelPayload,
  });

  return channelPayload;
});

// 删除频道
server.delete("/api/channels/:channelId", async (request, reply) => {
  const { channelId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return reply.status(404).send({ error: "频道不存在" });
  }

  const canManage = await permissionService.hasGuildPermission(
    user.id,
    channel.guildId,
    PermissionFlags.MANAGE_CHANNELS,
  );
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "缺少管理频道权限 (MANAGE_CHANNELS)" });
  }

  await prisma.channel.delete({ where: { id: channelId } });

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CHANNEL_DELETE,
    d: { channelId, guildId: channel.guildId },
  });

  return { success: true, channelId };
});

// 编辑频道 (重命名、主题等)
server.patch("/api/channels/:channelId", async (request, reply) => {
  const { channelId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return reply.status(404).send({ error: "频道不存在" });
  }

  const canManage = await permissionService.hasGuildPermission(
    user.id,
    channel.guildId,
    PermissionFlags.MANAGE_CHANNELS,
  );
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "缺少管理频道权限 (MANAGE_CHANNELS)" });
  }

  const { name, topic } = (request.body || {}) as {
    name?: string;
    topic?: string;
  };
  const updatedChannel = await prisma.channel.update({
    where: { id: channelId },
    data: {
      ...(name
        ? { name: name.trim().toLowerCase().replace(/\s+/g, "-") }
        : {}),
      ...(topic !== undefined ? { topic } : {}),
    },
  });

  const channelPayload = {
    id: updatedChannel.id,
    guildId: updatedChannel.guildId,
    name: updatedChannel.name,
    type: updatedChannel.type as any,
    topic: updatedChannel.topic,
    parentId: updatedChannel.parentId,
    position: updatedChannel.position,
    isE2EE: updatedChannel.isE2EE,
    bitrate: updatedChannel.bitrate,
    createdAt: updatedChannel.createdAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CHANNEL_UPDATE,
    d: channelPayload,
  });

  return channelPayload;
});

// 退出公会
server.post("/api/guilds/:guildId/leave", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) {
    return reply.status(404).send({ error: "服务器不存在" });
  }
  if (guild.ownerId === user.id) {
    return reply
      .status(400)
      .send({ error: "服务器所有者无法退出，请转让或删除服务器" });
  }

  await prisma.guildMember.deleteMany({
    where: { guildId, userId: user.id },
  });

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_MEMBER_REMOVE,
    d: { guildId, userId: user.id },
  });

  return { success: true, guildId };
});

// 踢出成员
server.delete(
  "/api/guilds/:guildId/members/:targetUserId",
  async (request, reply) => {
    const { guildId, targetUserId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst();
    if (!user) {
      return reply.status(401).send({ error: "需要登录" });
    }

    const canKick = await permissionService.hasGuildPermission(
      user.id,
      guildId,
      PermissionFlags.KICK_MEMBERS,
    );
    if (!canKick) {
      return reply
        .status(403)
        .send({ error: "缺少踢出成员权限 (KICK_MEMBERS)" });
    }

    await prisma.guildMember.deleteMany({
      where: { guildId, userId: targetUserId },
    });

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_MEMBER_REMOVE,
      d: { guildId, userId: targetUserId },
    });

    return { success: true, guildId, targetUserId };
  },
);

// ==========================================
// 3. 消息操作与互动 API (Messages & Reactions)
// ==========================================

server.get("/api/channels/:channelId/messages", async (request) => {
  const { channelId } = request.params as any;
  const currentUserId = await getUserIdFromRequest(request);

  const messages = await prisma.message.findMany({
    where: { channelId },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
      attachments: true,
      reactions: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const replyToIds = messages
    .map((m) => m.replyToId)
    .filter(Boolean) as string[];
  const replyMap = new Map<
    string,
    { id: string; authorName: string; content: string }
  >();
  if (replyToIds.length > 0) {
    const repliedMessages = await prisma.message.findMany({
      where: { id: { in: replyToIds } },
      include: { author: { select: { username: true } } },
    });
    for (const rm of repliedMessages) {
      replyMap.set(rm.id, {
        id: rm.id,
        authorName: rm.author.username,
        content: rm.content.slice(0, 100),
      });
    }
  }

  return messages.map((m) => {
    const reactionMap = new Map<
      string,
      { emoji: string; count: number; userIds: string[]; me: boolean }
    >();
    for (const r of m.reactions) {
      if (!reactionMap.has(r.emoji)) {
        reactionMap.set(r.emoji, {
          emoji: r.emoji,
          count: 0,
          userIds: [],
          me: false,
        });
      }
      const item = reactionMap.get(r.emoji)!;
      item.count++;
      item.userIds.push(r.userId);
      if (currentUserId && r.userId === currentUserId) {
        item.me = true;
      }
    }

    return {
      id: m.id,
      channelId: m.channelId,
      authorId: m.authorId,
      author: {
        id: m.author.id,
        username: m.author.username,
        avatarUrl: m.author.avatarUrl,
      },
      content: m.content,
      isEncrypted: m.isEncrypted,
      replyToId: m.replyToId,
      replyTo: m.replyToId ? replyMap.get(m.replyToId) || null : null,
      isPinned: m.isPinned,
      reactions: Array.from(reactionMap.values()),
      attachments: m.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
      })),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  });
});

server.post("/api/channels/:channelId/messages", async (request, reply) => {
  const { channelId } = request.params as any;
  const { content, authorId, isEncrypted, attachments, replyToId } =
    request.body as any;

  const reqUserId = await getUserIdFromRequest(request);
  const targetUserId = reqUserId || authorId;
  let author = targetUserId
    ? await prisma.user.findUnique({ where: { id: targetUserId } })
    : null;
  if (!author) {
    author = await prisma.user.findFirst();
  }
  if (!author) {
    return reply.status(400).send({ error: "发信作者不存在" });
  }

  const canSend = await permissionService.hasChannelPermission(
    author.id,
    channelId,
    PermissionFlags.SEND_MESSAGES,
  );
  if (!canSend) {
    return reply
      .status(403)
      .send({ error: "缺少频道发信权限 (SEND_MESSAGES)" });
  }

  let replyToPreview = null;
  if (replyToId) {
    const refMsg = await prisma.message.findUnique({
      where: { id: replyToId },
      include: { author: { select: { username: true } } },
    });
    if (refMsg) {
      replyToPreview = {
        id: refMsg.id,
        authorName: refMsg.author.username,
        content: refMsg.content.slice(0, 100),
      };
    }
  }

  const createdMessage = await prisma.message.create({
    data: {
      channelId,
      authorId: author.id,
      content,
      isEncrypted: !!isEncrypted,
      replyToId: replyToId || null,
      attachments: attachments?.length
        ? {
            create: attachments.map((a: any) => ({
              url: a.url,
              fileName: a.fileName,
              fileSize: a.fileSize || 0,
              mimeType: a.mimeType || "application/octet-stream",
            })),
          }
        : undefined,
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
      attachments: true,
    },
  });

  const messagePayload: Message = {
    id: createdMessage.id,
    channelId: createdMessage.channelId,
    authorId: createdMessage.authorId,
    author: {
      id: createdMessage.author.id,
      username: createdMessage.author.username,
      avatarUrl: createdMessage.author.avatarUrl,
    },
    content: createdMessage.content,
    isEncrypted: createdMessage.isEncrypted,
    replyToId: createdMessage.replyToId,
    replyTo: replyToPreview,
    isPinned: createdMessage.isPinned,
    reactions: [],
    attachments: createdMessage.attachments.map((a) => ({
      id: a.id,
      url: a.url,
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
    })),
    createdAt: createdMessage.createdAt.toISOString(),
    updatedAt: createdMessage.updatedAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.MESSAGE_CREATE,
    d: messagePayload,
  });

  return messagePayload;
});

// 添加 Reaction 点赞
server.put(
  "/api/channels/:channelId/messages/:messageId/reactions/:emoji",
  async (request, reply) => {
    const { channelId, messageId, emoji } = request.params as any;
    const decodedEmoji = decodeURIComponent(emoji);
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst();
    if (!user) {
      return reply.status(401).send({ error: "需要登录后操作" });
    }

    const canReact = await permissionService.hasChannelPermission(
      user.id,
      channelId,
      PermissionFlags.ADD_REACTIONS,
    );
    if (!canReact) {
      return reply
        .status(403)
        .send({ error: "缺少表情点赞权限 (ADD_REACTIONS)" });
    }

    await prisma.reaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: user.id,
          emoji: decodedEmoji,
        },
      },
      create: {
        messageId,
        userId: user.id,
        emoji: decodedEmoji,
      },
      update: {},
    });

    const allReactions = await prisma.reaction.findMany({
      where: { messageId },
    });

    const reactionMap = new Map<
      string,
      { emoji: string; count: number; userIds: string[]; me: boolean }
    >();
    for (const r of allReactions) {
      if (!reactionMap.has(r.emoji)) {
        reactionMap.set(r.emoji, {
          emoji: r.emoji,
          count: 0,
          userIds: [],
          me: false,
        });
      }
      const item = reactionMap.get(r.emoji)!;
      item.count++;
      item.userIds.push(r.userId);
      if (r.userId === user.id) item.me = true;
    }

    const reactionsList = Array.from(reactionMap.values());

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.MESSAGE_REACTION_ADD,
      d: {
        channelId,
        messageId,
        userId: user.id,
        emoji: decodedEmoji,
        reactions: reactionsList,
      },
    });

    return reactionsList;
  },
);

// 取消 Reaction 点赞
server.delete(
  "/api/channels/:channelId/messages/:messageId/reactions/:emoji",
  async (request, reply) => {
    const { channelId, messageId, emoji } = request.params as any;
    const decodedEmoji = decodeURIComponent(emoji);
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst();
    if (!user) {
      return reply.status(401).send({ error: "需要登录" });
    }

    await prisma.reaction.deleteMany({
      where: {
        messageId,
        userId: user.id,
        emoji: decodedEmoji,
      },
    });

    const allReactions = await prisma.reaction.findMany({
      where: { messageId },
    });

    const reactionMap = new Map<
      string,
      { emoji: string; count: number; userIds: string[]; me: boolean }
    >();
    for (const r of allReactions) {
      if (!reactionMap.has(r.emoji)) {
        reactionMap.set(r.emoji, {
          emoji: r.emoji,
          count: 0,
          userIds: [],
          me: false,
        });
      }
      const item = reactionMap.get(r.emoji)!;
      item.count++;
      item.userIds.push(r.userId);
      if (r.userId === user.id) item.me = true;
    }

    const reactionsList = Array.from(reactionMap.values());

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.MESSAGE_REACTION_REMOVE,
      d: {
        channelId,
        messageId,
        userId: user.id,
        emoji: decodedEmoji,
        reactions: reactionsList,
      },
    });

    return reactionsList;
  },
);

// 切换置顶状态 (Pin / Unpin)
server.patch(
  "/api/channels/:channelId/messages/:messageId/pin",
  async (request, reply) => {
    const { channelId, messageId } = request.params as any;
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      return reply.status(404).send({ error: "消息不存在" });
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isPinned: !message.isPinned },
    });

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.MESSAGE_PIN_UPDATE,
      d: {
        channelId,
        messageId,
        isPinned: updated.isPinned,
      },
    });

    return { messageId, isPinned: updated.isPinned };
  },
);

// 删除/撤回消息
server.delete(
  "/api/channels/:channelId/messages/:messageId",
  async (request, reply) => {
    const { channelId, messageId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst();
    if (!user) {
      return reply.status(401).send({ error: "需要登录" });
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      return reply.status(404).send({ error: "消息不存在" });
    }

    const isAuthor = message.authorId === user.id;
    const canManage = await permissionService.hasChannelPermission(
      user.id,
      channelId,
      PermissionFlags.MANAGE_MESSAGES,
    );
    if (!isAuthor && !canManage) {
      return reply.status(403).send({ error: "您没有撤回或删除该消息的权限" });
    }

    await prisma.message.delete({ where: { id: messageId } });

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.MESSAGE_DELETE,
      d: { channelId, messageId },
    });

    return { success: true, messageId };
  },
);

// ==========================================
// 4. 对象存储与附件直传 API (Storage & Attachments)
// ==========================================

server.post("/api/attachments/presigned-url", async (request, reply) => {
  try {
    const body = request.body as PresignedUploadRequest;
    if (!body?.fileName) {
      return reply.status(400).send({ error: "未提供 fileName" });
    }
    const result = await storageService.getPresignedUploadUrl(body);
    return result;
  } catch (err: any) {
    return reply
      .status(500)
      .send({ error: err.message || "获取预签名链接失败" });
  }
});

server.put("/api/attachments/upload/:fileName", async (request, reply) => {
  const { fileName } = request.params as any;
  const decodedFileName = decodeURIComponent(fileName);
  const filePath = path.join(storageService.getUploadsDir(), decodedFileName);

  const buffer = Buffer.isBuffer(request.body)
    ? request.body
    : Buffer.from(
        typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body),
      );

  await fs.promises.writeFile(filePath, buffer);

  const baseUrl = process.env.SERVER_BASE_URL || "http://localhost:3001";
  return {
    success: true,
    fileUrl: `${baseUrl}/uploads/${encodeURIComponent(decodedFileName)}`,
  };
});

// ==========================================
// 4.5 阶段五：基础链路加固与 E2EE 密钥分发中心 (Phase 5 Security & E2EE Hub)
// ==========================================

// 链路安全与加固策略查询
server.get("/api/security/posture", async () => {
  return e2eeService.getSecurityPosture();
});

// 客户端注册/更新自身的双棘轮 PreKeyBundle 公钥束
server.post("/api/e2ee/keys/prekey", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要有效登录身份注册公钥束" });
  }

  const body = request.body as RegisterPreKeyDTO;
  if (!body || !body.identityKey || !body.signedPreKey || !body.signature) {
    return reply.status(400).send({ error: "请提供完整的 PreKeyBundle 参数" });
  }

  const bundle = e2eeService.registerPreKey(user.id, body);
  return bundle;
});

// 查询特定成员的 PreKeyBundle（用于端侧发起双棘轮握手）
server.get("/api/e2ee/keys/prekey/:targetUserId", async (request, reply) => {
  const { targetUserId } = request.params as any;
  const bundle = e2eeService.getPreKey(targetUserId);
  if (!bundle) {
    return reply.status(404).send({ error: "目标用户尚未发布端到端加密公钥束" });
  }
  return bundle;
});

// 频道端到端密文密钥协商信令（服务端盲中继）
server.post(
  "/api/channels/:channelId/e2ee/key-exchange",
  async (request, reply) => {
    const { channelId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findFirst();
    if (!user) {
      return reply.status(401).send({ error: "需要登录后发送密钥协商包" });
    }

    const body = (request.body || {}) as {
      recipientId?: string;
      ephemeralKey: string;
      encryptedKeyData: string;
    };

    if (!body.ephemeralKey || !body.encryptedKeyData) {
      return reply.status(400).send({ error: "密钥协商载荷不完整" });
    }

    const payload: E2eeKeyExchangePayload = {
      channelId,
      senderId: user.id,
      recipientId: body.recipientId,
      ephemeralKey: body.ephemeralKey,
      encryptedKeyData: body.encryptedKeyData,
      timestamp: Date.now(),
    };

    // 服务端仅盲中继密文包，绝不解密也不可能解密
    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.E2EE_KEY_EXCHANGE,
      d: payload,
    });

    return { success: true, timestamp: payload.timestamp };
  },
);

// 获取频道端到端加密安全状态与已就绪密钥成员数
server.get("/api/channels/:channelId/e2ee/status", async (request, reply) => {
  const { channelId } = request.params as any;
  try {
    const status = await e2eeService.getChannelE2EEStatus(channelId);
    return status;
  } catch (err: any) {
    return reply.status(404).send({ error: err.message || "频道不存在" });
  }
});

// ==========================================
// 5. LiveKit 媒体 Token 生成
// ==========================================

server.post("/api/livekit/token", async (request, reply) => {
  const body = request.body as any;
  if (!body || !body.roomName || !body.identity) {
    return reply
      .status(400)
      .send({ error: "roomName and identity are required" });
  }
  return await generateLiveKitToken({
    roomName: String(body.roomName),
    identity: String(body.identity),
    name: body.name ? String(body.name) : undefined,
    isPublisher: body.isPublisher !== false,
    bitrate: body.bitrate ? Number(body.bitrate) : undefined,
  });
});

// ==========================================
// 6. WebSocket 网关长连接
// ==========================================

server.register(async function (fastify) {
  fastify.get("/gateway", { websocket: true }, (socket) => {
    gatewayManager.handleConnection(socket);
  });
});

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function start() {
  try {
    // 启动前执行种子数据检查与存储服务自愈检查
    await seedInitialData();
    await storageService.init();

    await server.listen({ port: PORT, host: HOST });
    console.log(
      `🚀 Tescord 后端服务与 Gateway 网关已在 http://${HOST}:${PORT} 启动 (SQLite 持久化与存储双模引擎已就绪)`,
    );
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
