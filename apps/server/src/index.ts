import "./env.js";

import fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyJwt from "@fastify/jwt";
import path from "path";
import fs from "fs";
import { createHmac, randomBytes } from "crypto";
import { config } from "dotenv";
import { prisma, seedInitialData } from "./db.js";
import { AuthFailure, AuthService } from "./services/auth.service.js";
import { RelationshipService } from "./services/relationship.service.js";
import { gatewayManager } from "./gateway.js";
import { cacheStore } from "./cache.js";
import { generateLiveKitToken, getWebhookReceiver } from "./livekit.js";
import { storageService } from "./services/storage.service.js";
import { permissionService } from "./services/permission.service.js";
import { auditLogService } from "./services/audit-log.service.js";
import { e2eeService } from "./services/e2ee.service.js";
import { adminService } from "./services/admin.service.js";
import { dmService } from "./services/dm.service.js";
import { dmCallService } from "./services/dm-call.service.js";
import { registrationInviteService } from "./services/registration-invite.service.js";
import { cloudflareRealtimeService } from "./services/cloudflare-realtime.service.js";
import type {
  CfCallsPublishTrackRequest,
  CfCallsSubscribeTrackRequest,
  CfCallsRenegotiateRequest,
  CfCallsCloseTracksRequest,
  CfCallsUnsubscribeRequest,
  CfStreamWatchRequest,
  LiveKitTokenRequest,
} from "@tescord/types";

import {
  CreateRegistrationInviteDTO,
  GatewayOpCode,
  GatewayEvents,
  LoginDTO,
  Message,
  RegisterDTO,
  CheckEmailDTO,
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
  AttachmentAccessRequest,
  AttachmentAccessResponse,
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
  AdminUpdateUserDTO,
  SystemBroadcastDTO,
  SystemSettingsDTO,
  CreateDMDTO,
  MarkDMReadDTO,
  RegisterDeviceKeyDTO,
  ErrorCode,
  SupportedLocale,
  DiscardGuildIconUploadDTO,
} from "@tescord/types";

config();

export function sendApiError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode | string,
  message: string,
  details?: Record<string, any>,
) {
  return reply.status(status).send({
    code,
    error: message,
    ...(details ? { details } : {}),
  });
}

const server = fastify({
  logger: process.env.NODE_ENV === "development",
  bodyLimit: 50 * 1024 * 1024,
});

server.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, defaultDone) => {
    if (!body || (typeof body === "string" && body.trim().length === 0)) {
      defaultDone(null, {});
      return;
    }
    try {
      const json = JSON.parse(body as string);
      defaultDone(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      defaultDone(err, undefined);
    }
  },
);

const requestWindows = new Map<string, { startedAt: number; count: number }>();
server.addHook("onRequest", async (request, reply) => {
  if (process.env.IS_E2E === "true") return;
  const path = request.url.split("?", 1)[0];
  const rule =
    path === "/api/auth/login" || path === "/api/auth/register"
      ? { name: "auth", limit: 10, windowMs: 60_000 }
      : path.includes("/call-token")
        ? { name: "call", limit: 20, windowMs: 60_000 }
        : path === "/api/attachments/access"
          ? { name: "attachment-access", limit: 120, windowMs: 60_000 }
          : path.startsWith("/api/attachments/")
            ? { name: "upload", limit: 40, windowMs: 60_000 }
            : null;
  if (!rule) return;
  const key = `${rule.name}:${request.ip}`;
  const now = Date.now();
  const current = requestWindows.get(key);
  const window =
    !current || now - current.startedAt >= rule.windowMs
      ? { startedAt: now, count: 1 }
      : { ...current, count: current.count + 1 };
  requestWindows.set(key, window);
  if (window.count > rule.limit) {
    reply.header(
      "Retry-After",
      Math.ceil((rule.windowMs - (now - window.startedAt)) / 1000),
    );
    return reply.status(429).send({ error: "请求过于频繁，请稍后重试" });
  }
});
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, value] of requestWindows)
    if (value.startedAt < cutoff) requestWindows.delete(key);
}, 5 * 60_000).unref();

// 0. 注册基础链路安全与加固响应头 (HSTS, CSP, X-Content-Type-Options, etc.)
const securityHeaders = buildSecurityHeaders();
server.addHook("onSend", async (request, reply) => {
  for (const [headerKey, headerVal] of Object.entries(securityHeaders)) {
    reply.header(headerKey, headerVal);
  }
});

// 1. 注册跨域插件
await server.register(cors, {
  origin(origin, callback) {
    const allowed = new Set(
      (process.env.CORS_ORIGINS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const isLocalDevelopment =
      process.env.NODE_ENV !== "production" &&
      Boolean(
        origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin),
      );
    if (
      !origin ||
      allowed.has(origin) ||
      isLocalDevelopment ||
      ((origin === "null" || origin === "file://") &&
        process.env.ALLOW_FILE_ORIGIN === "true")
    ) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

// 2. 注册二进制上传 Content-Type 解析器 (用于本地直传附件，支持任意音视频、图片、压缩包及文档)
server.addContentTypeParser(
  "text/plain",
  { parseAs: "buffer" },
  (req, body, done) => {
    done(null, body);
  },
);
server.addContentTypeParser(
  /^application\/(?!json|webhook\+json).+|^image\/.+|^audio\/.+|^video\/.+|^font\/.+|^multipart\/.+/,
  { parseAs: "buffer" },
  (req, body, done) => {
    done(null, body);
  },
);

// 3. 注册 LiveKit Webhook 专用的 Content-Type 解析器 (保留原始文本以供 WebhookReceiver 校验签名)
server.addContentTypeParser(
  "application/webhook+json",
  { parseAs: "string" },
  (req, body, done) => {
    done(null, body);
  },
);

// 4. 注册 JWT 鉴权插件
const jwtSecret =
  process.env.JWT_SECRET || "tescord_fallback_jwt_secret_dev_2026";
await server.register(fastifyJwt, {
  secret: jwtSecret,
});
gatewayManager.setTokenVerifier(async (token) =>
  server.jwt.verify<Record<string, unknown>>(token),
);

// 5. 注册 WebSocket 插件
await server.register(websocket);

// 6. 注册鉴权服务与好友服务
const authService = new AuthService(server);
const relationshipService = new RelationshipService(server, authService);

// 辅助函数：从请求提取用户 ID
async function getUserIdFromRequest(
  request: FastifyRequest,
): Promise<string | null> {
  try {
    const decoded: any = request.user || (await request.jwtVerify());
    return decoded?.sub || null;
  } catch {
    return null;
  }
}

// 7. 鉴权守卫中间件
server.decorate(
  "authenticate",
  async (request: FastifyRequest, reply: FastifyReply) => {
    let claims: { sub?: string; sessionVersion?: number; sessionId?: string };
    try {
      await request.jwtVerify();
      claims = request.user as {
        sub?: string;
        sessionVersion?: number;
        sessionId?: string;
      };
      if (!claims?.sub) throw new Error("missing subject");
    } catch {
      return reply.status(401).send({ error: "认证失效或未提供有效令牌" });
    }
    try {
      const user = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user || user.isBanned) {
        return reply.status(401).send({ error: "会话已失效，请重新登录" });
      }
      const dbSessionVersion = Number(user.sessionVersion ?? 0);
      const tokenSessionVersion = Number(claims.sessionVersion ?? 0);
      if (dbSessionVersion !== tokenSessionVersion) {
        return reply.status(401).send({ error: "会话已失效，请重新登录" });
      }
      const session = claims.sessionId
        ? await prisma.refreshToken.findUnique({
            where: { id: claims.sessionId },
          })
        : null;
      if (
        !session ||
        session.userId !== user.id ||
        session.expiresAt <= new Date()
      ) {
        return reply.status(401).send({
          error: "会话已撤销，请重新登录",
          code: "AUTH_SESSION_REVOKED",
        });
      }
    } catch (err) {
      request.log.error({ err }, "session validation failed");
      return reply.status(503).send({
        error: "会话服务暂时不可用",
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    }
  },
);

const publicApiPaths = new Set([
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/registration-status",
  "/api/auth/check-email",
  "/api/discovery/guilds",
  "/api/livekit/webhook",
]);

server.addHook("preHandler", async (request, reply) => {
  if (request.method === "OPTIONS" || !request.url.startsWith("/api/")) return;
  const pathOnly = request.url.split("?", 1)[0];
  const isPublicInviteQuery =
    request.method === "GET" && pathOnly.startsWith("/api/invites/");
  if (publicApiPaths.has(pathOnly) || isPublicInviteQuery) return;

  await (server as any).authenticate(request, reply);
  if (reply.sent) return;

  const claims = request.user as { sub?: string };
  const user = claims?.sub
    ? await prisma.user.findUnique({ where: { id: claims.sub } })
    : null;
  if (!user) return reply.status(401).send({ error: "会话已失效" });
  if (
    user.mustChangePassword &&
    pathOnly !== "/api/auth/me" &&
    pathOnly !== "/api/auth/change-password"
  ) {
    return reply.status(428).send({
      error: "必须先修改临时密码",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }

  const maintenance = await prisma.systemSetting.findUnique({
    where: { key: "maintenance_mode" },
  });
  const maintenanceAllowed =
    user.role === "SUPER_ADMIN" ||
    pathOnly === "/api/auth/me" ||
    pathOnly === "/api/users/@me" ||
    pathOnly === "/api/auth/change-password";
  if (gatewayManager.isMaintenanceActive && !maintenanceAllowed) {
    return reply.status(503).send({
      error: "系统正在维护，普通业务已暂停",
      code: "MAINTENANCE_MODE",
    });
  }
});

server.decorate(
  "requireSuperAdmin",
  async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const userPayload = request.user as any;
      if (!userPayload || !userPayload.sub) {
        return reply.status(401).send({ error: "认证失效或未提供有效令牌" });
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: userPayload.sub },
      });

      if (!dbUser || dbUser.isBanned || dbUser.role !== "SUPER_ADMIN") {
        return reply.status(403).send({ error: "需要超级管理员权限" });
      }
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

// 获取公开注册状态与策略
server.get("/api/auth/registration-status", async () => {
  return await authService.getRegistrationStatus();
});

// 检查邮箱是否存在
server.post("/api/auth/check-email", async (request, reply) => {
  try {
    const body = request.body as CheckEmailDTO;
    if (!body?.email || typeof body.email !== "string" || !body.email.trim()) {
      return reply.status(400).send({ error: "请提供有效的邮箱地址" });
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(body.email.trim())) {
      return reply.status(400).send({ error: "请输入有效的邮箱地址" });
    }
    const result = await authService.checkEmail(body.email);
    return result;
  } catch (err: any) {
    return reply.status(400).send({ error: err.message || "检测邮箱失败" });
  }
});

// 注册
server.post("/api/auth/register", async (request, reply) => {
  try {
    const body = request.body as RegisterDTO;
    if (
      !body?.email ||
      !body?.password ||
      (!body?.username && !body?.nickname)
    ) {
      return reply
        .status(400)
        .send({ error: "请完整填写昵称/用户名、邮箱和密码" });
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
    if (err instanceof AuthFailure)
      return reply.status(401).send({ error: err.message, code: err.code });
    request.log.error({ err }, "auth login failed");
    return reply
      .status(503)
      .send({ error: "登录服务暂时不可用", code: "AUTH_SERVICE_UNAVAILABLE" });
  }
});

// 双令牌无感刷新
server.post("/api/auth/refresh", async (request, reply) => {
  try {
    const { refreshToken } = (request.body || {}) as { refreshToken?: string };
    if (!refreshToken) {
      return reply.status(400).send({ error: "未提供 refreshToken" });
    }
    const result = await authService.refresh(refreshToken);
    return {
      ...result,
      token: result.accessToken,
    };
  } catch (err: any) {
    if (err instanceof AuthFailure) {
      return reply.status(401).send({ error: err.message, code: err.code });
    }
    request.log.error({ err }, "auth refresh failed");
    return reply
      .status(503)
      .send({ error: "会话服务暂时不可用", code: "AUTH_SERVICE_UNAVAILABLE" });
  }
});

server.post("/api/auth/logout", async (request, reply) => {
  const body = (request.body || {}) as { refreshToken?: string };
  if (typeof body.refreshToken !== "string")
    return reply.status(400).send({ error: "缺少会话凭据" });
  await authService.revokeSession(body.refreshToken);
  return reply.status(204).send();
});

server.post(
  "/api/auth/change-password",
  { preValidation: [(server as any).authenticate] },
  async (request, reply) => {
    const body = (request.body || {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!body.currentPassword || !body.newPassword) {
      return reply.status(400).send({ error: "请提供当前密码和新密码" });
    }
    try {
      await authService.changePassword(
        (request.user as any).sub,
        body.currentPassword,
        body.newPassword,
      );
      return { success: true, reauthenticate: true };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "修改密码失败",
      });
    }
  },
);

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
      return reply
        .status(401)
        .send({ error: "用户不存在或会话已失效", code: "USER_NOT_FOUND" });
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

      // 若修改了在线状态、个性签名或活动展示设置，同步更新瞬时在线表并广播专属 PRESENCE_UPDATE
      if (
        body.status ||
        body.customStatus !== undefined ||
        body.showActivity !== undefined
      ) {
        const existingPresence = await cacheStore.getUserPresence(userId);
        const presence = {
          userId,
          status: updated.status,
          customStatus: updated.customStatus,
          activities: existingPresence?.activities,
          clientStatus: existingPresence?.clientStatus,
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
        userNotes:
          incomingSettings.userNotes !== undefined
            ? incomingSettings.userNotes
            : existingSettings.userNotes || {},
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

// 获取当前用户的所有备注字典 (GET /api/users/@me/notes)
server.get(
  "/api/users/@me/notes",
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
    if (!user || !user.settings) {
      return {};
    }
    try {
      const settings = JSON.parse(user.settings);
      return settings.userNotes || {};
    } catch {
      return {};
    }
  },
);

// 更新对某个特定用户的备注 (PUT /api/users/@me/notes/:targetUserId)
server.put(
  "/api/users/@me/notes/:targetUserId",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    const { targetUserId } = request.params as { targetUserId: string };
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    if (!targetUserId) {
      return reply.status(400).send({ error: "目标用户ID缺失" });
    }

    try {
      const { note } = (request.body as { note?: string }) || {};
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { settings: true },
      });
      if (!user) {
        return reply.status(404).send({ error: "用户不存在" });
      }

      let settings: Record<string, any> = {};
      if (user.settings) {
        try {
          settings = JSON.parse(user.settings);
        } catch {}
      }

      const userNotes = { ...(settings.userNotes || {}) };
      const trimmedNote = typeof note === "string" ? note.trim() : "";
      if (trimmedNote) {
        userNotes[targetUserId] = trimmedNote;
      } else {
        delete userNotes[targetUserId];
      }

      settings.userNotes = userNotes;

      await prisma.user.update({
        where: { id: userId },
        data: { settings: JSON.stringify(settings) },
      });

      return reply.status(200).send({
        success: true,
        targetUserId,
        note: trimmedNote,
      });
    } catch (err: any) {
      return reply
        .status(500)
        .send({ error: err.message || "更新用户备注失败" });
    }
  },
);

// ==========================================
// 1.3 好友关系与好友申请 API (Relationships & Friends)
// ==========================================

// 获取当前用户的所有关系 (好友、待处理申请、屏蔽)
server.get(
  "/api/users/@me/relationships",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    try {
      return await relationshipService.getRelationships(userId);
    } catch (err: any) {
      return reply
        .status(400)
        .send({ error: err.message || "获取好友列表失败" });
    }
  },
);

// 发送好友申请 (Body: { identifier: string })
server.post(
  "/api/users/@me/relationships",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    try {
      const { identifier } = (request.body as { identifier?: string }) || {};
      if (!identifier || typeof identifier !== "string") {
        return reply
          .status(400)
          .send({ error: "请输入完整的用户标识，例如 用户名#12345" });
      }
      const relationship = await relationshipService.sendFriendRequest(
        userId,
        identifier,
      );
      return reply.status(201).send(relationship);
    } catch (err: any) {
      const status = err.message.includes("找不到") ? 404 : 400;
      return reply
        .status(status)
        .send({ error: err.message || "发送好友申请失败" });
    }
  },
);

// 接受好友申请 (PUT /api/users/@me/relationships/:targetUserId)
server.put(
  "/api/users/@me/relationships/:targetUserId",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    const { targetUserId } = request.params as { targetUserId: string };
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    try {
      const relationship = await relationshipService.acceptFriendRequest(
        userId,
        targetUserId,
      );
      return relationship;
    } catch (err: any) {
      return reply
        .status(400)
        .send({ error: err.message || "接受好友申请失败" });
    }
  },
);

// 解除好友 / 拒绝申请 / 取消申请 (DELETE /api/users/@me/relationships/:targetUserId)
server.delete(
  "/api/users/@me/relationships/:targetUserId",
  { preValidation: [(server as any).authenticate] },
  async (request: any, reply) => {
    const userId = request.user?.sub;
    const { targetUserId } = request.params as { targetUserId: string };
    if (!userId) {
      return reply.status(401).send({ error: "无效用户" });
    }
    try {
      return await relationshipService.removeRelationship(userId, targetUserId);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || "操作失败" });
    }
  },
);

