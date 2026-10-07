import { createHash, randomUUID, webcrypto } from "node:crypto";
import { prisma } from "../db.js";
import { gatewayManager } from "../gateway.js";
import { dmCallService } from "./dm-call.service.js";
import { dmService } from "./dm.service.js";
import { permissionService } from "./permission.service.js";
import {
  GatewayEvents,
  GatewayOpCode,
  MEDIA_ENCRYPTION_VERSION,
  PermissionFlags,
  mediaStreamEnvelopeSigningBytes,
} from "@tescord/types";
import type {
  MediaEncryptionContext,
  MediaEncryptionDevice,
  MediaEncryptionJoinRequest,
  MediaEncryptionSnapshot,
  MediaStreamKeyPublishRequest,
  MediaKeyEnvelopePushPayload,
  MediaKeyAckPushPayload,
  MediaEpochUpdatePushPayload,
} from "@tescord/types";

interface Registration {
  userId: string;
  loginSessionId: string;
  deviceId: string;
  gatewaySessionId: string;
  touchedAt: number;
}
interface Room {
  contextId: string;
  channelId: string;
  callId?: string;
  registrations: Map<string, Registration>;
}
const identity = (userId: string, deviceId: string) =>
  JSON.stringify([userId, deviceId]);
function reject(code = "MEDIA_CONTEXT_STALE"): never {
  throw new Error(code);
}
/** Entry: verified HTTP session + identified Gateway session. Keys are ciphertext only.
 * Resource: current voice/call session. Authorization: active CONNECT/DM participation,
 * matching login/Gateway/device identity, current roster epoch. Denial is fail closed.
 */
