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
import { cacheStore } from "./cache.js";
import { generateLiveKitToken } from "./livekit.js";
import { storageService } from "./services/storage.service.js";
import { permissionService } from "./services/permission.service.js";
import { auditLogService } from "./services/audit-log.service.js";
import { e2eeService } from "./services/e2ee.service.js";
import {
  GatewayOpCode,
  GatewayEvents,
  LoginDTO,
  Message,
  RegisterDTO,
  UpdateProfileDTO,
  CreateGuildDTO,
  UpdateGuildDTO,
  CreateChannelDTO,
  CreateCategoryDTO,
  UpdateCategoryDTO,
  ReorderCategoriesDTO,
  ReorderChannelsDTO,
  CreateInviteDTO,
  JoinInviteDTO,
  PresignedUploadRequest,
  PermissionFlags,
  buildSecurityHeaders,
  RegisterPreKeyDTO,
  E2eeKeyExchangePayload,
  CreateRoleDTO,
  UpdateRoleDTO,
  UpdateRolePositionsDTO,
  UpdateMemberRolesDTO,
  BanMemberDTO,
  TransferOwnershipDTO,
  AuditLogAction,
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

      // 若修改了在线状态或个性签名，同步更新瞬时在线表并广播专属 PRESENCE_UPDATE
      if (body.status || body.customStatus !== undefined) {
        const presence = {
          userId,
          status: updated.status,
          customStatus: updated.customStatus,
          lastActiveAt: new Date().toISOString(),
        };
        await cacheStore.setUserPresence(userId, presence);
        await gatewayManager.broadcastPresenceUpdate(userId, presence);
      }

      // 通过网关广播全量资料更新事件
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

// 获取用户个人偏好设置 (UserSettingsDTO)
server.get(
  "/api/users/@me/settings",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) {
      return reply.status(404).send({ error: "用户不存在" });
    }
    if (!user.settings) {
      return {};
    }
    try {
      return JSON.parse(user.settings);
    } catch {
      return {};
    }
  },
);

// 增量/全量更新个人偏好设置 (UserSettingsDTO)
server.patch(
  "/api/users/@me/settings",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    try {
      const incomingSettings = request.body || {};
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { settings: true },
      });
      if (!user) {
        return reply.status(404).send({ error: "用户不存在" });
      }
      let existingSettings: Record<string, any> = {};
      if (user.settings) {
        try {
          existingSettings = JSON.parse(user.settings);
        } catch {}
      }
      const mergedSettings = {
        ...existingSettings,
        ...incomingSettings,
        audio: {
          ...(existingSettings.audio || {}),
          ...(incomingSettings.audio || {}),
        },
        video: {
          ...(existingSettings.video || {}),
          ...(incomingSettings.video || {}),
        },
        userVolumes: {
          ...(existingSettings.userVolumes || {}),
          ...(incomingSettings.userVolumes || {}),
        },
      };
      await prisma.user.update({
        where: { id: userId },
        data: { settings: JSON.stringify(mergedSettings) },
      });
      return mergedSettings;
    } catch (err: any) {
      return reply
        .status(400)
        .send({ error: err.message || "更新用户设置失败" });
    }
  },
);

// ==========================================
// 2. 公会与频道 API (Guilds & Channels)
// ==========================================