// ==========================================
// 2. 公会与频道 API (Guilds & Channels)
// ==========================================

server.get("/api/guilds", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return [];
  }

  const guilds = await prisma.guild.findMany({
    where: {
      members: {
        some: { userId },
      },
    },
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
      isPublic: g.isPublic,
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
        voiceMode: ((c as any).voiceMode || "sfu") as any,
        streamMode: ((c as any).streamMode || "sfu") as any,
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

server.get("/api/guilds/:guildId/channels", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const isMember = await prisma.guildMember.findUnique({
    where: { guildId_userId: { guildId, userId } },
  });
  if (!isMember) {
    return reply
      .status(403)
      .send({ error: "您尚未加入该服务器，无权查看频道列表" });
  }

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
    voiceMode: ((c as any).voiceMode || "sfu") as any,
    streamMode: ((c as any).streamMode || "sfu") as any,
    createdAt: c.createdAt.toISOString(),
  }));
});

// 获取公开服务器发现列表 (Server Discovery)
server.get("/api/discovery/guilds", async (request) => {
  const userId = await getUserIdFromRequest(request);
  const guilds = await prisma.guild.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      iconUrl: true,
      description: true,
      ownerId: true,
      createdAt: true,
      _count: {
        select: { members: true },
      },
      members: userId
        ? {
            where: { userId },
            select: { userId: true },
          }
        : false,
    },
    orderBy: { createdAt: "desc" },
  });

  return guilds.map((g: any) => ({
    id: g.id,
    name: g.name,
    iconUrl: g.iconUrl,
    description: g.description,
    ownerId: g.ownerId,
    memberCount: g._count.members,
    isJoined: userId ? Boolean(g.members && g.members.length > 0) : false,
    createdAt: g.createdAt.toISOString(),
  }));
});

// 加入公开服务器 (Join Public Guild)
server.post("/api/guilds/:guildId/join", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) {
    return reply.status(401).send({ error: "需要登录后加入公会" });
  }

  const { guildId } = request.params as { guildId: string };
  const guild = await prisma.guild.findUnique({
    where: { id: guildId },
    include: {
      categories: { orderBy: { position: "asc" } },
      channels: { orderBy: { position: "asc" } },
      members: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              status: true,
              customStatus: true,
              bio: true,
              createdAt: true,
            },
          },
        },
      },
      roles: { orderBy: { position: "asc" } },
    },
  });

  if (!guild) {
    return reply.status(404).send({ error: "服务器不存在" });
  }

  if (!guild.isPublic) {
    return reply
      .status(403)
      .send({ error: "该服务器为私有服务器，需要专属邀请码加入" });
  }

  // 检查是否已被封禁
  const isBanned = await prisma.ban.findFirst({
    where: { guildId, userId: user.id },
  });
  if (isBanned) {
    return reply.status(403).send({ error: "您已被该服务器封禁，无法加入" });
  }

  // 检查是否已经是成员
  let member = guild.members.find((m) => m.userId === user.id);
  if (!member) {
    const everyoneRole = guild.roles.find((r) => r.name === "@everyone");
    const roleIds = everyoneRole ? [everyoneRole.id] : [];
    const createdMember = await prisma.guildMember.create({
      data: {
        guildId,
        userId: user.id,
        nickname: user.username,
        roleIds: JSON.stringify(roleIds),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            status: true,
            customStatus: true,
            bio: true,
            createdAt: true,
          },
        },
      },
    });

    member = createdMember;
    guild.members.push(createdMember);

    // 局域组播 GUILD_MEMBER_ADD 给公会内其他在线成员
    gatewayManager.broadcastToGuild(
      guildId,
      {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.GUILD_MEMBER_ADD,
        d: {
          guildId,
          member: {
            userId: member.userId,
            guildId: member.guildId,
            nickname: member.nickname,
            roleIds,
            roles: everyoneRole
              ? [
                  {
                    id: everyoneRole.id,
                    guildId: everyoneRole.guildId,
                    name: everyoneRole.name,
                    color: everyoneRole.color,
                    hoist: everyoneRole.hoist,
                    position: everyoneRole.position,
                    permissions: everyoneRole.permissions,
                    isDefault: everyoneRole.isDefault,
                    createdAt: everyoneRole.createdAt.toISOString(),
                  },
                ]
              : [],
            joinedAt: member.joinedAt.toISOString(),
            user: member.user
              ? {
                  ...member.user,
                  status: "ONLINE",
                  createdAt: member.user.createdAt.toISOString(),
                }
              : undefined,
          },
        },
      },
      user.id,
    );
  }

  // 格式化公会信息并单推 GUILD_CREATE 给加入者
  const allMemberIds = Array.from(new Set(guild.members.map((m) => m.userId)));
  const presences = await cacheStore.batchGetPresences(allMemberIds);
  const roleMap = new Map(guild.roles.map((r) => [r.id, r]));

  const formattedGuild = {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconUrl,
    description: guild.description,
    isPublic: guild.isPublic,
    ownerId: guild.ownerId,
    createdAt: guild.createdAt.toISOString(),
    updatedAt: guild.updatedAt.toISOString(),
    categories: guild.categories.map((cat) => ({
      id: cat.id,
      guildId: cat.guildId,
      name: cat.name,
      position: cat.position,
      createdAt: cat.createdAt.toISOString(),
      updatedAt: cat.updatedAt.toISOString(),
    })),
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
      voiceMode: ((c as any).voiceMode || "sfu") as any,
      streamMode: ((c as any).streamMode || "sfu") as any,
      createdAt: c.createdAt.toISOString(),
    })),
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
    members: guild.members.map((m) => {
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

  gatewayManager.sendToUser(user.id, {
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.GUILD_CREATE,
    d: formattedGuild,
  });

  return formattedGuild;
});

