import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { FastifyRequest } from "fastify";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  ErrorCode,
  PasskeyInfo,
  WebAuthnRegisterOptionsResponse,
  WebAuthnVerifyRegisterDTO,
  WebAuthnLoginOptionsResponse,
  WebAuthnVerifyLoginDTO,
  AuthResponse,
} from "@tescord/types";
import { prisma } from "../db.js";
import { cacheStore } from "../cache.js";
import { AuthService } from "./auth.service.js";

export class WebAuthnError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
  }
}

export interface RelyingPartyConfig {
  rpName: string;
  rpID: string;
  expectedOrigin: string[];
}

export function getRelyingPartyConfig(req: FastifyRequest): RelyingPartyConfig {
  const envRpId = process.env.WEBAUTHN_RP_ID?.trim();
  const envRpName = process.env.WEBAUTHN_RP_NAME?.trim() || "Tescord";
  const envOrigins = process.env.WEBAUTHN_ORIGINS
    ? process.env.WEBAUTHN_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  if (process.env.NODE_ENV === "production") {
    const serverOrigin = new URL(process.env.SERVER_BASE_URL || "");
    return {
      rpName: envRpName,
      rpID: envRpId || serverOrigin.hostname,
      expectedOrigin:
        envOrigins && envOrigins.length > 0
          ? envOrigins
          : [serverOrigin.origin],
    };
  }

  // 优先从客户端 Origin 或 Referer 提取访问域名，完美应对 Vite proxy / 反向代理变更 Host 的情况
  let clientHostname = "";
  let clientOrigin = "";
  const rawOrigin = req.headers.origin?.trim();
  if (rawOrigin) {
    try {
      const u = new URL(rawOrigin);
      clientHostname = u.hostname;
      clientOrigin = u.origin;
    } catch {}
  } else if (req.headers.referer) {
    try {
      const u = new URL(req.headers.referer);
      clientHostname = u.hostname;
      clientOrigin = u.origin;
    } catch {}
  }

  const hostHeader = (
    (req.headers["x-forwarded-host"] as string) ||
    req.headers.host ||
    "localhost:3001"
  ).trim();
  const hostname = hostHeader.split(":")[0];
  const rpID = envRpId || clientHostname || hostname;

  const proto = (req.headers["x-forwarded-proto"] as string) || "http";

  const inferredOrigins = new Set<string>([
    `http://${rpID}:3000`,
    `https://${rpID}:3000`,
    `http://${rpID}:4173`,
    `https://${rpID}:4173`,
    `http://${rpID}:3001`,
    `https://${rpID}:3001`,
    `http://${hostname}:3000`,
    `https://${hostname}:3000`,
    `http://${hostname}:4173`,
    `https://${hostname}:4173`,
    `http://${hostname}:3001`,
    `https://${hostname}:3001`,
    `http://localhost:3000`,
    `https://localhost:3000`,
    `http://localhost:4173`,
    `https://localhost:4173`,
    `http://127.0.0.1:3000`,
    `https://127.0.0.1:3000`,
    `http://127.0.0.1:4173`,
    `https://127.0.0.1:4173`,
    `http://localhost:3001`,
    `https://localhost:3001`,
    `http://127.0.0.1:3001`,
    `https://127.0.0.1:3001`,
    `${proto}://${hostHeader}`,
  ]);

  if (clientOrigin) {
    inferredOrigins.add(clientOrigin);
  }

  const expectedOrigin =
    envOrigins && envOrigins.length > 0
      ? envOrigins
      : Array.from(inferredOrigins);

  return { rpName: envRpName, rpID, expectedOrigin };
}

export function formatPasskey(p: any): PasskeyInfo {
  let parsedTransports: string[] | null = null;
  if (p.transports) {
    try {
      parsedTransports = JSON.parse(p.transports);
    } catch {
      parsedTransports = null;
    }
  }

  return {
    id: p.id,
    name: p.name,
    createdAt:
      p.createdAt instanceof Date
        ? p.createdAt.toISOString()
        : String(p.createdAt),
    lastUsedAt: p.lastUsedAt
      ? p.lastUsedAt instanceof Date
        ? p.lastUsedAt.toISOString()
        : String(p.lastUsedAt)
      : null,
    aaguid: p.aaguid || null,
    transports: parsedTransports,
  };
}

const CHALLENGE_TTL_SECONDS = 300; // 5 分钟有效

export class WebAuthnService {
  constructor(private authService: AuthService) {}