server.get("/api/guilds", async () => {
  const guilds = await prisma.guild.findMany({
    include: {
      categories: {
        orderBy: { position: "asc" },
      },
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
              bio: true,
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

  const allMemberIds = Array.from(
    new Set(guilds.flatMap((g) => g.members.map((m) => m.userId))),
  );
  const presences = await cacheStore.batchGetPresences(allMemberIds);

  return guilds.map((g) => {
    const roleMap = new Map(g.roles.map((r) => [r.id, r]));
    return {
      id: g.id,
      name: g.name,
      iconUrl: g.iconUrl,
      description: g.description,
      ownerId: g.ownerId,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
      categories: g.categories.map((cat) => ({
        id: cat.id,
        guildId: cat.guildId,
        name: cat.name,
        position: cat.position,
        createdAt: cat.createdAt.toISOString(),
        updatedAt: cat.updatedAt.toISOString(),
      })),
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
      roles: g.roles.map((r) => ({
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
      members: g.members.map((m) => {
        const roleIds: string[] = JSON.parse(m.roleIds || "[]");
        const parsedRoles = roleIds
          .map((id) => roleMap.get(id))
          .filter(Boolean)
          .map((r: any) => ({
            id: r.id,
            guildId: r.guildId,
            name: r.name,
            color: r.color,
            hoist: r.hoist,
            position: r.position,
            permissions: r.permissions,
            isDefault: r.isDefault,
            createdAt: r.createdAt.toISOString(),
          }));

        const presence = m.user ? presences.get(m.userId) : null;
        const isOnline =
          presence &&
          presence.status !== "OFFLINE" &&
          presence.status !== "INVISIBLE";
        const finalStatus = isOnline ? presence.status : "OFFLINE";
        const finalCustomStatus =
          presence?.customStatus !== undefined
            ? presence.customStatus
            : m.user?.customStatus;

        return {
          userId: m.userId,
          guildId: m.guildId,
          nickname: m.nickname,
          roleIds,
          roles: parsedRoles,
          joinedAt: m.joinedAt.toISOString(),
          user: m.user
            ? {
                ...m.user,
                status: finalStatus,
                customStatus: finalCustomStatus,
                createdAt: m.user.createdAt.toISOString(),
              }
            : undefined,
        };
      }),
    };
  });
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

  const guild = await prisma.guild.create({
    data: {
      name: name.trim(),
      iconUrl: iconUrl || null,
      description: (request.body as any)?.description || null,
      ownerId: owner.id,
      roles: {
        create: [
          {
            name: "@everyone",
            color: null,
            hoist: false,
            position: 0,
            permissions: defaultPerms,
            isDefault: true,
          },
          {
            name: "Admin",
            color: "#5865F2",
            hoist: true,
            position: 1,
            permissions: 0x7fffffff,
            isDefault: false,
          },
        ],
      },
    },
    include: {
      roles: true,
    },
  });

  const textCat = await prisma.channelCategory.create({
    data: {
      guildId: guild.id,
      name: "文字频道",
      position: 0,
    },
  });

  const voiceCat = await prisma.channelCategory.create({
    data: {
      guildId: guild.id,
      name: "语音频道",
      position: 1,
    },
  });

  const textChannel = await prisma.channel.create({
    data: {
      guildId: guild.id,
      parentId: textCat.id,
      name: "常规",
      type: "TEXT",
      topic: "日常聊天交流",
      position: 0,
    },
  });

  const voiceChannel = await prisma.channel.create({
    data: {
      guildId: guild.id,
      parentId: voiceCat.id,
      name: "日常闲聊",
      type: "VOICE",
      position: 1,
    },
  });

  const adminRole =
    guild.roles.find((r) => r.name === "Admin") || guild.roles[0];
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
          bio: true,
          createdAt: true,
        },
      },
    },
  });

  const formattedGuild = {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    description: guild.description,
    ownerId: guild.ownerId,
    createdAt: guild.createdAt.toISOString(),
    updatedAt: guild.updatedAt.toISOString(),
    categories: [
      {
        id: textCat.id,
        guildId: textCat.guildId,
        name: textCat.name,
        position: textCat.position,
        createdAt: textCat.createdAt.toISOString(),
        updatedAt: textCat.updatedAt.toISOString(),
      },
      {
        id: voiceCat.id,
        guildId: voiceCat.guildId,
        name: voiceCat.name,
        position: voiceCat.position,
        createdAt: voiceCat.createdAt.toISOString(),
        updatedAt: voiceCat.updatedAt.toISOString(),
      },
    ],
    channels: [
      {
        id: textChannel.id,
        guildId: textChannel.guildId,
        name: textChannel.name,
        type: textChannel.type as any,
        topic: textChannel.topic,
        parentId: textChannel.parentId,
        position: textChannel.position,
        isE2EE: textChannel.isE2EE,
        bitrate: textChannel.bitrate,
        createdAt: textChannel.createdAt.toISOString(),
      },
      {
        id: voiceChannel.id,
        guildId: voiceChannel.guildId,
        name: voiceChannel.name,
        type: voiceChannel.type as any,
        topic: voiceChannel.topic,
        parentId: voiceChannel.parentId,
        position: voiceChannel.position,
        isE2EE: voiceChannel.isE2EE,
        bitrate: voiceChannel.bitrate,
        createdAt: voiceChannel.createdAt.toISOString(),
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
      isDefault: r.isDefault,
      createdAt: r.createdAt.toISOString(),
    })),
    members: [
      {
        userId: member.userId,
        guildId: member.guildId,
        nickname: member.nickname,
        roleIds: [adminRole.id],
        roles: [
          {
            id: adminRole.id,
            guildId: adminRole.guildId,
            name: adminRole.name,
            color: adminRole.color,
            hoist: adminRole.hoist,
            position: adminRole.position,
            permissions: adminRole.permissions,
            isDefault: adminRole.isDefault,
            createdAt: adminRole.createdAt.toISOString(),
          },
        ],
        joinedAt: member.joinedAt.toISOString(),
        user: member.user
          ? { ...member.user, createdAt: member.user.createdAt.toISOString() }
          : undefined,
      },
    ],
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_CREATE,
    d: formattedGuild,
  });

  return formattedGuild;
});

// ==========================================
// 2.1 服务器管理员管理板块 API (Server Admin Suite)
// ==========================================

