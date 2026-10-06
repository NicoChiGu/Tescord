/** Media encryption is mandatory and independent of text-channel encryption. */
export const MEDIA_ENCRYPTION_VERSION = 2 as const;
export type MediaEncryptionPhase =
  "negotiating" | "ready" | "active" | "failed";
export interface MediaEncryptionDevice {
  userId: string;
  deviceId: string;
  gatewaySessionId: string;
  signingPublicKey: string;
  agreementPublicKey: string;
  fingerprint: string;
}
export interface MediaEncryptionJoinRequest {
  version: typeof MEDIA_ENCRYPTION_VERSION;
  deviceId: string;
  gatewaySessionId: string;
  callId?: string;
}
export interface MediaEncryptionContext {
  version: typeof MEDIA_ENCRYPTION_VERSION;
  contextId: string;
  channelId: string;
  callId?: string;
  membershipVersion: string;
  devices: MediaEncryptionDevice[];
  expiresAt: string;
  complete: boolean;
}
export interface MediaStreamKeyEnvelope {
  version: typeof MEDIA_ENCRYPTION_VERSION;
  contextId: string;
  membershipVersion: string;
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
  streamId: string;
  keyId: number;
  envelopes: MediaStreamKeyEnvelope[];
}
export interface MediaEncryptionSnapshot {
  context: MediaEncryptionContext;
  envelopes: MediaStreamKeyEnvelope[];
  acknowledgedKeyIds: number[];
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
