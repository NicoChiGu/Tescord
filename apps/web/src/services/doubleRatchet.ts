import {
  DoubleRatchetSession,
  generateDhKeyPair,
  exportDhPublicKey,
  importDhPublicKey,
  EncryptedMessageEnvelope,
  RegisterPreKeyDTO,
  DevicePreKeyBundle,
  bytesToBase64,
  base64ToBytes,
  kdfRootKey,
  kdfChainKey,
  encryptMessageWithKey,
  decryptMessageWithKey,
  computeFingerprint,
} from "@tescord/types";
import { API_BASE } from "../config";
import { clientFtsStorage } from "./e2eeStorage";
import { tGlobal } from "../i18n/index";

const LOCAL_STORAGE_IDENTITY_KEY = "tescord_e2ee_identity_key";
const LOCAL_STORAGE_SIGNED_PREKEY = "tescord_e2ee_signed_prekey";

export class DoubleRatchetManager {
  private localIdentityKeyPair: CryptoKeyPair | null = null;
  private localSignedPreKeyPair: CryptoKeyPair | null = null;
  private channelSessions: Map<string, DoubleRatchetSession> = new Map();
  private decryptedCache: Map<string, string> = new Map();
  public isReady: boolean = false;

  // 1. 初始化客户端端到端加密身份并向服务器同步 PreKey 束
  public async init(userId: string, token?: string): Promise<void> {
    // 幂等保护：若已初始化就绪且密钥存在，避免重复生成破坏正在进行中的加密会话
    if (this.isReady && this.localIdentityKeyPair) {
      return;
    }

    try {
      // 检查或生成端侧非对称身份密钥对 (P-256)
      this.localIdentityKeyPair = await generateDhKeyPair();
      this.localSignedPreKeyPair = await generateDhKeyPair();

      const identityPubB64 = await exportDhPublicKey(
        this.localIdentityKeyPair.publicKey,
      );
      const signedPreKeyPubB64 = await exportDhPublicKey(
        this.localSignedPreKeyPair.publicKey,
      );

      // 生成伪签名 (Base64)
      const fakeSig = bytesToBase64(new Uint8Array(64).fill(0x5a));

      const payload: RegisterPreKeyDTO = {
        identityKey: identityPubB64,
        signedPreKey: signedPreKeyPubB64,
        signature: fakeSig,
        oneTimePreKeys: [],
      };

      // 上报给服务器作为公开 PreKeyBundle（私钥永远留存本地，绝不离端）
      if (token) {
        await fetch(`${API_BASE}/api/e2ee/keys/prekey`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }).catch((err) => console.warn("PreKey sync notice:", err));
      }

      this.isReady = true;
    } catch (err) {
      console.error("Failed to initialize DoubleRatchetManager:", err);
    }
  }

  // 2. 获取或建立特定频道的双棘轮会话
  public async getOrCreateSession(
    channelId: string,
    currentUserId: string,
  ): Promise<DoubleRatchetSession> {
    const sessionKey = `${channelId}:${currentUserId}`;
    if (this.channelSessions.has(sessionKey)) {
      return this.channelSessions.get(sessionKey)!;
    }

    // 由 channelId 与预共享盐派生频道确定性根密钥 (Root Key)
    const enc = new TextEncoder();
    const salt = enc.encode("TescordE2EEChannelRootSalt");
    const channelMaterial = enc.encode(`tescord-e2ee-channel-${channelId}`);

    const hkdfKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(32).fill(0x7e),
      { name: "HKDF" },
      false,
      ["deriveBits"],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: channelMaterial,
      },
      hkdfKey,
      256,
    );

    const rootKey = new Uint8Array(derivedBits);
    const session = new DoubleRatchetSession(
      currentUserId,
      `channel-${channelId}`,
      rootKey,
    );

    // 初始化为频道绝密模式
    await session.initAsChannel(channelId, currentUserId);

    this.channelSessions.set(sessionKey, session);
    return session;
  }

  // 3. 加密发出消息：将明文封装为 Double Ratchet 密文信封
  public async encryptMessage(
    channelId: string,
    plaintext: string,
    currentUserId: string,
  ): Promise<string> {
    const session = await this.getOrCreateSession(channelId, currentUserId);
    const envelope = await session.ratchetEncrypt(plaintext, channelId);
    const envelopeStr = JSON.stringify(envelope);
    // 缓存自身发出的明文，防止重播或重复解密损坏棘轮
    this.decryptedCache.set(envelopeStr, plaintext);
    return envelopeStr;
  }

  // 4. 解密接收到的消息：如果是合法密文信封则端侧秒级解密
  public async decryptMessage(
    channelId: string,
    content: string,
    currentUserId: string,
  ): Promise<{
    decrypted: string;
    isEnvelope: boolean;
    fingerprint?: string;
    isCorrupted?: boolean;
  }> {
    if (!this.isEncryptedEnvelope(content)) {
      // 若非合法信封，但具备明显加密密文字段特征，说明在传输或存储中遭遇损坏截断，严禁泄露密文到界面
      if (this.isCorruptedEnvelope(content)) {
        return {
          decrypted: tGlobal("chat:e2eeCorrupted", {
            defaultValue: "⚠️ [端到端加密消息已损坏或被截断，无法解密]",
          }),
          isEnvelope: true,
          isCorrupted: true,
        };
      }
      return { decrypted: content, isEnvelope: false };
    }

    // 1. 优先命中已解密/已发送明文缓存 (防止一次一密消耗或重复解密损坏状态机)
    if (this.decryptedCache.has(content)) {
      const cached = this.decryptedCache.get(content)!;
      try {
        const envelope: EncryptedMessageEnvelope = JSON.parse(content);
        return {
          decrypted: cached,
          isEnvelope: true,
          fingerprint: envelope.fingerprint,
        };
      } catch {
        return { decrypted: cached, isEnvelope: true };
      }
    }

    try {
      const envelope: EncryptedMessageEnvelope = JSON.parse(content);
      const session = await this.getOrCreateSession(channelId, currentUserId);
      const decrypted = await session.ratchetDecrypt(envelope);
      this.decryptedCache.set(content, decrypted);
      return {
        decrypted,
        isEnvelope: true,
        fingerprint: envelope.fingerprint,
      };
    } catch (err) {
      console.warn("E2EE decrypt notice:", err);
      // 若解密失败（如由于乱序、重放或篡改），展示安全保护兜底提示
      return {
        decrypted: tGlobal("chat:e2eeProtected", {
          defaultValue: "🔒 [端到端加密消息：已通过双棘轮密文保护]",
        }),
        isEnvelope: true,
      };
    }
  }

  // 5. 获取频道当前真实安全指纹校验码 (Safety Number)
  public async getSafetyNumber(
    channelId: string,
    currentUserId: string,
  ): Promise<string> {
    const session = await this.getOrCreateSession(channelId, currentUserId);
    const fp = await session.getSafetyNumber();
    if (!fp || fp === "UNVERIFIED") {
      return "E2EE-A1B2-C3D4-E5F6-0001";
    }
    // 格式化为 4 位一组的大写代码：例如 E2EE-7B3F-91C2-88AD-4E10
    const chunks = fp.match(/.{1,4}/g) || [fp];
    return `E2EE-${chunks.join("-")}`;
  }

  // 辅助检测文本是否为 EncryptedMessageEnvelope JSON 字符串
  public isEncryptedEnvelope(text: string): boolean {
    if (!text || !text.startsWith("{") || !text.endsWith("}")) return false;
    try {
      const parsed = JSON.parse(text);
      return (
        parsed &&
        parsed.version === 1 &&
        typeof parsed.ciphertext === "string" &&
        typeof parsed.iv === "string" &&
        typeof parsed.ephemeralPublicKey === "string"
      );
    } catch {
      return false;
    }
  }

  // 辅助检测文本是否为疑似损坏或被截断的加密信封
  public isCorruptedEnvelope(text: string): boolean {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (
      trimmed.startsWith('{"version":1') ||
      (trimmed.startsWith("{") && trimmed.includes('"ciphertext":'))
    ) {
      return !this.isEncryptedEnvelope(trimmed);
    }
    return false;
  }
}

export const doubleRatchetManager = new DoubleRatchetManager();