// 创建公会 (Server)
server.post("/api/guilds", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  let owner = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!owner) {
    return sendApiError(
      reply,
      401,
      ErrorCode.UNAUTHORIZED,
      "创建服务器需要有效用户身份",
    );
  }

  const { name, iconUrl } = (request.body || {}) as CreateGuildDTO;
  if (!name || !name.trim()) {
    return sendApiError(
      reply,
      400,
      ErrorCode.GUILD_NAME_REQUIRED,
      "服务器名称不能为空",
    );
  }

  // 根据客户端 locale 或 Accept-Language 决定默认频道与分类文案
  const rawLocale =
    (request.body as any)?.locale ||
    (request.headers["accept-language"] as string) ||
    "zh-CN";
  let defaultLocale: SupportedLocale = "zh-CN";
  const lowerLocale = rawLocale.toLowerCase();
  if (lowerLocale.startsWith("ja")) {
    defaultLocale = "ja-JP";
  } else if (lowerLocale.startsWith("en")) {
    defaultLocale = "en-US";
  } else if (
    lowerLocale.startsWith("zh-hk") ||
    lowerLocale.startsWith("zh-mo") ||
    lowerLocale.includes("hk") ||
    lowerLocale.includes("mo")
  ) {
    defaultLocale = "zh-HK";
  } else if (
    lowerLocale.startsWith("zh-tw") ||
    lowerLocale.includes("tw") ||
    lowerLocale.includes("hant")
  ) {
    defaultLocale = "zh-TW";
  }

  const defaultI18nLabels = {
    "zh-CN": {
      textCat: "文字频道",
      voiceCat: "语音频道",
      textChannel: "常规",
      textTopic: "日常聊天交流",
      voiceChannel: "日常闲聊",
    },
    "zh-TW": {
      textCat: "文字頻道",
      voiceCat: "語音頻道",
      textChannel: "一般",
      textTopic: "日常聊天交流",
      voiceChannel: "日常閒聊",
    },
    "zh-HK": {
      textCat: "文字頻道",
      voiceCat: "語音頻道",
      textChannel: "一般",
      textTopic: "日常聊天交流",
      voiceChannel: "日常閒聊",
    },
    "en-US": {
      textCat: "Text Channels",
      voiceCat: "Voice Channels",
      textChannel: "general",
      textTopic: "General chat and discussion",
      voiceChannel: "Lounge",
    },
    "ja-JP": {
      textCat: "テキストチャンネル",
      voiceCat: "ボイスチャンネル",
      textChannel: "一般",
      textTopic: "日常のチャット",
      voiceChannel: "雑談",
    },
  }[defaultLocale];

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
      isPublic: Boolean((request.body as any)?.isPublic),
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
      name: defaultI18nLabels.textCat,
      position: 0,
    },
  });

  const voiceCat = await prisma.channelCategory.create({
    data: {
      guildId: guild.id,
      name: defaultI18nLabels.voiceCat,
      position: 1,
    },
  });

  const textChannel = await prisma.channel.create({
    data: {
      guildId: guild.id,
      parentId: textCat.id,
      name: defaultI18nLabels.textChannel,
      type: "TEXT",
      topic: defaultI18nLabels.textTopic,
      position: 0,
    },
  });

  const voiceChannel = await prisma.channel.create({
    data: {
      guildId: guild.id,
      parentId: voiceCat.id,
      name: defaultI18nLabels.voiceChannel,
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
    isPublic: guild.isPublic,
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
        voiceMode: ((textChannel as any).voiceMode || "sfu") as any,
        streamMode: ((textChannel as any).streamMode || "sfu") as any,
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
        voiceMode: ((voiceChannel as any).voiceMode || "sfu") as any,
        streamMode: ((voiceChannel as any).streamMode || "sfu") as any,
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

  gatewayManager.sendToUser(owner.id, {
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
  let claimedNewIcon = false;
  if (
    body.iconUrl?.includes("/public-assets/") &&
    body.iconUrl !== guild.iconUrl &&
    !(claimedNewIcon = storageService.claimPublicAsset(
      user.id,
      guildId,
      body.iconUrl,
    ))
  ) {
    return reply.status(403).send({ error: "服务器图标上传授权无效" });
  }
  let updated;
  try {
    updated = await prisma.guild.update({
      where: { id: guildId },
      data: {
        name: body.name !== undefined ? body.name.trim() : undefined,
        iconUrl: body.iconUrl !== undefined ? body.iconUrl : undefined,
        description:
          body.description !== undefined ? body.description : undefined,
        isPublic:
          typeof (body as any).isPublic === "boolean"
            ? (body as any).isPublic
            : undefined,
      },
    });
  } catch (error) {
    if (claimedNewIcon && body.iconUrl) {
      storageService.releasePublicAssetClaim(user.id, guildId, body.iconUrl);
    }
    throw error;
  }
  if (
    body.iconUrl !== undefined &&
    guild.iconUrl &&
    guild.iconUrl !== updated.iconUrl &&
    guild.iconUrl.includes("/public-assets/")
  ) {
    void storageService
      .removePublicAsset(guild.iconUrl)
      .catch((error) =>
        server.log.warn(
          { error, guildId, iconUrl: guild.iconUrl },
          "Failed to remove replaced guild icon",
        ),
      );
  }

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
      isPublic: { old: guild.isPublic, new: updated.isPublic },
    },
  });

  const payload = {
    id: updated.id,
    name: updated.name,
    iconUrl: updated.iconUrl,
    description: updated.description,
    isPublic: updated.isPublic,
    ownerId: updated.ownerId,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };

  gatewayManager.broadcastToGuild(guildId, {
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

  const memberIds = await prisma.guildMember.findMany({
    where: { guildId },
    select: { userId: true },
  });
  await prisma.guild.delete({ where: { id: guildId } });

  for (const member of memberIds)
    gatewayManager.sendToUser(member.userId, {
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
  const requestedPermissions = body.permissions ?? 0;
  if (
    !Number.isSafeInteger(requestedPermissions) ||
    requestedPermissions < 0 ||
    (requestedPermissions & ~permissionService.allPermissionBits) !== 0
  ) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "角色权限参数无效",
    );
  }
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) {
    return sendApiError(reply, 404, ErrorCode.GUILD_NOT_FOUND, "服务器不存在");
  }
  const isPrivilegedActor =
    guild.ownerId === user.id || user.role === "SUPER_ADMIN";
  if (!isPrivilegedActor) {
    const actorPermissions =
      (await permissionService.getGuildPermissionBits(user.id, guildId)) ?? 0;
    if (
      (requestedPermissions & PermissionFlags.ADMINISTRATOR) !== 0 ||
      (requestedPermissions & ~actorPermissions) !== 0
    ) {
      return sendApiError(
        reply,
        403,
        ErrorCode.GUILD_PERMISSION_DENIED,
        "不能创建包含自身未持有权限或管理员权限的角色",
      );
    }
  }
  // 新建角色 position 分配：置于 position 1（@everyone 0 之上），现有 >= 1 的角色顺延，确保创建者最高角色永远大于新角色
  const role = await prisma.$transaction(async (transaction) => {
    await transaction.role.updateMany({
      where: { guildId, position: { gte: 1 }, isDefault: false },
      data: { position: { increment: 1 } },
    });
    return transaction.role.create({
      data: {
        guildId,
        name: body.name ? body.name.trim() : "新身份组",
        color: body.color || null,
        hoist: body.hoist || false,
        position: 1,
        permissions: requestedPermissions,
        isDefault: false,
      },
    });
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
  if (!canManage) {
    return reply
      .status(403)
      .send({ error: "无权修改该角色（权限不足或角色层级高于/等同于自身）" });
  }

  const body = (request.body || {}) as UpdateRoleDTO;
  const isEveryone = role.isDefault || role.name === "@everyone";
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  const isPrivilegedActor =
    guild?.ownerId === user.id || user.role === "SUPER_ADMIN";
  if (body.permissions !== undefined) {
    if (
      !Number.isSafeInteger(body.permissions) ||
      body.permissions < 0 ||
      (body.permissions & ~permissionService.allPermissionBits) !== 0
    ) {
      return sendApiError(
        reply,
        400,
        ErrorCode.INVALID_PARAMS,
        "角色权限参数无效",
      );
    }
    if (!isPrivilegedActor) {
      const actorPermissions =
        (await permissionService.getGuildPermissionBits(user.id, guildId)) ?? 0;
      if (
        (body.permissions & PermissionFlags.ADMINISTRATOR) !== 0 ||
        (body.permissions & ~actorPermissions) !== 0
      ) {
        return sendApiError(
          reply,
          403,
          ErrorCode.GUILD_PERMISSION_DENIED,
          "不能授予自身未持有的权限或管理员权限",
        );
      }
    }
  }
  if (
    !isPrivilegedActor &&
    body.position !== undefined &&
    body.position >=
      (await permissionService.getMemberHighestRolePosition(user.id, guildId))
  ) {
    return sendApiError(
      reply,
      403,
      ErrorCode.GUILD_ROLE_HIERARCHY_TOO_LOW,
      "不能将角色提升到等于或高于自身的层级",
    );
  }

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
        const actorPermissions =
          (await permissionService.getGuildPermissionBits(user.id, guildId)) ??
          0;
        for (const r of assignedRoles) {
          if (
            r.position >= actorHighestPos ||
            (r.permissions & PermissionFlags.ADMINISTRATOR) !== 0 ||
            (r.permissions & ~actorPermissions) !== 0
          ) {
            return sendApiError(
              reply,
              403,
              ErrorCode.GUILD_ROLE_HIERARCHY_TOO_LOW,
              `无法赋予层级过高或包含自身未持有权限的角色: ${r.name}`,
            );
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

// 获取当前用户在该公会的有效活跃邀请链接 (用于复用，避免每次打开弹窗都新建)
server.get("/api/guilds/:guildId/invites/active", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) {
    return sendApiError(reply, 401, ErrorCode.UNAUTHORIZED, "需要登录后操作");
  }

  const canInvite = await permissionService.hasGuildPermission(
    user.id,
    guildId,
    PermissionFlags.CREATE_INVITE,
  );
  if (!canInvite) {
    return sendApiError(
      reply,
      403,
      ErrorCode.GUILD_PERMISSION_DENIED,
      "您没有在该服务器创建邀请码的权限",
    );
  }

  const now = new Date();
  const existingInvites = await prisma.invite.findMany({
    where: {
      guildId,
      inviterId: user.id,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });

  const validInvite = existingInvites.find(
    (inv) => inv.maxUses === 0 || inv.uses < inv.maxUses,
  );

  if (!validInvite) {
    return { invite: null };
  }

  return {
    invite: {
      code: validInvite.code,
      guildId: validInvite.guildId,
      inviterId: validInvite.inviterId,
      maxUses: validInvite.maxUses,
      uses: validInvite.uses,
      expiresAt: validInvite.expiresAt
        ? validInvite.expiresAt.toISOString()
        : null,
      createdAt: validInvite.createdAt.toISOString(),
    },
  };
});

// 生成专属邀请码 (Invite)
server.post("/api/guilds/:guildId/invites", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
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

  // 若未显式指定 forceNew 为 true，优先复用已存在的未过期且未用尽的有效邀请码
  if (!body.forceNew) {
    const now = new Date();
    const existingInvites = await prisma.invite.findMany({
      where: {
        guildId,
        inviterId: user.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
    const validInvite = existingInvites.find(
      (inv) => inv.maxUses === 0 || inv.uses < inv.maxUses,
    );
    if (validInvite) {
      return {
        code: validInvite.code,
        guildId: validInvite.guildId,
        inviterId: validInvite.inviterId,
        maxUses: validInvite.maxUses,
        uses: validInvite.uses,
        expiresAt: validInvite.expiresAt
          ? validInvite.expiresAt.toISOString()
          : null,
        createdAt: validInvite.createdAt.toISOString(),
      };
    }
  }
  const maxUses = body.maxUses || 0;
  const expiresAt =
    body.maxAge !== undefined
      ? body.maxAge > 0
        ? new Date(Date.now() + body.maxAge * 1000)
        : null
      : body.expiresInHours && body.expiresInHours > 0
        ? new Date(Date.now() + body.expiresInHours * 3600 * 1000)
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

// 获取邀请码详情与服务器概览信息 (用于渲染聊天中的服务器邀请卡片与加入前展示)
server.get("/api/invites/:code", async (request, reply) => {
  const { code } = request.params as any;
  const invite = await prisma.invite.findUnique({
    where: { code },
    include: {
      guild: {
        select: {
          id: true,
          name: true,
          iconUrl: true,
          description: true,
          _count: {
            select: { members: true },
          },
        },
      },
      inviter: {
        select: {
          id: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!invite) {
    return reply.status(404).send({ error: "邀请码不存在或已失效" });
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return reply.status(410).send({ error: "邀请链接已过期" });
  }

  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) {
    return reply.status(410).send({ error: "邀请链接已达最大使用次数" });
  }

  const memberCount = invite.guild._count.members;
  const currentUserId = await getUserIdFromRequest(request);
  let isMember = false;
  if (currentUserId) {
    const existingMember = await prisma.guildMember.findUnique({
      where: {
        guildId_userId: { guildId: invite.guild.id, userId: currentUserId },
      },
    });
    isMember = !!existingMember;
  }

  return {
    code: invite.code,
    guild: {
      id: invite.guild.id,
      name: invite.guild.name,
      iconUrl: invite.guild.iconUrl,
      description: invite.guild.description,
      approximateMemberCount: memberCount,
      approximatePresenceCount: Math.max(1, Math.floor(memberCount * 0.4)),
    },
    inviter: invite.inviter,
    expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    maxUses: invite.maxUses,
    uses: invite.uses,
    isMember,
  };
});

// 通过邀请码加入公会
server.post("/api/invites/:code/join", async (request, reply) => {
  const { code } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
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
    const finalStatus = isOnline
      ? presence.status
      : member.user?.status || "ONLINE";
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
    : null;
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

  const { name, type, topic, parentId, isE2EE, voiceMode, streamMode } =
    (request.body || {}) as CreateChannelDTO;
  if (!name || !name.trim()) {
    return reply.status(400).send({ error: "频道名称不能为空" });
  }

  if (
    voiceMode !== undefined &&
    voiceMode !== "sfu" &&
    voiceMode !== "p2p_mesh"
  ) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "Invalid voiceMode",
      {
        field: "voiceMode",
      },
    );
  }

  if (
    streamMode !== undefined &&
    streamMode !== "sfu" &&
    streamMode !== "p2p_direct" &&
    streamMode !== "p2p_relay"
  ) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "Invalid streamMode",
      {
        field: "streamMode",
      },
    );
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
      voiceMode: voiceMode || "sfu",
      streamMode: streamMode || "sfu",
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
    voiceMode: ((channel as any).voiceMode || "sfu") as any,
    streamMode: ((channel as any).streamMode || "sfu") as any,
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
    : null;
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return reply.status(404).send({ error: "频道不存在" });
  }

  if (!channel.guildId) {
    return reply.status(400).send({ error: "无法在此删除私信频道" });
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
    : null;
  if (!user) {
    return reply.status(401).send({ error: "需要登录" });
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return reply.status(404).send({ error: "频道不存在" });
  }

  if (!channel.guildId) {
    return reply.status(400).send({ error: "无法在此编辑私信频道" });
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

  const { name, topic, parentId, position, voiceMode, streamMode } =
    (request.body || {}) as {
      name?: string;
      topic?: string;
      parentId?: string | null;
      position?: number;
      voiceMode?: "sfu" | "p2p_mesh";
      streamMode?: "sfu" | "p2p_direct" | "p2p_relay";
    };

  if (
    voiceMode !== undefined &&
    voiceMode !== "sfu" &&
    voiceMode !== "p2p_mesh"
  ) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "Invalid voiceMode",
      {
        field: "voiceMode",
      },
    );
  }

  if (
    streamMode !== undefined &&
    streamMode !== "sfu" &&
    streamMode !== "p2p_direct" &&
    streamMode !== "p2p_relay"
  ) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "Invalid streamMode",
      {
        field: "streamMode",
      },
    );
  }

  const updatedChannel = await prisma.channel.update({
    where: { id: channelId },
    data: {
      ...(name ? { name: name.trim().toLowerCase().replace(/\s+/g, "-") } : {}),
      ...(topic !== undefined ? { topic } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(voiceMode !== undefined ? { voiceMode } : {}),
      ...(streamMode !== undefined ? { streamMode } : {}),
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
    voiceMode: ((updatedChannel as any).voiceMode || "sfu") as any,
    streamMode: ((updatedChannel as any).streamMode || "sfu") as any,
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
    : null;
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
    : null;
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
    : null;
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
server.patch(
  "/api/guilds/:guildId/categories/positions",
  async (request, reply) => {
    const { guildId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
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
  },
);

// 批量更新频道排序与所属分类 (拖拽移动与排序)
server.patch(
  "/api/guilds/:guildId/channels/positions",
  async (request, reply) => {
    const { guildId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
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
  },
);

// 退出公会
server.post("/api/guilds/:guildId/leave", async (request, reply) => {
  const { guildId } = request.params as any;
  const userId = await getUserIdFromRequest(request);
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
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
      : null;
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

server.get("/api/channels/:channelId/messages", async (request, reply) => {
  const { channelId } = request.params as any;
  const { limit: queryLimit, before, after } = (request.query || {}) as any;
  const currentUserId = await getUserIdFromRequest(request);
  if (!currentUserId) return reply.status(401).send({ error: "需要登录" });
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { recipients: true },
  });
  if (!channel) return reply.status(404).send({ error: "频道不存在" });
  const canRead = channel.guildId
    ? (await permissionService.hasChannelPermission(
        currentUserId,
        channelId,
        PermissionFlags.VIEW_CHANNEL,
      )) &&
      (await permissionService.hasChannelPermission(
        currentUserId,
        channelId,
        PermissionFlags.READ_MESSAGE_HISTORY,
      ))
    : (channel.type === "DM" || channel.type === "GROUP_DM") &&
      channel.recipients.some(
        (recipient) => recipient.userId === currentUserId,
      );
  if (!canRead) return reply.status(403).send({ error: "无权读取该频道" });
  const attachmentScope = getAttachmentScope(request);

  const take = queryLimit
    ? Math.min(Math.max(parseInt(queryLimit as string, 10) || 50, 1), 100)
    : 100; // 默认拉取最多 100 条消息

  const whereClause: any = { channelId };
  let isDescending = false;

  if (before !== undefined) {
    whereClause.sequence = { lt: parseInt(before as string, 10) };
    isDescending = true;
  } else if (after !== undefined) {
    whereClause.sequence = { gt: parseInt(after as string, 10) };
    isDescending = false;
  } else {
    // 默认拉取最新 100 条
    isDescending = true;
  }

  let messages = await prisma.message.findMany({
    where: whereClause,
    take,
    include: {
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
      attachments: true,
      reactions: true,
    },
    orderBy: isDescending
      ? [{ sequence: "desc" }, { createdAt: "desc" }, { id: "desc" }]
      : [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  if (isDescending) {
    messages = messages.reverse();
  }

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
      include: { author: { select: { username: true, displayName: true } } },
    });
    for (const rm of repliedMessages) {
      replyMap.set(rm.id, {
        id: rm.id,
        authorName: rm.author.displayName || rm.author.username,
        content: rm.content.slice(0, 100),
      });
    }
  }

  return Promise.all(
    messages.map(async (m) => {
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
        attachments: await Promise.all(
          m.attachments.map(async (a) => ({
            id: a.id,
            url: await storageService.createDownloadUrl(
              a.url,
              channelId,
              attachmentScope,
            ),
            ...(a.previewUrl
              ? {
                  previewUrl: await storageService.createDownloadUrl(
                    a.url,
                    channelId,
                    attachmentScope,
                    "preview",
                  ),
                }
              : {}),
            downloadUrl: await storageService.createDownloadUrl(
              a.url,
              channelId,
              attachmentScope,
              "original",
              true,
            ),
            expiresAt: storageService.getDownloadExpiry(),
            fileName: a.fileName,
            fileSize: a.fileSize,
            mimeType: a.mimeType,
          })),
        ),
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        sequence: m.sequence,
      };
    }),
  );
});

server.post("/api/channels/:channelId/messages", async (request, reply) => {
  const { channelId } = request.params as any;
  const { content, isEncrypted, attachments, replyToId } = request.body as any;

  const reqUserId = await getUserIdFromRequest(request);
  const author = reqUserId
    ? await prisma.user.findUnique({ where: { id: reqUserId } })
    : null;
  if (!author) {
    return reply.status(400).send({ error: "发信作者不存在" });
  }

  if (author.isBanned) {
    return reply.status(403).send({ error: "您的账号已被系统封禁，无法发信" });
  }

  const targetChannel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      recipients: true,
    },
  });
  if (!targetChannel) {
    return reply.status(404).send({ error: "目标频道不存在" });
  }
  const attachmentScope = getAttachmentScope(request);

  const isDM = targetChannel.type === "DM" || targetChannel.type === "GROUP_DM";
  if (isDM) {
    const isParticipant = targetChannel.recipients.some(
      (r) => r.userId === author.id,
    );
    if (!isParticipant) {
      return reply.status(403).send({ error: "您不是该私信会话的参与者" });
    }
  } else {
    const canSend =
      (await permissionService.hasChannelPermission(
        author.id,
        channelId,
        PermissionFlags.VIEW_CHANNEL,
      )) &&
      (await permissionService.hasChannelPermission(
        author.id,
        channelId,
        PermissionFlags.SEND_MESSAGES,
      ));
    if (!canSend) {
      return reply
        .status(403)
        .send({ error: "缺少频道发信权限 (SEND_MESSAGES)" });
    }
  }

  let replyToPreview = null;
  if (replyToId) {
    const refMsg = await prisma.message.findUnique({
      where: { id: replyToId },
      include: { author: { select: { username: true, displayName: true } } },
    });
    if (refMsg && refMsg.channelId === channelId) {
      replyToPreview = {
        id: refMsg.id,
        authorName: refMsg.author.displayName || refMsg.author.username,
        content: refMsg.content.slice(0, 100),
      };
    }
  }

  const requestedAttachments = Array.isArray(attachments)
    ? attachments.slice(0, 10)
    : [];
  if (
    requestedAttachments.length > 0 &&
    !(await permissionService.hasChannelPermission(
      author.id,
      channelId,
      PermissionFlags.ATTACH_FILES,
    ))
  ) {
    return reply.status(403).send({ error: "缺少频道附件权限 (ATTACH_FILES)" });
  }
  const claimedAttachments = requestedAttachments.map((attachment: any) =>
    storageService.claimAttachment(author.id, channelId, attachment),
  );
  if (claimedAttachments.some((attachment) => !attachment)) {
    return reply
      .status(403)
      .send({ error: "附件上传授权无效、已过期或不属于当前用户" });
  }

  const createdMessage = await prisma.$transaction(async (tx) => {
    const sequencedChannel = await tx.channel.update({
      where: { id: channelId },
      data: { nextMessageSequence: { increment: 1 } },
      select: { nextMessageSequence: true },
    });
    if (isDM) {
      await tx.channelRecipient.updateMany({
        where: { channelId, userId: { not: author.id }, isClosed: true },
        data: { isClosed: false },
      });
    }
    return tx.message.create({
      data: {
        channelId,
        authorId: author.id,
        content: String(content || "").slice(0, isEncrypted ? 16000 : 4000),
        isEncrypted: !!isEncrypted,
        sequence: sequencedChannel.nextMessageSequence,
        replyToId: replyToPreview ? replyToId : null,
        attachments: claimedAttachments.length
          ? {
              create: claimedAttachments.map((a) => ({
                url: a!.url,
                fileName: a!.fileName,
                fileSize: a!.fileSize,
                mimeType: a!.mimeType,
                previewUrl: a!.preview?.url,
                previewSize: a!.preview?.size,
                previewWidth: a!.preview?.width,
                previewHeight: a!.preview?.height,
              })),
            }
          : undefined,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        attachments: true,
      },
    });
  });

  const publicAttachments = await Promise.all(
    createdMessage.attachments.map(async (a) => ({
      id: a.id,
      url: await storageService.createDownloadUrl(
        a.url,
        channelId,
        attachmentScope,
      ),
      ...(a.previewUrl
        ? {
            previewUrl: await storageService.createDownloadUrl(
              a.url,
              channelId,
              attachmentScope,
              "preview",
            ),
          }
        : {}),
      downloadUrl: await storageService.createDownloadUrl(
        a.url,
        channelId,
        attachmentScope,
        "original",
        true,
      ),
      expiresAt: storageService.getDownloadExpiry(),
      fileName: a.fileName,
      fileSize: a.fileSize,
      mimeType: a.mimeType,
    })),
  );
  const messagePayload: Message = {
    id: createdMessage.id,
    channelId: createdMessage.channelId,
    authorId: createdMessage.authorId,
    author: {
      id: createdMessage.author.id,
      username: createdMessage.author.username,
      displayName: createdMessage.author.displayName,
      avatarUrl: createdMessage.author.avatarUrl,
    },
    content: createdMessage.content,
    isEncrypted: createdMessage.isEncrypted,
    replyToId: createdMessage.replyToId,
    replyTo: replyToPreview,
    isPinned: createdMessage.isPinned,
    reactions: [],
    attachments: publicAttachments,
    createdAt: createdMessage.createdAt.toISOString(),
    updatedAt: createdMessage.updatedAt.toISOString(),
    sequence: createdMessage.sequence,
  };

  if (isDM) {
    for (const r of targetChannel.recipients) {
      gatewayManager.sendToUser(r.userId, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.MESSAGE_CREATE,
        d: messagePayload,
      });
      if (r.userId !== author.id) {
        if (r.isClosed) {
          await prisma.channelRecipient.updateMany({
            where: { channelId, userId: r.userId },
            data: { isClosed: false },
          });
        }
        const fullChannel = await dmService.getFormattedDMChannel(
          r.userId,
          channelId,
        );
        if (fullChannel) {
          gatewayManager.sendToUser(r.userId, {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.DM_CHANNEL_CREATE,
            d: fullChannel,
          });
        }
        gatewayManager.sendToUser(r.userId, {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.DM_CHANNEL_UPDATE,
          d: {
            channelId,
            isClosed: false,
            lastMessage: messagePayload,
            unreadIncrement: 1,
          },
        });
      }
    }
  } else {
    gatewayManager.broadcast({
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.MESSAGE_CREATE,
      d: messagePayload,
    });
  }

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
    : null;

  if (!user) {
    return reply.status(401).send({ error: "需要登录后操作" });
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { recipients: { select: { userId: true } } },
  });
  if (!channel) return reply.status(404).send({ error: "频道不存在" });
  if (channel.type === "DM" || channel.type === "GROUP_DM") {
    if (!channel.recipients.some((item) => item.userId === user.id)) {
      return reply.status(403).send({ error: "无权访问该私信会话" });
    }
    for (const recipient of channel.recipients) {
      if (recipient.userId !== user.id) {
        gatewayManager.sendToUser(recipient.userId, {
          op: GatewayOpCode.DISPATCH,
          t: GatewayEvents.TYPING_START,
          d: { channelId, userId: user.id, user, timestamp: Date.now() },
        });
      }
    }
  } else {
    const canRead = await permissionService.hasChannelPermission(
      user.id,
      channelId,
      PermissionFlags.READ_MESSAGE_HISTORY,
    );
    if (!canRead) return reply.status(403).send({ error: "无权访问该频道" });
    await gatewayManager.broadcastTypingAuthorized(channelId, user);
  }
  return reply.status(204).send();
});

async function dispatchChannelEvent(
  channelId: string,
  event: (typeof GatewayEvents)[keyof typeof GatewayEvents],
  data: unknown,
) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      recipients: { select: { userId: true } },
      guild: { include: { members: { select: { userId: true } } } },
    },
  });
  if (!channel) return;
  const candidates =
    channel.type === "DM" || channel.type === "GROUP_DM"
      ? channel.recipients.map((item) => item.userId)
      : channel.guild?.members.map((item) => item.userId) || [];
  for (const recipientId of candidates) {
    if (
      channel.type !== "DM" &&
      channel.type !== "GROUP_DM" &&
      !(await permissionService.hasChannelPermission(
        recipientId,
        channelId,
        PermissionFlags.READ_MESSAGE_HISTORY,
      ))
    )
      continue;
    gatewayManager.sendToUser(recipientId, {
      op: GatewayOpCode.DISPATCH,
      t: event,
      d: data,
    });
  }
}

// 添加 Reaction 点赞
server.put(
  "/api/channels/:channelId/messages/:messageId/reactions/:emoji",
  async (request, reply) => {
    const { channelId, messageId, emoji } = request.params as any;
    const decodedEmoji = decodeURIComponent(emoji);
    const userId = await getUserIdFromRequest(request);
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) {
      return reply.status(401).send({ error: "需要登录后操作" });
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.channelId !== channelId) {
      return reply.status(404).send({ error: "消息不属于该频道" });
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    const canReact =
      channel?.type === "DM" || channel?.type === "GROUP_DM"
        ? await dmService.isParticipant(user.id, channelId)
        : await permissionService.hasChannelPermission(
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

    await dispatchChannelEvent(channelId, GatewayEvents.MESSAGE_REACTION_ADD, {
      channelId,
      messageId,
      userId: user.id,
      emoji: decodedEmoji,
      reactions: reactionsList,
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
      : null;
    if (!user) {
      return reply.status(401).send({ error: "需要登录" });
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.channelId !== channelId) {
      return reply.status(404).send({ error: "消息不属于该频道" });
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    const canRead =
      channel?.type === "DM" || channel?.type === "GROUP_DM"
        ? await dmService.isParticipant(user.id, channelId)
        : await permissionService.hasChannelPermission(
            user.id,
            channelId,
            PermissionFlags.READ_MESSAGE_HISTORY,
          );
    if (!canRead) return reply.status(403).send({ error: "无权访问该频道" });

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

    await dispatchChannelEvent(
      channelId,
      GatewayEvents.MESSAGE_REACTION_REMOVE,
      {
        channelId,
        messageId,
        userId: user.id,
        emoji: decodedEmoji,
        reactions: reactionsList,
      },
    );

    return reactionsList;
  },
);

// 切换置顶状态 (Pin / Unpin)
server.patch(
  "/api/channels/:channelId/messages/:messageId/pin",
  async (request, reply) => {
    const { channelId, messageId } = request.params as any;
    const userId = await getUserIdFromRequest(request);
    if (!userId) return reply.status(401).send({ error: "需要登录" });
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.channelId !== channelId) {
      return reply.status(404).send({ error: "消息不存在" });
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    const canPin =
      channel?.type === "DM" || channel?.type === "GROUP_DM"
        ? message.authorId === userId &&
          (await dmService.isParticipant(userId, channelId))
        : await permissionService.hasChannelPermission(
            userId,
            channelId,
            PermissionFlags.MANAGE_MESSAGES,
          );
    if (!canPin) return reply.status(403).send({ error: "无权修改该消息" });

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { isPinned: !message.isPinned },
    });

    await dispatchChannelEvent(channelId, GatewayEvents.MESSAGE_PIN_UPDATE, {
      channelId,
      messageId,
      isPinned: updated.isPinned,
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
      : null;
    if (!user) {
      return reply.status(401).send({ error: "需要登录" });
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message || message.channelId !== channelId) {
      return reply.status(404).send({ error: "消息不存在" });
    }

    const isAuthor = message.authorId === user.id;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    const canManage =
      channel?.type === "DM" || channel?.type === "GROUP_DM"
        ? false
        : await permissionService.hasChannelPermission(
            user.id,
            channelId,
            PermissionFlags.MANAGE_MESSAGES,
          );
    if (!isAuthor && !canManage) {
      return reply.status(403).send({ error: "您没有撤回或删除该消息的权限" });
    }

    await prisma.message.delete({ where: { id: messageId } });

    await dispatchChannelEvent(channelId, GatewayEvents.MESSAGE_DELETE, {
      channelId,
      messageId,
    });

    return { success: true, messageId };
  },
);

// ==========================================
// 4. 对象存储与附件直传 API (Storage & Attachments)
// ==========================================

function getAttachmentScope(request: FastifyRequest): {
  userId: string;
  sessionId: string;
  sessionVersion: number;
} {
  const claims = request.user as {
    sub: string;
    sessionId: string;
    sessionVersion?: number;
  };
  return {
    userId: claims.sub,
    sessionId: claims.sessionId,
    sessionVersion: Number(claims.sessionVersion ?? 0),
  };
}

server.post("/api/attachments/access", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return reply.status(401).send({ error: "需要登录" });
  const attachmentScope = getAttachmentScope(request);
  const body = request.body as AttachmentAccessRequest | undefined;
  if (
    !Array.isArray(body?.attachmentIds) ||
    body.attachmentIds.length < 1 ||
    body.attachmentIds.length > 50 ||
    body.attachmentIds.some(
      (id) => typeof id !== "string" || !id || id.length > 128,
    )
  ) {
    return reply.status(400).send({ error: "附件 ID 列表无效" });
  }
  const ids = [...new Set(body.attachmentIds)];
  const attachments = await prisma.attachment.findMany({
    where: { id: { in: ids }, messageId: { not: null } },
    include: {
      message: { include: { channel: { include: { recipients: true } } } },
    },
  });
  if (attachments.length !== ids.length)
    return reply.status(404).send({ error: "附件不存在" });
  const allowedByChannel = new Map<string, boolean>();
  for (const attachment of attachments) {
    const channel = attachment.message?.channel;
    if (!channel) return reply.status(404).send({ error: "附件不存在" });
    let allowed = allowedByChannel.get(channel.id);
    if (allowed === undefined) {
      allowed = channel.guildId
        ? (await permissionService.hasChannelPermission(
            userId,
            channel.id,
            PermissionFlags.VIEW_CHANNEL,
          )) &&
          (await permissionService.hasChannelPermission(
            userId,
            channel.id,
            PermissionFlags.READ_MESSAGE_HISTORY,
          )) &&
          !(await prisma.ban.findUnique({
            where: { guildId_userId: { guildId: channel.guildId, userId } },
          }))
        : (channel.type === "DM" || channel.type === "GROUP_DM") &&
          channel.recipients.some((r) => r.userId === userId);
      allowedByChannel.set(channel.id, allowed);
    }
    if (!allowed) return reply.status(403).send({ error: "无权读取附件" });
  }
  const entries = await Promise.all(
    attachments.map(async (attachment) => {
      const channelId = attachment.message!.channelId;
      return {
        id: attachment.id,
        url: await storageService.createDownloadUrl(
          attachment.url,
          channelId,
          attachmentScope,
        ),
        ...(attachment.previewUrl
          ? {
              previewUrl: await storageService.createDownloadUrl(
                attachment.url,
                channelId,
                attachmentScope,
                "preview",
              ),
            }
          : {}),
        downloadUrl: await storageService.createDownloadUrl(
          attachment.url,
          channelId,
          attachmentScope,
          "original",
          true,
        ),
        expiresAt: storageService.getDownloadExpiry(),
      };
    }),
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const response: AttachmentAccessResponse = {
    attachments: ids.map((id) => byId.get(id)!),
  };
  reply.header("Cache-Control", "no-store");
  return response;
});

server.post("/api/attachments/presigned-url", async (request, reply) => {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return reply.status(401).send({ error: "需要登录" });
    const body = request.body as PresignedUploadRequest;
    if (!body?.fileName) {
      return reply.status(400).send({ error: "未提供 fileName" });
    }
    if (body.purpose === "guild-icon") {
      if (
        !body.guildId ||
        !(await permissionService.hasGuildPermission(
          userId,
          body.guildId,
          PermissionFlags.MANAGE_GUILD,
        ))
      ) {
        return reply.status(403).send({ error: "缺少管理服务器权限" });
      }
      if (
        !/^(image\/png|image\/jpeg|image\/webp|image\/gif)$/.test(
          body.mimeType,
        ) ||
        !/\.(png|jpe?g|webp|gif)$/i.test(body.fileName)
      ) {
        return reply.status(400).send({ error: "不支持的服务器图标格式" });
      }
    } else {
      if (body.purpose && body.purpose !== "attachment") {
        return reply.status(400).send({ error: "未知上传用途" });
      }
      if (
        !body.channelId ||
        !(await permissionService.hasChannelPermission(
          userId,
          body.channelId,
          PermissionFlags.VIEW_CHANNEL,
        )) ||
        !(await permissionService.hasChannelPermission(
          userId,
          body.channelId,
          PermissionFlags.SEND_MESSAGES,
        )) ||
        !(await permissionService.hasChannelPermission(
          userId,
          body.channelId,
          PermissionFlags.ATTACH_FILES,
        ))
      ) {
        return reply.status(403).send({ error: "缺少频道附件上传权限" });
      }
    }
    const result = await storageService.getPresignedUploadUrl(body, userId);
    return result;
  } catch (err: any) {
    return reply
      .status(500)
      .send({ error: err.message || "获取预签名链接失败" });
  }
});

server.delete("/api/guilds/:guildId/pending-icon", async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return sendApiError(reply, 401, ErrorCode.UNAUTHORIZED, "需要登录");
  }
  if (
    !(await permissionService.hasGuildPermission(
      userId,
      guildId,
      PermissionFlags.MANAGE_GUILD,
    ))
  ) {
    return sendApiError(
      reply,
      403,
      ErrorCode.GUILD_PERMISSION_DENIED,
      "缺少管理服务器权限",
    );
  }
  const body = (request.body || {}) as DiscardGuildIconUploadDTO;
  if (!body.fileUrl) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "缺少待清理图标地址",
    );
  }
  const discarded = await storageService.discardPendingPublicAsset(
    userId,
    guildId,
    body.fileUrl,
  );
  if (!discarded) {
    return sendApiError(
      reply,
      404,
      ErrorCode.NOT_FOUND,
      "待清理图标不存在或已绑定",
    );
  }
  reply.header("Cache-Control", "no-store");
  return { success: true };
});

server.put("/api/attachments/upload/:fileName", async (request, reply) => {
  const { fileName } = request.params as any;
  const decodedFileName = decodeURIComponent(fileName);
  const userId = await getUserIdFromRequest(request);
  const query = request.query as { expires?: string; signature?: string };
  const expiresAt = Number(query.expires);
  if (
    !userId ||
    !query.signature ||
    !storageService.verifyLocalUpload(
      decodedFileName,
      userId,
      expiresAt,
      query.signature,
    )
  ) {
    return reply.status(403).send({ error: "上传凭证无效或已过期" });
  }
  const scope = storageService.getUploadGrantScope(decodedFileName, userId);
  if (!scope) {
    return reply.status(403).send({ error: "上传授权无效或已过期" });
  }
  const stillAuthorized =
    scope.purpose === "guild-icon"
      ? Boolean(
          scope.guildId &&
          (await permissionService.hasGuildPermission(
            userId,
            scope.guildId,
            PermissionFlags.MANAGE_GUILD,
          )),
        )
      : Boolean(
          scope.channelId &&
          (await permissionService.hasChannelPermission(
            userId,
            scope.channelId,
            PermissionFlags.VIEW_CHANNEL,
          )) &&
          (await permissionService.hasChannelPermission(
            userId,
            scope.channelId,
            PermissionFlags.SEND_MESSAGES,
          )) &&
          (await permissionService.hasChannelPermission(
            userId,
            scope.channelId,
            PermissionFlags.ATTACH_FILES,
          )),
        );
  if (!stillAuthorized) {
    return reply.status(403).send({ error: "上传权限已被撤销" });
  }
  const buffer = Buffer.isBuffer(request.body)
    ? request.body
    : Buffer.from(
        typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body),
      );

  const maxUploadBytes = Number(
    process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024,
  );
  if (buffer.byteLength > maxUploadBytes) {
    return reply.status(413).send({ error: "附件超过大小限制" });
  }
  if (
    !storageService.verifyUploadMetadata(
      decodedFileName,
      userId,
      buffer.byteLength,
      request.headers["content-type"],
    )
  ) {
    return reply.status(403).send({ error: "上传内容与授权不一致" });
  }

  try {
    await storageService.storeObject(decodedFileName, buffer);
    return { success: true };
  } catch {
    return reply.status(503).send({ error: "附件存储暂不可用" });
  }
});

async function servePrivateAttachment(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { fileName } = request.params as { fileName: string };
  const decodedFileName = decodeURIComponent(fileName);
  const query = request.query as {
    channelId?: string;
    expires?: string;
    signature?: string;
    variant?: string;
    download?: string;
    userId?: string;
    sessionId?: string;
    sessionVersion?: string;
  };
  const variant = query.variant === "preview" ? "preview" : "original";
  const download = query.download === "1";
  const scope = {
    userId: query.userId || "",
    sessionId: query.sessionId || "",
    sessionVersion: Number(query.sessionVersion),
  };
  const sendAttachmentError = (status: number, message: string) => {
    reply.header(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0",
    );
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
    reply.header("Cloudflare-CDN-Cache-Control", "no-store");
    reply.header("CDN-Cache-Control", "no-store");
    return reply.status(status).send({ error: message });
  };

  if (
    (query.variant && query.variant !== variant) ||
    (query.download && !["0", "1"].includes(query.download))
  ) {
    return sendAttachmentError(403, "附件访问授权无效");
  }
  if (
    !query.channelId ||
    !query.signature ||
    !storageService.verifyDownload(
      decodedFileName,
      query.channelId,
      Number(query.expires),
      query.signature,
      scope,
      variant,
      download,
    )
  ) {
    return sendAttachmentError(403, "附件访问授权无效或已过期");
  }
  const [user, session, attachment] = await Promise.all([
    prisma.user.findUnique({
      where: { id: scope.userId },
      select: { isBanned: true, sessionVersion: true },
    }),
    prisma.refreshToken.findUnique({
      where: { id: scope.sessionId },
      select: { userId: true, expiresAt: true },
    }),
    prisma.attachment.findFirst({
      where: {
        url: { endsWith: `/${decodedFileName}` },
        message: { channelId: query.channelId },
      },
      include: {
        message: { include: { channel: { include: { recipients: true } } } },
      },
    }),
  ]);
  if (
    !user ||
    user.isBanned ||
    user.sessionVersion !== scope.sessionVersion ||
    !session ||
    session.userId !== scope.userId ||
    session.expiresAt <= new Date()
  ) {
    return sendAttachmentError(403, "附件访问会话已失效");
  }
  if (!attachment) return sendAttachmentError(404, "附件不存在");
  const channel = attachment.message?.channel;
  if (!channel) return sendAttachmentError(404, "附件不存在");
  const canRead = channel.guildId
    ? (await permissionService.hasChannelPermission(
        scope.userId,
        channel.id,
        PermissionFlags.VIEW_CHANNEL,
      )) &&
      (await permissionService.hasChannelPermission(
        scope.userId,
        channel.id,
        PermissionFlags.READ_MESSAGE_HISTORY,
      )) &&
      !(await prisma.ban.findUnique({
        where: {
          guildId_userId: { guildId: channel.guildId, userId: scope.userId },
        },
      }))
    : (channel.type === "DM" || channel.type === "GROUP_DM") &&
      channel.recipients.some((r) => r.userId === scope.userId);
  if (!canRead) return sendAttachmentError(403, "附件访问权限已被撤销");
  if (variant === "preview" && !attachment.previewUrl)
    return sendAttachmentError(404, "预览图不存在");
  const objectUrl =
    variant === "preview" ? attachment.previewUrl! : attachment.url;
  reply.header(
    "Content-Type",
    variant === "preview"
      ? "image/webp"
      : attachment.mimeType || "application/octet-stream",
  );
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cache-Control", "private, no-cache");
  reply.header(
    "Content-Disposition",
    `${download || !/^(image\/(png|jpeg|gif|webp|avif)|audio\/(mpeg|ogg|wav|webm)|video\/(mp4|webm))$/i.test(attachment.mimeType) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(variant === "preview" ? `${attachment.fileName}.webp` : attachment.fileName)}`,
  );
  try {
    const stat = await storageService.statObject(objectUrl);
    reply.header("ETag", stat.etag);
    reply.header("Accept-Ranges", "bytes");
    if (
      request.headers["if-none-match"] === stat.etag &&
      !request.headers.range
    )
      return reply.status(304).send();
    const rangeHeader = request.headers.range;
    let start = 0;
    let end = stat.size - 1;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (!match || (!match[1] && !match[2])) {
        reply.header(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, max-age=0",
        );
        reply.header("Content-Range", `bytes */${stat.size}`);
        return reply.status(416).send();
      }
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
      } else {
        start = Math.max(0, stat.size - Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= stat.size ||
        stat.size <= 0
      ) {
        reply.header(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, max-age=0",
        );
        reply.header("Content-Range", `bytes */${stat.size}`);
        return reply.status(416).send();
      }
      end = Math.min(end, stat.size - 1);
      reply
        .status(206)
        .header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    }
    reply.header("Content-Length", end - start + 1);
    return reply.send(
      rangeHeader
        ? await storageService.openObjectRange(
            objectUrl,
            start,
            end - start + 1,
          )
        : await storageService.openObject(objectUrl),
    );
  } catch {
    return sendAttachmentError(503, "附件存储暂不可用");
  }
}
server.get("/attachments/:fileName", servePrivateAttachment);

server.get("/public-assets/:fileName", async (request, reply) => {
  const { fileName } = request.params as { fileName: string };
  const decoded = decodeURIComponent(fileName);

  const sendPublicAssetError = (status: number, message: string) => {
    reply.header(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0",
    );
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
    reply.header("Cloudflare-CDN-Cache-Control", "no-store");
    reply.header("CDN-Cache-Control", "no-store");
    return reply.status(status).send({ error: message });
  };

  if (
    !storageService.resolveLocalUploadPath(decoded) ||
    !/\.(png|jpe?g|webp|gif)$/i.test(decoded)
  ) {
    return sendPublicAssetError(404, "资源不存在");
  }

  const fileUrl = `${process.env.SERVER_BASE_URL || "http://localhost:3001"}/public-assets/${encodeURIComponent(decoded)}`;

  // 公共路由只服务已绑定到公会的资源。上传中的图标由浏览器 Blob
  // 本地预览，绝不能在绑定前进入 Cloudflare 的长期公共缓存。
  const guild = await prisma.guild.findFirst({
    where: {
      OR: [
        { iconUrl: fileUrl },
        {
          iconUrl: {
            endsWith: `/public-assets/${encodeURIComponent(decoded)}`,
          },
        },
        { iconUrl: { endsWith: `/public-assets/${decoded}` } },
      ],
    },
    select: { id: true },
  });

  if (!guild) {
    return sendPublicAssetError(404, "资源不存在");
  }

  const ext = decoded.split(".").pop()?.toLowerCase();
  reply.header("Content-Type", ext === "jpg" ? "image/jpeg" : `image/${ext}`);
  reply.header("X-Content-Type-Options", "nosniff");
  try {
    const stream = await storageService.openObject(fileUrl);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("ETag", `"${decoded}"`);
    return reply.send(stream);
  } catch {
    return sendPublicAssetError(404, "资源不存在");
  }
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
    : null;
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

server.post("/api/e2ee/devices", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  const body = (request.body || {}) as RegisterDeviceKeyDTO;
  if (
    !userId ||
    !body.deviceId ||
    !body.signingPublicKey ||
    !body.agreementPublicKey ||
    !body.fingerprint
  ) {
    return reply.status(400).send({ error: "设备公钥资料不完整" });
  }
  if (
    [
      body.deviceId,
      body.signingPublicKey,
      body.agreementPublicKey,
      body.fingerprint,
    ].some((value) => value.length > 8192)
  ) {
    return reply.status(400).send({ error: "设备公钥资料超过长度限制" });
  }
  const existing = await prisma.deviceKey.findUnique({
    where: { userId_deviceId: { userId, deviceId: body.deviceId } },
  });
  if (
    existing &&
    !existing.revokedAt &&
    (existing.signingPublicKey !== body.signingPublicKey ||
      existing.agreementPublicKey !== body.agreementPublicKey)
  ) {
    return reply
      .status(409)
      .send({ error: "已知设备身份密钥发生变化，需要撤销旧设备后重新确认" });
  }
  const device = existing
    ? await prisma.deviceKey.update({
        where: { id: existing.id },
        data: { ...body, revokedAt: null },
      })
    : await prisma.deviceKey.create({ data: { userId, ...body } });
  return {
    userId: device.userId,
    deviceId: device.deviceId,
    signingPublicKey: device.signingPublicKey,
    agreementPublicKey: device.agreementPublicKey,
    fingerprint: device.fingerprint,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
});

server.delete("/api/e2ee/devices/:deviceId", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  const { deviceId } = request.params as { deviceId: string };
  if (!userId) return reply.status(401).send({ error: "需要登录" });
  const result = await prisma.deviceKey.updateMany({
    where: { userId, deviceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count)
    return reply.status(404).send({ error: "设备不存在或已撤销" });
  await prisma.platformAuditLog.create({
    data: {
      actorId: userId,
      action: "DEVICE_KEY_REVOKED",
      targetType: "DEVICE",
      targetId: deviceId,
    },
  });
  gatewayManager.sendToUser(userId, {
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.ACCOUNT_SESSION_REVOKED,
    d: { deviceId, reason: "device_key_revoked" },
  });
  gatewayManager.terminateActiveCall(userId, "device_key_revoked");
  return { success: true };
});

server.get("/api/channels/:channelId/e2ee/devices", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  const { channelId } = request.params as { channelId: string };
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!userId || !channel)
    return reply.status(404).send({ error: "频道不存在" });
  const participantIds =
    channel.type === "DM" || channel.type === "GROUP_DM"
      ? (
          await prisma.channelRecipient.findMany({
            where: { channelId },
            select: { userId: true },
          })
        ).map((item) => item.userId)
      : (
          await prisma.guildMember.findMany({
            where: { guildId: channel.guildId! },
            select: { userId: true },
          })
        ).map((item) => item.userId);
  const callerAllowed =
    channel.type === "DM" || channel.type === "GROUP_DM"
      ? participantIds.includes(userId)
      : await permissionService.hasChannelPermission(
          userId,
          channelId,
          PermissionFlags.CONNECT,
        );
  if (!callerAllowed)
    return reply.status(403).send({ error: "无权读取该频道设备密钥" });
  const visibleParticipantIds =
    channel.type === "DM" || channel.type === "GROUP_DM"
      ? participantIds
      : (
          await Promise.all(
            participantIds.map(async (candidateId) =>
              (await permissionService.hasChannelPermission(
                candidateId,
                channelId,
                PermissionFlags.CONNECT,
              ))
                ? candidateId
                : null,
            ),
          )
        ).filter((value): value is string => Boolean(value));
  const devices = await prisma.deviceKey.findMany({
    where: { userId: { in: visibleParticipantIds }, revokedAt: null },
    orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
  });
  return devices.map((device) => ({
    userId: device.userId,
    deviceId: device.deviceId,
    signingPublicKey: device.signingPublicKey,
    agreementPublicKey: device.agreementPublicKey,
    fingerprint: device.fingerprint,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  }));
});

server.post(
  "/api/channels/:channelId/e2ee/media-key",
  async (request, reply) => {
    const senderId = await getUserIdFromRequest(request);
    const { channelId } = request.params as { channelId: string };
    const body = (request.body || {}) as {
      callId?: string;
      senderDeviceId?: string;
      recipientDeviceId?: string;
      ephemeralPublicKey?: string;
      iv?: string;
      ciphertext?: string;
      signature?: string;
    };
    if (
      !senderId ||
      !body.callId ||
      !body.senderDeviceId ||
      !body.recipientDeviceId ||
      !body.ephemeralPublicKey ||
      !body.iv ||
      !body.ciphertext ||
      !body.signature
    ) {
      return reply.status(400).send({ error: "媒体密钥信封不完整" });
    }
    if (
      [body.callId, body.senderDeviceId, body.recipientDeviceId].some(
        (value) => value.length > 160,
      ) ||
      body.ephemeralPublicKey.length > 8192 ||
      body.iv.length > 128 ||
      body.ciphertext.length > 8192 ||
      body.signature.length > 1024
    ) {
      return reply.status(400).send({ error: "媒体密钥信封超过长度限制" });
    }
    let call;
    try {
      call = dmCallService.authorizeKeyExchange(
        senderId,
        body.callId,
        channelId,
      );
    } catch (error) {
      return reply.status(403).send({
        error: error instanceof Error ? error.message : "呼叫上下文无效",
      });
    }
    if (call.callerId !== senderId) {
      return reply
        .status(403)
        .send({ error: "仅呼叫发起设备可以建立本次媒体密钥" });
    }
    const [senderDevice, recipientDevice] = await Promise.all([
      prisma.deviceKey.findFirst({
        where: {
          userId: senderId,
          deviceId: body.senderDeviceId,
          revokedAt: null,
        },
      }),
      prisma.deviceKey.findFirst({
        where: { deviceId: body.recipientDeviceId, revokedAt: null },
      }),
    ]);
    if (
      !senderDevice ||
      !recipientDevice ||
      recipientDevice.userId === senderId ||
      !(await dmService.isParticipant(recipientDevice.userId, channelId))
    ) {
      return reply.status(403).send({ error: "发送或接收设备无权参与该呼叫" });
    }
    const createdAt = new Date();
    const stored = await prisma.$transaction(async (tx) => {
      await tx.mediaKeyEnvelope.deleteMany({
        where: {
          createdAt: { lt: new Date(createdAt.getTime() - 5 * 60_000) },
        },
      });
      return tx.mediaKeyEnvelope.upsert({
        where: {
          callId_senderDeviceId_recipientDeviceId: {
            callId: body.callId!,
            senderDeviceId: senderDevice.deviceId,
            recipientDeviceId: recipientDevice.deviceId,
          },
        },
        create: {
          callId: body.callId!,
          channelId,
          senderId,
          senderDeviceId: senderDevice.deviceId,
          recipientId: recipientDevice.userId,
          recipientDeviceId: recipientDevice.deviceId,
          ephemeralPublicKey: body.ephemeralPublicKey!,
          senderSigningPublicKey: senderDevice.signingPublicKey,
          senderFingerprint: senderDevice.fingerprint,
          iv: body.iv!,
          ciphertext: body.ciphertext!,
          signature: body.signature!,
          createdAt,
        },
        update: {
          ephemeralPublicKey: body.ephemeralPublicKey!,
          senderSigningPublicKey: senderDevice.signingPublicKey,
          senderFingerprint: senderDevice.fingerprint,
          iv: body.iv!,
          ciphertext: body.ciphertext!,
          signature: body.signature!,
          createdAt,
          consumedAt: null,
        },
      });
    });
    const envelope = {
      channelId,
      callId: body.callId,
      senderId,
      senderDeviceId: senderDevice.deviceId,
      recipientId: recipientDevice.userId,
      recipientDeviceId: recipientDevice.deviceId,
      ephemeralPublicKey: body.ephemeralPublicKey,
      senderSigningPublicKey: senderDevice.signingPublicKey,
      senderFingerprint: senderDevice.fingerprint,
      iv: body.iv,
      ciphertext: body.ciphertext,
      signature: body.signature,
      createdAt: stored.createdAt.toISOString(),
    };
    gatewayManager.sendToUser(recipientDevice.userId, {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.E2EE_KEY_EXCHANGE,
      d: envelope,
    });
    return { success: true, recipientDeviceId: recipientDevice.deviceId };
  },
);

server.get(
  "/api/channels/:channelId/e2ee/media-key/:callId",
  async (request, reply) => {
    const recipientId = await getUserIdFromRequest(request);
    const { channelId, callId } = request.params as {
      channelId: string;
      callId: string;
    };
    const { deviceId } = (request.query || {}) as { deviceId?: string };
    if (
      !recipientId ||
      !deviceId ||
      deviceId.length > 160 ||
      callId.length > 160
    ) {
      return reply.status(400).send({ error: "缺少有效的设备或呼叫上下文" });
    }
    try {
      dmCallService.authorizeKeyExchange(recipientId, callId, channelId);
    } catch (error) {
      return reply.status(403).send({
        error: error instanceof Error ? error.message : "呼叫上下文无效",
      });
    }
    const device = await prisma.deviceKey.findFirst({
      where: { userId: recipientId, deviceId, revokedAt: null },
      select: { id: true },
    });
    if (!device)
      return reply.status(403).send({ error: "设备身份无效或已撤销" });
    const cutoff = new Date(Date.now() - 2 * 60_000);
    const stored = await prisma.mediaKeyEnvelope.findFirst({
      where: {
        channelId,
        callId,
        recipientId,
        recipientDeviceId: deviceId,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!stored)
      return reply.status(404).send({ error: "媒体密钥尚未到达或已过期" });
    await prisma.mediaKeyEnvelope.update({
      where: { id: stored.id },
      data: { consumedAt: new Date() },
    });
    return {
      channelId: stored.channelId,
      callId: stored.callId,
      senderId: stored.senderId,
      senderDeviceId: stored.senderDeviceId,
      recipientId: stored.recipientId,
      recipientDeviceId: stored.recipientDeviceId,
      ephemeralPublicKey: stored.ephemeralPublicKey,
      senderSigningPublicKey: stored.senderSigningPublicKey,
      senderFingerprint: stored.senderFingerprint,
      iv: stored.iv,
      ciphertext: stored.ciphertext,
      signature: stored.signature,
      createdAt: stored.createdAt.toISOString(),
    };
  },
);

// 查询特定成员的 PreKeyBundle（用于端侧发起双棘轮握手）
server.get("/api/e2ee/keys/prekey/:targetUserId", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  const { targetUserId } = request.params as any;
  const { channelId } = (request.query || {}) as { channelId?: string };
  if (!userId || !channelId)
    return reply.status(400).send({ error: "需要频道上下文" });
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return reply.status(404).send({ error: "频道不存在" });
  if (channel.type === "DM" || channel.type === "GROUP_DM") {
    if (
      !(await dmService.isParticipant(userId, channelId)) ||
      !(await dmService.isParticipant(targetUserId, channelId))
    ) {
      return reply.status(403).send({ error: "仅会话参与设备可以读取公钥" });
    }
  } else {
    const [callerCanRead, targetCanRead] = await Promise.all([
      permissionService.hasChannelPermission(
        userId,
        channelId,
        PermissionFlags.CONNECT,
      ),
      permissionService.hasChannelPermission(
        targetUserId,
        channelId,
        PermissionFlags.CONNECT,
      ),
    ]);
    if (!callerCanRead || !targetCanRead)
      return reply.status(403).send({ error: "无权读取该频道设备公钥" });
  }
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
      : null;
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
    if (!body.recipientId || body.recipientId === user.id) {
      return reply.status(400).send({ error: "必须指定其他接收设备所属用户" });
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) return reply.status(404).send({ error: "频道不存在" });
    if (channel.type === "DM" || channel.type === "GROUP_DM") {
      if (
        !(await dmService.isParticipant(user.id, channelId)) ||
        !(await dmService.isParticipant(body.recipientId, channelId))
      ) {
        return reply
          .status(403)
          .send({ error: "密钥只能发送给同一会话的参与者" });
      }
    } else {
      const [senderAllowed, recipientAllowed] = await Promise.all([
        permissionService.hasChannelPermission(
          user.id,
          channelId,
          PermissionFlags.CONNECT,
        ),
        permissionService.hasChannelPermission(
          body.recipientId,
          channelId,
          PermissionFlags.CONNECT,
        ),
      ]);
      if (!senderAllowed || !recipientAllowed)
        return reply.status(403).send({ error: "密钥接收方无频道访问权" });
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
    gatewayManager.sendToUser(body.recipientId, {
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
  const userId = await getUserIdFromRequest(request);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!userId || !channel)
    return reply.status(404).send({ error: "频道不存在" });
  const allowed =
    channel.type === "DM" || channel.type === "GROUP_DM"
      ? await dmService.isParticipant(userId, channelId)
      : await permissionService.hasChannelPermission(
          userId,
          channelId,
          PermissionFlags.CONNECT,
        );
  if (!allowed)
    return reply.status(403).send({ error: "无权查看该频道加密状态" });
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

server.get("/api/network/ice-servers", async (request, reply) => {
  const userId = await getUserIdFromRequest(request);
  if (!userId) return reply.status(401).send({ error: "Unauthorized" });

  // 1. 若配置了 Cloudflare Realtime TURN，优先拉取全球 Anycast 边缘凭据
  if (cloudflareRealtimeService.isTurnConfigured) {
    try {
      const cfTurn = await cloudflareRealtimeService.generateTurnIceServers(
        userId,
        86400,
      );
      return {
        iceServers: [
          ...(process.env.ALLOW_PUBLIC_STUN === "true"
            ? [{ urls: "stun:stun.cloudflare.com:3478" }]
            : []),
          ...cfTurn.iceServers,
        ],
        turnActive: true,
        provider: "cloudflare",
      };
    } catch (err: any) {
      server.log.warn(
        `Cloudflare TURN generation failed: ${err.message}, falling back to Coturn`,
      );
    }
  }

  // 2. 否则使用自建 Coturn 凭据
  const turnHost = process.env.COTURN_HOST || process.env.TURN_HOST || "";
  const turnPort = process.env.COTURN_PORT || process.env.TURN_PORT || "3478";
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const turnUser = `${expiresAt}:${userId}`;
  const turnSecret = process.env.TURN_SECRET || "";
  const turnPass = createHmac("sha1", turnSecret)
    .update(turnUser)
    .digest("base64");

  return {
    iceServers: [
      ...(process.env.ALLOW_PUBLIC_STUN === "true"
        ? [{ urls: "stun:stun.cloudflare.com:3478" }]
        : []),
      // 未配置外部 Coturn 时不下发无效的本机地址或开发密钥。
      ...(turnHost && turnSecret
        ? [
            { urls: `stun:${turnHost}:${turnPort}` },
            {
              urls: [
                `turn:${turnHost}:${turnPort}?transport=udp`,
                `turn:${turnHost}:${turnPort}?transport=tcp`,
              ],
              username: turnUser,
              credential: turnPass,
            },
          ]
        : []),
    ],
    turnActive: Boolean(turnHost && turnSecret),
    provider: "coturn",
  };
});

// ==========================================
// 5. LiveKit 媒体 Token 生成
// ==========================================

server.post("/api/livekit/token", async (request, reply) => {
  const body = request.body as Partial<LiveKitTokenRequest> | null;
  if (
    !body ||
    typeof body.roomName !== "string" ||
    !body.roomName ||
    typeof body.identity !== "string" ||
    !body.identity ||
    (body.gatewaySessionId !== undefined &&
      (typeof body.gatewaySessionId !== "string" ||
        body.gatewaySessionId.length > 128)) ||
    (body.bitrate !== undefined &&
      (typeof body.bitrate !== "number" ||
        !Number.isFinite(body.bitrate) ||
        body.bitrate < 6000 ||
        body.bitrate > 512000))
  ) {
    return sendApiError(
      reply,
      400,
      ErrorCode.INVALID_PARAMS,
      "Invalid media token request",
    );
  }

  const reqUserId = await getUserIdFromRequest(request);
  if (!reqUserId || reqUserId !== body.identity) {
    return sendApiError(reply, 403, ErrorCode.FORBIDDEN, "Media token denied");
  }
  const gatewaySessionId = body.gatewaySessionId || undefined;
  if (
    gatewaySessionId &&
    !gatewayManager.hasIdentifiedSession(reqUserId, gatewaySessionId)
  ) {
    return sendApiError(
      reply,
      403,
      ErrorCode.FORBIDDEN,
      "Invalid voice session",
    );
  }
  const channel = await prisma.channel.findUnique({
    where: { id: body.roomName },
  });
  if (!channel || channel.type !== "VOICE") {
    return sendApiError(reply, 403, ErrorCode.FORBIDDEN, "Media room denied");
  }
  const canConnect = await permissionService.hasChannelPermission(
    reqUserId,
    channel.id,
    PermissionFlags.CONNECT,
  );
  if (!canConnect)
    return sendApiError(
      reply,
      403,
      ErrorCode.FORBIDDEN,
      "Voice permission denied",
    );

  return await generateLiveKitToken({
    roomName: body.roomName,
    identity: body.identity,
    gatewaySessionId,
    name: typeof body.name === "string" ? body.name.slice(0, 128) : undefined,
    isPublisher: body.isPublisher !== false,
    bitrate: body.bitrate,
  });
});

// LiveKit Webhook 权威状态收敛回调
server.post("/api/livekit/webhook", async (request, reply) => {
  try {
    const receiver = getWebhookReceiver();
    const authHeader = request.headers.authorization;
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body);

    const event = await receiver.receive(rawBody, authHeader);
    console.log(
      `[LiveKit Webhook] Event: ${event.event}, participant: ${event.participant?.identity}, room: ${event.room?.name}`,
    );

    if (event.event === "participant_left" || event.event === "room_finished") {
      const identity = event.participant?.identity;
      const roomName = event.room?.name;
      let gatewaySessionId: string | undefined;
      try {
        const metadata = JSON.parse(event.participant?.metadata || "{}");
        if (typeof metadata?.gatewaySessionId === "string")
          gatewaySessionId = metadata.gatewaySessionId;
      } catch {
        // Legacy participants without structured metadata use the time guard.
      }
      if (identity) {
        gatewayManager.handleLiveKitParticipantLeft(
          identity,
          roomName,
          gatewaySessionId,
        );
      }
    }

    return reply.status(200).send({ ok: true });
  } catch (err: any) {
    console.warn(
      "[LiveKit Webhook] Verification or handling failed:",
      err?.message || err,
    );
    return reply
      .status(400)
      .send({ error: "Invalid webhook payload or signature" });
  }
});

// ==========================================
// 6. Cloudflare Realtime (Serverless SFU & Calls TURN)
// ==========================================

type CfMediaBody = {
  channelId?: string;
  sessionId?: string;
  sessionDescription?: { type: "offer" | "answer"; sdp: string };
  tracks?: Array<{
    mid?: string;
    trackName?: string;
    publisherSessionId?: string;
    kind?: "audio" | "video";
    source?: "microphone" | "camera" | "screen" | "screen-audio";
  }>;
};

const cfRateBuckets = new Map<string, { count: number; until: number }>();
server.addHook("preHandler", async (request, reply) => {
  if (!request.url.startsWith("/api/cloudflare-realtime/")) return;
  const userId = await getUserIdFromRequest(request);
  if (!userId) return reply.status(401).send({ error: "Unauthorized" });
  const now = Date.now();
  const key = `${userId}:${request.url.split("?", 1)[0]}`;
  const bucket = cfRateBuckets.get(key);
  const count = bucket && bucket.until > now ? bucket.count + 1 : 1;
  cfRateBuckets.set(key, {
    count,
    until: bucket && bucket.until > now ? bucket.until : now + 60_000,
  });
  if (cfRateBuckets.size > 10_000) {
    for (const [id, entry] of cfRateBuckets)
      if (entry.until <= now) cfRateBuckets.delete(id);
  }
  if (count > (key.endsWith("/session/new") ? 6 : 60))
    return reply.status(429).send({ error: "Media request rate exceeded" });
});

function cfBody(request: FastifyRequest): CfMediaBody {
  return request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body)
    ? (request.body as CfMediaBody)
    : {};
}

function cfLoginSession(request: FastifyRequest): string {
  return (request.user as { sessionId?: string } | undefined)?.sessionId || "";
}

async function cfCanUseChannel(
  userId: string,
  channelId: string,
  speak = false,
): Promise<boolean> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return false;
  if (channel.type === "DM" || channel.type === "GROUP_DM") {
    return dmService.isParticipant(userId, channelId);
  }
  if (channel.type !== "VOICE") return false;
  return permissionService.hasChannelPermission(
    userId,
    channelId,
    speak ? PermissionFlags.SPEAK : PermissionFlags.CONNECT,
  );
}

async function cfSessionForRequest(
  request: FastifyRequest,
  sessionId: string | undefined,
) {
  const userId = await getUserIdFromRequest(request);
  if (
    !userId ||
    !sessionId ||
    !cloudflareRealtimeService.ownsSession(
      sessionId,
      userId,
      cfLoginSession(request),
    )
  )
    return null;
  const session = cloudflareRealtimeService.getSession(sessionId);
  if (!session || !(await cfCanUseChannel(userId, session.channelId)))
    return null;
  return { ...session, sessionId };
}

async function cfSendTracks(channelId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { recipients: true },
  });
  if (!channel) return;
  const payload = {
    op: GatewayOpCode.DISPATCH,
    t: GatewayEvents.CF_MEDIA_TRACKS,
    d: { channelId, tracks: cloudflareRealtimeService.getTracks(channelId) },
  };
  if (channel.type === "DM" || channel.type === "GROUP_DM") {
    for (const recipient of channel.recipients)
      gatewayManager.sendToUser(recipient.userId, payload);
  } else if (channel.guildId) {
    const members = await prisma.guildMember.findMany({
      where: { guildId: channel.guildId },
      select: { userId: true },
    });
    for (const member of members) {
      if (await cfCanUseChannel(member.userId, channelId))
        gatewayManager.sendToUser(member.userId, payload);
    }
  }
}

async function cfSendViewerEvents() {
  for (const event of cloudflareRealtimeService.drainViewerEvents()) {
    const channel = await prisma.channel.findUnique({
      where: { id: event.channelId },
      include: { recipients: true },
    });
    if (!channel) continue;
    const payload = {
      op: GatewayOpCode.DISPATCH,
      t: GatewayEvents.CF_STREAM_VIEWERS,
      d: event,
    };
    if (channel.type === "DM" || channel.type === "GROUP_DM") {
      for (const recipient of channel.recipients)
        gatewayManager.sendToUser(recipient.userId, payload);
    } else if (channel.guildId) {
      const members = await prisma.guildMember.findMany({
        where: { guildId: channel.guildId },
        select: { userId: true },
      });
      for (const member of members)
        if (await cfCanUseChannel(member.userId, event.channelId))
          gatewayManager.sendToUser(member.userId, payload);
    }
  }
}

// 6.1 获取 Cloudflare Realtime 服务端配置状态
server.get("/api/cloudflare-realtime/config", async () => {
  return cloudflareRealtimeService.getConfig();
});

// 6.2 申请 Cloudflare Calls TURN 临时中继凭据
server.get("/api/cloudflare-realtime/ice-servers", async (request, reply) => {
  if (!cloudflareRealtimeService.isTurnConfigured) {
    return reply
      .status(503)
      .send({ error: "Cloudflare TURN is not configured" });
  }
  const userId = await getUserIdFromRequest(request);
  if (!userId) return reply.status(401).send({ error: "Unauthorized" });
  try {
    const creds = await cloudflareRealtimeService.generateTurnIceServers(
      userId,
      3600,
    );
    return creds;
  } catch (err: any) {
    server.log.error(err, "Failed to generate Cloudflare TURN credentials");
    return reply.status(502).send({ error: "TURN credential request failed" });
  }
});

// 6.3 创建新的 Cloudflare Calls SFU 会话
server.post("/api/cloudflare-realtime/session/new", async (request, reply) => {
  if (!cloudflareRealtimeService.isSfuConfigured) {
    return reply
      .status(503)
      .send({ error: "Cloudflare Calls SFU is not configured" });
  }
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const { channelId } = cfBody(request);
  if (
    typeof channelId !== "string" ||
    !channelId ||
    !(await cfCanUseChannel(userId, channelId))
  ) {
    return reply.status(403).send({ error: "无权连接该语音频道" });
  }
  if (!cfLoginSession(request))
    return reply.status(401).send({ error: "Invalid login session" });

  try {
    const session = await cloudflareRealtimeService.createSession();
    cloudflareRealtimeService.registerSession(
      session.sessionId,
      userId,
      channelId,
      cfLoginSession(request),
    );
    await cfSendViewerEvents();
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { type: true, isE2EE: true },
    });
    return {
      ...session,
      tracks: cloudflareRealtimeService.getTracks(channelId),
      requiresE2EE:
        channel?.type === "DM" ||
        channel?.type === "GROUP_DM" ||
        Boolean(channel?.isE2EE),
    };
  } catch (err: any) {
    server.log.error(err, "Failed to create Cloudflare Calls session");
    return reply.status(502).send({ error: "Failed to create media session" });
  }
});

// 6.4 推送本地音视频轨道 (Publish Tracks / Local Tracks)
server.post(
  "/api/cloudflare-realtime/tracks/publish",
  async (request, reply) => {
    if (!cloudflareRealtimeService.isSfuConfigured) {
      return reply
        .status(503)
        .send({ error: "Cloudflare Calls SFU is not configured" });
    }
    const userId = await getUserIdFromRequest(request);
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const body = cfBody(request);
    const session = await cfSessionForRequest(request, body.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      body.channelId !== session.channelId ||
      body.sessionDescription?.type !== "offer" ||
      typeof body.sessionDescription.sdp !== "string" ||
      !Array.isArray(body.tracks) ||
      body.tracks.length < 1 ||
      body.tracks.length > 4 ||
      body.tracks.some(
        (t) =>
          typeof t.mid !== "string" ||
          !/^\d{1,3}$/.test(t.mid) ||
          typeof t.trackName !== "string" ||
          t.trackName.length > 100 ||
          !/^(microphone|camera|screen|screen-audio)-[a-f0-9-]{36}$/.test(
            t.trackName,
          ) ||
          !(
            (t.kind === "audio" &&
              (t.source === "microphone" || t.source === "screen-audio")) ||
            (t.kind === "video" &&
              (t.source === "camera" || t.source === "screen"))
          ),
      )
    ) {
      return reply.status(400).send({ error: "Invalid publish request body" });
    }
    if (!(await cfCanUseChannel(userId, session.channelId, true)))
      return reply.status(403).send({ error: "缺少发言权限" });

    try {
      const result = await cloudflareRealtimeService.publishTracks(
        body as CfCallsPublishTrackRequest,
      );
      cloudflareRealtimeService.addTracks(
        body.tracks.map((t) => ({
          sessionId: session.sessionId,
          channelId: session.channelId,
          userId,
          trackName: t.trackName!,
          mid: t.mid,
          kind: t.kind!,
          source: t.source!,
        })),
      );
      return result;
    } catch (err: any) {
      server.log.error(err, "Failed to publish tracks to Cloudflare Calls");
      console.warn(
        "[CF media] publish failed:",
        err instanceof Error ? err.message : "unknown",
      );
      return reply.status(502).send({ error: "Failed to publish tracks" });
    }
  },
);

// 6.5 订阅远端音视频轨道 (Subscribe Tracks / Remote Tracks)
server.post(
  "/api/cloudflare-realtime/tracks/subscribe",
  async (request, reply) => {
    if (!cloudflareRealtimeService.isSfuConfigured) {
      return reply
        .status(503)
        .send({ error: "Cloudflare Calls SFU is not configured" });
    }
    const userId = await getUserIdFromRequest(request);
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const body = cfBody(request);
    const session = await cfSessionForRequest(request, body.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      body.channelId !== session.channelId ||
      !Array.isArray(body.tracks) ||
      body.tracks.length < 1 ||
      body.tracks.length > 16 ||
      body.tracks.some(
        (t) =>
          !t.publisherSessionId ||
          !t.trackName ||
          cloudflareRealtimeService.getReadyTrack(
            t.publisherSessionId,
            t.trackName,
          )?.channelId !== session.channelId,
      )
    ) {
      return reply
        .status(400)
        .send({ error: "Invalid subscribe request body" });
    }

    try {
      const result = await cloudflareRealtimeService.subscribeTracks(
        body as CfCallsSubscribeTrackRequest,
      );
      cloudflareRealtimeService.recordSubscriptions(
        session.sessionId,
        result.tracks.map((track, index) => ({
          mid: track.mid!,
          publisherSessionId: body.tracks![index].publisherSessionId!,
          trackName: body.tracks![index].trackName!,
        })),
      );
      return result;
    } catch (err: any) {
      server.log.error(err, "Failed to subscribe tracks from Cloudflare Calls");
      const statuses = await Promise.all(
        body.tracks
          .slice(0, 3)
          .map((t) =>
            cloudflareRealtimeService.publicationStatus(
              t.publisherSessionId!,
              t.trackName!,
            ),
          ),
      );
      console.warn(
        "[CF media] subscribe failed:",
        err instanceof Error ? err.message : "unknown",
        "publisher statuses:",
        statuses.join(","),
      );
      return reply.status(502).send({ error: "Failed to subscribe tracks" });
    }
  },
);

// A remote MID belongs to one authenticated media session. Closing it releases
// the SFU subscription without letting a viewer close the host's publication.
server.put(
  "/api/cloudflare-realtime/tracks/unsubscribe",
  async (request, reply) => {
    const body = cfBody(request) as CfCallsUnsubscribeRequest;
    const session = await cfSessionForRequest(request, body.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      body.channelId !== session.channelId ||
      !Array.isArray(body.tracks) ||
      body.tracks.length < 1 ||
      body.tracks.length > 16 ||
      body.tracks.some(
        (track) =>
          typeof track.mid !== "string" ||
          !/^\d{1,3}$/.test(track.mid) ||
          !cloudflareRealtimeService.ownsSubscriptionMid(
            session.sessionId,
            session.channelId,
            track.mid,
          ),
      )
    )
      return reply
        .status(400)
        .send({ error: "Invalid unsubscribe request body" });
    const mids = [...new Set(body.tracks.map((track) => track.mid))];
    const publishers = new Set(
      mids.map((mid) =>
        cloudflareRealtimeService.publisherForSubscriptionMid(
          session.sessionId,
          mid,
        ),
      ),
    );
    try {
      await cloudflareRealtimeService.closeTracks({
        sessionId: session.sessionId,
        tracks: mids.map((mid) => ({ mid })),
      });
      cloudflareRealtimeService.forgetSubscriptions(session.sessionId, mids);
      for (const publisherSessionId of publishers) {
        if (
          publisherSessionId &&
          !cloudflareRealtimeService.hasConfirmedScreenSubscription(
            session.sessionId,
            publisherSessionId,
          )
        )
          cloudflareRealtimeService.unwatchStream(
            session.sessionId,
            publisherSessionId,
          );
      }
      await cfSendViewerEvents();
      return { ok: true };
    } catch (error) {
      request.log.warn({ error }, "Cloudflare unsubscribe failed");
      return reply.status(502).send({ error: "Failed to unsubscribe tracks" });
    }
  },
);

server.post(
  "/api/cloudflare-realtime/streams/watch",
  async (request, reply) => {
    const body = cfBody(request) as CfStreamWatchRequest;
    const session = await cfSessionForRequest(request, body.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      body.channelId !== session.channelId ||
      typeof body.publisherSessionId !== "string" ||
      !/^[a-f0-9-]{20,80}$/i.test(body.publisherSessionId)
    )
      return reply.status(400).send({ error: "Invalid stream watch request" });
    const state = cloudflareRealtimeService.watchStream(
      session.sessionId,
      body.publisherSessionId,
    );
    if (!state)
      return reply.status(403).send({
        error: "Stream unavailable or screen subscription not established",
      });
    await cfSendViewerEvents();
    return state;
  },
);

server.post(
  "/api/cloudflare-realtime/streams/unwatch",
  async (request, reply) => {
    const body = cfBody(request) as CfStreamWatchRequest;
    const session = await cfSessionForRequest(request, body.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      body.channelId !== session.channelId ||
      typeof body.publisherSessionId !== "string" ||
      !/^[a-f0-9-]{20,80}$/i.test(body.publisherSessionId)
    )
      return reply.status(400).send({ error: "Invalid stream watch request" });
    const state = cloudflareRealtimeService.unwatchStream(
      session.sessionId,
      body.publisherSessionId,
    );
    await cfSendViewerEvents();
    return (
      state || {
        channelId: session.channelId,
        publisherSessionId: body.publisherSessionId,
        hostUserId: "",
        viewerCount: 0,
        watching: false,
      }
    );
  },
);

server.get(
  "/api/cloudflare-realtime/streams/viewers",
  async (request, reply) => {
    const query = request.query as Partial<CfStreamWatchRequest>;
    const session = await cfSessionForRequest(request, query.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      query.channelId !== session.channelId ||
      typeof query.publisherSessionId !== "string" ||
      !/^[a-f0-9-]{20,80}$/i.test(query.publisherSessionId)
    )
      return reply.status(400).send({ error: "Invalid stream viewer query" });
    const state = cloudflareRealtimeService.streamWatchState(
      session.sessionId,
      query.publisherSessionId,
    );
    if (!state || state.channelId !== session.channelId)
      return reply.status(404).send({ error: "Stream unavailable" });
    return state;
  },
);

// 6.6 重协商 Answer 提交
server.put(
  "/api/cloudflare-realtime/tracks/renegotiate",
  async (request, reply) => {
    if (!cloudflareRealtimeService.isSfuConfigured) {
      return reply
        .status(503)
        .send({ error: "Cloudflare Calls SFU is not configured" });
    }
    const userId = await getUserIdFromRequest(request);
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const body = cfBody(request);
    if (!(await cfSessionForRequest(request, body.sessionId)))
      return reply.status(403).send({ error: "Invalid media session" });
    if (
      body.sessionDescription?.type !== "answer" ||
      typeof body.sessionDescription.sdp !== "string"
    ) {
      return reply
        .status(400)
        .send({ error: "Invalid renegotiate request body" });
    }

    try {
      await cloudflareRealtimeService.renegotiate(
        body as CfCallsRenegotiateRequest,
      );
      cloudflareRealtimeService.confirmSubscriptions(body.sessionId!);
      return { ok: true };
    } catch (err: any) {
      server.log.error(err, "Failed to renegotiate Cloudflare Calls session");
      return reply.status(502).send({ error: "Failed to renegotiate" });
    }
  },
);

// 6.7 注销/关闭轨道
server.put("/api/cloudflare-realtime/tracks/close", async (request, reply) => {
  if (!cloudflareRealtimeService.isSfuConfigured) {
    return reply
      .status(503)
      .send({ error: "Cloudflare Calls SFU is not configured" });
  }
  const userId = await getUserIdFromRequest(request);
  if (!userId) return reply.status(401).send({ error: "Unauthorized" });

  const body = cfBody(request);
  const session = await cfSessionForRequest(request, body.sessionId);
  if (!session)
    return reply.status(403).send({ error: "Invalid media session" });
  if (
    !Array.isArray(body.tracks) ||
    body.tracks.length < 1 ||
    body.tracks.length > 8 ||
    body.tracks.some((t) => {
      const published = t.trackName
        ? cloudflareRealtimeService.getTrack(session.sessionId, t.trackName)
        : undefined;
      return (
        !published ||
        published.userId !== userId ||
        !published.mid ||
        t.mid !== published.mid
      );
    })
  ) {
    return reply
      .status(400)
      .send({ error: "Invalid close tracks request body" });
  }

  try {
    await cloudflareRealtimeService.closeTracks(
      body as CfCallsCloseTracksRequest,
    );
    cloudflareRealtimeService.removeTracks(
      session.sessionId,
      body.tracks.map((t) => t.trackName!),
    );
    await cfSendTracks(session.channelId);
    await cfSendViewerEvents();
    return { ok: true };
  } catch (err: any) {
    server.log.error(err, "Failed to close Cloudflare Calls tracks");
    return reply.status(502).send({ error: "Failed to close tracks" });
  }
});

server.post("/api/cloudflare-realtime/tracks/ready", async (request, reply) => {
  const session = await cfSessionForRequest(request, cfBody(request).sessionId);
  if (!session)
    return reply.status(403).send({ error: "Invalid media session" });
  cloudflareRealtimeService.markTracksReady(session.sessionId);
  await cfSendTracks(session.channelId);
  return { ok: true };
});

server.post(
  "/api/cloudflare-realtime/session/heartbeat",
  async (request, reply) => {
    const session = await cfSessionForRequest(
      request,
      cfBody(request).sessionId,
    );
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    cloudflareRealtimeService.touchSession(session.sessionId);
    return { ok: true };
  },
);

server.post(
  "/api/cloudflare-realtime/session/leave",
  async (request, reply) => {
    const body = cfBody(request);
    const session = await cfSessionForRequest(request, body.sessionId);
    if (!session)
      return reply.status(403).send({ error: "Invalid media session" });
    await cloudflareRealtimeService
      .revokeSession(session.sessionId)
      .catch((error) =>
        request.log.warn({ error }, "Cloudflare session teardown incomplete"),
      );
    await cfSendTracks(session.channelId);
    await cfSendViewerEvents();
    return { ok: true };
  },
);

const cloudflareMediaSweep = setInterval(async () => {
  for (const [sessionId, session] of cloudflareRealtimeService.listSessions()) {
    try {
      const login = await prisma.refreshToken.findUnique({
        where: { id: session.loginSessionId },
        select: { userId: true, expiresAt: true },
      });
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { isBanned: true },
      });
      if (
        Date.now() - session.lastSeenAt <= 45_000 &&
        login?.userId === session.userId &&
        login.expiresAt > new Date() &&
        user &&
        !user.isBanned &&
        (await cfCanUseChannel(session.userId, session.channelId))
      )
        continue;
      await cloudflareRealtimeService.revokeSession(sessionId);
      await cfSendTracks(session.channelId);
      await cfSendViewerEvents();
    } catch (error) {
      server.log.warn({ error }, "Cloudflare media revocation retry pending");
    }
  }
}, 10_000);
cloudflareMediaSweep.unref();

