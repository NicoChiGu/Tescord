import { ErrorCode } from "./index.js";

/** Media encryption is mandatory and independent of text-channel encryption. */
export const MEDIA_ENCRYPTION_VERSION = 3 as const;
export type MediaEncryptionPhase =
  "negotiating" | "ready" | "active" | "failed";
export interface MediaEncryptionDevice {
  userId: string;
  deviceId: string;
  gatewaySessionId: string;
  registrationId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  fingerprint: string;
}
export interface MediaEncryptionJoinRequest {
  version: typeof MEDIA_ENCRYPTION_VERSION;
  deviceId: string;
  gatewaySessionId: string;
  registrationId: string;
  callId?: string;
}
export interface MediaEncryptionContext {
  version: typeof MEDIA_ENCRYPTION_VERSION;
  contextId: string;
  channelId: string;
  callId?: string;
  membershipVersion: string;
  contextRevision: number;
  devices: MediaEncryptionDevice[];
  expiresAt: string;
  complete: boolean;
}
export interface MediaStreamKeyEnvelope {
  version: typeof MEDIA_ENCRYPTION_VERSION;
  contextId: string;
  membershipVersion: string;
  contextRevision: number;
  streamId: string;
  keyId: number;
  senderId: string;
  senderDeviceId: string;
  recipientId: string;
  recipientDeviceId: string;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
  signature: string;
  createdAt: string;
}
export interface MediaStreamKeyPublishRequest {
  contextId: string;
  membershipVersion: string;
  contextRevision: number;
  streamId: string;
  keyId: number;
  envelopes: MediaStreamKeyEnvelope[];
}
export interface MediaStreamKeyAcknowledgeRequest {
  contextId: string;
  membershipVersion: string;
  contextRevision: number;
  keyId: number;
}
export interface MediaEncryptionSnapshot {
  context: MediaEncryptionContext;
  envelopes: MediaStreamKeyEnvelope[];
  acknowledgedKeyIds: number[];
}
/** Only the identified connection's own login and Gateway session may sync. */
export interface MediaEncryptionSyncRequest extends MediaEncryptionJoinRequest {
  requestId: string;
  channelId: string;
}
export type MediaEncryptionSyncResult = {
  requestId: string;
  channelId: string;
  registrationId: string;
} & (
  | { success: true; snapshot: MediaEncryptionSnapshot }
  | { success: false; code: ErrorCode }
);

export function isMediaEncryptionSyncRequest(
  value: unknown,
): value is MediaEncryptionSyncRequest {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.version === MEDIA_ENCRYPTION_VERSION &&
    [
      "requestId",
      "channelId",
      "deviceId",
      "gatewaySessionId",
      "registrationId",
    ].every(
      (key) =>
        typeof data[key] === "string" &&
        data[key].length > 0 &&
        data[key].length <= 160,
    ) &&
    (data.callId === undefined ||
      (typeof data.callId === "string" &&
        data.callId.length > 0 &&
        data.callId.length <= 160))
  );
}

