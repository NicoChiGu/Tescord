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
  MediaStreamKeyAcknowledgeRequest,
  MediaKeyEnvelopePushPayload,
  MediaKeyAckPushPayload,
  MediaEpochUpdatePushPayload,
} from "@tescord/types";

interface Registration {
  userId: string;
  loginSessionId: string;
  deviceId: string;
  gatewaySessionId: string;
  registrationId: string;
  touchedAt: number;
}
interface Room {
  contextId: string;
  channelId: string;
  callId?: string;
  registrations: Map<string, Registration>;
  contextRevision: number;
  membershipVersion?: string;
}
interface JoinTicket {
  userId: string;
  gatewaySessionId: string;
  registrationId: string;
  cancelled: boolean;
}
const identity = (userId: string, deviceId: string) =>
  JSON.stringify([userId, deviceId]);
function reject(code = "MEDIA_CONTEXT_STALE"): never {
  throw new Error(code);
}
/** Entry: verified HTTP session or identified Gateway socket. Keys are ciphertext only.
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
  private operations = new Map<string, Promise<void>>();
  private pendingJoins = new Map<string, Set<JoinTicket>>();
  private serialize<T>(
    channelId: string,
    callId: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = this.roomKey(channelId, callId);
    const previous = this.operations.get(key) || Promise.resolve();
    const result = previous.then(run, run);
    const settled = result.then(
      () => {},
      () => {},
    );
    this.operations.set(key, settled);
    void settled.then(() => {
      if (this.operations.get(key) === settled) this.operations.delete(key);
    });
    return result;
  }
  private assertRegistration(
    room: Room,
    userId: string,
    loginSessionId: string,
    body: MediaEncryptionJoinRequest,
  ): Registration {
    if (this.rooms.get(this.roomKey(room.channelId, room.callId)) !== room)
      reject();
    const entry = room.registrations.get(identity(userId, body.deviceId));
    if (
      !entry ||
      entry.gatewaySessionId !== body.gatewaySessionId ||
      entry.registrationId !== body.registrationId ||
      entry.loginSessionId !== loginSessionId
    )
      reject();
    return entry;
  }
  private async assertCurrent(
    room: Room,
    context: MediaEncryptionContext,
    userId: string,
    loginSessionId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<void> {
    this.assertRegistration(room, userId, loginSessionId, body);
    const latest = await this.context(room);
    this.assertRegistration(room, userId, loginSessionId, body);
    if (
      latest.membershipVersion !== context.membershipVersion ||
      latest.contextRevision !== context.contextRevision
    )
      reject();
  }
  private roomKey(channelId: string, callId?: string): string {
    return JSON.stringify([channelId, callId || null]);
  }
  private async authorize(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<MediaEncryptionDevice> {
    if (body.version !== MEDIA_ENCRYPTION_VERSION)
      reject("MEDIA_E2EE_UNSUPPORTED");
    if (
      !body.deviceId ||
      !body.gatewaySessionId ||
      !body.registrationId ||
      [
        body.deviceId,
        body.gatewaySessionId,
        body.registrationId,
        body.callId || "",
      ].some((value) => typeof value !== "string" || value.length > 160)
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
    // Permissions are asynchronous; a Gateway transfer/revoke during that lookup wins.
    if (
      !this.gateway.hasIdentifiedLoginSession(
        userId,
        body.gatewaySessionId,
        loginSessionId,
        user.sessionVersion,
      )
    )
      reject("UNAUTHORIZED");
    if (!body.callId) {
      const currentVoice = this.gateway.getMediaVoiceState(userId);
      if (
        currentVoice?.channelId !== channelId ||
        currentVoice.sessionId !== body.gatewaySessionId
      )
        reject("FORBIDDEN");
    }
    return {
      userId,
      deviceId: body.deviceId,
      gatewaySessionId: body.gatewaySessionId,
      registrationId: body.registrationId,
      signingPublicKey: device.signingPublicKey,
      agreementPublicKey: device.agreementPublicKey,
      fingerprint: device.fingerprint,
    };
  }
  async join(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<MediaEncryptionSnapshot> {
    const key = this.roomKey(channelId, body.callId);
    const ticket: JoinTicket = {
      userId,
      gatewaySessionId: body.gatewaySessionId,
      registrationId: body.registrationId,
      cancelled: false,
    };
    const tickets = this.pendingJoins.get(key) || new Set<JoinTicket>();
    tickets.add(ticket);
    this.pendingJoins.set(key, tickets);
    return this.serialize(channelId, body.callId, () =>
      this.joinUnlocked(userId, loginSessionId, channelId, body, ticket),
    ).finally(() => {
      tickets.delete(ticket);
      if (!tickets.size && this.pendingJoins.get(key) === tickets)
        this.pendingJoins.delete(key);
    });
  }
  private async joinUnlocked(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
    ticket: JoinTicket,
  ): Promise<MediaEncryptionSnapshot> {
    if (ticket.cancelled) reject();
    await this.authorize(userId, loginSessionId, channelId, body);
    if (ticket.cancelled) reject();
    const roomKey = this.roomKey(channelId, body.callId);
    let room = this.rooms.get(roomKey);
    if (!room) {
      room = {
        contextId: randomUUID(),
        channelId,
        callId: body.callId,
        registrations: new Map(),
        contextRevision: 0,
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
      registrationId: body.registrationId,
      touchedAt: Date.now(),
    });
    if (!body.callId)
      this.gateway.confirmMediaRegistration?.(
        userId,
        channelId,
        body.gatewaySessionId,
      );
    const snapshot = await this.snapshotUnlocked(
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
    // Each identity is independent. Await the complete authorization set before
    // producing the sorted epoch, rather than serializing five database walks.
    await Promise.all(
      [...room.registrations].map(async ([key, entry]) => {
        try {
          if (Date.now() - entry.touchedAt > 15_000) reject();
          const device = await this.authorize(
            entry.userId,
            entry.loginSessionId,
            room.channelId,
            {
              version: MEDIA_ENCRYPTION_VERSION,
              ...entry,
              callId: room.callId,
            },
          );
          if (
            room.registrations.get(key) !== entry ||
            this.rooms.get(this.roomKey(room.channelId, room.callId)) !== room
          )
            reject();
          devices.push(device);
        } catch {
          // A synchronous leave/device transfer may have already replaced this identity.
          if (room.registrations.get(key) !== entry) return;
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
      }),
    );
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
    expected.sort((a, b) =>
      JSON.stringify([a.userId, a.sessionId]).localeCompare(
        JSON.stringify([b.userId, b.sessionId]),
      ),
    );
    if (this.rooms.get(this.roomKey(room.channelId, room.callId)) !== room)
      reject();
    // Remove identities revoked while an authorization lookup was in flight.
    const activeDevices = devices.filter((device) => {
      const registered = room.registrations.get(
        identity(device.userId, device.deviceId),
      );
      return (
        registered?.gatewaySessionId === device.gatewaySessionId &&
        registered.registrationId === device.registrationId
      );
    });
    const complete =
      activeDevices.length > 0 &&
      expected.length === activeDevices.length &&
      expected.every((entry) =>
        activeDevices.some(
          (device) =>
            device.userId === entry.userId &&
            device.gatewaySessionId === entry.sessionId,
        ),
      );
    const membershipVersion = createHash("sha256")
      .update(JSON.stringify([room.contextId, activeDevices, expected]))
      .digest("base64url");
    if (room.membershipVersion !== membershipVersion) {
      room.membershipVersion = membershipVersion;
      room.contextRevision++;
    }
    return {
      version: MEDIA_ENCRYPTION_VERSION,
      contextId: room.contextId,
      channelId: room.channelId,
      callId: room.callId,
      membershipVersion,
      contextRevision: room.contextRevision,
      devices: activeDevices,
      complete,
      expiresAt: new Date(Date.now() + 15_000).toISOString(),
    };
  }
  private requireRoom(channelId: string, callId?: string): Room {
    return this.rooms.get(this.roomKey(channelId, callId)) || reject();
  }
  private async participantContext(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<MediaEncryptionContext> {
    await this.authorize(userId, loginSessionId, channelId, body);
    const room = this.requireRoom(channelId, body.callId);
    this.assertRegistration(room, userId, loginSessionId, body).touchedAt =
      Date.now();
    const context = await this.context(room);
    this.assertRegistration(room, userId, loginSessionId, body);
    if (
      !context.devices.some(
        (device) =>
          device.userId === userId && device.deviceId === body.deviceId,
      )
    )
      reject();
    return context;
  }
  async snapshot(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
  ): Promise<MediaEncryptionSnapshot> {
    return this.serialize(channelId, body.callId, () =>
      this.snapshotUnlocked(userId, loginSessionId, channelId, body),
    );
  }
  private async snapshotUnlocked(
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
      entry.registrationId !== body.registrationId ||
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
          record.recipientDeviceId === body.deviceId &&
          (
            JSON.parse(
              record.envelopeJson,
            ) as MediaEncryptionSnapshot["envelopes"][number]
          ).contextRevision === context.contextRevision,
      )
      .map(
        (record) =>
          JSON.parse(
            record.envelopeJson,
          ) as MediaEncryptionSnapshot["envelopes"][number],
      );
    const groups = new Map<number, typeof records>();
    for (const record of records)
      if (
        record.senderId === userId &&
        record.senderDeviceId === body.deviceId &&
        (
          JSON.parse(
            record.envelopeJson,
          ) as MediaEncryptionSnapshot["envelopes"][number]
        ).contextRevision === context.contextRevision
      )
        groups.set(record.keyId, [...(groups.get(record.keyId) || []), record]);
    const acknowledgedKeyIds = [...groups]
      .filter(([, entries]) =>
        entries.every((entry) => entry.acknowledgedAt !== null),
      )
      .map(([keyId]) => keyId);
    await this.assertCurrent(room, context, userId, loginSessionId, body);
    return { context, envelopes, acknowledgedKeyIds };
  }
  async publish(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
    request: MediaStreamKeyPublishRequest,
  ): Promise<{ acknowledged: boolean }> {
    return this.serialize(channelId, body.callId, () =>
      this.publishUnlocked(userId, loginSessionId, channelId, body, request),
    );
  }
  private async publishUnlocked(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
    request: MediaStreamKeyPublishRequest,
  ): Promise<{ acknowledged: boolean }> {
    const context = await this.participantContext(
      userId,
      loginSessionId,
      channelId,
      body,
    );
    if (
      !context.complete ||
      context.contextId !== request.contextId ||
      context.membershipVersion !== request.membershipVersion ||
      context.contextRevision !== request.contextRevision
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
        envelope.version !== MEDIA_ENCRYPTION_VERSION ||
        envelope.contextId !== context.contextId ||
        envelope.membershipVersion !== context.membershipVersion ||
        envelope.contextRevision !== context.contextRevision ||
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
    if (collision) {
      const existing = await prisma.streamMediaKeyEnvelope.findMany({
        where: {
          contextId: context.contextId,
          membershipVersion: context.membershipVersion,
          keyId: request.keyId,
        },
      });
      if (
        existing.length !== request.envelopes.length ||
        existing.some(
          (record) =>
            !request.envelopes.some(
              (envelope) => record.envelopeJson === JSON.stringify(envelope),
            ),
        )
      )
        reject("MEDIA_KEY_INVALID");
      await this.assertCurrent(
        this.requireRoom(channelId, body.callId),
        context,
        userId,
        loginSessionId,
        body,
      );
      return {
        acknowledged: existing.every(
          (record) => record.acknowledgedAt !== null,
        ),
      };
    }
    // Recheck the roster after signature validation; no stale recipient can receive a newly rotated key.
    const current = await this.context(
      this.requireRoom(channelId, body.callId),
    );
    if (
      current.membershipVersion !== context.membershipVersion ||
      current.contextRevision !== context.contextRevision
    )
      reject();
    this.assertRegistration(
      this.requireRoom(channelId, body.callId),
      userId,
      loginSessionId,
      body,
    );
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
    await this.assertCurrent(
      this.requireRoom(channelId, body.callId),
      context,
      userId,
      loginSessionId,
      body,
    );
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
              contextRevision: context.contextRevision,
              envelope,
            } satisfies MediaKeyEnvelopePushPayload,
          },
        );
      }
    }
    if (recipients.length) {
      const timer = setTimeout(() => {
        void this.serialize(channelId, body.callId, async () => {
          const room = this.rooms.get(this.roomKey(channelId, body.callId));
          if (
            !room ||
            room.contextId !== context.contextId ||
            room.contextRevision !== context.contextRevision ||
            room.membershipVersion !== context.membershipVersion
          )
            return;
          const missing = await prisma.streamMediaKeyEnvelope.findMany({
            where: {
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              keyId: request.keyId,
              acknowledgedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          // Most timers belong to fully acknowledged keys. They must not fill
          // the room queue with redundant full-roster authorization scans.
          if (!missing.length) return;
          if (
            (await this.context(room)).contextRevision !==
            context.contextRevision
          )
            return;
          // A newer rotation supersedes this timeout, even within the same roster epoch.
          const latest = await prisma.streamMediaKeyEnvelope.findFirst({
            where: {
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              senderId: userId,
              senderDeviceId: body.deviceId,
              streamId: request.streamId,
              expiresAt: { gt: new Date() },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (
            !latest ||
            latest.keyId !== request.keyId ||
            (await this.context(room)).contextRevision !==
              context.contextRevision
          )
            return;
          const stillMissing = await prisma.streamMediaKeyEnvelope.findMany({
            where: {
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              keyId: request.keyId,
              acknowledgedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          const missingIds = new Set(stillMissing.map((record) => record.id));
          if (
            this.rooms.get(this.roomKey(channelId, body.callId)) !== room ||
            room.membershipVersion !== context.membershipVersion ||
            room.contextRevision !== context.contextRevision
          )
            return;
          for (const envelope of missing) {
            if (!missingIds.has(envelope.id)) continue;
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
              recipient.registrationId,
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
        }).catch(() => {});
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
    request: MediaStreamKeyAcknowledgeRequest,
  ): Promise<void> {
    return this.serialize(channelId, body.callId, () =>
      this.acknowledgeUnlocked(
        userId,
        loginSessionId,
        channelId,
        body,
        request,
      ),
    );
  }
  private async acknowledgeUnlocked(
    userId: string,
    loginSessionId: string,
    channelId: string,
    body: MediaEncryptionJoinRequest,
    request: MediaStreamKeyAcknowledgeRequest,
  ): Promise<void> {
    if (
      !request ||
      !Number.isInteger(request.keyId) ||
      request.keyId <= 0 ||
      request.keyId > 0x7fffffff
    )
      reject("INVALID_PARAMS");
    const keyId = request.keyId;
    const context = await this.participantContext(
      userId,
      loginSessionId,
      channelId,
      body,
    );
    if (
      request.contextId !== context.contextId ||
      request.membershipVersion !== context.membershipVersion ||
      request.contextRevision !== context.contextRevision
    )
      reject();
    const eligible = await prisma.streamMediaKeyEnvelope.findMany({
      where: {
        contextId: context.contextId,
        membershipVersion: context.membershipVersion,
        recipientId: userId,
        recipientDeviceId: body.deviceId,
        keyId,
        expiresAt: { gt: new Date() },
      },
    });
    if (
      !eligible.length ||
      eligible.some(
        (record) =>
          (
            JSON.parse(
              record.envelopeJson,
            ) as MediaEncryptionSnapshot["envelopes"][number]
          ).contextRevision !== context.contextRevision,
      )
    )
      reject("MEDIA_KEY_INVALID");
    // ACK writes are context-bound bookkeeping. Revalidate the entire roster
    // after all database awaits and before any sender can be unpaused.
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
    await this.assertCurrent(
      this.requireRoom(channelId, body.callId),
      context,
      userId,
      loginSessionId,
      body,
    );
    if (unacknowledged === 0) {
      const sample = eligible[0];
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
              contextRevision: context.contextRevision,
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
    expectedLoginSessionId?: string,
  ): Promise<void> {
    return this.serialize(channelId, callId, async () => {
      if (!gatewaySessionId) reject("MEDIA_KEY_UNAVAILABLE");
      const room = this.requireRoom(channelId, callId);
      const entry = [...room.registrations.values()].find(
        (registration) =>
          registration.userId === userId &&
          registration.gatewaySessionId === gatewaySessionId,
      );
      if (!entry || Date.now() - entry.touchedAt > 15_000)
        reject("MEDIA_KEY_UNAVAILABLE");
      if (
        expectedLoginSessionId !== undefined &&
        expectedLoginSessionId !== entry.loginSessionId
      )
        reject("UNAUTHORIZED");
      const body: MediaEncryptionJoinRequest = {
        version: MEDIA_ENCRYPTION_VERSION,
        deviceId: entry.deviceId,
        gatewaySessionId: entry.gatewaySessionId,
        registrationId: entry.registrationId,
        callId,
      };
      await this.authorize(userId, entry.loginSessionId, channelId, body);
      this.assertRegistration(room, userId, entry.loginSessionId, body);
    });
  }
  leave(
    userId: string,
    channelId: string,
    gatewaySessionId: string,
    callId?: string,
    registrationId?: string,
  ): void {
    const key = this.roomKey(channelId, callId),
      room = this.rooms.get(key);
    for (const ticket of this.pendingJoins.get(key) || []) {
      if (
        ticket.userId === userId &&
        ticket.gatewaySessionId === gatewaySessionId &&
        (registrationId === undefined ||
          ticket.registrationId === registrationId)
      )
        ticket.cancelled = true;
    }
    if (!room) return;
    let removed = false;
    for (const [id, entry] of room.registrations)
      if (
        entry.userId === userId &&
        entry.gatewaySessionId === gatewaySessionId &&
        (registrationId === undefined ||
          entry.registrationId === registrationId)
      ) {
        room.registrations.delete(id);
        removed = true;
      }
    if (!removed) return;
    room.membershipVersion = undefined;
    if (!room.registrations.size) {
      this.rooms.delete(key);
    } else {
      void this.serialize(channelId, callId, () => this.context(room))
        .then((ctx) => {
          this.broadcastEpochUpdate(room, ctx);
        })
        .catch(() => {});
    }
  }
}
export const mediaEncryptionRegistry = new MediaEncryptionRegistry();
