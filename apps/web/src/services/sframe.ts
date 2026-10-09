import type { MediaTransformEvent } from "@tescord/types";
import {
  decodeSFrameHeader,
  encryptSFramePacket,
  decryptSFramePacket,
  SFrameReplayFilter,
  encodedFrameLayout,
  escapeMediaRbsp,
  unescapeMediaRbsp,
  joinMediaFrame,
} from "@tescord/types";

export interface SFrameStats {
  enabled: boolean;
  keyId: number;
  framesEncrypted: number;
  framesDecrypted: number;
  framesDroppedReplay: number;
  lastError: string | null;
}
export interface SenderMediaKey {
  key: Uint8Array;
  keyId: number;
  streamId: string;
}
export interface EncodedMediaFrame {
  data: ArrayBuffer;
  type?: string;
  getMetadata?: () => { mimeType?: string; payloadType?: number };
}
interface EncodedEndpoint {
  createEncodedStreams?: () => {
    readable: ReadableStream<EncodedMediaFrame>;
    writable: WritableStream<EncodedMediaFrame>;
  };
  transform?: unknown;
}
interface SenderState {
  kind: "audio" | "video";
  streamId: string;
  key: SenderMediaKey | null;
  counter: bigint;
  generation: number;
  worker: Worker | null;
  detached: boolean;
}
interface TransformConstructor {
  new (
    worker: Worker,
    options: {
      operation: "encrypt" | "decrypt";
      kind: "audio" | "video";
      streamId: string;
    },
  ): unknown;
}