// ==========================================
// 7. 超级管理员系统运维与治理 API (Super Admin)
// ==========================================

// 获取系统综合运行指标看板
server.get(
  "/api/admin/overview",
  { preValidation: [(server as any).requireSuperAdmin] },
  async () => {
    return await adminService.getOverviewStats();
  },
);

// 全局检索与分页列出用户
server.get(
  "/api/admin/users",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request) => {
    const query = (request.query || {}) as Record<string, string | undefined>;
    return await adminService.listUsers({
      search: query.search,
      role: query.role as any,
      banned: query.banned === undefined ? undefined : query.banned === "true",
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 50),
    });
  },
);

// 更新指定用户 (修改角色、封禁/解封、重置密码)
server.patch(
  "/api/admin/users/:userId",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request, reply) => {
    const { userId } = request.params as any;
    const body = request.body as AdminUpdateUserDTO;
    try {
      return await adminService.updateUser(
        (request.user as any).sub,
        userId,
        body,
      );
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "更新用户失败",
      });
    }
  },
);

// 列出全平台所有公会/服务器
server.get(
  "/api/admin/guilds",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request) => {
    const query = (request.query || {}) as Record<string, string | undefined>;
    return await adminService.listGuilds({
      search: query.search,
      page: Number(query.page || 1),
      pageSize: Number(query.pageSize || 50),
    });
  },
);