// 修改服务器基础概览信息 (需 MANAGE_GUILD)
server.patch("/api/guilds/:guildId", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const hasPerm = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.MANAGE_GUILD,
  );
  if (!hasPerm) {
    return reply
      .status(403)
      .send({ error: "缺少管理服务器权限 (MANAGE_GUILD)" });
  }

  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) return reply.status(404).send({ error: "服务器不存在" });

  const body = (request.body || {}) as UpdateGuildDTO;
  const updated = await prisma.guild.update({
    where: { id: guildId },
    data: {
      name: body.name !== undefined ? body.name.trim() : undefined,
      iconUrl: body.iconUrl !== undefined ? body.iconUrl : undefined,
      description:
        body.description !== undefined ? body.description : undefined,
    },
  });

  await auditLogService.logAction({
    guildId,
    userId: user.id,
    action: AuditLogAction.GUILD_UPDATE,
    targetId: guildId,
    targetName: updated.name,
    changes: {
      name: { old: guild.name, new: updated.name },
      iconUrl: { old: guild.iconUrl, new: updated.iconUrl },
      description: { old: guild.description, new: updated.description },
    },
  });

  const payload = {
    id: updated.id,
    name: updated.name,
    iconUrl: updated.iconUrl,
    description: updated.description,
    ownerId: updated.ownerId,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_UPDATE,
    d: payload,
  });

  return payload;
});

// 解散/删除服务器 (仅限 Owner，需服务器全名二次确认)
server.delete("/api/guilds/:guildId", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) return reply.status(404).send({ error: "服务器不存在" });

  if (guild.ownerId !== user.id) {
    return reply.status(403).send({ error: "只有服务器所有者可以解散服务器" });
  }

  const { nameConfirmation } = (request.body || {}) as {
    nameConfirmation?: string;
  };
  if (nameConfirmation !== guild.name) {
    return reply.status(400).send({ error: "服务器名称确认不匹配" });
  }

  await prisma.guild.delete({ where: { id: guildId } });

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_DELETE,
    d: { guildId },
  });

  return { success: true, guildId };
});

// 转让服务器所有权 (仅限 Owner)
server.post(
  "/api/guilds/:guildId/transfer-ownership",
  async (request, reply) => {
    const { guildId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) return reply.status(401).send({ error: "需要登录后操作" });

    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild) return reply.status(404).send({ error: "服务器不存在" });

    if (guild.ownerId !== user.id) {
      return reply
        .status(403)
        .send({ error: "只有服务器所有者可以转让所有权" });
    }

    const { newOwnerId } = (request.body || {}) as TransferOwnershipDTO;
    if (!newOwnerId) {
      return reply.status(400).send({ error: "目标新所有者不能为空" });
    }

    const targetMember = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId: newOwnerId } },
      include: { user: true },
    });
    if (!targetMember) {
      return reply.status(400).send({ error: "目标用户不是该服务器成员" });
    }

    const updated = await prisma.guild.update({
      where: { id: guildId },
      data: { ownerId: newOwnerId },
    });

    await auditLogService.logAction({
      guildId,
      userId: user.id,
      action: "GUILD_OWNERSHIP_TRANSFER",
      targetId: newOwnerId,
      targetName: targetMember.user.username,
      reason: `所有权由 ${user.username} 转让给 ${targetMember.user.username}`,
    });

    const payload = {
      id: updated.id,
      name: updated.name,
      iconUrl: updated.iconUrl,
      description: updated.description,
      ownerId: updated.ownerId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_UPDATE,
      d: payload,
    });

    return payload;
  },
);

// 获取角色列表 (确保包含 @everyone)
server.get("/api/guilds/:guildId/roles", async (request) => {
  const { guildId } = request.params as any;
  await permissionService.ensureEveryoneRole(guildId);
  const roles = await prisma.role.findMany({
    where: { guildId },
    orderBy: { position: "asc" },
  });
  return roles.map((r) => ({
    id: r.id,
    guildId: r.guildId,
    name: r.name,
    color: r.color,
    hoist: r.hoist,
    position: r.position,
    permissions: r.permissions,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));
});

// 创建角色 (需 MANAGE_ROLES)
server.post("/api/guilds/:guildId/roles", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const hasPerm = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.MANAGE_ROLES,
  );
  if (!hasPerm) {
    return reply.status(403).send({ error: "缺少管理角色权限 (MANAGE_ROLES)" });
  }

  const body = (request.body || {}) as CreateRoleDTO;
  const roles = await prisma.role.findMany({
    where: { guildId },
    select: { position: true },
  });
  const maxPos =
    roles.length > 0 ? Math.max(...roles.map((r) => r.position)) : 0;

  const role = await prisma.role.create({
    data: {
      guildId,
      name: body.name ? body.name.trim() : "新身份组",
      color: body.color || null,
      hoist: body.hoist || false,
      position: maxPos + 1,
      permissions: body.permissions !== undefined ? body.permissions : 0,
      isDefault: false,
    },
  });

  await auditLogService.logAction({
    guildId,
    userId: user.id,
    action: AuditLogAction.ROLE_CREATE,
    targetId: role.id,
    targetName: role.name,
    changes: {
      name: { new: role.name },
      color: { new: role.color },
      hoist: { new: role.hoist },
      permissions: { new: role.permissions },
    },
  });

  const formattedRole = {
    id: role.id,
    guildId: role.guildId,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    position: role.position,
    permissions: role.permissions,
    isDefault: role.isDefault,
    createdAt: role.createdAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_ROLE_CREATE,
    d: { guildId, role: formattedRole },
  });

  return formattedRole;
});

