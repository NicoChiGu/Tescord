import { useAuthStore } from "../stores/useAuthStore.js";
import { apiFetch } from "./apiClient.js";
import { API_BASE } from "../config.js";
import {
  GatewayEvents,
  MEDIA_ENCRYPTION_VERSION,
  mediaStreamEnvelopeSigningBytes,
} from "@tescord/types";
import type {
  MediaEncryptionContext,
  MediaEncryptionJoinRequest,
  MediaEncryptionSnapshot,
  MediaEncryptionState,
  MediaStreamKeyEnvelope,
  MediaStreamKeyPublishRequest,
  MediaStreamKeyAcknowledgeRequest,
  MediaKeyEnvelopePushPayload,
  MediaKeyAckPushPayload,
  MediaEpochUpdatePushPayload,
  MediaJoinStage,
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
  onStage?: (stage: MediaJoinStage) => void;
}
interface PendingKey {
  context: MediaEncryptionContext;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
/** A membership change cancels work, without invalidating the active identity. */
class MediaEpochSuperseded extends Error {
  constructor() {
    super("MEDIA_CONTEXT_STALE");
  }
}
/** A server roster race is retryable; a local identity mismatch never is. */
class MediaContextResponseStale extends Error {
  constructor() {
    super("MEDIA_CONTEXT_STALE");
  }
}
export class MediaEncryptionService {
  private options: MediaEncryptionPrepareOptions | null = null;
  private context: MediaEncryptionContext | null = null;
  private body: MediaEncryptionJoinRequest | null = null;
  private generation = 0;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private unbinds: Array<() => void> = [];
  private pending = new Map<number, PendingKey>();
  private received = new Set<number>();
  private acknowledgedReceivers = new Set<number>();
  private acceptedEnvelopes = new Map<number, string>();
  private deferred = new Map<string, MediaStreamKeyEnvelope>();
  private consuming = new Map<string, Promise<void>>();
  private syncing: Promise<void> | null = null;
  private syncRequested = false;
  private lastSyncAt = 0;
  private pollDelay = 250;
  private rotating = false;
  private pendingLeave: Promise<void> = Promise.resolve();
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
  private matches(
    context: MediaEncryptionContext,
    generation = this.generation,
  ): boolean {
    return (
      generation === this.generation &&
      this.state.phase !== "failed" &&
      context.contextId === this.context?.contextId &&
      context.contextRevision === this.context.contextRevision &&
      context.membershipVersion === this.context.membershipVersion
    );
  }
  private inScope(channelId: string, callId?: string): boolean {
    return (
      channelId === this.options?.channelId && callId === this.options?.callId
    );
  }
  private background(error: unknown, generation: number): void {
    if (generation !== this.generation || !this.options) return;
    if (error instanceof MediaEpochSuperseded) return;
    if (
      error instanceof Error &&
      /UNAUTHORIZED|FORBIDDEN|MEDIA_KEY_INVALID|MEDIA_E2EE_UNSUPPORTED|MEDIA_CONTEXT_STALE/.test(
        error.message,
      )
    )
      this.fail(error);
    else if (Date.now() - this.lastSyncAt > 12_000) this.fail(error);
    else {
      this.pollDelay = Math.min(1000, this.pollDelay * 2);
      this.schedulePoll();
    }
  }
  private schedulePoll(urgent = false): void {
    if (!this.options || this.state.phase === "failed") return;
    if (this.poll) {
      if (!urgent) return;
      clearTimeout(this.poll);
    }
    const generation = this.generation;
    const negotiating =
      this.state.phase === "negotiating" ||
      this.pending.size > 0 ||
      this.deferred.size > 0;
    const delay = urgent ? 0 : negotiating ? this.pollDelay : 5000;
    this.poll = setTimeout(() => {
      this.poll = null;
      void this.sync()
        .catch((error) => this.background(error, generation))
        .finally(() => {
          if (generation !== this.generation) return;
          this.pollDelay = negotiating
            ? Math.min(1000, this.pollDelay * 2)
            : 250;
          this.schedulePoll();
        });
    }, delay);
  }
  private requestSync(): void {
    if (!this.options || this.state.phase === "failed") return;
    if (this.syncing) this.syncRequested = true;
    else this.schedulePoll(true);
  }
  public async prepare(options: MediaEncryptionPrepareOptions): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    if (!sframeManager.isSupported()) throw new Error("MEDIA_E2EE_UNSUPPORTED");
    await this.pendingLeave;
    if (generation !== this.generation)
      throw new DOMException("Cancelled", "AbortError");
    this.options = options;
    this.controller = new AbortController();
    this.lastSyncAt = Date.now();
    try {
      await deviceKeyService.ensureAndRegister(options.userId, options.token);
      if (generation !== this.generation)
        throw new DOMException("Cancelled", "AbortError");
      options.onStage?.("deviceRegistered");
      this.body = {
        version: MEDIA_ENCRYPTION_VERSION,
        deviceId: deviceKeyService.getDeviceId()!,
        gatewaySessionId: options.gatewaySessionId,
        registrationId: crypto.randomUUID(),
        callId: options.callId,
      };
      // Install the context before registering handlers: a pushed key can never
      // be acknowledged into a pipeline that initialization subsequently clears.
      sframeManager.beginContext(
        (streamId) => this.createSenderKey(streamId),
        (error) => {
          if (
            generation === this.generation &&
            !(error instanceof MediaEpochSuperseded)
          )
            this.fail(error);
        },
      );
      sframeManager.pause();
      this.unbinds.push(
        gatewayClient.on(
          "VOICE_STATE_UPDATE",
          (event: {
            userId: string;
            channelId?: string | null;
            previousChannelId?: string;
            sessionId?: string;
          }) => {
            if (
              generation !== this.generation ||
              options.callId ||
              !this.context
            )
              return;
            if (
              event.channelId !== options.channelId &&
              event.previousChannelId !== options.channelId
            )
              return;
            const known = this.context.devices.find(
              (device) => device.userId === event.userId,
            );
            if (
              !known ||
              event.channelId !== options.channelId ||
              known.gatewaySessionId !== event.sessionId
            ) {
              sframeManager.pause();
              this.emit({ ...this.state, phase: "negotiating" });
              this.requestSync();
            }
          },
        ),
      );
      this.unbinds.push(
        gatewayClient.on(
          GatewayEvents.MEDIA_KEY_ENVELOPE,
          (payload: MediaKeyEnvelopePushPayload) => {
            if (
              generation !== this.generation ||
              !this.inScope(payload.channelId, payload.callId)
            )
              return;
            if (
              payload.contextId !== payload.envelope.contextId ||
              payload.contextRevision !== payload.envelope.contextRevision ||
              payload.membershipVersion !== payload.envelope.membershipVersion
            ) {
              this.fail(new Error("MEDIA_KEY_INVALID"));
              return;
            }
            void this.consumeEnvelope(payload.envelope).catch((error) =>
              this.background(error, generation),
            );
          },
        ),
      );
      this.unbinds.push(
        gatewayClient.on(
          GatewayEvents.MEDIA_KEY_ACK,
          (payload: MediaKeyAckPushPayload) => {
            if (
              generation !== this.generation ||
              !this.inScope(payload.channelId, payload.callId) ||
              !payload.acknowledged
            )
              return;
            const pending = this.pending.get(payload.keyId);
            if (
              pending &&
              payload.contextId === pending.context.contextId &&
              payload.contextRevision === pending.context.contextRevision &&
              payload.membershipVersion === pending.context.membershipVersion &&
              this.matches(pending.context)
            )
              this.resolvePending(payload.keyId);
          },
        ),
      );
      this.unbinds.push(
        gatewayClient.on(
          GatewayEvents.MEDIA_EPOCH_UPDATE,
          (payload: MediaEpochUpdatePushPayload) => {
            if (
              generation !== this.generation ||
              !this.inScope(payload.channelId, payload.callId)
            )
              return;
            void this.applyEpochUpdate(payload.context, "push").catch((error) =>
              this.background(error, generation),
            );
          },
        ),
      );
      this.unbinds.push(
        gatewayClient.onConnectionStateChange((state) => {
          if (
            generation === this.generation &&
            state === "connected" &&
            this.context
          )
            this.requestSync();
        }),
      );
      const snapshot = await this.requestSnapshot("join");
      if (generation !== this.generation)
        throw new DOMException("Cancelled", "AbortError");
      await this.applyEpochUpdate(snapshot.context, "snapshot");
      await this.consume(snapshot);
      // Transport setup may proceed while the full roster is registering.
      // Each sender remains keyless/paused until its current recipient ACKs.
      this.schedulePoll();
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      throw error;
    }
  }
  private async request<T>(
    operation: string,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    const options = this.options,
      body = this.body,
      controller = this.controller;
    const generation = this.generation;
    if (!options || !body || !controller || this.state.phase === "failed")
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
        body: JSON.stringify({ ...body, ...extra }),
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      },
    );
    if (generation !== this.generation)
      throw new DOMException("Cancelled", "AbortError");
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as {
        code?: string;
      } | null;
      if (data?.code === "MEDIA_CONTEXT_STALE")
        throw new MediaContextResponseStale();
      throw new Error(data?.code || "MEDIA_KEY_UNAVAILABLE");
    }
    return response.json() as Promise<T>;
  }
  private async requestIdempotent<T>(
    operation: "publish" | "acknowledge",
    extra: Record<string, unknown>,
  ): Promise<T> {
    const generation = this.generation;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request<T>(operation, extra);
      } catch (error) {
        const transportFailure =
          error instanceof TypeError ||
          (error instanceof DOMException &&
            (error.name === "TimeoutError" || error.name === "AbortError"));
        if (
          !transportFailure ||
          attempt >= 2 ||
          generation !== this.generation ||
          this.controller?.signal.aborted ||
          !this.options ||
          this.state.phase === "failed"
        )
          throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 250 * 2 ** attempt),
        );
      }
    }
  }
  private async requestSnapshot(
    operation: "join" | "sync",
  ): Promise<MediaEncryptionSnapshot> {
    const generation = this.generation;
    for (let attempt = 0; ; attempt++) {
      try {
        if (operation === "sync") {
          const options = this.options,
            body = this.body,
            controller = this.controller;
          if (
            !options ||
            !body ||
            !controller ||
            this.state.phase === "failed" ||
            useAuthStore.getState().user?.id !== options.userId
          )
            throw new Error("MEDIA_CONTEXT_STALE");
          // An unavailable Gateway cannot authorize media. HTTP compatibility is
          // used only for an identified older server that did not advertise sync.
          if (!gatewayClient.isReadyForUser(options.userId))
            throw new TypeError("Gateway unavailable");
          if (gatewayClient.supportsMediaEncryptionSync()) {
            const result = await gatewayClient.requestMediaEncryptionSync(
              options.userId,
              { ...body, channelId: options.channelId },
              controller.signal,
            );
            if (
              generation !== this.generation ||
              useAuthStore.getState().user?.id !== options.userId
            )
              throw new DOMException("Cancelled", "AbortError");
            if (!result.success) {
              if (result.code === "MEDIA_CONTEXT_STALE")
                throw new MediaContextResponseStale();
              throw new Error(result.code);
            }
            return result.snapshot;
          }
        }
        return await this.request<MediaEncryptionSnapshot>(operation);
      } catch (error) {
        const transportFailure =
          operation === "sync" &&
          (error instanceof TypeError ||
            (error instanceof DOMException && error.name === "TimeoutError"));
        if (
          (!(error instanceof MediaContextResponseStale) &&
            !transportFailure) ||
          attempt >= (transportFailure ? 2 : 3) ||
          generation !== this.generation ||
          !this.options ||
          this.controller?.signal.aborted ||
          this.state.phase === "failed"
        )
          throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 250 * 2 ** attempt),
        );
      }
    }
  }
  private async applyEpochUpdate(
    context: MediaEncryptionContext,
    source: "push" | "snapshot",
  ): Promise<void> {
    if (
      !this.options ||
      this.state.phase === "failed" ||
      !this.inScope(context.channelId, context.callId)
    )
      return;
    if (
      context.version !== MEDIA_ENCRYPTION_VERSION ||
      !Number.isSafeInteger(context.contextRevision) ||
      context.contextRevision < 1
    )
      throw new Error("MEDIA_E2EE_UNSUPPORTED");
    if (
      this.context &&
      context.contextId === this.context.contextId &&
      context.contextRevision < this.context.contextRevision
    )
      return;
    const belongsToRegistration = context.devices.some(
      (device) =>
        device.userId === this.options?.userId &&
        device.deviceId === this.body?.deviceId &&
        device.gatewaySessionId === this.body?.gatewaySessionId &&
        device.registrationId === this.body?.registrationId,
    );
    if (!belongsToRegistration) {
      if (
        source === "push" &&
        (!this.context || context.contextId !== this.context.contextId)
      ) {
        // A delayed event can reach the next registration's new handler. The
        // authoritative join snapshot bootstraps that operation; synchronizing
        // before its registration commits could incorrectly reject the join.
        if (this.context) this.requestSync();
        return;
      }
      sframeManager.pause();
      throw new Error("MEDIA_CONTEXT_STALE");
    }
    if (this.context) {
      if (context.contextId !== this.context.contextId)
        throw new Error("MEDIA_CONTEXT_STALE");
      if (
        context.contextRevision === this.context.contextRevision &&
        context.membershipVersion !== this.context.membershipVersion
      )
        throw new Error("MEDIA_KEY_INVALID");
    }
    const generation = this.generation;
    const changed = this.context?.contextRevision !== context.contextRevision;
    this.context = context;
    if (context.complete) this.options.onStage?.("contextReady");
    this.emit({
      ...this.state,
      contextId: context.contextId,
      membershipVersion: context.membershipVersion,
    });
    if (changed) {
      this.rotating = true;
      this.pollDelay = 250;
      const baseline = sframeManager.getStats();
      this.readyFrameBaseline = {
        encrypted: baseline.framesEncrypted,
        decrypted: baseline.framesDecrypted,
      };
      this.emit({ ...this.state, phase: "negotiating" });
      sframeManager.pause();
      this.received.clear();
      this.acknowledgedReceivers.clear();
      this.acceptedEnvelopes.clear();
      for (const key of this.pending.values()) {
        clearTimeout(key.timer);
        key.reject(new MediaEpochSuperseded());
      }
      this.pending.clear();
      for (const [id, envelope] of this.deferred)
        if (
          envelope.contextId !== context.contextId ||
          envelope.contextRevision < context.contextRevision
        )
          this.deferred.delete(id);
      // rotateSenderKeys invalidates the old generation synchronously; never
      // await remote ACKs inside the snapshot/envelope consumer.
      void sframeManager
        .rotateSenderKeys(false)
        .then(() => {
          if (!this.matches(context, generation)) return;
          this.rotating = false;
          if (this.context?.complete) {
            sframeManager.resume();
            this.emit({ ...this.state, phase: "ready" });
          }
        })
        .catch((error) => {
          if (this.matches(context, generation))
            this.background(error, generation);
        });
    }
    if (!context.complete) sframeManager.pause();
    else if (!this.rotating) {
      sframeManager.resume();
      if (this.state.phase === "negotiating")
        this.emit({ ...this.state, phase: "ready" });
    }
    await Promise.all(
      [...this.deferred.values()]
        .filter(
          (envelope) => envelope.contextRevision === context.contextRevision,
        )
        .map((envelope) => this.consumeEnvelope(envelope)),
    );
    this.schedulePoll();
  }
  private async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    const generation = this.generation;
    this.syncing = (async () => {
      do {
        this.syncRequested = false;
        const snapshot = await this.requestSnapshot("sync");
        if (generation !== this.generation) return;
        this.lastSyncAt = Date.now();
        await this.applyEpochUpdate(snapshot.context, "snapshot");
        await this.consume(snapshot);
      } while (
        this.syncRequested &&
        generation === this.generation &&
        this.state.phase !== "failed"
      );
    })().finally(() => {
      if (generation === this.generation) this.syncing = null;
    });
    return this.syncing;
  }
  private async consumeEnvelope(
    envelope: MediaStreamKeyEnvelope,
  ): Promise<void> {
    const context = this.context,
      generation = this.generation;
    if (!this.options || this.state.phase === "failed") return;
    if (
      envelope.version !== MEDIA_ENCRYPTION_VERSION ||
      !Number.isSafeInteger(envelope.contextRevision) ||
      envelope.contextRevision < 1
    )
      throw new Error("MEDIA_KEY_INVALID");
    if (
      context &&
      (envelope.contextId !== context.contextId ||
        envelope.contextRevision < context.contextRevision)
    )
      return;
    const id = `${envelope.contextRevision}:${envelope.keyId}`;
    if (!context || envelope.contextRevision > context.contextRevision) {
      if (this.deferred.size >= 512 && !this.deferred.has(id))
        throw new Error("MEDIA_KEY_INVALID");
      this.deferred.set(id, envelope);
      // The join snapshot binds this registration to its room. A delayed old
      // envelope before that commit must not start an unauthorized early sync.
      if (context) this.requestSync();
      return;
    }
    if (envelope.membershipVersion !== context.membershipVersion)
      throw new Error("MEDIA_KEY_INVALID");
    const identity =
      new TextDecoder().decode(mediaStreamEnvelopeSigningBytes(envelope)) +
      ":" +
      envelope.signature;
    const accepted = this.acceptedEnvelopes.get(envelope.keyId);
    if (accepted !== undefined && accepted !== identity)
      throw new Error("MEDIA_KEY_INVALID");
    if (this.acknowledgedReceivers.has(envelope.keyId)) return;
    const existing = this.consuming.get(id);
    if (existing) return existing;
    const operation = (async () => {
      if (!this.received.has(envelope.keyId)) {
        const key = await deviceKeyService.openStreamKey(context, envelope);
        if (!this.matches(context, generation)) return;
        await sframeManager.installReceiverKey(envelope.keyId, key);
        if (!this.matches(context, generation)) return;
        this.received.add(envelope.keyId);
        this.acceptedEnvelopes.set(envelope.keyId, identity);
      }
      const acknowledge: MediaStreamKeyAcknowledgeRequest = {
        contextId: context.contextId,
        contextRevision: context.contextRevision,
        membershipVersion: context.membershipVersion,
        keyId: envelope.keyId,
      };
      try {
        await this.requestIdempotent("acknowledge", { acknowledge });
        if (this.matches(context, generation)) {
          this.acknowledgedReceivers.add(envelope.keyId);
          this.deferred.delete(id);
        }
      } catch (error) {
        if (!this.matches(context, generation)) return;
        this.deferred.set(id, envelope);
        if (error instanceof Error && error.message === "MEDIA_CONTEXT_STALE") {
          this.requestSync();
          return;
        }
        throw error;
      }
    })()
      .catch((error) => {
        if (this.matches(context, generation)) throw error;
      })
      .finally(() => {
        if (this.consuming.get(id) === operation) this.consuming.delete(id);
      });
    this.consuming.set(id, operation);
    return operation;
  }
  private async consume(snapshot: MediaEncryptionSnapshot): Promise<void> {
    if (!this.matches(snapshot.context)) return;
    await Promise.all(
      snapshot.envelopes.map((envelope) => this.consumeEnvelope(envelope)),
    );
    if (!this.matches(snapshot.context)) return;
    for (const keyId of snapshot.acknowledgedKeyIds) {
      const pending = this.pending.get(keyId);
      if (pending && this.matches(pending.context)) this.resolvePending(keyId);
    }
  }
  private resolvePending(keyId: number): void {
    const pending = this.pending.get(keyId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(keyId);
    pending.resolve();
  }
  private async createSenderKey(streamId: string): Promise<SenderMediaKey> {
    const generation = this.generation,
      deadline = Date.now() + 15000;
    const startedRevision = this.context?.contextRevision;
    while (
      generation === this.generation &&
      this.options &&
      this.state.phase !== "failed"
    ) {
      if (this.context?.contextRevision !== startedRevision)
        throw new MediaEpochSuperseded();
      if (Date.now() >= deadline) throw new Error("MEDIA_NEGOTIATION_TIMEOUT");
      const context = this.context,
        options = this.options;
      if (!context?.complete) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        await this.sync();
        continue;
      }
      const key = crypto.getRandomValues(new Uint8Array(32));
      const keyId =
        crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff || 1;
      const recipients = context.devices.filter(
        (device) =>
          device.userId !== options.userId ||
          device.deviceId !== this.body?.deviceId,
      );
      const envelopes = await Promise.all(
        recipients.map((recipient) =>
          deviceKeyService.wrapStreamKey(
            context,
            streamId,
            keyId,
            key,
            recipient,
          ),
        ),
      );
      if (!this.matches(context, generation)) throw new MediaEpochSuperseded();
      const publish: MediaStreamKeyPublishRequest = {
        contextId: context.contextId,
        contextRevision: context.contextRevision,
        membershipVersion: context.membershipVersion,
        streamId,
        keyId,
        envelopes,
      };
      const ack = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            this.pending.delete(keyId);
            reject(new Error("MEDIA_NEGOTIATION_TIMEOUT"));
          },
          Math.max(1, deadline - Date.now()),
        );
        this.pending.set(keyId, { context, resolve, reject, timer });
      });
      // The publication HTTP request may still be in flight when an epoch
      // invalidates this ACK, so attach a rejection observer immediately.
      void ack.catch(() => {});
      this.schedulePoll(true);
      try {
        const result = await this.requestIdempotent<{ acknowledged: boolean }>(
          "publish",
          { publish },
        );
        if (result.acknowledged && this.matches(context, generation))
          this.resolvePending(keyId);
        await ack;
        if (!this.matches(context, generation))
          throw new MediaEpochSuperseded();
        this.options?.onStage?.("keyAcknowledged");
        return { key, keyId, streamId };
      } catch (error) {
        this.resolvePending(keyId);
        if (
          generation !== this.generation ||
          !this.options ||
          this.getState().phase === "failed"
        )
          throw error;
        if (error instanceof MediaEpochSuperseded) throw error;
        if (error instanceof Error && error.message === "MEDIA_CONTEXT_STALE") {
          await this.sync();
          if (!this.matches(context, generation))
            throw new MediaEpochSuperseded();
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          continue;
        }
        throw error;
      }
    }
    throw new DOMException("Cancelled", "AbortError");
  }
  private fail(error: unknown): void {
    const normalized =
      error instanceof Error ? error : new Error("MEDIA_KEY_UNAVAILABLE");
    if (!this.options || this.state.phase === "failed") return;
    const source = (normalized as Error & { mediaFailureSource?: string })
      .mediaFailureSource;
    console.warn("[MediaEncryption] negotiation stopped", {
      code: /^[A-Z_]+$/.test(normalized.message)
        ? normalized.message
        : "MEDIA_KEY_UNAVAILABLE",
      source: source?.startsWith("media-") ? source : "media-negotiation",
      contextRevision: this.context?.contextRevision,
      lastSyncAgeMs: Date.now() - this.lastSyncAt,
      pendingSenders: this.pending.size,
    });
    sframeManager.pause();
    this.emit({
      ...this.state,
      phase: "failed",
      errorCode: normalized.message,
    });
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(normalized);
    }
    this.pending.clear();
    this.options.onFailure?.(normalized);
  }
  public stop(): void {
    const options = this.options,
      body = this.body;
    if (options && body) {
      const auth = useAuthStore.getState();
      this.pendingLeave = this.pendingLeave.then(async () => {
        await fetch(
          `${API_BASE}/api/channels/${encodeURIComponent(options.channelId)}/media-encryption/leave`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${auth.user?.id === options.userId ? auth.token || options.token : options.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            keepalive: true,
            signal: AbortSignal.timeout(3000),
          },
        ).catch(() => {});
      });
    }
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
    for (const unbind of this.unbinds) unbind();
    this.unbinds = [];
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new MediaEpochSuperseded());
    }
    this.pending.clear();
    this.received.clear();
    this.acknowledgedReceivers.clear();
    this.acceptedEnvelopes.clear();
    this.deferred.clear();
    this.consuming.clear();
    this.options = null;
    this.context = null;
    this.body = null;
    this.syncing = null;
    this.syncRequested = false;
    this.rotating = false;
    this.pollDelay = 250;
    this.readyFrameBaseline = { encrypted: 0, decrypted: 0 };
    sframeManager.disable();
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