// 强制解散违规公会/服务器
server.delete(
  "/api/admin/guilds/:guildId",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request, reply) => {
    const { guildId } = request.params as any;
    const body = (request.body || {}) as { nameConfirmation?: string };
    try {
      await adminService.forceDeleteGuild(
        (request.user as any).sub,
        guildId,
        body.nameConfirmation || "",
      );
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "强制解散服务器失败",
      });
    }
    return reply.status(204).send();
  },
);

// 发送全平台置顶广播
server.post(
  "/api/admin/broadcast",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request, reply) => {
    const userPayload = request.user as any;
    const body = request.body as any;
    if (!body?.title || !body?.content) {
      return reply.status(400).send({ error: "广播标题和内容为必填项" });
    }
    return await adminService.broadcastMessage((request.user as any).sub, {
      title: body.title,
      content: body.content,
      severity: body.severity || "INFO",
      senderName: userPayload?.username || "系统管理员",
    });
  },
);

// 获取系统运维设置 (新用户注册开关等)
server.get(
  "/api/admin/settings",
  { preValidation: [(server as any).requireSuperAdmin] },
  async () => {
    return await adminService.getSettings();
  },
);

// 更新系统运维设置
server.patch(
  "/api/admin/settings",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request) => {
    const body = request.body as any;
    return await adminService.updateSettings((request.user as any).sub, body);
  },
);