// 修改角色 (需 MANAGE_ROLES & 层级校验)
server.patch("/api/guilds/:guildId/roles/:roleId", async (request, reply) => {
  const { guildId, roleId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.guildId !== guildId) {
    return reply.status(404).send({ error: "角色不存在" });
  }

  const canManage = await permissionService.canManageRole(
    user.id,
    guildId,
    role,
  );
  if (!canManage && !role.isDefault) {
    return reply
      .status(403)
      .send({ error: "无权修改该角色（权限不足或角色层级高于/等同于自身）" });
  }

  const body = (request.body || {}) as UpdateRoleDTO;
  const isEveryone = role.isDefault || role.name === "@everyone";

  const updatedRole = await prisma.role.update({
    where: { id: roleId },
    data: {
      name:
        !isEveryone && body.name !== undefined ? body.name.trim() : undefined,
      color: !isEveryone && body.color !== undefined ? body.color : undefined,
      hoist: !isEveryone && body.hoist !== undefined ? body.hoist : undefined,
      position:
        !isEveryone && body.position !== undefined ? body.position : undefined,
      permissions:
        body.permissions !== undefined ? body.permissions : undefined,
    },
  });

  await auditLogService.logAction({
    guildId,
    userId: user.id,
    action: AuditLogAction.ROLE_UPDATE,
    targetId: role.id,
    targetName: updatedRole.name,
    changes: {
      name: { old: role.name, new: updatedRole.name },
      color: { old: role.color, new: updatedRole.color },
      hoist: { old: role.hoist, new: updatedRole.hoist },
      permissions: { old: role.permissions, new: updatedRole.permissions },
    },
  });

  const formattedRole = {
    id: updatedRole.id,
    guildId: updatedRole.guildId,
    name: updatedRole.name,
    color: updatedRole.color,
    hoist: updatedRole.hoist,
    position: updatedRole.position,
    permissions: updatedRole.permissions,
    isDefault: updatedRole.isDefault,
    createdAt: updatedRole.createdAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_ROLE_UPDATE,
    d: { guildId, role: formattedRole },
  });

  return formattedRole;
});

// 删除角色 (需 MANAGE_ROLES & 层级校验)
server.delete("/api/guilds/:guildId/roles/:roleId", async (request, reply) => {
  const { guildId, roleId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.guildId !== guildId) {
    return reply.status(404).send({ error: "角色不存在" });
  }
  if (role.isDefault || role.name === "@everyone") {
    return reply.status(400).send({ error: "无法删除 @everyone 基础角色" });
  }

  const canManage = await permissionService.canManageRole(
    user.id,
    guildId,
    role,
  );
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "无权删除该角色（权限不足或角色层级高于/等同于自身）" });
  }

  // 从该公会所有成员的 roleIds 中移除该 roleId
  const members = await prisma.guildMember.findMany({ where: { guildId } });
  for (const m of members) {
    try {
      const ids: string[] = JSON.parse(m.roleIds || "[]");
      if (ids.includes(roleId)) {
        const nextIds = ids.filter((id) => id !== roleId);
        await prisma.guildMember.update({
          where: { id: m.id },
          data: { roleIds: JSON.stringify(nextIds) },
        });
      }
    } catch {}
  }

  await prisma.role.delete({ where: { id: roleId } });

  await auditLogService.logAction({
    guildId,
    userId: user.id,
    action: AuditLogAction.ROLE_DELETE,
    targetId: role.id,
    targetName: role.name,
  });

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_ROLE_DELETE,
    d: { guildId, roleId },
  });

  return { success: true, guildId, roleId };
});

// 批量调整角色权重层级
server.put("/api/guilds/:guildId/roles/positions", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const hasPerm = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.MANAGE_ROLES,
  );
  if (!hasPerm) {
    return reply.status(403).send({ error: "缺少管理角色权限 (MANAGE_ROLES)" });
  }

  const { roles } = (request.body || {}) as UpdateRolePositionsDTO;
  if (!Array.isArray(roles)) {
    return reply.status(400).send({ error: "roles 参数必须为数组" });
  }

  await prisma.$transaction(
    roles.map((r) =>
      prisma.role.update({
        where: { id: r.id },
        data: { position: r.position },
      }),
    ),
  );

  const updatedRoles = await prisma.role.findMany({
    where: { guildId },
    orderBy: { position: "asc" },
  });

  return updatedRoles.map((r) => ({
    id: r.id,
    guildId: r.guildId,
    name: r.name,
    color: r.color,
    hoist: r.hoist,
    position: r.position,
    permissions: r.permissions,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));
});

