import { useAuthStore } from "../stores/useAuthStore.js";
import { apiFetch } from "./apiClient.js";
import { API_BASE } from "../config.js";
import { MEDIA_ENCRYPTION_VERSION } from "@tescord/types";
import type {
  MediaEncryptionContext,
  MediaEncryptionJoinRequest,
  MediaEncryptionSnapshot,
  MediaEncryptionState,
  MediaStreamKeyPublishRequest,
} from "@tescord/types";
import { deviceKeyService } from "./deviceKeys.js";
import { gatewayClient } from "./gateway.js";
import { sframeManager } from "./sframe.js";
import type { SenderMediaKey } from "./sframe.js";

export interface MediaEncryptionPrepareOptions {
  channelId: string;
  callId?: string;
  gatewaySessionId: string;
  userId: string;
  token: string;
  onFailure?: (error: Error) => void;
}
interface PendingKey {
  epoch: string;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
class MediaEncryptionService {
  private options: MediaEncryptionPrepareOptions | null = null;
  private context: MediaEncryptionContext | null = null;
  private body: MediaEncryptionJoinRequest | null = null;
  private generation = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  private unbind: (() => void) | null = null;
  private pending = new Map<number, PendingKey>();
  private received = new Set<number>();
  private syncing: Promise<void> | null = null;
  private lastSyncAt = 0;
  private rotating = false;
  private readyFrameBaseline = { encrypted: 0, decrypted: 0 };
  private listeners = new Set<(state: MediaEncryptionState) => void>();
  private state: MediaEncryptionState = {
    phase: "negotiating",
    contextId: null,
    membershipVersion: null,
    framesEncrypted: 0,
    framesDecrypted: 0,
  };
  constructor() {
    sframeManager.onStatsChange((stats) => {
      if (!this.options) return;
      this.emit({
        ...this.state,
        framesEncrypted: stats.framesEncrypted,
        framesDecrypted: stats.framesDecrypted,
        phase:
          this.state.phase === "failed" || this.state.phase === "negotiating"
            ? this.state.phase
            : stats.framesEncrypted > this.readyFrameBaseline.encrypted ||
                stats.framesDecrypted > this.readyFrameBaseline.decrypted
              ? "active"
              : this.state.phase,
      });
    });
  }
  public onState(callback: (state: MediaEncryptionState) => void): () => void {
    this.listeners.add(callback);
    callback(this.state);
    return () => this.listeners.delete(callback);
  }
  public getState(): MediaEncryptionState {
    return { ...this.state };
  }
  private emit(state: MediaEncryptionState): void {
    this.state = state;
    for (const callback of this.listeners) callback({ ...state });
  }
  public async prepare(options: MediaEncryptionPrepareOptions): Promise<void> {
    this.stop();
    if (!sframeManager.isSupported()) throw new Error("MEDIA_E2EE_UNSUPPORTED");
    const generation = ++this.generation;
    this.options = options;
    this.controller = new AbortController();
    this.emit({
      phase: "negotiating",
      contextId: null,
      membershipVersion: null,
      framesEncrypted: 0,
      framesDecrypted: 0,
    });
    try {
      await deviceKeyService.ensureAndRegister(options.userId, options.token);
      if (generation !== this.generation)
        throw new DOMException("Cancelled", "AbortError");
      this.body = {
        version: MEDIA_ENCRYPTION_VERSION,
        deviceId: deviceKeyService.getDeviceId()!,
        gatewaySessionId: options.gatewaySessionId,
        callId: options.callId,
      };
      const snapshot = await this.request<MediaEncryptionSnapshot>("join");
      if (generation !== this.generation)
        throw new DOMException("Cancelled", "AbortError");
      this.context = snapshot.context;
      this.lastSyncAt = Date.now();
      this.poll = setInterval(() => {
        void this.sync().catch((error: unknown) => {
          if (generation !== this.generation) return;
          if (
            Date.now() - this.lastSyncAt > 8_000 ||
            (error instanceof Error &&
              /UNAUTHORIZED|FORBIDDEN/.test(error.message))
          )
            this.fail(error);
        });
      }, 750);
      this.unbind = gatewayClient.on(
        "VOICE_STATE_UPDATE",
        (event: {
          userId: string;
          channelId?: string | null;
          previousChannelId?: string;
          sessionId?: string;
        }) => {
          const context = this.context;
          if (!context || options.callId) return;
          if (
            event.channelId === options.channelId ||
            event.previousChannelId === options.channelId
          ) {
            const known = context.devices.find(
              (device) => device.userId === event.userId,
            );
            if (
              !known ||
              event.channelId !== options.channelId ||
              known.gatewaySessionId !== event.sessionId
            ) {
              sframeManager.pause();
              void this.sync().catch((error: unknown) => {
                if (generation === this.generation) this.fail(error);
              });
            }
          }
        },
      );
      const deadline = Date.now() + 15_000;
      while (!this.context?.complete) {
        if (generation !== this.generation)
          throw new DOMException("Cancelled", "AbortError");
        if (Date.now() > deadline) throw new Error("MEDIA_NEGOTIATION_TIMEOUT");
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        await this.sync();
      }
      this.received.clear();
      sframeManager.beginContext(
        (streamId) => this.createSenderKey(streamId),
        (error) => {
          if (generation === this.generation) this.fail(error);
        },
      );
      await this.consume(
        snapshot.context.membershipVersion === this.context.membershipVersion
          ? snapshot
          : await this.request<MediaEncryptionSnapshot>("sync"),
      );
      if (generation !== this.generation)
        throw new DOMException("Cancelled", "AbortError");
      this.emit({
        ...this.state,
        phase: "ready",
        contextId: this.context.contextId,
        membershipVersion: this.context.membershipVersion,
      });
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
    }
  }
  private async request<T>(
    operation: string,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    const options = this.options;
    if (!options || !this.body || !this.controller)
      throw new Error("MEDIA_CONTEXT_STALE");
    const auth = useAuthStore.getState();
    if (auth.user?.id !== options.userId)
      throw new Error("MEDIA_CONTEXT_STALE");
    const response = await apiFetch(
      `${API_BASE}/api/channels/${encodeURIComponent(options.channelId)}/media-encryption/${operation}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token || options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...this.body, ...extra }),
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(5_000),
        ]),
      },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      throw new Error(data?.code || "MEDIA_KEY_UNAVAILABLE");
    }
    return response.json() as Promise<T>;
  }
  private async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    const generation = this.generation;
    this.syncing = (async () => {
      const snapshot = await this.request<MediaEncryptionSnapshot>("sync");
      if (generation !== this.generation) return;
      this.lastSyncAt = Date.now();
      const changed =
        this.context?.membershipVersion !== snapshot.context.membershipVersion;
      this.context = snapshot.context;
      if (changed && sframeManager.hasActiveContext) {
        this.rotating = true;
        const baseline = sframeManager.getStats();
        this.readyFrameBaseline = {
          encrypted: baseline.framesEncrypted,
          decrypted: baseline.framesDecrypted,
        };
        this.emit({
          ...this.state,
          phase: "negotiating",
          membershipVersion: snapshot.context.membershipVersion,
        });
        sframeManager.pause();
        this.received.clear();
        for (const key of this.pending.values()) {
          clearTimeout(key.timer);
          key.reject(new Error("MEDIA_CONTEXT_STALE"));
        }
        this.pending.clear();
        // Do not block polling while rotated sender keys await remote acknowledgements.
        const expectedVersion = snapshot.context.membershipVersion;
        void sframeManager
          .rotateSenderKeys()
          .then(() => {
            if (
              generation === this.generation &&
              this.context?.membershipVersion === expectedVersion
            ) {
              this.rotating = false;
              this.emit({ ...this.state, phase: "ready" });
            }
          })
          .catch((error: unknown) => {
            if (
              generation === this.generation &&
              this.context?.membershipVersion === expectedVersion
            )
              this.fail(error);
          });
      }
      if (!snapshot.context.complete) sframeManager.pause();
      else if (!changed && !this.rotating) sframeManager.resume();
      await this.consume(snapshot);
    })().finally(() => {
      if (generation === this.generation) this.syncing = null;
    });
    return this.syncing;
  }
  private async consume(snapshot: MediaEncryptionSnapshot): Promise<void> {
    const generation = this.generation;
    for (const envelope of snapshot.envelopes) {
      if (!this.received.has(envelope.keyId)) {
        const key = await deviceKeyService.openStreamKey(
          snapshot.context,
          envelope,
        );
        if (
          generation !== this.generation ||
          snapshot.context.membershipVersion !== this.context?.membershipVersion
        )
          return;
        sframeManager.addReceiverKey(envelope.keyId, key);
        this.received.add(envelope.keyId);
        await this.request("acknowledge", { keyId: envelope.keyId });
      }
    }
    for (const keyId of snapshot.acknowledgedKeyIds) {
      const pending = this.pending.get(keyId);
      if (pending?.epoch === snapshot.context.membershipVersion) {
        clearTimeout(pending.timer);
        pending.resolve();
        this.pending.delete(keyId);
      }
    }
  }
  private async createSenderKey(streamId: string): Promise<SenderMediaKey> {
    let context = this.context;
    const options = this.options,
      generation = this.generation;
    if (!context || !options) throw new Error("MEDIA_CONTEXT_STALE");
    const deadline = Date.now() + 15_000;
    while (!context.complete) {
      if (generation !== this.generation || !this.context)
        throw new Error("MEDIA_CONTEXT_STALE");
      if (Date.now() > deadline) throw new Error("MEDIA_NEGOTIATION_TIMEOUT");
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      context = this.context;
    }
    const key = crypto.getRandomValues(new Uint8Array(32));
    let keyId = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    if (!keyId) keyId = 1;
    const recipients = context.devices.filter(
      (device) =>
        device.userId !== options.userId ||
        device.deviceId !== this.body?.deviceId,
    );
    const envelopes = await Promise.all(
      recipients.map((recipient) =>
        deviceKeyService.wrapStreamKey(
          context!,
          streamId,
          keyId,
          key,
          recipient,
        ),
      ),
    );
    if (
      generation !== this.generation ||
      context.membershipVersion !== this.context?.membershipVersion
    )
      throw new Error("MEDIA_CONTEXT_STALE");
    const publish: MediaStreamKeyPublishRequest = {
      contextId: context.contextId,
      membershipVersion: context.membershipVersion,
      streamId,
      keyId,
      envelopes,
    };
    const ack = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(keyId);
        reject(new Error("MEDIA_NEGOTIATION_TIMEOUT"));
      }, 15_000);
      this.pending.set(keyId, {
        epoch: context!.membershipVersion,
        resolve,
        reject,
        timer,
      });
    });
    try {
      const result = await this.request<{ acknowledged: boolean }>("publish", {
        publish,
      });
      if (result.acknowledged) {
        const pending = this.pending.get(keyId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve();
          this.pending.delete(keyId);
        }
      }
      await ack;
      if (
        generation !== this.generation ||
        context.membershipVersion !== this.context?.membershipVersion
      )
        throw new Error("MEDIA_CONTEXT_STALE");
      return { key, keyId, streamId };
    } catch (error) {
      const pending = this.pending.get(keyId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve();
        this.pending.delete(keyId);
      }
      throw error;
    }
  }
  private fail(error: unknown): void {
    const normalized =
      error instanceof Error ? error : new Error("MEDIA_KEY_UNAVAILABLE");
    if (!this.options || this.state.phase === "failed") return;
    sframeManager.pause();
    this.emit({
      ...this.state,
      phase: "failed",
      errorCode: normalized.message,
    });
    const callback = this.options.onFailure;
    // Keep fail-closed until the caller tears down the connection or retries explicitly.
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    callback?.(normalized);
  }
  public stop(): void {
    const options = this.options,
      body = this.body;
    if (options && body)
      void fetch(
        `${API_BASE}/api/channels/${encodeURIComponent(options.channelId)}/media-encryption/leave`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${useAuthStore.getState().user?.id === options.userId ? useAuthStore.getState().token || options.token : options.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          keepalive: true,
        },
      ).catch(() => {});
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.unbind?.();
    this.unbind = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("MEDIA_CONTEXT_STALE"));
    }
    this.pending.clear();
    this.received.clear();
    this.options = null;
    this.context = null;
    this.body = null;
    this.syncing = null;
    this.rotating = false;
    this.readyFrameBaseline = { encrypted: 0, decrypted: 0 };
    sframeManager.disable();
    deviceKeyService.clear();
    this.emit({
      phase: "negotiating",
      contextId: null,
      membershipVersion: null,
      framesEncrypted: 0,
      framesDecrypted: 0,
    });
  }
}
export const mediaEncryptionService = new MediaEncryptionService();