// 获取注册邀请码列表 (分页/检索/状态筛选)
server.get(
  "/api/admin/registration-invites",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request) => {
    const query = request.query as any;
    return await registrationInviteService.listInvites({
      page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 20,
      search: query.search,
      status: query.status,
    });
  },
);

// 创建新注册邀请码
server.post(
  "/api/admin/registration-invites",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request, reply) => {
    try {
      const body = request.body as CreateRegistrationInviteDTO;
      const adminId = (request.user as any).sub;
      return await registrationInviteService.createInvite(body, adminId);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || "创建邀请码失败" });
    }
  },
);

// 作废或恢复邀请码
server.patch(
  "/api/admin/registration-invites/:code/revoke",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const body = request.body as { isRevoked?: boolean };
      const isRevoked = body.isRevoked !== false; // 默认作废
      const adminId = (request.user as any).sub;
      return await registrationInviteService.setRevoked(
        code,
        isRevoked,
        adminId,
      );
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || "操作失败" });
    }
  },
);

// 删除邀请码
server.delete(
  "/api/admin/registration-invites/:code",
  { preValidation: [(server as any).requireSuperAdmin] },
  async (request, reply) => {
    try {
      const { code } = request.params as { code: string };
      const adminId = (request.user as any).sub;
      return await registrationInviteService.deleteInvite(code, adminId);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || "删除邀请码失败" });
    }
  },
);