// 修改成员所属角色或昵称 (需 MANAGE_ROLES / MANAGE_NICKNAMES & 层级校验)
server.patch(
  "/api/guilds/:guildId/members/:targetUserId",
  async (request, reply) => {
    const { guildId, targetUserId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) return reply.status(401).send({ error: "需要登录后操作" });

    const member = await prisma.guildMember.findUnique({
      where: { guildId_userId: { guildId, userId: targetUserId } },
      include: { user: true },
    });
    if (!member) return reply.status(404).send({ error: "目标成员不存在" });

    const body = (request.body || {}) as UpdateMemberRolesDTO;

    // 角色修改校验
    if (body.roleIds !== undefined) {
      const hasManageRoles = await permissionService.hasGuildPermission(
        user.id,
        guildId,
        PermissionFlags.MANAGE_ROLES,
      );
      if (!hasManageRoles) {
        return reply
          .status(403)
          .send({ error: "缺少管理角色权限 (MANAGE_ROLES)" });
      }

      const canManage = await permissionService.canManageMember(
        user.id,
        targetUserId,
        guildId,
      );
      if (!canManage) {
        return reply
          .status(403)
          .send({ error: "无权管理该成员的角色（对方职级高于或等同于自身）" });
      }

      const actorHighestPos =
        await permissionService.getMemberHighestRolePosition(user.id, guildId);
      const assignedRoles = await prisma.role.findMany({
        where: { id: { in: body.roleIds }, guildId },
      });

      const guild = await prisma.guild.findUnique({ where: { id: guildId } });
      const isOwner = guild?.ownerId === user.id;
      if (!isOwner) {
        for (const r of assignedRoles) {
          if (r.position >= actorHighestPos) {
            return reply.status(403).send({
              error: `无法赋予等于或高于自身权重的角色: ${r.name}`,
            });
          }
        }
      }
    }

    // 昵称修改校验
    if (body.nickname !== undefined) {
      if (user.id === targetUserId) {
        const hasNickPerm = await permissionService.hasGuildPermission(
          user.id,
          guildId,
          PermissionFlags.CHANGE_NICKNAME,
        );
        if (!hasNickPerm) {
          return reply
            .status(403)
            .send({ error: "缺少修改自身昵称权限 (CHANGE_NICKNAME)" });
        }
      } else {
        const hasManageNickPerm = await permissionService.hasGuildPermission(
          user.id,
          guildId,
          PermissionFlags.MANAGE_NICKNAMES,
        );
        if (!hasManageNickPerm) {
          return reply
            .status(403)
            .send({ error: "缺少管理昵称权限 (MANAGE_NICKNAMES)" });
        }
        const canManage = await permissionService.canManageMember(
          user.id,
          targetUserId,
          guildId,
        );
        if (!canManage) {
          return reply.status(403).send({
            error: "无权修改该成员昵称（对方职级高于或等同于自身）",
          });
        }
      }
    }

    const updatedMember = await prisma.guildMember.update({
      where: { id: member.id },
      data: {
        roleIds:
          body.roleIds !== undefined ? JSON.stringify(body.roleIds) : undefined,
        nickname: body.nickname !== undefined ? body.nickname : undefined,
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
            bio: true,
            createdAt: true,
          },
        },
      },
    });

    const allRoles = await prisma.role.findMany({ where: { guildId } });
    const roleMap = new Map(allRoles.map((r) => [r.id, r]));
    const finalRoleIds: string[] = JSON.parse(updatedMember.roleIds || "[]");
    const parsedRoles = finalRoleIds
      .map((id) => roleMap.get(id))
      .filter(Boolean)
      .map((r: any) => ({
        id: r.id,
        guildId: r.guildId,
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        position: r.position,
        permissions: r.permissions,
        isDefault: r.isDefault,
        createdAt: r.createdAt.toISOString(),
      }));

    await auditLogService.logAction({
      guildId,
      userId: user.id,
      action: AuditLogAction.MEMBER_ROLE_UPDATE,
      targetId: targetUserId,
      targetName: updatedMember.user.username,
      changes: {
        roleIds: { old: member.roleIds, new: updatedMember.roleIds },
        nickname: { old: member.nickname, new: updatedMember.nickname },
      },
    });

    const memberPayload = {
      userId: updatedMember.userId,
      guildId: updatedMember.guildId,
      nickname: updatedMember.nickname,
      roleIds: finalRoleIds,
      roles: parsedRoles,
      joinedAt: updatedMember.joinedAt.toISOString(),
      user: updatedMember.user
        ? {
            ...updatedMember.user,
            createdAt: updatedMember.user.createdAt.toISOString(),
          }
        : undefined,
    };

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_MEMBER_UPDATE,
      d: { guildId, member: memberPayload },
    });

    return memberPayload;
  },
);

