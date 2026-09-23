import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { FastifyInstance } from "fastify";
import {
  AuthTokens,
  GatewayEvents,
  GatewayOpCode,
  LoginDTO,
  RegisterDTO,
  RegistrationStatusResponse,
  UpdateProfileDTO,
  User,
  UserStatus,
} from "@tescord/types";
import { prisma } from "../db.js";
import { cacheStore } from "../cache.js";
import { gatewayManager } from "../gateway.js";
import { registrationInviteService } from "./registration-invite.service.js";

export class AuthService {
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
  }

  /**
   * 将 Prisma User 实体转换为统一契约协议 User
   */
  public formatUser(u: any): User {
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      avatarUrl: u.avatarUrl || null,
      status: (u.status as UserStatus) || "ONLINE",
      customStatus: u.customStatus || null,
      bio: u.bio || null,
      bannerUrl: u.bannerUrl || null,
      bannerColor: u.bannerColor || null,
      themeColor: u.themeColor || null,
      showActivity: u.showActivity !== undefined ? Boolean(u.showActivity) : true,
      role: (u.role as any) || "USER",
      isBanned: u.isBanned || false,
      mustChangePassword: u.mustChangePassword || false,
      createdAt:
        u.createdAt instanceof Date
          ? u.createdAt.toISOString()
          : String(u.createdAt),
      updatedAt:
        u.updatedAt instanceof Date ? u.updatedAt.toISOString() : undefined,
    };
  }

  /**
   * 生成 Access Token (15分钟) 与 Refresh Token (7天)，并持久化 Refresh Token
   */
  public async generateAuthTokens(user: any): Promise<AuthTokens> {
    const formattedUser = this.formatUser(user);

    // 1. 生成短生命周期 Access Token (15m)
    const accessToken = this.fastify.jwt.sign(
      {
        sub: user.id,
        username: user.username,
        email: user.email,
        role: user.role || "USER",
        sessionVersion: user.sessionVersion || 0,
      },
      { expiresIn: "15m" },
    );

    // 2. 生成安全随机 Refresh Token (7d)
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawRefreshToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7天

    // 3. 将 Refresh Token 哈希持久化至数据库
    await prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    // 4. 写入缓存记录在线状态
    await cacheStore.setUserPresence(user.id, formattedUser.status);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: formattedUser,
      expiresIn: 900, // 15分钟 (秒)
    };
  }

  /**
   * 获取系统当前注册策略 (公开)
   */
  public async getRegistrationStatus(): Promise<RegistrationStatusResponse> {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: { in: ["allow_registration", "require_invite_code"] },
      },
    });
    const map = new Map(settings.map((s) => [s.key, s.value]));
    return {
      allowRegistration: map.get("allow_registration") !== "false",
      requireInviteCode: map.get("require_invite_code") === "true",
    };
  }

  /**
   * 用户注册 (检查唯一性、注册策略、邀请码核销、密码哈希)
   */
  public async register(dto: RegisterDTO): Promise<AuthTokens> {
    const status = await this.getRegistrationStatus();
    if (!status.allowRegistration) {
      throw new Error("当前系统已暂停新用户注册");
    }

    const inviteCode = dto.inviteCode?.trim().toUpperCase();
    if (status.requireInviteCode && !inviteCode) {
      throw new Error("系统已开启邀请码准入，请输入有效的注册邀请码");
    }

    if (inviteCode) {
      // 预先校验邀请码基础有效性
      await registrationInviteService.validateInvite(inviteCode);
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email.toLowerCase() }, { username: dto.username }],
      },
    });

    if (existing) {
      if (existing.email.toLowerCase() === dto.email.toLowerCase()) {
        throw new Error("该邮箱已被注册");
      }
      throw new Error("该用户名已被占用");
    }

    if (dto.password.length < 6) {
      throw new Error("密码长度不能少于 6 位");
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const user = await prisma.$transaction(async (tx) => {
      if (inviteCode) {
        // 在事务内进行严格核验并原子累加使用次数
        await registrationInviteService.validateInvite(inviteCode, tx);
        await tx.registrationInvite.update({
          where: { code: inviteCode },
          data: { uses: { increment: 1 } },
        });
      }

      return tx.user.create({
        data: {
          username: dto.username,
          email: dto.email.toLowerCase(),
          passwordHash,
          avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(dto.username)}`,
          status: "ONLINE",
          registeredWithInviteCode: inviteCode || null,
        },
      });
    });

    return this.generateAuthTokens(user);
  }

  /**
   * 用户登录 (支持邮箱或用户名 + 密码校验)
   */
  public async login(dto: LoginDTO): Promise<AuthTokens> {
    const input = dto.emailOrUsername.trim();
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.toLowerCase() }, { username: input }],
      },
    });

    if (!user) {
      throw new Error("账号或密码不正确");
    }

    if (user.isBanned) {
      throw new Error("该账号已被系统封禁，无法登录");
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new Error("账号或密码不正确");
    }

    return this.generateAuthTokens(user);
  }

  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (newPassword.length < 10) {
      throw new Error("新密码长度不能少于 10 位");
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isBanned) throw new Error("账号不可用");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new Error("当前密码不正确");
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          sessionVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.platformAuditLog.create({
        data: {
          actorId: userId,
          action: "PASSWORD_CHANGED",
          targetType: "USER",
          targetId: userId,
          detailsJson: JSON.stringify({ forced: user.mustChangePassword }),
        },
      }),
    ]);
    gatewayManager.disconnectUser(userId);
  }

  /**
   * 双令牌无感刷新 (Token Rotation)
   */
  public async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    if (!rawRefreshToken) {
      throw new Error("缺失 Refresh Token");
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawRefreshToken)
      .digest("hex");
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new Error("无效的 Refresh Token");
    }

    if (tokenRecord.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      throw new Error("Refresh Token 已过期，请重新登录");
    }

    if (tokenRecord.user.isBanned) {
      await prisma.refreshToken.deleteMany({
        where: { userId: tokenRecord.userId },
      });
      throw new Error("该账号已被系统封禁");
    }

    // 轮换机制：消费旧 Refresh Token 并销毁
    await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

    // 签发全新 Access Token 与 Refresh Token
    return this.generateAuthTokens(tokenRecord.user);
  }

  /**
   * 修改个人资料
   */
  public async updateProfile(
    userId: string,
    dto: UpdateProfileDTO,
  ): Promise<User> {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.username ? { username: dto.username } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.customStatus !== undefined
          ? { customStatus: dto.customStatus }
          : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.bannerUrl !== undefined ? { bannerUrl: dto.bannerUrl } : {}),
        ...(dto.bannerColor !== undefined
          ? { bannerColor: dto.bannerColor }
          : {}),
        ...(dto.themeColor !== undefined
          ? { themeColor: dto.themeColor }
          : {}),
        ...(dto.showActivity !== undefined
          ? { showActivity: dto.showActivity }
          : {}),
      },
    });

    if (dto.status) {
      await cacheStore.setUserPresence(userId, dto.status);
    }

    return this.formatUser(updated);
  }
}