export class MediaEncryptionRegistry {
  constructor(
    private gateway: Pick<
      typeof gatewayManager,
      "hasIdentifiedLoginSession" | "getMediaVoiceState" | "getMediaVoiceRoster"
    > &
      Partial<
        Pick<
          typeof gatewayManager,
          | "confirmMediaRegistration"
          | "expireMediaParticipant"
          | "sendToSession"
          | "sendToUser"
        >
      > = gatewayManager,
  ) {}
  private rooms = new Map<string, Room>();
  private roomKey(channelId: string, callId?: string): string {
    return JSON.stringify([channelId, callId || null]);
  }
  private async authorize(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<void> {
    if (body.version !== MEDIA_ENCRYPTION_VERSION)
      reject("MEDIA_E2EE_UNSUPPORTED");
    if (
      !body.deviceId ||
      !body.gatewaySessionId ||
      [body.deviceId, body.gatewaySessionId, body.callId || ""].some(
        (value) => typeof value !== "string" || value.length > 160,
      )
    )
      reject("INVALID_PARAMS");
    const [user, login, device, channel] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.refreshToken.findUnique({ where: { id: loginSessionId } }),
      prisma.deviceKey.findFirst({
        where: { userId, deviceId: body.deviceId, revokedAt: null },
      }),
      prisma.channel.findUnique({ where: { id: channelId } }),
    ]);
    if (
      !user ||
      user.isBanned ||
      !login ||
      login.userId !== userId ||
      login.expiresAt <= new Date() ||
      !device ||
      !channel
    )
      reject("UNAUTHORIZED");
    if (
      !this.gateway.hasIdentifiedLoginSession(
        userId,
        body.gatewaySessionId,
        loginSessionId,
        user.sessionVersion,
      )
    )
      reject("UNAUTHORIZED");
    if (body.callId) {
      if (!(await dmService.isParticipant(userId, channelId)))
        reject("FORBIDDEN");
      try {
        dmCallService.authorizeMedia(
          userId,
          body.gatewaySessionId,
          body.callId,
          channelId,
        );
      } catch {
        reject("FORBIDDEN");
      }
    } else {
      const voice = this.gateway.getMediaVoiceState(userId);
      if (
        channel.type !== "VOICE" ||
        voice?.channelId !== channelId ||
        voice.sessionId !== body.gatewaySessionId ||
        !(await permissionService.hasChannelPermission(
          userId,
          channelId,
          PermissionFlags.CONNECT,
        ))
      )
        reject("FORBIDDEN");
    }
  }
  async join(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<MediaEncryptionSnapshot> {
    await this.authorize(userId, loginSessionId, channelId, body);
    const roomKey = this.roomKey(channelId, body.callId);
    let room = this.rooms.get(roomKey);
    if (!room) {
      room = {
        contextId: randomUUID(),
        channelId,
        callId: body.callId,
        registrations: new Map(),
      };
      this.rooms.set(roomKey, room);
    }
    // A single active voice identity per user; a transferred device replaces the old registration.
    for (const [key, entry] of room.registrations)
      if (
        entry.userId === userId &&
        (entry.deviceId !== body.deviceId ||
          entry.gatewaySessionId !== body.gatewaySessionId)
      )
        room.registrations.delete(key);
    room.registrations.set(identity(userId, body.deviceId), {
      userId,
      loginSessionId,
      deviceId: body.deviceId,
      gatewaySessionId: body.gatewaySessionId,
      touchedAt: Date.now(),
    });
    if (!body.callId)
      this.gateway.confirmMediaRegistration?.(
        userId,
        channelId,
        body.gatewaySessionId,
      );
    const snapshot = await this.snapshot(
      userId,
      loginSessionId,
      channelId,
      body,
    );
    this.broadcastEpochUpdate(room, snapshot.context);
    return snapshot;
  }
  private broadcastEpochUpdate(room: Room, context: MediaEncryptionContext) {
    for (const [, entry] of room.registrations) {
      this.gateway.sendToSession?.(entry.userId, entry.gatewaySessionId, {
        op: GatewayOpCode.DISPATCH,
        t: GatewayEvents.MEDIA_EPOCH_UPDATE,
        d: {
          channelId: room.channelId,
          callId: room.callId,
          context,
        } satisfies MediaEpochUpdatePushPayload,
      });
    }
  }
  private async context(room: Room): Promise<MediaEncryptionContext> {
    const devices: MediaEncryptionDevice[] = [];
    for (const [key, entry] of room.registrations) {
      try {
        if (Date.now() - entry.touchedAt > 15_000) reject();
        await this.authorize(
          entry.userId,
          entry.loginSessionId,
          room.channelId,
          { version: 2, ...entry, callId: room.callId },
        );
        const device = await prisma.deviceKey.findFirst({
          where: {
            userId: entry.userId,
            deviceId: entry.deviceId,
            revokedAt: null,
          },
        });
        if (!device) reject();
        devices.push({
          userId: entry.userId,
          deviceId: entry.deviceId,
          gatewaySessionId: entry.gatewaySessionId,
          signingPublicKey: device!.signingPublicKey,
          agreementPublicKey: device!.agreementPublicKey,
          fingerprint: device!.fingerprint,
        });
      } catch {
        room.registrations.delete(key);
        if (!room.callId)
          this.gateway.expireMediaParticipant?.(
            entry.userId,
            room.channelId,
            entry.gatewaySessionId,
          );
        else {
          try {
            dmCallService.authorizeMedia(
              entry.userId,
              entry.gatewaySessionId,
              room.callId,
              room.channelId,
            );
            dmCallService.terminateForUser(
              entry.userId,
              "e2ee_negotiation_timeout",
            );
          } catch {
            /* A revoked call has already been closed. */
          }
        }
      }
    }
    devices.sort((a, b) =>
      identity(a.userId, a.deviceId).localeCompare(
        identity(b.userId, b.deviceId),
      ),
    );
    let expected: { userId: string; sessionId?: string }[];
    if (room.callId && devices[0]) {
      try {
        const call = dmCallService.authorizeMedia(
          devices[0].userId,
          devices[0].gatewaySessionId,
          room.callId,
          room.channelId,
        );
        expected = [
          { userId: call.callerId, sessionId: call.callerSessionId },
          { userId: call.calleeId, sessionId: call.acceptedSessionId },
        ];
      } catch {
        expected = [{ userId: "invalid" }];
      }
    } else
      expected = this.gateway
        .getMediaVoiceRoster(room.channelId)
        .map((state) => ({ userId: state.userId, sessionId: state.sessionId }));
    const complete =
      devices.length > 0 &&
      expected.length === devices.length &&
      expected.every((entry) =>
        devices.some(
          (device) =>
            device.userId === entry.userId &&
            device.gatewaySessionId === entry.sessionId,
        ),
      );
    const membershipVersion = createHash("sha256")
      .update(JSON.stringify([room.contextId, devices, expected]))
      .digest("base64url");
    return {
      version: 2,
      contextId: room.contextId,
      channelId: room.channelId,
      callId: room.callId,
      membershipVersion,
      devices,
      complete,
      expiresAt: new Date(Date.now() + 15_000).toISOString(),
    };
  }
  private requireRoom(channelId: string, callId?: string): Room {
    return this.rooms.get(this.roomKey(channelId, callId)) || reject();
  }
  async snapshot(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<MediaEncryptionSnapshot> {
    await this.authorize(userId, loginSessionId, channelId, body);
    const room = this.requireRoom(channelId, body.callId),
      entry = room.registrations.get(identity(userId, body.deviceId));
    if (
      !entry ||
      entry.gatewaySessionId !== body.gatewaySessionId ||
      entry.loginSessionId !== loginSessionId
    )
      reject();
    entry.touchedAt = Date.now();
    const context = await this.context(room);
    if (
      !context.devices.some(
        (device) =>
          device.userId === userId && device.deviceId === body.deviceId,
      )
    )
      reject();
    const records = await prisma.streamMediaKeyEnvelope.findMany({
      where: {
        contextId: room.contextId,
        membershipVersion: context.membershipVersion,
        expiresAt: { gt: new Date() },
      },
    });
    const envelopes = records
      .filter(
        (record) =>
          record.recipientId === userId &&
          record.recipientDeviceId === body.deviceId,
      )
      .map(
        (record) =>
          JSON.parse(
            record.envelopeJson,
          ) as MediaEncryptionSnapshot["envelopes"][number],
      );
    const groups = new Map<number, typeof records>();
    for (const record of records)
      if (record.senderId === userId && record.senderDeviceId === body.deviceId)
        groups.set(record.keyId, [...(groups.get(record.keyId) || []), record]);
    const acknowledgedKeyIds = [...groups]
      .filter(([, entries]) =>
        entries.every((entry) => entry.acknowledgedAt !== null),
      )
      .map(([keyId]) => keyId);
    return { context, envelopes, acknowledgedKeyIds };
  }
  async publish(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
    request: MediaStreamKeyPublishRequest,
  ): Promise<{ acknowledged: boolean }> {
    const { context } = await this.snapshot(
      userId,
      loginSessionId,
      channelId,
      body,
    );
    if (
      !context.complete ||
      context.contextId !== request.contextId ||
      context.membershipVersion !== request.membershipVersion
    )
      reject();
    if (
      !Number.isInteger(request.keyId) ||
      request.keyId <= 0 ||
      request.keyId > 0x7fffffff ||
      typeof request.streamId !== "string" ||
      request.streamId.length > 160 ||
      !Array.isArray(request.envelopes)
    )
      reject("INVALID_PARAMS");
    const sender = context.devices.find(
      (device) => device.userId === userId && device.deviceId === body.deviceId,
    )!;
    const recipients = context.devices.filter((device) => device !== sender);
    if (
      recipients.length !== request.envelopes.length ||
      recipients.length > 500
    )
      reject("INVALID_PARAMS");
    const signer = await webcrypto.subtle.importKey(
      "jwk",
      JSON.parse(sender.signingPublicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const seen = new Set<string>();
    for (const envelope of request.envelopes) {
      const recipient = recipients.find(
        (device) =>
          device.userId === envelope.recipientId &&
          device.deviceId === envelope.recipientDeviceId,
      );
      const recipientIdentity = identity(
        envelope.recipientId,
        envelope.recipientDeviceId,
      );
      if (
        !recipient ||
        seen.has(recipientIdentity) ||
        envelope.senderId !== userId ||
        envelope.senderDeviceId !== body.deviceId ||
        envelope.version !== 2 ||
        envelope.contextId !== context.contextId ||
        envelope.membershipVersion !== context.membershipVersion ||
        envelope.streamId !== request.streamId ||
        envelope.keyId !== request.keyId
      )
        reject("FORBIDDEN");
      seen.add(recipientIdentity);
      if (
        ![
          envelope.ephemeralPublicKey,
          envelope.iv,
          envelope.ciphertext,
          envelope.signature,
          envelope.createdAt,
        ].every(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 4096,
        ) ||
        Math.abs(Date.now() - Date.parse(envelope.createdAt)) > 60_000 ||
        !Number.isFinite(Date.parse(envelope.createdAt))
      )
        reject("INVALID_PARAMS");
      if (
        Buffer.from(envelope.iv, "base64url").length !== 12 ||
        Buffer.from(envelope.ciphertext, "base64url").length !== 48 ||
        Buffer.from(envelope.signature, "base64url").length !== 64
      )
        reject("INVALID_PARAMS");
      const jwk = JSON.parse(envelope.ephemeralPublicKey) as JsonWebKey;
      if (jwk.kty !== "EC" || jwk.crv !== "P-256" || jwk.d)
        reject("INVALID_PARAMS");
      if (
        !(await webcrypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          signer,
          Buffer.from(envelope.signature, "base64url"),
          mediaStreamEnvelopeSigningBytes(envelope),
        ))
      )
        reject("MEDIA_KEY_INVALID");
    }
    const collision = await prisma.streamMediaKeyEnvelope.findFirst({
      where: {
        contextId: context.contextId,
        membershipVersion: context.membershipVersion,
        keyId: request.keyId,
      },
    });
    if (collision) reject("MEDIA_KEY_INVALID");
    // Recheck the roster after signature validation; no stale recipient can receive a newly rotated key.
    const current = await this.context(
      this.requireRoom(channelId, body.callId),
    );
    if (current.membershipVersion !== context.membershipVersion) reject();
    await prisma.$transaction([
      prisma.streamMediaKeyEnvelope.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      ...request.envelopes.map((envelope) =>
        prisma.streamMediaKeyEnvelope.create({
          data: {
            contextId: context.contextId,
            membershipVersion: context.membershipVersion,
            channelId,
            streamId: request.streamId,
            keyId: request.keyId,
            senderId: userId,
            senderDeviceId: body.deviceId,
            recipientId: envelope.recipientId,
            recipientDeviceId: envelope.recipientDeviceId,
            envelopeJson: JSON.stringify(envelope),
            expiresAt: new Date(Date.now() + 120_000),
          },
        }),
      ),
    ]);
    for (const envelope of request.envelopes) {
      const recipient = recipients.find(
        (device) =>
          device.userId === envelope.recipientId &&
          device.deviceId === envelope.recipientDeviceId,
      );
      if (recipient) {
        this.gateway.sendToSession?.(
          recipient.userId,
          recipient.gatewaySessionId,
          {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.MEDIA_KEY_ENVELOPE,
            d: {
              channelId,
              callId: body.callId,
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              envelope,
            } satisfies MediaKeyEnvelopePushPayload,
          },
        );
      }
    }
    if (recipients.length) {
      const timer = setTimeout(() => {
        void (async () => {
          const room = this.rooms.get(this.roomKey(channelId, body.callId));
          if (
            !room ||
            (await this.context(room)).membershipVersion !==
              context.membershipVersion
          )
            return;
          const missing = await prisma.streamMediaKeyEnvelope.findMany({
            where: {
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              keyId: request.keyId,
              acknowledgedAt: null,
            },
          });
          for (const envelope of missing) {
            const recipient = context.devices.find(
              (device) =>
                device.userId === envelope.recipientId &&
                device.deviceId === envelope.recipientDeviceId,
            );
            if (!recipient) continue;
            this.leave(
              recipient.userId,
              channelId,
              recipient.gatewaySessionId,
              body.callId,
            );
            if (body.callId) {
              dmCallService.authorizeMedia(
                recipient.userId,
                recipient.gatewaySessionId,
                body.callId,
                channelId,
              );
              dmCallService.terminateForUser(
                recipient.userId,
                "e2ee_negotiation_timeout",
              );
            } else
              this.gateway.expireMediaParticipant?.(
                recipient.userId,
                channelId,
                recipient.gatewaySessionId,
              );
          }
        })().catch(() => {});
      }, 10_000);
      timer.unref();
    }
    return { acknowledged: !recipients.length };
  }
  async acknowledge(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
    keyId: number,
  ): Promise<void> {
    const { context } = await this.snapshot(
      userId,
      loginSessionId,
      channelId,
      body,
    );
    if (!Number.isInteger(keyId)) reject("INVALID_PARAMS");
    await prisma.streamMediaKeyEnvelope.updateMany({
      where: {
        contextId: context.contextId,
        membershipVersion: context.membershipVersion,
        recipientId: userId,
        recipientDeviceId: body.deviceId,
        keyId,
        expiresAt: { gt: new Date() },
      },
      data: { acknowledgedAt: new Date() },
    });
    const unacknowledged = await prisma.streamMediaKeyEnvelope.count({
      where: {
        contextId: context.contextId,
        membershipVersion: context.membershipVersion,
        keyId,
        acknowledgedAt: null,
      },
    });
    if (unacknowledged === 0) {
      const sample = await prisma.streamMediaKeyEnvelope.findFirst({
        where: {
          contextId: context.contextId,
          membershipVersion: context.membershipVersion,
          keyId,
        },
        select: { senderId: true, senderDeviceId: true },
      });
      if (sample) {
        const sender = context.devices.find(
          (device) =>
            device.userId === sample.senderId &&
            device.deviceId === sample.senderDeviceId,
        );
        if (sender) {
          this.gateway.sendToSession?.(sender.userId, sender.gatewaySessionId, {
            op: GatewayOpCode.DISPATCH,
            t: GatewayEvents.MEDIA_KEY_ACK,
            d: {
              channelId,
              callId: body.callId,
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              keyId,
              acknowledged: true,
            } satisfies MediaKeyAckPushPayload,
          });
        }
      }
    }
  }
  async assertParticipant(
    channelId: string,
    userId: string,
    gatewaySessionId: string | undefined,
    callId?: string,
  ): Promise<void> {
    if (!gatewaySessionId) reject("MEDIA_KEY_UNAVAILABLE");
    const room = this.requireRoom(channelId, callId),
      context = await this.context(room);
    if (
      !context.complete ||
      !context.devices.some(
        (device) =>
          device.userId === userId &&
          device.gatewaySessionId === gatewaySessionId,
      )
    )
      reject("MEDIA_KEY_UNAVAILABLE");
  }
  leave(
    userId: string,
    channelId: string,
    gatewaySessionId: string,
    callId?: string,
  ): void {
    const key = this.roomKey(channelId, callId),
      room = this.rooms.get(key);
    if (!room) return;
    for (const [id, entry] of room.registrations)
      if (
        entry.userId === userId &&
        entry.gatewaySessionId === gatewaySessionId
      )
        room.registrations.delete(id);
    if (!room.registrations.size) {
      this.rooms.delete(key);
    } else {
      void this.context(room)
        .then((ctx) => {
          this.broadcastEpochUpdate(room, ctx);
        })
        .catch(() => {});
    }
  }
}
export const mediaEncryptionRegistry = new MediaEncryptionRegistry();