/** Validate transport shape before any snapshot reaches the crypto state machine. */
export function isMediaEncryptionSyncResult(
  value: unknown,
): value is MediaEncryptionSyncResult {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (
    !["requestId", "channelId", "registrationId"].every(
      (key) =>
        typeof data[key] === "string" &&
        data[key].length > 0 &&
        data[key].length <= 160,
    )
  )
    return false;
  if (data.success === false)
    return Object.values(ErrorCode).includes(data.code as ErrorCode);
  if (
    data.success !== true ||
    !data.snapshot ||
    typeof data.snapshot !== "object"
  )
    return false;
  const snapshot = data.snapshot as Record<string, unknown>;
  if (!snapshot.context || typeof snapshot.context !== "object") return false;
  const context = snapshot.context as Record<string, unknown>;
  const strings = (entry: unknown, fields: string[]) =>
    Boolean(
      entry &&
      typeof entry === "object" &&
      fields.every(
        (key) =>
          typeof (entry as Record<string, unknown>)[key] === "string" &&
          ((entry as Record<string, unknown>)[key] as string).length > 0,
      ),
    );
  const integer = (entry: unknown) =>
    typeof entry === "number" && Number.isSafeInteger(entry) && entry > 0;
  return (
    context.version === MEDIA_ENCRYPTION_VERSION &&
    strings(context, [
      "contextId",
      "channelId",
      "membershipVersion",
      "expiresAt",
    ]) &&
    (context.callId === undefined || typeof context.callId === "string") &&
    integer(context.contextRevision) &&
    typeof context.complete === "boolean" &&
    Array.isArray(context.devices) &&
    context.devices.every((device) =>
      strings(device, [
        "userId",
        "deviceId",
        "gatewaySessionId",
        "registrationId",
        "signingPublicKey",
        "agreementPublicKey",
        "fingerprint",
      ]),
    ) &&
    Array.isArray(snapshot.acknowledgedKeyIds) &&
    snapshot.acknowledgedKeyIds.every(integer) &&
    Array.isArray(snapshot.envelopes) &&
    snapshot.envelopes.every((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const envelope = entry as Record<string, unknown>;
      return (
        envelope.version === MEDIA_ENCRYPTION_VERSION &&
        integer(envelope.contextRevision) &&
        integer(envelope.keyId) &&
        strings(envelope, [
          "contextId",
          "membershipVersion",
          "streamId",
          "senderId",
          "senderDeviceId",
          "recipientId",
          "recipientDeviceId",
          "ephemeralPublicKey",
          "iv",
          "ciphertext",
          "signature",
          "createdAt",
        ])
      );
    })
  );
}
/** Canonical signed bytes: no delimiter ambiguity or implementation-local ordering. */
export function mediaStreamEnvelopeSigningBytes(
  envelope: Omit<MediaStreamKeyEnvelope, "signature">,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      envelope.version,
      envelope.contextId,
      envelope.membershipVersion,
      envelope.contextRevision,
      envelope.streamId,
      envelope.keyId,
      envelope.senderId,
      envelope.senderDeviceId,
      envelope.recipientId,
      envelope.recipientDeviceId,
      envelope.ephemeralPublicKey,
      envelope.iv,
      envelope.ciphertext,
      envelope.createdAt,
    ]),
  );
}
export interface MediaEncryptionState {
  phase: MediaEncryptionPhase;
  contextId: string | null;
  membershipVersion: string | null;
  errorCode?: string;
  framesEncrypted: number;
  framesDecrypted: number;
}
/** Percentages use 0..100 across P2P/SFU and all presentation layers. */
export interface AudioReceiveQuality {
  trackId: string;
  timestamp: number;
  intervalMs: number;
  packetsReceived: number;
  packetsLost: number;
  packetLossPercent?: number;
  jitterMs?: number;
  jitterBufferDelayMs?: number;
  concealedSamples: number;
  concealmentPercent?: number;
  bytesReceived: number;
  receiverBufferTargetMs?: number;
}

export interface MediaKeyEnvelopePushPayload {
  channelId: string;
  callId?: string;
  contextId: string;
  membershipVersion: string;
  contextRevision: number;
  envelope: MediaStreamKeyEnvelope;
}

export interface MediaKeyAckPushPayload {
  channelId: string;
  callId?: string;
  contextId: string;
  membershipVersion: string;
  contextRevision: number;
  keyId: number;
  acknowledged: boolean;
}

export interface MediaEpochUpdatePushPayload {
  channelId: string;
  callId?: string;
  context: MediaEncryptionContext;
}

export type MediaJoinStage =
  | "joinStarted"
  | "deviceRegistered"
  | "contextReady"
  | "keyAcknowledged"
  | "iceReady"
  | "published"
  | "subscribed"
  | "connected"
  | "firstPlayableAudio";
/** Durations from startedAt, in milliseconds; never interpreted as media latency. */
export interface MediaJoinTimingTrace {
  channelId: string;
  operationEpoch: number;
  startedAt: number;
  stages: Partial<Record<MediaJoinStage, number>>;
}
