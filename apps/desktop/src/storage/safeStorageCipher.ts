import { safeStorage } from "electron";

export class SafeStorageCipher {
  public static isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  public static encrypt(plainText: string | null | undefined): Buffer | null {
    if (!plainText) return null;
    try {
      if (this.isAvailable()) {
        return safeStorage.encryptString(plainText);
      }
    } catch (err) {
      console.warn(
        "[SafeStorageCipher] Native safeStorage encryption failed, falling back to base64 buffer:",
        err,
      );
    }
    // 降级兼容：如果在不支持的环境，转换为 Buffer 存储
    return Buffer.from(plainText, "utf-8");
  }

  public static decrypt(
    cipherBuffer: Buffer | Uint8Array | null | undefined,
  ): string | null {
    if (!cipherBuffer || cipherBuffer.length === 0) return null;
    const buf = Buffer.isBuffer(cipherBuffer)
      ? cipherBuffer
      : Buffer.from(cipherBuffer);
    try {
      if (this.isAvailable()) {
        return safeStorage.decryptString(buf);
      }
    } catch {
      // safeStorage 解密失败时可能是降级存的纯文本 Buffer
      try {
        return buf.toString("utf-8");
      } catch {
        return null;
      }
    }
    return buf.toString("utf-8");
  }
}