// ==========================================
// 8. 私信会话 (Direct Messages) 与 1v1 呼叫 API
// ==========================================

// 获取当前登录用户的所有活跃私信列表
server.get(
  "/api/users/@me/channels",
  { preValidation: [(server as any).authenticate] },
  async (request) => {
    const userPayload = request.user as any;
    const query = request.query as { page?: string; pageSize?: string };
    return await dmService.getDMChannels(
      userPayload.sub,
      Number(query.page || 1),
      Number(query.pageSize || 50),
    );
  },
);

// 发起或幂等获取与某用户的 1v1 私信会话
server.post(
  "/api/users/@me/channels",
  { preValidation: [(server as any).authenticate] },
  async (request, reply) => {
    const userPayload = request.user as any;
    const body = request.body as CreateDMDTO;
    if (!body?.recipientId) {
      return reply.status(400).send({ error: "缺少接收方 ID (recipientId)" });
    }

    try {
      return await dmService.getOrCreateDMChannel(
        userPayload.sub,
        body.recipientId,
      );
    } catch (err: any) {
      return reply.status(403).send({ error: err.message || "建立私信失败" });
    }
  },
);

// 关闭/隐藏私信会话 (从左侧私信列表移除)
server.delete(
  "/api/users/@me/channels/:channelId",
  { preValidation: [(server as any).authenticate] },
  async (request, reply) => {
    const userPayload = request.user as any;
    const { channelId } = request.params as any;
    await dmService.closeDMChannel(userPayload.sub, channelId);
    return reply.status(204).send();
  },
);

