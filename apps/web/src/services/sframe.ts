import {
  SFrameHeader,
  encodeSFrameHeader,
  decodeSFrameHeader,
  encryptSFramePacket,
  decryptSFramePacket,
  SFrameReplayFilter,
  SFrameConfig,
} from "@tescord/types";

export interface SFrameStats {
  enabled: boolean;
  keyId: number;
  framesEncrypted: number;
  framesDecrypted: number;
  framesDroppedReplay: number;
  lastError: string | null;
}

export class SFrameManager {
  public enabled: boolean = false;
  public keyId: number = 1;
  private currentKey: Uint8Array | null = null;
  private frameCounter: bigint = 0n;
  private replayFilter: SFrameReplayFilter = new SFrameReplayFilter(128);

  private framesEncrypted: number = 0;
  private framesDecrypted: number = 0;
  private framesDroppedReplay: number = 0;
  private lastError: string | null = null;

  private statsListeners: Set<(stats: SFrameStats) => void> = new Set();

  // 根据房间名与可选共享密码派生 256 位 SFrame 主密钥
  public async deriveRoomKey(
    roomName: string,
    passphrase?: string,
  ): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const salt = enc.encode(`TescordSFrameSalt:${roomName}`);
    const password =
      passphrase || `tescord-default-voice-passphrase-${roomName}`;

    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 10000,
        hash: "SHA-256",
      },
      baseKey,
      256,
    );

    const key = new Uint8Array(bits);
    this.currentKey = key;
    this.enabled = true;
    this.emitStats();
    return key;
  }

  // 对待推流的音频帧注入 SFrame 头并执行 AES-GCM 加密
  public async encryptFrame(rawAudioFrame: Uint8Array): Promise<Uint8Array> {
    if (!this.enabled || !this.currentKey) {
      return rawAudioFrame;
    }

    try {
      this.frameCounter += 1n;
      const encrypted = await encryptSFramePacket(
        rawAudioFrame,
        this.currentKey,
        this.keyId,
        this.frameCounter,
      );
      this.framesEncrypted++;
      return encrypted;
    } catch (err: any) {
      this.lastError = err.message || "加密音频帧失败";
      return rawAudioFrame;
    }
  }

  // 对远端收到的 SFrame 密文音频帧执行解密与反重放校验
  public async decryptFrame(
    sframePacket: Uint8Array,
  ): Promise<Uint8Array | null> {
    if (!this.enabled || !this.currentKey) {
      return sframePacket;
    }

    try {
      const header = decodeSFrameHeader(sframePacket);
      // 反重放过滤
      const isFresh = this.replayFilter.checkAndAdd(header.counter);
      if (!isFresh) {
        this.framesDroppedReplay++;
        this.emitStats();
        return null; // 拦截重放攻击数据包
      }

      const { decryptedPayload } = await decryptSFramePacket(
        sframePacket,
        this.currentKey,
      );
      this.framesDecrypted++;
      return decryptedPayload;
    } catch (err: any) {
      this.lastError = err.message || "解密 SFrame 数据包失败";
      return null;
    }
  }

  public disable(): void {
    this.enabled = false;
    this.currentKey = null;
    this.frameCounter = 0n;
    this.emitStats();
  }

  public getStats(): SFrameStats {
    return {
      enabled: this.enabled,
      keyId: this.keyId,
      framesEncrypted: this.framesEncrypted,
      framesDecrypted: this.framesDecrypted,
      framesDroppedReplay: this.framesDroppedReplay,
      lastError: this.lastError,
    };
  }

  public onStatsChange(callback: (stats: SFrameStats) => void): () => void {
    this.statsListeners.add(callback);
    callback(this.getStats());
    return () => {
      this.statsListeners.delete(callback);
    };
  }

  private emitStats() {
    const stats = this.getStats();
    for (const cb of this.statsListeners) {
      try {
        cb(stats);
      } catch {}
    }
  }
}

export const sframeManager = new SFrameManager();