// 获取封禁黑名单 (需 BAN_MEMBERS)
server.get("/api/guilds/:guildId/bans", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const hasPerm = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.BAN_MEMBERS,
  );
  if (!hasPerm) {
    return reply
      .status(403)
      .send({ error: "缺少查看封禁名单权限 (BAN_MEMBERS)" });
  }

  const bans = await prisma.ban.findMany({
    where: { guildId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          email: true,
          status: true,
          customStatus: true,
          bio: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return bans.map((b) => ({
    id: b.id,
    guildId: b.guildId,
    userId: b.userId,
    user: b.user
      ? { ...b.user, createdAt: b.user.createdAt.toISOString() }
      : undefined,
    reason: b.reason,
    createdAt: b.createdAt.toISOString(),
  }));
});

// 封禁指定成员 (需 BAN_MEMBERS & 层级校验)
server.post(
  "/api/guilds/:guildId/bans/:targetUserId",
  async (request, reply) => {
    const { guildId, targetUserId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) return reply.status(401).send({ error: "需要登录后操作" });

    const hasPerm = await permissionService.hasGuildPermission(
      user.id,
      guildId,
      PermissionFlags.BAN_MEMBERS,
    );
    if (!hasPerm) {
      return reply
        .status(403)
        .send({ error: "缺少封禁成员权限 (BAN_MEMBERS)" });
    }

    const canManage = await permissionService.canManageMember(
      user.id,
      targetUserId,
      guildId,
    );
    if (!canManage) {
      return reply
        .status(403)
        .send({ error: "无权封禁该成员（对方职级高于或等同于自身）" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      return reply.status(404).send({ error: "目标用户不存在" });
    }

    const body = (request.body || {}) as BanMemberDTO;
    const ban = await prisma.ban.upsert({
      where: { guildId_userId: { guildId, userId: targetUserId } },
      create: {
        guildId,
        userId: targetUserId,
        reason: body.reason || "违反服务器社区守则",
      },
      update: {
        reason: body.reason || "违反服务器社区守则",
      },
      include: { user: true },
    });

    // 移出成员
    await prisma.guildMember.deleteMany({
      where: { guildId, userId: targetUserId },
    });

    await auditLogService.logAction({
      guildId,
      userId: user.id,
      action: AuditLogAction.MEMBER_BAN_ADD,
      targetId: targetUserId,
      targetName: targetUser.username,
      reason: body.reason,
    });

    const banPayload = {
      id: ban.id,
      guildId: ban.guildId,
      userId: ban.userId,
      user: ban.user
        ? { ...ban.user, createdAt: ban.user.createdAt.toISOString() }
        : undefined,
      reason: ban.reason,
      createdAt: ban.createdAt.toISOString(),
    };

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_BAN_ADD,
      d: { guildId, ban: banPayload },
    });

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_MEMBER_REMOVE,
      d: { guildId, userId: targetUserId },
    });

    return banPayload;
  },
);