// 标记私信已读
server.post(
  "/api/channels/:channelId/read",
  { preValidation: [(server as any).authenticate] },
  async (request, reply) => {
    const userPayload = request.user as any;
    const { channelId } = request.params as any;
    const body = (request.body || {}) as MarkDMReadDTO;
    try {
      const lastReadSequence = await dmService.markAsRead(
        userPayload.sub,
        channelId,
        body.lastReadSequence,
      );
      return { channelId, lastReadSequence };
    } catch (error: any) {
      return reply.status(403).send({ error: error.message || "无法标记已读" });
    }
  },
);

// 申请 1v1 私信专属 LiveKit 房间 Token
server.post(
  "/api/channels/dm/:channelId/call-token",
  { preValidation: [(server as any).authenticate] },
  async (request, reply) => {
    const userPayload = request.user as any;
    const { channelId } = request.params as any;
    const body = (request.body || {}) as {
      callId?: string;
      sessionId?: string;
    };
    if (!body.callId || !body.sessionId) {
      return reply.status(400).send({ error: "缺少 callId 或设备会话标识" });
    }
    try {
      dmCallService.authorizeMedia(
        userPayload.sub,
        body.sessionId,
        body.callId,
        channelId,
      );
    } catch (error) {
      return reply.status(403).send({
        error: error instanceof Error ? error.message : "无权加入此私信通话",
      });
    }

    const roomName = `dm_${channelId}_${body.callId}`;
    const token = await generateLiveKitToken({
      roomName,
      identity: userPayload.sub,
      name: userPayload.username,
      isPublisher: true,
    });

    return {
      ...token,
      callId: body.callId,
      roomName,
      serverUrl: process.env.LIVEKIT_URL || "ws://localhost:7880",
    };
  },
);

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
    await gatewayManager.initMaintenanceState();

    // 历史服务器向下兼容自动补齐 @everyone 基础角色
    const existingGuilds = await prisma.guild.findMany({
      select: { id: true },
    });
    for (const g of existingGuilds) {
      await permissionService.ensureEveryoneRole(g.id);
    }

    await server.listen({ port: PORT, host: HOST });
    console.log(
      `🚀 Tescord 后端服务与 Gateway 网关已在 http://${HOST}:${PORT} 启动 (${process.env.DATABASE_PROVIDER} 持久化与 ${storageService.getMode()} 存储已就绪)`,
    );
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

export { server, start };

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("index.js"));

if (isDirectRun) {
  start();
}
