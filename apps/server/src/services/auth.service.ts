import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { FastifyInstance } from "fastify";
import {
  AuthTokens,
  AuthFailureCode,
  GatewayEvents,
  GatewayOpCode,
  LoginDTO,
  RegisterDTO,
  RegistrationStatusResponse,
  UpdateProfileDTO,
  User,
  UserStatus,
  CheckEmailResponse,
} from "@tescord/types";
import { prisma } from "../db.js";
import { cacheStore } from "../cache.js";
import { gatewayManager } from "../gateway.js";
import { registrationInviteService } from "./registration-invite.service.js";

export class AuthFailure extends Error {
  constructor(
    public code: AuthFailureCode,
    message: string,
  ) {
    super(message);
  }
}

const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export class AuthService {
  private fastify: FastifyInstance;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
  }

  /**
   * 检查邮箱（或已有用户名）是否已在系统中注册
   */
  public async checkEmail(email: string): Promise<CheckEmailResponse> {
    const input = email.trim();
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.toLowerCase() }, { username: input }],
      },
      select: { id: true },
    });
    return { exists: Boolean(existing) };
  }

  /**
   * 将 Prisma User 实体转换为统一契约协议 User
   */
  public formatUser(u: any): User {
    const fallbackDiscriminator =
      u.discriminator ||
      (typeof u.username === "string" && u.username.includes("#")
        ? u.username.split("#")[1]
        : "00000");

    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName || null,
      discriminator: fallbackDiscriminator,
      email: u.email,
      avatarUrl: u.avatarUrl || null,
      status: (u.status as UserStatus) || "ONLINE",
      customStatus: u.customStatus || null,
      bio: u.bio || null,
      bannerUrl: u.bannerUrl || null,
      bannerColor: u.bannerColor || null,
      themeColor: u.themeColor || null,
      showActivity:
        u.showActivity !== undefined ? Boolean(u.showActivity) : true,
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
   * 生成 Access Token (15分钟) 与 Refresh Token (30天)，并持久化 Refresh Token
   */
  public async generateAuthTokens(user: any): Promise<AuthTokens> {
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const session = await prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefreshToken(rawRefreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_LIFETIME_MS),
      },
    });
    return this.issueTokens(user, session.id, rawRefreshToken);
  }

  private hashRefreshToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private async issueTokens(
    user: any,
    sessionId: string,
    rawRefreshToken: string,
  ): Promise<AuthTokens> {
    const formattedUser = this.formatUser(user);
    const accessToken = this.fastify.jwt.sign(
      {
        sub: user.id,
        sessionId,
        username: user.username,
        email: user.email,
        role: user.role || "USER",
        sessionVersion: user.sessionVersion || 0,
      },
      { expiresIn: "15m" },
    );

    await cacheStore
      .setUserPresence(user.id, formattedUser.status)
      .catch(() => {});

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
        key: {
          in: [
            "allow_registration",
            "require_invite_code",
            "allow_non_super_admin_create_guild",
          ],
        },
      },
    });
    const map = new Map(settings.map((s) => [s.key, s.value]));
    return {
      allowRegistration: map.get("allow_registration") !== "false",
      requireInviteCode: map.get("require_invite_code") === "true",
      allowNonSuperAdminCreateGuild:
        map.get("allow_non_super_admin_create_guild") !== "false",
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

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(dto.email.trim())) {
      throw new Error("请输入有效的邮箱地址");
    }

    // 确定唯一用户名与 tag 逻辑：若提供昵称则生成类似 Discord 风格的「昵称#随机5位数字」(如 Nick#43142)
    let finalUsername = dto.username?.trim();
    let finalDiscriminator = "";
    let finalDisplayName: string | null = dto.nickname?.trim() || null;

    if (dto.nickname && dto.nickname.trim()) {
      const baseName = dto.nickname.trim().replace(/#/g, "");
      for (let attempt = 0; attempt < 15; attempt++) {
        const tag = Math.floor(10000 + Math.random() * 90000);
        const candidate = `${baseName}#${tag}`;
        const exists = await prisma.user.findFirst({
          where: { username: candidate },
          select: { id: true },
        });
        if (!exists) {
          finalUsername = candidate;
          finalDiscriminator = String(tag);
          break;
        }
      }
      if (!finalUsername) {
        const tag = Date.now().toString().slice(-5);
        finalUsername = `${baseName}#${tag}`;
        finalDiscriminator = tag;
      }
    } else if (!finalUsername) {
      const baseName = (dto.email.split("@")[0].trim() || "User").replace(
        /#/g,
        "",
      );
      const tag = Math.floor(10000 + Math.random() * 90000);
      finalUsername = `${baseName}#${tag}`;
      finalDiscriminator = String(tag);
      finalDisplayName = baseName;
    } else {
      if (finalUsername.includes("#")) {
        const parts = finalUsername.split("#");
        finalDiscriminator =
          parts[1] || String(Math.floor(10000 + Math.random() * 90000));
        finalDisplayName = parts[0];
      } else {
        finalDiscriminator = String(Math.floor(10000 + Math.random() * 90000));
        finalDisplayName = finalUsername;
        finalUsername = `${finalUsername}#${finalDiscriminator}`;
      }
    }

    const existingEmail = await prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existingEmail) {
      throw new Error("该邮箱已被注册");
    }

    const existingUsername = await prisma.user.findFirst({
      where: { username: finalUsername },
    });
    if (existingUsername) {
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
          username: finalUsername,
          displayName: finalDisplayName,
          discriminator: finalDiscriminator,
          email: dto.email.toLowerCase().trim(),
          passwordHash,
          avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(finalUsername)}`,
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
      throw new AuthFailure("AUTH_INVALID_CREDENTIALS", "账号或密码不正确");
    }

    if (user.isBanned) {
      throw new AuthFailure(
        "AUTH_ACCOUNT_BANNED",
        "该账号已被系统封禁，无法登录",
      );
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new AuthFailure("AUTH_INVALID_CREDENTIALS", "账号或密码不正确");
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
    if (!rawRefreshToken || !/^[a-f0-9]{80}$/.test(rawRefreshToken)) {
      throw new AuthFailure("AUTH_REFRESH_INVALID", "无效的刷新凭据");
    }
    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new AuthFailure("AUTH_REFRESH_INVALID", "无效的刷新凭据");
    }

    if (tokenRecord.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      throw new AuthFailure("AUTH_REFRESH_EXPIRED", "登录已过期，请重新登录");
    }

    if (tokenRecord.user.isBanned) {
      await prisma.refreshToken.deleteMany({
        where: { userId: tokenRecord.userId },
      });
      throw new AuthFailure("AUTH_ACCOUNT_BANNED", "该账号已被系统封禁");
    }
    const newRefreshToken = crypto.randomBytes(40).toString("hex");
    // 条件更新保证并发中只有一个请求消费旧凭据；更新失败时事务回滚。
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: tokenRecord.userId },
      });
      if (!user || user.isBanned) {
        throw new AuthFailure("AUTH_ACCOUNT_BANNED", "账号不可用");
      }
      const changed = await tx.refreshToken.updateMany({
        where: { id: tokenRecord.id, tokenHash, expiresAt: { gt: new Date() } },
        data: {
          tokenHash: this.hashRefreshToken(newRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_LIFETIME_MS),
        },
      });
      if (changed.count !== 1) {
        throw new AuthFailure("AUTH_REFRESH_INVALID", "刷新凭据已使用，请重试");
      }
      return user;
    });
    return this.issueTokens(updated, tokenRecord.id, newRefreshToken);
  }

  public async revokeSession(rawRefreshToken: string): Promise<void> {
    if (!/^[a-f0-9]{80}$/.test(rawRefreshToken)) return;
    await prisma.refreshToken.deleteMany({
      where: { tokenHash: this.hashRefreshToken(rawRefreshToken) },
    });
  }

  /**
   * 修改个人资料
   */
  public async updateProfile(
    userId: string,
    dto: UpdateProfileDTO,
  ): Promise<User> {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!currentUser) {
      throw new Error("用户不存在");
    }

    const dataToUpdate: any = {
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
      ...(dto.themeColor !== undefined ? { themeColor: dto.themeColor } : {}),
      ...(dto.showActivity !== undefined
        ? { showActivity: dto.showActivity }
        : {}),
    };

    if (dto.displayName !== undefined) {
      dataToUpdate.displayName = dto.displayName
        ? dto.displayName.trim()
        : null;
    }

    if (dto.username !== undefined && dto.username.trim()) {
      // 提取不可变 5 位 discriminator
      let discriminator = currentUser.discriminator;
      if (!discriminator || discriminator === "00000") {
        if (currentUser.username.includes("#")) {
          discriminator = currentUser.username.split("#")[1];
        } else {
          discriminator = String(Math.floor(10000 + Math.random() * 90000));
        }
      }

      // 用户想要修改识别码的前缀
      const cleanPrefix = dto.username.split("#")[0].trim().replace(/#/g, "");
      if (!cleanPrefix) {
        throw new Error("用户名识别码前缀不能为空");
      }
      const newUsername = `${cleanPrefix}#${discriminator}`;
      if (newUsername !== currentUser.username) {
        const conflict = await prisma.user.findFirst({
          where: {
            username: newUsername,
            id: { not: userId },
          },
        });
        if (conflict) {
          throw new Error("该识别码已被占用，请尝试其他前缀");
        }
        dataToUpdate.username = newUsername;
        dataToUpdate.discriminator = discriminator;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
    });

    if (dto.status) {
      await cacheStore.setUserPresence(userId, dto.status);
    }

    return this.formatUser(updated);
  }
}