// 解除封禁 (需 BAN_MEMBERS)
server.delete(
  "/api/guilds/:guildId/bans/:targetUserId",
  async (request, reply) => {
    const { guildId, targetUserId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) return reply.status(401).send({ error: "需要登录后操作" });

    const hasPerm = await permissionService.hasGuildPermission(
      user.id,
      guildId,
      PermissionFlags.BAN_MEMBERS,
    );
    if (!hasPerm) {
      return reply
        .status(403)
        .send({ error: "缺少解封成员权限 (BAN_MEMBERS)" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    await prisma.ban.deleteMany({
      where: { guildId, userId: targetUserId },
    });

    await auditLogService.logAction({
      guildId,
      userId: user.id,
      action: AuditLogAction.MEMBER_BAN_REMOVE,
      targetId: targetUserId,
      targetName: targetUser?.username || targetUserId,
    });

    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.GUILD_BAN_REMOVE,
      d: { guildId, userId: targetUserId },
    });

    return { success: true, guildId, userId: targetUserId };
  },
);

// 查询服务器有效邀请列表 (需 MANAGE_GUILD)
server.get("/api/guilds/:guildId/invites", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const hasPerm = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.MANAGE_GUILD,
  );
  if (!hasPerm) {
    return reply
      .status(403)
      .send({ error: "缺少管理服务器权限 (MANAGE_GUILD)" });
  }

  const invites = await prisma.invite.findMany({
    where: { guildId },
    include: {
      inviter: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          email: true,
          status: true,
          customStatus: true,
          bio: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return invites.map((inv) => ({
    code: inv.code,
    guildId: inv.guildId,
    inviterId: inv.inviterId,
    inviter: inv.inviter
      ? { ...inv.inviter, createdAt: inv.inviter.createdAt.toISOString() }
      : undefined,
    maxUses: inv.maxUses,
    uses: inv.uses,
    expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
  }));
});

// 作废/删除邀请码
server.delete("/api/invites/:code", async (request, reply) => {
  const { code } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite) return reply.status(404).send({ error: "邀请码不存在" });

  const hasManageGuild = await permissionService.hasGuildPermission(
    user.id,
    invite.guildId,
    PermissionFlags.MANAGE_GUILD,
  );
  if (invite.inviterId !== user.id && !hasManageGuild) {
    return reply.status(403).send({ error: "您没有权限删除该邀请码" });
  }

  await prisma.invite.delete({ where: { code } });

  await auditLogService.logAction({
    guildId: invite.guildId,
    userId: user.id,
    action: AuditLogAction.INVITE_DELETE,
    targetId: code,
    targetName: code,
  });

  return { success: true, code };
});

// 查询审计日志流水 (需 VIEW_AUDIT_LOG)
server.get("/api/guilds/:guildId/audit-logs", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) return reply.status(401).send({ error: "需要登录后操作" });

  const hasPerm = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.VIEW_AUDIT_LOG,
  );
  if (!hasPerm) {
    return reply
      .status(403)
      .send({ error: "缺少查看审计日志权限 (VIEW_AUDIT_LOG)" });
  }

  const query = (request.query || {}) as {
    limit?: string;
    before?: string;
    action?: string;
  };
  const logs = await auditLogService.getGuildAuditLogs(guildId, {
    limit: query.limit ? parseInt(query.limit, 10) : 50,
    before: query.before,
    action: query.action,
  });

  return logs;
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

  // 检查是否处于该公会的黑名单中
  const isBanned = await prisma.ban.findUnique({
    where: {
      guildId_userId: { guildId: invite.guildId, userId: user.id },
    },
  });
  if (isBanned) {
    return reply.status(403).send({ error: "您已被该服务器封禁，无法加入" });
  }

  let member = await prisma.guildMember.findUnique({
    where: {
      guildId_userId: { guildId: invite.guildId, userId: user.id },
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
          bio: true,
          createdAt: true,
        },
      },
    },
  });

  if (!member) {
    await prisma.invite.update({
      where: { code },
      data: { uses: { increment: 1 } },
    });

    const safeUserSelect = {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      status: true,
      customStatus: true,
      bio: true,
      createdAt: true,
    };

    member = await prisma.guildMember.create({
      data: {
        guildId: invite.guildId,
        userId: user.id,
        roleIds: "[]",
      },
      include: {
        user: {
          select: safeUserSelect,
        },
      },
    });

    const presence = await cacheStore.getUserPresence(member.userId);
    const isOnline =
      presence &&
      presence.status !== "OFFLINE" &&
      presence.status !== "INVISIBLE";
    const finalStatus = isOnline ? presence.status : (member.user?.status || "ONLINE");
    const finalCustomStatus =
      presence?.customStatus !== undefined
        ? presence.customStatus
        : member.user?.customStatus;

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
          roles: [],
          joinedAt: member.joinedAt.toISOString(),
          user: member.user
            ? {
                ...member.user,
                status: finalStatus as any,
                customStatus: finalCustomStatus,
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

  const { name, topic, parentId, position } = (request.body || {}) as {
    name?: string;
    topic?: string;
    parentId?: string | null;
    position?: number;
  };
  const updatedChannel = await prisma.channel.update({
    where: { id: channelId },
    data: {
      ...(name ? { name: name.trim().toLowerCase().replace(/\s+/g, "-") } : {}),
      ...(topic !== undefined ? { topic } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(position !== undefined ? { position } : {}),
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

// ==========================================
// 频道分类与拖拽排序 API (Channel Categories & Positions)
// ==========================================

// 创建分类 (Category)
server.post("/api/guilds/:guildId/categories", async (request, reply) => {
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

  const { name, position: customPosition } = (request.body ||
    {}) as CreateCategoryDTO;
  if (!name || !name.trim()) {
    return reply.status(400).send({ error: "分类名称不能为空" });
  }

  let position = customPosition;
  if (position === undefined) {
    const maxPosCat = await prisma.channelCategory.findFirst({
      where: { guildId },
      orderBy: { position: "desc" },
    });
    position = maxPosCat ? maxPosCat.position + 1 : 0;
  }

  const category = await prisma.channelCategory.create({
    data: {
      guildId,
      name: name.trim(),
      position,
    },
  });

  const categoryPayload = {
    id: category.id,
    guildId: category.guildId,
    name: category.name,
    position: category.position,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CATEGORY_CREATE,
    d: categoryPayload,
  });

  return categoryPayload;
});

// 编辑分类 (重命名/排序)
server.patch("/api/categories/:categoryId", async (request, reply) => {
  const { categoryId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const category = await prisma.channelCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return reply.status(404).send({ error: "分类不存在" });
  }

  const canManage = await permissionService.hasGuildPermission(
    user.id,
    category.guildId,
    PermissionFlags.MANAGE_CHANNELS,
  );
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "缺少管理频道权限 (MANAGE_CHANNELS)" });
  }

  const { name, position } = (request.body || {}) as UpdateCategoryDTO;
  const updatedCategory = await prisma.channelCategory.update({
    where: { id: categoryId },
    data: {
      ...(name ? { name: name.trim() } : {}),
      ...(position !== undefined ? { position } : {}),
    },
  });

  const categoryPayload = {
    id: updatedCategory.id,
    guildId: updatedCategory.guildId,
    name: updatedCategory.name,
    position: updatedCategory.position,
    createdAt: updatedCategory.createdAt.toISOString(),
    updatedAt: updatedCategory.updatedAt.toISOString(),
  };

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CATEGORY_UPDATE,
    d: categoryPayload,
  });

  return categoryPayload;
});

// 删除分类 (保留子频道，将其 parentId 设为 null)
server.delete("/api/categories/:categoryId", async (request, reply) => {
  const { categoryId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst();
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const category = await prisma.channelCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return reply.status(404).send({ error: "分类不存在" });
  }

  const canManage = await permissionService.hasGuildPermission(
    user.id,
    category.guildId,
    PermissionFlags.MANAGE_CHANNELS,
  );
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "缺少管理频道权限 (MANAGE_CHANNELS)" });
  }

  // 将该分类下所有频道的 parentId 置空 (孤儿保留)
  await prisma.channel.updateMany({
    where: { parentId: categoryId },
    data: { parentId: null },
  });

  // 删除该分类
  await prisma.channelCategory.delete({
    where: { id: categoryId },
  });

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CATEGORY_DELETE,
    d: { categoryId, guildId: category.guildId },
  });

  return { success: true, categoryId, guildId: category.guildId };
});

