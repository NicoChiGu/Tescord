import { safeStorage } from "electron";

export class SafeStorageCipher {
  public static isAvailable(): boolean {
    try {
      return (
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text")
      );
    } catch {
      return false;
    }
  }

  public static encrypt(plainText: string | null | undefined): Buffer | null {
    if (!plainText) return null;
    if (!this.isAvailable()) {
      throw new Error("Native credential encryption is unavailable");
    }
    return safeStorage.encryptString(plainText);
  }

  public static decrypt(
    cipherBuffer: Buffer | Uint8Array | null | undefined,
  ): string | null {
    if (!cipherBuffer || cipherBuffer.length === 0) return null;
    const buf = Buffer.isBuffer(cipherBuffer)
      ? cipherBuffer
      : Buffer.from(cipherBuffer);
    if (!this.isAvailable()) return null;
    try {
      return safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }
}