export class SFrameManager {
  public enabled = false;
  public keyId = 1;
  private currentKey: Uint8Array | null = null;
  private frameCounter = 0n;
  private keys = new Map<number, Uint8Array>();
  private replayFilters = new Map<number, SFrameReplayFilter>();
  private framesEncrypted = 0;
  private framesDecrypted = 0;
  private framesDroppedReplay = 0;
  private lastError: string | null = null;
  private factory: ((streamId: string) => Promise<SenderMediaKey>) | null =
    null;
  private senders = new Map<RTCRtpSender, SenderState>();
  private receivers = new Map<RTCRtpReceiver, Worker | null>();
  private workers = new Set<Worker>();
  private generation = 0;
  private paused = false;
  private failureSink: ((error: Error) => void) | null = null;
  private statsListeners = new Set<(stats: SFrameStats) => void>();
  private installSequence = 0;
  private installations = new Map<
    number,
    {
      remaining: Set<Worker>;
      resolve(): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  public isSupported(): boolean {
    const scope = globalThis as typeof globalThis & {
      RTCRtpScriptTransform?: TransformConstructor;
    };
    return Boolean(
      scope.crypto?.subtle &&
      ((scope.RTCRtpScriptTransform && typeof Worker !== "undefined") ||
        (typeof RTCRtpSender !== "undefined" &&
          typeof (RTCRtpSender.prototype as EncodedEndpoint)
            .createEncodedStreams === "function" &&
          typeof RTCRtpReceiver !== "undefined" &&
          typeof (RTCRtpReceiver.prototype as EncodedEndpoint)
            .createEncodedStreams === "function")),
    );
  }
  public get hasActiveContext(): boolean {
    return Boolean(this.factory && this.enabled);
  }
  public assertReady(): void {
    if (!this.isSupported()) throw new Error("MEDIA_E2EE_UNSUPPORTED");
    if (!this.hasActiveContext) throw new Error("MEDIA_KEY_UNAVAILABLE");
  }
  /** The sender factory resolves only after current receiver acknowledgements. */
  public getSenderKeyReadiness(sender: RTCRtpSender): {
    generation: number;
    keyId: number | null;
    ready: boolean;
  } | null {
    const state = this.senders.get(sender);
    if (!state || state.detached || !this.hasActiveContext) return null;
    return {
      generation: this.generation,
      keyId: state.key?.keyId ?? null,
      ready:
        !this.paused && state.generation === this.generation && !!state.key,
    };
  }
  public beginContext(
    factory: (streamId: string) => Promise<SenderMediaKey>,
    onFailure?: (error: Error) => void,
  ): void {
    this.disable();
    this.factory = factory;
    this.failureSink = onFailure || null;
    this.enabled = true;
    this.paused = false;
    this.emitStats();
  }
  /** Legacy frame-test/old DM compatibility only; never authorizes a media connection. */
  public setNegotiatedKey(key: Uint8Array, keyId = 1): void {
    if (this.hasActiveContext) return;
    if (key.byteLength !== 32) throw new Error("MEDIA_KEY_INVALID");
    if (
      this.currentKey &&
      this.keyId === keyId &&
      this.currentKey.every((byte, i) => byte === key[i])
    )
      return;
    this.currentKey = new Uint8Array(key);
    this.keyId = keyId;
    this.frameCounter = 0n;
    this.keys.clear();
    this.replayFilters.clear();
    this.keys.set(keyId, this.currentKey);
    this.enabled = true;
    this.emitStats();
  }
  public async deriveRoomKey(
    _roomName: string,
    _passphrase?: string,
  ): Promise<Uint8Array> {
    throw new Error("MEDIA_KEY_UNAVAILABLE");
  }
  public addReceiverKey(keyId: number, key: Uint8Array): void {
    if (key.byteLength !== 32) throw new Error("MEDIA_KEY_INVALID");
    const known = this.keys.get(keyId);
    if (known && !known.every((byte, i) => byte === key[i]))
      throw new Error("MEDIA_KEY_INVALID");
    if (known) return;
    const stableKey = new Uint8Array(key);
    this.keys.set(keyId, stableKey);
    for (const worker of this.workers)
      worker.postMessage({ type: "receiver-key", keyId, key: stableKey });
  }
  public pause(): void {
    this.paused = true;
    for (const worker of this.workers) worker.postMessage({ type: "pause" });
  }
  /** Confirm existing Worker pipelines loaded the key before publishing its ACK. */
  public async installReceiverKey(
    keyId: number,
    key: Uint8Array,
  ): Promise<void> {
    this.addReceiverKey(keyId, key);
    if (!this.workers.size) return;
    const requestId = ++this.installSequence;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.installations.delete(requestId);
        reject(
          Object.assign(new Error("MEDIA_KEY_UNAVAILABLE"), {
            mediaFailureSource: "media-receiver-key-install-timeout",
          }),
        );
      }, 3000);
      this.installations.set(requestId, {
        remaining: new Set(this.workers),
        resolve,
        reject,
        timer,
      });
      for (const worker of this.workers)
        worker.postMessage({ type: "receiver-key", keyId, key, requestId });
    });
  }
  public async rotateSenderKeys(resume = true): Promise<void> {
    this.pause();
    const generation = ++this.generation;
    this.cancelInstallations();
    this.keys.clear();
    this.replayFilters.clear();
    for (const worker of this.workers)
      worker.postMessage({ type: "clear-keys" });
    await Promise.all(
      [...this.senders.values()].map((state) => this.provision(state)),
    );
    if (resume && generation === this.generation && this.enabled) this.resume();
  }
  public resume(): void {
    this.paused = false;
    for (const worker of this.workers) worker.postMessage({ type: "resume" });
  }
  private fail(error: unknown): void {
    const normalized =
      error instanceof Error ? error : new Error("MEDIA_KEY_UNAVAILABLE");
    this.lastError = normalized.message;
    this.pause();
    this.emitStats();
    this.failureSink?.(normalized);
  }
  private async provision(state: SenderState): Promise<void> {
    const factory = this.factory;
    if (!factory) throw new Error("MEDIA_KEY_UNAVAILABLE");
    const generation = this.generation;
    state.key = null;
    state.generation = generation;
    state.counter = 0n;
    let key: SenderMediaKey;
    try {
      key = await factory(state.streamId);
    } catch (error) {
      if (generation !== this.generation || !this.enabled || state.detached)
        return;
      throw error;
    }
    if (generation !== this.generation || !this.enabled || state.detached)
      return;
    state.key = key;
    this.keyId = key.keyId;
    state.worker?.postMessage({
      type: "sender-key",
      keyId: key.keyId,
      key: key.key,
      generation,
    });
  }
  private worker(
    operation: "encrypt" | "decrypt",
    streamId: string,
    endpoint: RTCRtpSender | RTCRtpReceiver,
  ): Worker | null {
    const Constructor = (
      globalThis as typeof globalThis & {
        RTCRtpScriptTransform?: TransformConstructor;
      }
    ).RTCRtpScriptTransform;
    if (!Constructor) return null;
    const worker = new Worker(new URL("./sframe.worker.ts", import.meta.url), {
      type: "module",
    });
    this.workers.add(worker);
    worker.onmessage = (event: MessageEvent<MediaTransformEvent>) => {
      if (!this.workers.has(worker) || !this.hasActiveContext) return;
      if (event.data.type === "key-installed") {
        const pending = this.installations.get(event.data.requestId);
        if (
          pending &&
          pending.remaining.delete(worker) &&
          !pending.remaining.size
        ) {
          clearTimeout(pending.timer);
          this.installations.delete(event.data.requestId);
          pending.resolve();
        }
      } else if (event.data.type === "codecs-needed") {
        worker.postMessage({
          type: "codecs",
          codecs: endpoint.getParameters().codecs,
        });
      } else if (event.data.type === "stats") {
        this.framesEncrypted += event.data.encrypted || 0;
        this.framesDecrypted += event.data.decrypted || 0;
        this.framesDroppedReplay += event.data.replay || 0;
        this.emitStats();
      } else if (event.data.type === "fatal")
        this.fail(new Error(event.data.error || "MEDIA_KEY_UNAVAILABLE"));
    };
    worker.onerror = () => {
      if (this.workers.has(worker) && this.hasActiveContext)
        this.fail(
          Object.assign(new Error("MEDIA_KEY_UNAVAILABLE"), {
            mediaFailureSource: "media-transform-worker-error",
          }),
        );
    };
    for (const [keyId, key] of this.keys)
      worker.postMessage({ type: "receiver-key", keyId, key });
    if (this.paused) worker.postMessage({ type: "pause" });
    return worker;
  }
  public attachSender(
    sender: RTCRtpSender,
    explicitKind?: "audio" | "video",
  ): void {
    this.assertReady();
    const kind = explicitKind ?? sender.track?.kind;
    const existing = this.senders.get(sender);
    if (
      (kind !== "audio" && kind !== "video") ||
      (sender.track && sender.track.kind !== kind) ||
      (existing && existing.kind !== kind)
    )
      throw new Error("MEDIA_KEY_INVALID");
    if (existing) return;
    const state: SenderState = {
      kind,
      streamId: crypto.randomUUID(),
      key: null,
      counter: 0n,
      generation: this.generation,
      worker: null,
      detached: false,
    };
    const endpoint = sender as RTCRtpSender & EncodedEndpoint;
    const Constructor = (
      globalThis as typeof globalThis & {
        RTCRtpScriptTransform?: TransformConstructor;
      }
    ).RTCRtpScriptTransform;
    if (Constructor) {
      state.worker = this.worker("encrypt", state.streamId, sender);
      endpoint.transform = new Constructor(state.worker!, {
        operation: "encrypt",
        kind,
        streamId: state.streamId,
      });
    } else {
      if (!endpoint.createEncodedStreams)
        throw new Error("MEDIA_E2EE_UNSUPPORTED");
      const { readable, writable } = endpoint.createEncodedStreams();
      void readable
        .pipeThrough(
          new TransformStream<EncodedMediaFrame, EncodedMediaFrame>({
            transform: async (frame, controller) => {
              if (!state.key || this.paused || !this.hasActiveContext) return;
              const generation = this.generation;
              try {
                const metadata = frame.getMetadata?.();
                const codec =
                  metadata?.mimeType ||
                  sender
                    .getParameters()
                    .codecs.find(
                      (codec) => codec.payloadType === metadata?.payloadType,
                    )?.mimeType;
                const layout = encodedFrameLayout(
                  new Uint8Array(frame.data),
                  kind,
                  codec,
                  frame.type,
                );
                const data = await encryptSFramePacket(
                  layout.payload,
                  state.key.key,
                  state.key.keyId,
                  state.counter++,
                  layout.header,
                );
                if (generation !== this.generation || this.paused) return;
                frame.data = joinMediaFrame(
                  layout.header,
                  layout.rbsp ? escapeMediaRbsp(data) : data,
                ).buffer;
                this.framesEncrypted++;
                controller.enqueue(frame);
                if (
                  this.framesEncrypted === 1 ||
                  this.framesEncrypted % 50 === 0
                )
                  this.emitStats();
              } catch (error) {
                this.fail(error);
              }
            },
          }),
        )
        .pipeTo(writable)
        .catch((error: unknown) => {
          if (!state.detached && this.hasActiveContext) this.fail(error);
        });
    }
    this.senders.set(sender, state);
    const generation = this.generation;
    void this.provision(state).catch((error: unknown) => {
      if (generation === this.generation && !state.detached && this.enabled)
        this.fail(error);
    });
  }
  public attachReceiver(receiver: RTCRtpReceiver): void {
    this.assertReady();
    if (this.receivers.has(receiver)) return;
    const endpoint = receiver as RTCRtpReceiver & EncodedEndpoint;
    const Constructor = (
      globalThis as typeof globalThis & {
        RTCRtpScriptTransform?: TransformConstructor;
      }
    ).RTCRtpScriptTransform;
    let receiverWorker: Worker | null = null;
    if (Constructor) {
      const worker = this.worker("decrypt", crypto.randomUUID(), receiver)!;
      receiverWorker = worker;
      endpoint.transform = new Constructor(worker, {
        operation: "decrypt",
        kind: receiver.track.kind,
        streamId: "",
      });
    } else {
      if (!endpoint.createEncodedStreams)
        throw new Error("MEDIA_E2EE_UNSUPPORTED");
      const { readable, writable } = endpoint.createEncodedStreams();
      void readable
        .pipeThrough(
          new TransformStream<EncodedMediaFrame, EncodedMediaFrame>({
            transform: async (frame, controller) => {
              if (this.paused || !this.hasActiveContext) return;
              const metadata = frame.getMetadata?.();
              const codec =
                metadata?.mimeType ||
                receiver
                  .getParameters()
                  .codecs.find(
                    (codec) => codec.payloadType === metadata?.payloadType,
                  )?.mimeType;
              const layout = encodedFrameLayout(
                new Uint8Array(frame.data),
                receiver.track.kind === "video" ? "video" : "audio",
                codec,
                frame.type,
                true,
              );
              const data = await this.decryptFrame(
                layout.rbsp
                  ? unescapeMediaRbsp(layout.payload)
                  : layout.payload,
                undefined,
                layout.header,
              );
              if (
                data &&
                !this.paused &&
                this.hasActiveContext &&
                this.receivers.has(receiver)
              ) {
                frame.data = (
                  layout.wrapper
                    ? data.slice()
                    : joinMediaFrame(layout.header, data)
                ).buffer;
                controller.enqueue(frame);
              }
            },
          }),
        )
        .pipeTo(writable)
        .catch((error: unknown) => {
          if (this.receivers.has(receiver) && this.hasActiveContext)
            this.fail(error);
        });
    }
    this.receivers.set(receiver, receiverWorker);
  }
  public detachPeerConnection(pc: RTCPeerConnection): void {
    for (const sender of pc.getSenders()) {
      const state = this.senders.get(sender);
      if (!state) continue;
      state.detached = true;
      state.key = null;
      if (state.worker) {
        state.worker.terminate();
        this.workers.delete(state.worker);
      }
      this.senders.delete(sender);
    }
    for (const receiver of pc.getReceivers()) {
      const worker = this.receivers.get(receiver);
      if (worker) {
        worker.terminate();
        this.workers.delete(worker);
      }
      this.receivers.delete(receiver);
    }
    for (const [id, pending] of this.installations) {
      for (const worker of pending.remaining)
        if (!this.workers.has(worker)) pending.remaining.delete(worker);
      if (!pending.remaining.size) {
        clearTimeout(pending.timer);
        this.installations.delete(id);
        pending.resolve();
      }
    }
  }
  private cancelInstallations(): void {
    for (const pending of this.installations.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MEDIA_CONTEXT_STALE"));
    }
    this.installations.clear();
  }
  public async encryptFrame(frame: Uint8Array): Promise<Uint8Array> {
    if (!this.enabled || !this.currentKey)
      throw new Error("MEDIA_KEY_UNAVAILABLE");
    const data = await encryptSFramePacket(
      frame,
      this.currentKey,
      this.keyId,
      this.frameCounter++,
    );
    this.framesEncrypted++;
    return data;
  }
  public async decryptFrame(
    packet: Uint8Array,
    replayFilter?: SFrameReplayFilter,
    metadata = new Uint8Array(0),
  ): Promise<Uint8Array | null> {
    if (!this.enabled || this.paused) return null;
    const generation = this.generation;
    try {
      const header = decodeSFrameHeader(packet),
        key = this.keys.get(header.kid);
      if (!key) return null;
      // Authenticate before changing replay state, so forged high counters cannot poison it.
      const { decryptedPayload } = await decryptSFramePacket(
        packet,
        key,
        metadata,
      );
      if (
        !this.enabled ||
        this.paused ||
        generation !== this.generation ||
        this.keys.get(header.kid) !== key
      )
        return null;
      let filter = replayFilter || this.replayFilters.get(header.kid);
      if (!filter) {
        filter = new SFrameReplayFilter(128);
        this.replayFilters.set(header.kid, filter);
      }
      if (!filter.checkAndAdd(header.counter)) {
        this.framesDroppedReplay++;
        this.emitStats();
        return null;
      }
      this.framesDecrypted++;
      if (this.framesDecrypted === 1 || this.framesDecrypted % 50 === 0)
        this.emitStats();
      return decryptedPayload;
    } catch {
      this.lastError = "MEDIA_KEY_INVALID";
      return null;
    }
  }
  public disable(): void {
    this.cancelInstallations();
    this.generation++;
    this.enabled = false;
    this.factory = null;
    this.currentKey = null;
    this.keys.clear();
    this.replayFilters.clear();
    this.senders.clear();
    this.receivers.clear();
    for (const worker of this.workers) worker.terminate();
    this.workers.clear();
    this.frameCounter = 0n;
    this.framesEncrypted = 0;
    this.framesDecrypted = 0;
    this.framesDroppedReplay = 0;
    this.lastError = null;
    this.failureSink = null;
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
    return () => this.statsListeners.delete(callback);
  }
  private emitStats(): void {
    for (const cb of this.statsListeners) {
      try {
        cb(this.getStats());
      } catch {}
    }
  }
}
export const sframeManager = new SFrameManager();