  /**
   * 生成通行密钥注册配置 (Options)
   */
  public async generateRegisterOptions(
    user: any,
    req: FastifyRequest,
  ): Promise<WebAuthnRegisterOptionsResponse> {
    const config = getRelyingPartyConfig(req);

    const existingPasskeys = await prisma.passkey.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });

    const excludeCredentials = existingPasskeys.map((pk) => ({
      id: pk.credentialId,
      transports: pk.transports
        ? (JSON.parse(pk.transports) as any)
        : undefined,
    }));

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email || user.username,
      userDisplayName: user.displayName || user.username,
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });

    const challengeId = crypto.randomUUID();
    await cacheStore.set(
      `webauthn:challenge:${challengeId}`,
      JSON.stringify({
        challenge: options.challenge,
        userId: user.id,
        type: "register",
      }),
      CHALLENGE_TTL_SECONDS,
    );

    return {
      options,
      challengeId,
    };
  }

  /**
   * 验证通行密钥注册响应并持久化
   */
  public async verifyRegisterResponse(
    user: any,
    dto: WebAuthnVerifyRegisterDTO,
    req: FastifyRequest,
  ): Promise<PasskeyInfo> {
    const cacheKey = `webauthn:challenge:${dto.challengeId}`;
    const rawCached = await cacheStore.getdel(cacheKey);
    if (!rawCached) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CHALLENGE_EXPIRED,
        "认证挑战已过期或无效，请重试",
        400,
      );
    }

    let cached: { challenge: string; userId?: string; type: string };
    try {
      cached = JSON.parse(rawCached);
    } catch {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CHALLENGE_EXPIRED,
        "认证挑战格式异常",
        400,
      );
    }

    if (cached.type !== "register" || cached.userId !== user.id) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CHALLENGE_EXPIRED,
        "挑战信息不匹配",
        400,
      );
    }

    const config = getRelyingPartyConfig(req);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.response,
        expectedChallenge: cached.challenge,
        expectedOrigin: config.expectedOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
    } catch (err: any) {
      req.log.warn({ err }, "WebAuthn registration verification failed");
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_VERIFICATION_FAILED,
        `通行密钥验证失败: ${err.message || "未知错误"}`,
        400,
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_VERIFICATION_FAILED,
        "通行密钥验证未通过",
        400,
      );
    }

    const { credential, aaguid } = verification.registrationInfo;

    const existing = await prisma.passkey.findUnique({
      where: { credentialId: credential.id },
    });
    if (existing) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CREDENTIAL_EXISTS,
        "该通行密钥已在此账号绑定",
        409,
      );
    }

    const publicKeyBase64Url = Buffer.from(credential.publicKey).toString(
      "base64url",
    );
    const defaultName = (dto.name || "").trim() || "通行密钥";

    const saved = await prisma.passkey.create({
      data: {
        userId: user.id,
        name: defaultName,
        credentialId: credential.id,
        publicKey: publicKeyBase64Url,
        counter: BigInt(credential.counter || 0),
        transports: credential.transports
          ? JSON.stringify(credential.transports)
          : null,
        aaguid: aaguid || null,
      },
    });

    return formatPasskey(saved);
  }

  /**
   * 生成通行密钥登录配置 (Options)
   */
  public async generateLoginOptions(
    req: FastifyRequest,
    emailOrUsername?: string,
  ): Promise<WebAuthnLoginOptionsResponse> {
    const config = getRelyingPartyConfig(req);

    let allowCredentials: any[] | undefined = undefined;
    let targetUserId: string | undefined = undefined;

    if (emailOrUsername && emailOrUsername.trim()) {
      const input = emailOrUsername.trim();
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ email: input.toLowerCase() }, { username: input }],
        },
        include: {
          passkeys: true,
        },
      });

      if (user && user.passkeys.length > 0) {
        targetUserId = user.id;
        allowCredentials = user.passkeys.map((pk) => ({
          id: pk.credentialId,
          transports: pk.transports ? JSON.parse(pk.transports) : undefined,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      userVerification: "required",
      allowCredentials,
    });

    const challengeId = crypto.randomUUID();
    await cacheStore.set(
      `webauthn:challenge:${challengeId}`,
      JSON.stringify({
        challenge: options.challenge,
        userId: targetUserId,
        type: "login",
      }),
      CHALLENGE_TTL_SECONDS,
    );

    return {
      options,
      challengeId,
    };
  }

  /**
   * 验证通行密钥登录响应并签发双令牌
   */
  public async verifyLoginResponse(
    dto: WebAuthnVerifyLoginDTO,
    req: FastifyRequest,
  ): Promise<AuthResponse> {
    const cacheKey = `webauthn:challenge:${dto.challengeId}`;
    const rawCached = await cacheStore.getdel(cacheKey);
    if (!rawCached) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CHALLENGE_EXPIRED,
        "登录挑战已过期，请重新尝试",
        400,
      );
    }

    let cached: { challenge: string; userId?: string; type: string };
    try {
      cached = JSON.parse(rawCached);
    } catch {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CHALLENGE_EXPIRED,
        "挑战信息格式异常",
        400,
      );
    }

    if (cached.type !== "login") {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CHALLENGE_EXPIRED,
        "挑战类型错误",
        400,
      );
    }

    const credentialId = dto.response?.id;
    if (!credentialId) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_VERIFICATION_FAILED,
        "缺少通行密钥标识",
        400,
      );
    }

    const passkey = await prisma.passkey.findUnique({
      where: { credentialId },
      include: { user: true },
    });

    if (!passkey || !passkey.user) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_CREDENTIAL_NOT_FOUND,
        "未找到与此通行密钥匹配的账号，请先在安全设置中绑定",
        404,
      );
    }

    if (passkey.user.isBanned) {
      throw new WebAuthnError(
        ErrorCode.AUTH_ACCOUNT_DISABLED,
        "该账号已被系统封禁",
        403,
      );
    }

    if (cached.userId && cached.userId !== passkey.userId) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_VERIFICATION_FAILED,
        "所选通行密钥不属于目标账号",
        403,
      );
    }

    const config = getRelyingPartyConfig(req);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: dto.response,
        expectedChallenge: cached.challenge,
        expectedOrigin: config.expectedOrigin,
        expectedRPID: config.rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(
            Buffer.from(passkey.publicKey, "base64url"),
          ),
          counter: Number(passkey.counter),
          transports: passkey.transports
            ? JSON.parse(passkey.transports)
            : undefined,
        },
        requireUserVerification: true,
      });
    } catch (err: any) {
      req.log.warn({ err }, "WebAuthn authentication verification failed");
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_VERIFICATION_FAILED,
        `通行密钥验证失败: ${err.message || "未知错误"}`,
        400,
      );
    }

    if (!verification.verified) {
      throw new WebAuthnError(
        ErrorCode.WEBAUTHN_VERIFICATION_FAILED,
        "通行密钥签名核验未通过",
        400,
      );
    }

    // 更新计数器与最近使用时间
    await prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    // 签发系统标准双令牌
    const tokens = await this.authService.generateAuthTokens(passkey.user);

    return {
      user: tokens.user,
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * 查询用户所有绑定的通行密钥
   */
  public async listPasskeys(userId: string): Promise<PasskeyInfo[]> {
    const list = await prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return list.map(formatPasskey);
  }

  /**
   * 重命名通行密钥
   */
  public async renamePasskey(
    userId: string,
    passkeyId: string,
    newName: string,
  ): Promise<PasskeyInfo> {
    const trimmed = (newName || "").trim();
    if (!trimmed) {
      throw new WebAuthnError(
        ErrorCode.INVALID_PARAMS,
        "通行密钥名称不能为空",
        400,
      );
    }

    const passkey = await prisma.passkey.findUnique({
      where: { id: passkeyId },
    });

    if (!passkey || passkey.userId !== userId) {
      throw new WebAuthnError(ErrorCode.NOT_FOUND, "未找到对应的通行密钥", 404);
    }

    const updated = await prisma.passkey.update({
      where: { id: passkeyId },
      data: { name: trimmed },
    });

    return formatPasskey(updated);
  }

  /**
   * 解绑通行密钥（需二次校验当前账号密码）
   */
  public async deletePasskey(
    userId: string,
    passkeyId: string,
    password?: string,
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new WebAuthnError(ErrorCode.AUTH_USER_NOT_FOUND, "用户不存在", 404);
    }

    if (!password) {
      throw new WebAuthnError(
        ErrorCode.AUTH_REAUTH_REQUIRED,
        "解绑通行密钥需提供账号密码进行二次确认",
        400,
      );
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new WebAuthnError(
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        "密码输入错误，无法解除通行密钥绑定",
        401,
      );
    }

    const passkey = await prisma.passkey.findUnique({
      where: { id: passkeyId },
    });

    if (!passkey || passkey.userId !== userId) {
      throw new WebAuthnError(ErrorCode.NOT_FOUND, "未找到对应的通行密钥", 404);
    }

    await prisma.passkey.delete({
      where: { id: passkeyId },
    });
  }
}
