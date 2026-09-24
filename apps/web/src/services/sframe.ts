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

  // 仅接受设备协商得到的高熵秘密；绝不从频道 ID 或公开房间名推导密钥。
  public async deriveRoomKey(
    roomName: string,
    passphrase?: string,
  ): Promise<Uint8Array> {
    if (!passphrase || passphrase.length < 32) {
      throw new Error("E2EE 设备密钥尚未协商完成，已拒绝未加密媒体降级");
    }
    const enc = new TextEncoder();
    const salt = enc.encode(`TescordSFrameSalt:${roomName}`);
    const password = passphrase;

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
        iterations: 210000,
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

  public setNegotiatedKey(key: Uint8Array, keyId = 1): void {
    if (key.byteLength !== 32) throw new Error("E2EE 媒体密钥必须为 256 位");
    this.currentKey = new Uint8Array(key);
    this.keyId = keyId;
    this.frameCounter = 0n;
    this.replayFilter = new SFrameReplayFilter(128);
    this.enabled = true;
    this.emitStats();
  }

  public attachSender(sender: RTCRtpSender): void {
    const encodedSender = sender as RTCRtpSender & {
      createEncodedStreams?: () => {
        readable: ReadableStream<any>;
        writable: WritableStream<any>;
      };
    };
    if (!encodedSender.createEncodedStreams)
      throw new Error("当前浏览器不支持 P2P Insertable Streams E2EE");
    const { readable, writable } = encodedSender.createEncodedStreams();
    const transform = new TransformStream({
      transform: async (frame: any, controller) => {
        try {
          const encrypted = await this.encryptFrame(new Uint8Array(frame.data));
          frame.data = encrypted.buffer.slice(
            encrypted.byteOffset,
            encrypted.byteOffset + encrypted.byteLength,
          );
          controller.enqueue(frame);
        } catch (error) {
          this.lastError =
            error instanceof Error ? error.message : "P2P 帧加密失败";
          this.emitStats();
        }
      },
    });
    readable
      .pipeThrough(transform)
      .pipeTo(writable)
      .catch((error) => {
        this.lastError =
          error instanceof Error ? error.message : "P2P 发送加密管线失败";
        this.emitStats();
      });
  }

  public attachReceiver(receiver: RTCRtpReceiver): void {
    const encodedReceiver = receiver as RTCRtpReceiver & {
      createEncodedStreams?: () => {
        readable: ReadableStream<any>;
        writable: WritableStream<any>;
      };
    };
    if (!encodedReceiver.createEncodedStreams)
      throw new Error("当前浏览器不支持 P2P Insertable Streams E2EE");
    const { readable, writable } = encodedReceiver.createEncodedStreams();
    // 每个接收器拥有独立计数空间；不同远端发送者允许从相同 counter 起步。
    const replayFilter = new SFrameReplayFilter(128);
    const transform = new TransformStream({
      transform: async (frame: any, controller) => {
        const decrypted = await this.decryptFrame(
          new Uint8Array(frame.data),
          replayFilter,
        );
        if (!decrypted) return;
        frame.data = decrypted.buffer.slice(
          decrypted.byteOffset,
          decrypted.byteOffset + decrypted.byteLength,
        );
        controller.enqueue(frame);
      },
    });
    readable
      .pipeThrough(transform)
      .pipeTo(writable)
      .catch((error) => {
        this.lastError =
          error instanceof Error ? error.message : "P2P 接收解密管线失败";
        this.emitStats();
      });
  }

  // 对待推流的音频帧注入 SFrame 头并执行 AES-GCM 加密
  public async encryptFrame(rawAudioFrame: Uint8Array): Promise<Uint8Array> {
    if (!this.enabled || !this.currentKey) {
      throw new Error("E2EE 密钥未就绪，禁止发送未加密媒体帧");
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
      this.emitStats();
      throw err;
    }
  }

  // 对远端收到的 SFrame 密文音频帧执行解密与反重放校验
  public async decryptFrame(
    sframePacket: Uint8Array,
    replayFilter: SFrameReplayFilter = this.replayFilter,
  ): Promise<Uint8Array | null> {
    if (!this.enabled || !this.currentKey) {
      return null;
    }

    try {
      const header = decodeSFrameHeader(sframePacket);
      // 反重放过滤
      const isFresh = replayFilter.checkAndAdd(header.counter);
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
      this.emitStats();
      return null;
    }
  }

  public disable(): void {
    this.enabled = false;
    this.currentKey = null;
    this.replayFilter = new SFrameReplayFilter(128);
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