// 批量更新分类排序 (拖拽排序)
server.patch("/api/guilds/:guildId/categories/positions", async (request, reply) => {
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

  const { categories } = (request.body || {}) as ReorderCategoriesDTO;
  if (!Array.isArray(categories)) {
    return reply.status(400).send({ error: "参数格式错误" });
  }

  await prisma.$transaction(
    categories.map((cat) =>
      prisma.channelCategory.update({
        where: { id: cat.id },
        data: { position: cat.position },
      }),
    ),
  );

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CATEGORY_POSITIONS_UPDATE,
    d: { guildId, categories },
  });

  return { success: true, categories };
});

// 批量更新频道排序与所属分类 (拖拽移动与排序)
server.patch("/api/guilds/:guildId/channels/positions", async (request, reply) => {
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

  const { channels } = (request.body || {}) as ReorderChannelsDTO;
  if (!Array.isArray(channels)) {
    return reply.status(400).send({ error: "参数格式错误" });
  }

  await prisma.$transaction(
    channels.map((ch) =>
      prisma.channel.update({
        where: { id: ch.id },
        data: {
          position: ch.position,
          ...(ch.parentId !== undefined ? { parentId: ch.parentId } : {}),
        },
      }),
    ),
  );

  gatewayManager.broadcast({
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CHANNEL_POSITIONS_UPDATE,
    d: { guildId, channels },
  });

  return { success: true, channels };
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

    const canManage = await permissionService.canManageMember(
      user.id,
      targetUserId,
      guildId,
    );
    if (!canManage) {
      return reply
        .status(403)
        .send({ error: "无权踢出该成员（对方职级高于或等同于自身）" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    await prisma.guildMember.deleteMany({
      where: { guildId, userId: targetUserId },
    });

    await auditLogService.logAction({
      guildId,
      userId: user.id,
      action: AuditLogAction.MEMBER_KICK,
      targetId: targetUserId,
      targetName: targetUser?.username || targetUserId,
      reason: (request.body as any)?.reason,
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

// 触发频道打字状态 (Typing Indicator - 对齐 Discord REST 规范)
server.post("/api/channels/:channelId/typing", async (request, reply) => {
  const { channelId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, avatarUrl: true },
      })
    : await prisma.user.findFirst({
        select: { id: true, username: true, avatarUrl: true },
      });

  if (!user) {
    return reply.status(401).send({ error: "需要登录后操作" });
  }

  gatewayManager.broadcastTyping(channelId, user);
  return reply.status(204).send();
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
    return reply
      .status(404)
      .send({ error: "目标用户尚未发布端到端加密公钥束" });
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
// 4.9 WebRTC STUN/TURN 动态穿透中继凭据分发
// ==========================================

server.get("/api/network/ice-servers", async () => {
  const turnHost =
    process.env.COTURN_HOST || process.env.TURN_HOST || "127.0.0.1";
  const turnPort =
    process.env.COTURN_PORT || process.env.TURN_PORT || "3478";
  const turnUser =
    process.env.COTURN_USER || process.env.TURN_USER || "tescorduser";
  const turnPass =
    process.env.COTURN_PASSWORD || process.env.TURN_PASSWORD || "tescordpass";

  return {
    iceServers: [
      // 1. Cloudflare 高可用全球双栈 IPv4 / IPv6 STUN
      { urls: "stun:stun.cloudflare.com:3478" },
      // 2. 国内主流高可用 STUN
      { urls: "stun:stun.qq.com:3478" },
      { urls: "stun:stun.miwifi.com:8443" },
      { urls: "stun:stun.chat.bilibili.com:3478" },
      // 3. 本地私有化 / 云端 Coturn STUN & TURN (UDP/TCP 双协议，解决对称 NAT 无法打洞问题)
      { urls: `stun:${turnHost}:${turnPort}` },
      {
        urls: [
          `turn:${turnHost}:${turnPort}?transport=udp`,
          `turn:${turnHost}:${turnPort}?transport=tcp`,
        ],
        username: turnUser,
        credential: turnPass,
      },
    ],
    turnActive: true,
  };
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

  // 鉴权校验：如果提供了身份凭据，校验请求用户是否与 identity 相符
  const reqUserId = await getUserIdFromRequest(request);
  if (reqUserId && reqUserId !== String(body.identity)) {
    return reply.status(403).send({ error: "无权为其他用户签发语音令牌" });
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

    // 历史服务器向下兼容自动补齐 @everyone 基础角色
    const existingGuilds = await prisma.guild.findMany({
      select: { id: true },
    });
    for (const g of existingGuilds) {
      await permissionService.ensureEveryoneRole(g.id);
    }

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
