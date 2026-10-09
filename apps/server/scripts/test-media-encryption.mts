import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import type {
  VoiceState,
  MediaEncryptionJoinRequest,
  MediaStreamKeyEnvelope,
  GatewayPayload,
  MediaKeyEnvelopePushPayload,
  MediaKeyAckPushPayload,
  MediaStreamKeyPublishRequest,
  MediaEncryptionContext,
} from "@tescord/types";
import {
  PermissionFlags,
  MEDIA_ENCRYPTION_VERSION,
  mediaStreamEnvelopeSigningBytes,
} from "@tescord/types";
const directory = mkdtempSync(join(tmpdir(), "tescord-media-encryption-test-"));
process.env.DATABASE_URL = `file:${join(directory, "isolated.sqlite").replace(/\\/g, "/")}`;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.REDIS_URL = "";
const require = createRequire(import.meta.url);
const diff = spawnSync(
  process.execPath,
  [
    require.resolve("prisma"),
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ],
  { cwd: process.cwd(), env: process.env, encoding: "utf8" },
);
if (diff.status !== 0) throw new Error(diff.stderr);
const { PrismaClient } = await import("@prisma/client");
const seed = new PrismaClient();
for (const statement of diff.stdout
  .split(/;\s*(?:\r?\n|$)/)
  .map((item) => item.trim())
  .filter(Boolean))
  await seed.$executeRawUnsafe(statement);
await seed.$disconnect();
const { prisma } = await import("../src/db.js");
const { MediaEncryptionRegistry, mediaEncryptionRegistry } =
  await import("../src/services/media-encryption.service.js");
const { registerMediaEncryptionRoutes } =
  await import("../src/services/media-encryption.routes.js");
const { default: fastify } = await import("fastify");
const { default: jwt } = await import("@fastify/jwt");
let passed = 0;
const test = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed++;
  console.log(`PASS ${name}`);
};
const states = new Map<string, VoiceState>(),
  activeLogin = new Map<string, string>();
let reverseRoster = false;
const expiredParticipants: string[] = [];
const pushedEvents: Array<{
  userId: string;
  sessionId: string;
  payload: GatewayPayload<unknown>;
}> = [];
const registry = new MediaEncryptionRegistry({
  hasIdentifiedLoginSession: (userId, sessionId, loginId) =>
    activeLogin.get(`${userId}:${sessionId}`) === loginId,
  getMediaVoiceState: (id) => states.get(id) || null,
  getMediaVoiceRoster: (id) => {
    const roster = [...states.values()].filter(
      (state) => state.channelId === id,
    );
    return reverseRoster ? roster.reverse() : roster;
  },
  expireMediaParticipant: (userId) => {
    expiredParticipants.push(userId);
    return undefined;
  },
  sendToSession: (userId, sessionId, payload) => {
    pushedEvents.push({ userId, sessionId, payload });
    return true;
  },
});
const keys = new Map<string, CryptoKeyPair>();
for (const id of ["alice", "bob", "carol", "dave", "frank", "eve"]) {
  await prisma.user.create({
    data: {
      id,
      username: id,
      email: `${id}@test.invalid`,
      passwordHash: "isolated",
    },
  });
  await prisma.refreshToken.create({
    data: {
      id: `login-${id}`,
      userId: id,
      tokenHash: `hash-${id}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const signing = await webcrypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    ),
    agreement = await webcrypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
  keys.set(id, signing);
  const signingPublicJwk = await webcrypto.subtle.exportKey(
      "jwk",
      signing.publicKey,
    ),
    agreementPublicJwk = await webcrypto.subtle.exportKey(
      "jwk",
      agreement.publicKey,
    );
  const fingerprint = Buffer.from(
    await webcrypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({ signingPublicJwk, agreementPublicJwk }),
      ),
    ),
  ).toString("base64url");
  await prisma.deviceKey.create({
    data: {
      userId: id,
      deviceId: `device-${id}`,
      signingPublicKey: JSON.stringify(signingPublicJwk),
      agreementPublicKey: JSON.stringify(agreementPublicJwk),
      fingerprint,
    },
  });
  activeLogin.set(`${id}:gateway-${id}`, `login-${id}`);
}
await prisma.guild.create({
  data: { id: "guild", name: "isolated", ownerId: "alice" },
});
await prisma.guildMember.createMany({
  data: [
    { guildId: "guild", userId: "alice" },
    { guildId: "guild", userId: "bob" },
    { guildId: "guild", userId: "carol" },
    { guildId: "guild", userId: "dave" },
    { guildId: "guild", userId: "frank" },
  ],
});
await prisma.role.create({
  data: {
    id: "everyone",
    guildId: "guild",
    name: "@everyone",
    isDefault: true,
    permissions: PermissionFlags.CONNECT | PermissionFlags.VIEW_CHANNEL,
  },
});
await prisma.channel.createMany({
  data: [
    { id: "voice", guildId: "guild", name: "voice", type: "VOICE" },
    { id: "other", guildId: "guild", name: "other", type: "VOICE" },
  ],
});
const registrationIds = new Map<string, string>();
const body = (userId: string): MediaEncryptionJoinRequest => ({
  version: MEDIA_ENCRYPTION_VERSION,
  deviceId: `device-${userId}`,
  gatewaySessionId: `gateway-${userId}`,
  registrationId: registrationIds.get(userId) || `registration-${userId}`,
});
const voice = (userId: string): VoiceState => ({
  userId,
  guildId: "guild",
  channelId: "voice",
  sessionId: `gateway-${userId}`,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  streaming: false,
});
states.set("alice", voice("alice"));
const first = await registry.join(
  "alice",
  "login-alice",
  "voice",
  body("alice"),
);
await test("single active device can initialize empty room", () =>
  assert.equal(first.context.complete, true));
states.set("bob", voice("bob"));
const second = await registry.join("bob", "login-bob", "voice", body("bob"));
const current = await registry.snapshot(
  "alice",
  "login-alice",
  "voice",
  body("alice"),
);
await test("join changes epoch and includes only authorized active voice devices", () => {
  assert.notEqual(
    first.context.membershipVersion,
    current.context.membershipVersion,
  );
  assert.equal(current.context.devices.length, 2);
  assert.equal(second.context.complete, true);
});
await test("unidentified, mismatched login, unauthorized channel and old protocol reject", async () => {
  await assert.rejects(
    () =>
      registry.join("alice", "login-alice", "voice", {
        ...body("alice"),
        gatewaySessionId: "unidentified",
      }),
    /UNAUTHORIZED/,
  );
  await assert.rejects(
    () => registry.join("alice", "login-bob", "voice", body("alice")),
    /UNAUTHORIZED/,
  );
  await assert.rejects(
    () => registry.join("alice", "login-alice", "other", body("alice")),
    /FORBIDDEN/,
  );
  states.set("eve", voice("eve"));
  await assert.rejects(
    () => registry.join("eve", "login-eve", "voice", body("eve")),
    /FORBIDDEN/,
  );
  states.delete("eve");
  await assert.rejects(
    () =>
      registry.join("alice", "login-alice", "voice", {
        ...body("alice"),
        version: 2 as typeof MEDIA_ENCRYPTION_VERSION,
      }),
    /MEDIA_E2EE_UNSUPPORTED/,
  );
});
await test("SFU requester login must match registered Gateway with two active same-user logins", async () => {
  const secondaryLogin = "login-alice-secondary";
  await prisma.refreshToken.create({
    data: {
      id: secondaryLogin,
      userId: "alice",
      tokenHash: "hash-alice-secondary",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  activeLogin.set("alice:gateway-alice-secondary", secondaryLogin);
  await registry.assertParticipant(
    "voice",
    "alice",
    "gateway-alice",
    undefined,
    "login-alice",
  );
  await assert.rejects(
    () =>
      registry.assertParticipant(
        "voice",
        "alice",
        "gateway-alice",
        undefined,
        secondaryLogin,
      ),
    /UNAUTHORIZED/,
  );
  await assert.rejects(
    () => registry.join("alice", secondaryLogin, "voice", body("alice")),
    /UNAUTHORIZED/,
  );
  assert.ok(
    await prisma.refreshToken.findUnique({ where: { id: secondaryLogin } }),
  );
  // Matching original login remains valid; denial was identity binding, not token expiry.
  await registry.assertParticipant(
    "voice",
    "alice",
    "gateway-alice",
    undefined,
    "login-alice",
  );
  activeLogin.delete("alice:gateway-alice-secondary");
  await prisma.refreshToken.delete({ where: { id: secondaryLogin } });
});
const ephemeral = await webcrypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  true,
  ["deriveBits"],
);
const unsigned: Omit<MediaStreamKeyEnvelope, "signature"> = {
  version: MEDIA_ENCRYPTION_VERSION,
  contextId: current.context.contextId,
  membershipVersion: current.context.membershipVersion,
  contextRevision: current.context.contextRevision,
  streamId: "microphone",
  keyId: 123,
  senderId: "alice",
  senderDeviceId: "device-alice",
  recipientId: "bob",
  recipientDeviceId: "device-bob",
  ephemeralPublicKey: JSON.stringify(
    await webcrypto.subtle.exportKey("jwk", ephemeral.publicKey),
  ),
  iv: Buffer.alloc(12).toString("base64url"),
  ciphertext: Buffer.alloc(48).toString("base64url"),
  createdAt: new Date().toISOString(),
};
const envelope = {
  ...unsigned,
  signature: Buffer.from(
    await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.get("alice")!.privateKey,
      mediaStreamEnvelopeSigningBytes(unsigned),
    ),
  ).toString("base64url"),
};
const publish = {
  contextId: current.context.contextId,
  membershipVersion: current.context.membershipVersion,
  contextRevision: current.context.contextRevision,
  streamId: "microphone",
  keyId: 123,
  envelopes: [envelope],
};
const signedPublish = async (
  context: MediaEncryptionContext,
  senderId: string,
  keyId: number,
): Promise<MediaStreamKeyPublishRequest> => {
  const envelopes: MediaStreamKeyEnvelope[] = [];
  for (const recipient of context.devices.filter(
    (device) => device.userId !== senderId,
  )) {
    const value: Omit<MediaStreamKeyEnvelope, "signature"> = {
      ...unsigned,
      contextId: context.contextId,
      membershipVersion: context.membershipVersion,
      contextRevision: context.contextRevision,
      keyId,
      senderId,
      senderDeviceId: `device-${senderId}`,
      recipientId: recipient.userId,
      recipientDeviceId: recipient.deviceId,
      createdAt: new Date().toISOString(),
    };
    const signature = Buffer.from(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.get(senderId)!.privateKey,
        mediaStreamEnvelopeSigningBytes(value),
      ),
    ).toString("base64url");
    envelopes.push({ ...value, signature });
  }
  return {
    contextId: context.contextId,
    membershipVersion: context.membershipVersion,
    contextRevision: context.contextRevision,
    streamId: "microphone",
    keyId,
    envelopes,
  };
};
await test("tampered signature and cross-recipient identity reject", async () => {
  await assert.rejects(
    () =>
      registry.publish("alice", "login-alice", "voice", body("alice"), {
        ...publish,
        envelopes: [
          {
            ...envelope,
            ciphertext: Buffer.alloc(48, 1).toString("base64url"),
          },
        ],
      }),
    /MEDIA_KEY_INVALID/,
  );
  await assert.rejects(
    () =>
      registry.publish("alice", "login-alice", "voice", body("alice"), {
        ...publish,
        envelopes: [{ ...envelope, recipientId: "eve" }],
      }),
    /FORBIDDEN/,
  );
});
await test("ciphertext envelopes deliver only to addressed device and await authenticated ack", async () => {
  pushedEvents.length = 0;
  assert.equal(
    (
      await registry.publish(
        "alice",
        "login-alice",
        "voice",
        body("alice"),
        publish,
      )
    ).acknowledged,
    false,
  );
  // Verify real-time Gateway WebSocket envelope dispatch to Bob
  const envelopePush = pushedEvents.find(
    (e) => e.userId === "bob" && e.payload.t === "MEDIA_KEY_ENVELOPE",
  );
  assert.ok(
    envelopePush,
    "Bob should receive real-time MEDIA_KEY_ENVELOPE via sendToSession",
  );
  assert.equal(
    (envelopePush.payload.d as MediaKeyEnvelopePushPayload).envelope.keyId,
    123,
  );
  assert.equal(
    (envelopePush.payload.d as MediaKeyEnvelopePushPayload).contextRevision,
    current.context.contextRevision,
  );

  assert.equal(
    (await registry.snapshot("bob", "login-bob", "voice", body("bob")))
      .envelopes.length,
    1,
  );
  assert.equal(
    (await registry.snapshot("alice", "login-alice", "voice", body("alice")))
      .envelopes.length,
    0,
  );

  pushedEvents.length = 0;
  const acknowledgement = {
    contextId: current.context.contextId,
    membershipVersion: current.context.membershipVersion,
    contextRevision: current.context.contextRevision,
    keyId: 123,
  };
  await registry.acknowledge(
    "bob",
    "login-bob",
    "voice",
    body("bob"),
    acknowledgement,
  );
  await registry.acknowledge(
    "bob",
    "login-bob",
    "voice",
    body("bob"),
    acknowledgement,
  );
  // Verify real-time Gateway WebSocket ACK dispatch to Alice
  const ackPush = pushedEvents.find(
    (e) => e.userId === "alice" && e.payload.t === "MEDIA_KEY_ACK",
  );
  assert.ok(
    ackPush,
    "Alice should receive real-time MEDIA_KEY_ACK via sendToSession",
  );
  assert.equal((ackPush.payload.d as MediaKeyAckPushPayload).keyId, 123);
  assert.equal(
    (ackPush.payload.d as MediaKeyAckPushPayload).acknowledged,
    true,
  );
  assert.equal(
    (ackPush.payload.d as MediaKeyAckPushPayload).contextRevision,
    current.context.contextRevision,
  );

  assert.deepEqual(
    (await registry.snapshot("alice", "login-alice", "voice", body("alice")))
      .acknowledgedKeyIds,
    [123],
  );
});
await test("requester control plane stays authorized while another device is registering", async () => {
  states.set("carol", voice("carol"));
  const pending = await registry.snapshot(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
  );
  assert.equal(pending.context.complete, false);
  await registry.assertParticipant("voice", "alice", "gateway-alice");
  await assert.rejects(
    () => registry.assertParticipant("voice", "carol", "gateway-carol"),
    /MEDIA_KEY_UNAVAILABLE/,
  );
  await assert.rejects(
    () =>
      registry.publish("alice", "login-alice", "voice", body("alice"), publish),
    /MEDIA_CONTEXT_STALE/,
  );
  await registry.join("carol", "login-carol", "voice", body("carol"));
});
await test("context revisions are monotonic and roster order cannot rotate keys", async () => {
  const before = await registry.snapshot(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
  );
  assert.ok(before.context.contextRevision > current.context.contextRevision);
  reverseRoster = true;
  const after = await registry.snapshot(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
  );
  reverseRoster = false;
  assert.equal(
    after.context.membershipVersion,
    before.context.membershipVersion,
  );
  assert.equal(after.context.contextRevision, before.context.contextRevision);
  await assert.rejects(
    () =>
      registry.acknowledge("bob", "login-bob", "voice", body("bob"), {
        contextId: current.context.contextId,
        membershipVersion: current.context.membershipVersion,
        contextRevision: current.context.contextRevision,
        keyId: 123,
      }),
    /MEDIA_CONTEXT_STALE/,
  );
});
const participants = ["alice", "bob", "carol", "dave", "frank"];
await test("five participants concurrent join and all sender ACKs repeat ten times", async () => {
  for (const id of participants) states.set(id, voice(id));
  for (let iteration = 0; iteration < 10; iteration++) {
    const joins = await Promise.all(
      participants.map((id) =>
        registry.join(id, `login-${id}`, "voice", body(id)),
      ),
    );
    const context = (
      await registry.snapshot("alice", "login-alice", "voice", body("alice"))
    ).context;
    assert.equal(context.devices.length, 5);
    assert.equal(context.complete, true);
    for (const joined of joins)
      assert.ok(joined.context.contextRevision <= context.contextRevision);
    const requests = await Promise.all(
      participants.map((id, index) =>
        signedPublish(context, id, 1000 + iteration * 5 + index),
      ),
    );
    await Promise.all(
      requests.map((request, index) =>
        registry.publish(
          participants[index],
          `login-${participants[index]}`,
          "voice",
          body(participants[index]),
          request,
        ),
      ),
    );
    await Promise.all(
      requests.flatMap((request) =>
        request.envelopes.map((envelope) =>
          registry.acknowledge(
            envelope.recipientId,
            `login-${envelope.recipientId}`,
            "voice",
            body(envelope.recipientId),
            {
              contextId: context.contextId,
              membershipVersion: context.membershipVersion,
              contextRevision: context.contextRevision,
              keyId: request.keyId,
            },
          ),
        ),
      ),
    );
    for (const [index, id] of participants.entries()) {
      assert.ok(
        (
          await registry.snapshot(id, `login-${id}`, "voice", body(id))
        ).acknowledgedKeyIds.includes(requests[index].keyId),
      );
      assert.equal(
        (
          await registry.publish(
            id,
            `login-${id}`,
            "voice",
            body(id),
            requests[index],
          )
        ).acknowledged,
        true,
      );
    }
    console.log(`PASS five-participant round ${iteration + 1}/10`);
  }
});
await test("obsolete timeout cannot evict devices after a newer acknowledged sender rotation", async () => {
  const context = (
    await registry.snapshot("alice", "login-alice", "voice", body("alice"))
  ).context;
  await registry.publish(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
    await signedPublish(context, "alice", 2000),
  );
  const latest = await signedPublish(context, "alice", 2001);
  await registry.publish(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
    latest,
  );
  await Promise.all(
    latest.envelopes.map((envelope) =>
      registry.acknowledge(
        envelope.recipientId,
        `login-${envelope.recipientId}`,
        "voice",
        body(envelope.recipientId),
        {
          contextId: context.contextId,
          membershipVersion: context.membershipVersion,
          contextRevision: context.contextRevision,
          keyId: latest.keyId,
        },
      ),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await Promise.all(
    participants.map((id) =>
      registry.snapshot(id, `login-${id}`, "voice", body(id)),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 5200));
  assert.equal(expiredParticipants.length, 0);
  assert.equal(
    (await registry.snapshot("alice", "login-alice", "voice", body("alice")))
      .context.devices.length,
    5,
  );
});
await test("delayed old HTTP leave cannot revoke a newly registered incarnation", async () => {
  const previousBody = body("frank");
  const previous = await registry.snapshot(
    "frank",
    "login-frank",
    "voice",
    previousBody,
  );
  const replacementBody = {
    ...previousBody,
    registrationId: "registration-frank-new",
  };
  const replaced = await registry.join(
    "frank",
    "login-frank",
    "voice",
    replacementBody,
  );
  registrationIds.set("frank", replacementBody.registrationId);
  assert.ok(
    replaced.context.contextRevision > previous.context.contextRevision,
  );
  assert.notEqual(
    replaced.context.membershipVersion,
    previous.context.membershipVersion,
  );
  const pending = registry.join(
    "frank",
    "login-frank",
    "voice",
    replacementBody,
  );
  registry.leave(
    "frank",
    "voice",
    "gateway-frank",
    undefined,
    previousBody.registrationId,
  );
  await pending;
  await registry.assertParticipant("voice", "frank", "gateway-frank");
  const latest = await registry.snapshot(
    "frank",
    "login-frank",
    "voice",
    replacementBody,
  );
  assert.equal(
    latest.context.contextRevision,
    replaced.context.contextRevision,
  );
  assert.equal(
    latest.context.devices.find((device) => device.userId === "frank")
      ?.registrationId,
    replacementBody.registrationId,
  );
  await assert.rejects(
    () => registry.snapshot("frank", "login-frank", "voice", previousBody),
    /MEDIA_CONTEXT_STALE/,
  );
});
await test("synchronous leave cancels pending registration even before the queue starts", async () => {
  const pending = registry.join("frank", "login-frank", "voice", body("frank"));
  registry.leave("frank", "voice", "gateway-frank");
  await assert.rejects(() => pending, /MEDIA_CONTEXT_STALE/);
  await assert.rejects(
    () => registry.assertParticipant("voice", "frank", "gateway-frank"),
    /MEDIA_KEY_UNAVAILABLE/,
  );
  // A fresh explicit join after the leave can register again.
  await registry.join("frank", "login-frank", "voice", body("frank"));
});
await test("synchronous leave during signature verification invalidates a queued publish", async () => {
  const context = (
    await registry.snapshot("alice", "login-alice", "voice", body("alice"))
  ).context;
  const request = await signedPublish(context, "alice", 3000);
  const originalVerify = webcrypto.subtle.verify;
  let removed = false;
  webcrypto.subtle.verify = async function (
    ...args: Parameters<typeof originalVerify>
  ) {
    const verified = await originalVerify.apply(this, args);
    if (!removed) {
      removed = true;
      states.delete("frank");
      registry.leave("frank", "voice", "gateway-frank");
    }
    return verified;
  };
  pushedEvents.length = 0;
  try {
    await assert.rejects(
      () =>
        registry.publish(
          "alice",
          "login-alice",
          "voice",
          body("alice"),
          request,
        ),
      /MEDIA_CONTEXT_STALE/,
    );
  } finally {
    webcrypto.subtle.verify = originalVerify;
  }
  assert.equal(
    pushedEvents.filter((event) => event.payload.t === "MEDIA_KEY_ENVELOPE")
      .length,
    0,
  );
  states.set("frank", voice("frank"));
  await registry.join("frank", "login-frank", "voice", body("frank"));
  assert.ok(
    (await registry.snapshot("alice", "login-alice", "voice", body("alice")))
      .context.contextRevision > context.contextRevision,
  );
});
await test("a sender leaving during the final ACK database write cannot be unpaused", async () => {
  const context = (
    await registry.snapshot("alice", "login-alice", "voice", body("alice"))
  ).context;
  const publication = await signedPublish(context, "alice", 3100);
  await registry.publish(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
    publication,
  );
  const acknowledgement = {
    contextId: context.contextId,
    membershipVersion: context.membershipVersion,
    contextRevision: context.contextRevision,
    keyId: publication.keyId,
  };
  const recipients = publication.envelopes.map(
    (envelope) => envelope.recipientId,
  );
  for (const recipient of recipients.slice(0, -1))
    await registry.acknowledge(
      recipient,
      `login-${recipient}`,
      "voice",
      body(recipient),
      acknowledgement,
    );
  const originalUpdate = prisma.streamMediaKeyEnvelope.updateMany;
  prisma.streamMediaKeyEnvelope.updateMany = (async (
    ...args: Parameters<typeof originalUpdate>
  ) => {
    const result = await originalUpdate.apply(
      prisma.streamMediaKeyEnvelope,
      args,
    );
    states.delete("alice");
    registry.leave("alice", "voice", "gateway-alice");
    return result;
  }) as typeof originalUpdate;
  pushedEvents.length = 0;
  try {
    const recipient = recipients[recipients.length - 1];
    await assert.rejects(
      () =>
        registry.acknowledge(
          recipient,
          `login-${recipient}`,
          "voice",
          body(recipient),
          acknowledgement,
        ),
      /MEDIA_CONTEXT_STALE/,
    );
    assert.equal(
      pushedEvents.filter((event) => event.payload.t === "MEDIA_KEY_ACK")
        .length,
      0,
    );
  } finally {
    prisma.streamMediaKeyEnvelope.updateMany = originalUpdate;
    states.set("alice", voice("alice"));
    await registry.join("alice", "login-alice", "voice", body("alice"));
  }
});
await test("member leave invalidates old epoch and denies revoked devices, sessions and banned users", async () => {
  states.delete("bob");
  registry.leave("bob", "voice", "gateway-bob");
  const after = await registry.snapshot(
    "alice",
    "login-alice",
    "voice",
    body("alice"),
  );
  assert.notEqual(
    after.context.membershipVersion,
    current.context.membershipVersion,
  );
  await assert.rejects(
    () =>
      registry.publish("alice", "login-alice", "voice", body("alice"), publish),
    /MEDIA_CONTEXT_STALE/,
  );
  await prisma.deviceKey.updateMany({
    where: { userId: "alice" },
    data: { revokedAt: new Date() },
  });
  await assert.rejects(
    () => registry.snapshot("alice", "login-alice", "voice", body("alice")),
    /UNAUTHORIZED/,
  );
  await prisma.deviceKey.updateMany({
    where: { userId: "alice" },
    data: { revokedAt: null },
  });
  await prisma.user.update({
    where: { id: "alice" },
    data: { isBanned: true },
  });
  await assert.rejects(
    () => registry.join("alice", "login-alice", "voice", body("alice")),
    /UNAUTHORIZED/,
  );
  await prisma.user.update({
    where: { id: "alice" },
    data: { isBanned: false },
  });
  await prisma.refreshToken.delete({ where: { id: "login-alice" } });
  await assert.rejects(
    () => registry.join("alice", "login-alice", "voice", body("alice")),
    /UNAUTHORIZED/,
  );
});
const app = fastify();
await app.register(jwt, { secret: "isolated-media-auth-test-secret" });
app.decorate("authenticate", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ code: "UNAUTHORIZED" });
  }
});
registerMediaEncryptionRoutes(
  app,
  async (request) => (request.user as { sub?: string }).sub || null,
  (reply, status, code, message) =>
    reply.status(status).send({ code, error: message }),
);
await test("HTTP no token, forged token and expired token are rejected before registry access", async () => {
  for (const token of [
    null,
    "forged",
    app.jwt.sign({ sub: "alice", sessionId: "login-alice", exp: 1 }),
  ]) {
    const result = await app.inject({
      method: "POST",
      url: "/api/channels/voice/media-encryption/join",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body("alice"),
    });
    assert.equal(result.statusCode, 401);
  }
});
await test("HTTP stale contexts are retryable 409 and old protocol is rejected", async () => {
  const snapshot = mediaEncryptionRegistry.snapshot;
  mediaEncryptionRegistry.snapshot = async () => {
    throw new Error("MEDIA_CONTEXT_STALE");
  };
  const headers = {
    authorization: `Bearer ${app.jwt.sign({ sub: "alice", sessionId: "login-alice" })}`,
  };
  try {
    const stale = await app.inject({
      method: "POST",
      url: "/api/channels/voice/media-encryption/sync",
      headers,
      payload: body("alice"),
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, "MEDIA_CONTEXT_STALE");
    const legacy = await app.inject({
      method: "POST",
      url: "/api/channels/voice/media-encryption/join",
      headers,
      payload: { ...body("alice"), version: 2 },
    });
    assert.equal(legacy.statusCode, 403);
    assert.equal(legacy.json().code, "MEDIA_E2EE_UNSUPPORTED");
  } finally {
    mediaEncryptionRegistry.snapshot = snapshot;
  }
});
await app.close();
await prisma.$disconnect();
assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
assert.match(
  basename(directory),
  /^tescord-media-encryption-test-[a-zA-Z0-9]+$/,
);
for (const name of [
  "isolated.sqlite",
  "isolated.sqlite-wal",
  "isolated.sqlite-shm",
  "isolated.sqlite-journal",
]) {
  const file = join(directory, name);
  if (existsSync(file)) rmSync(file);
}
rmdirSync(directory);
console.log(
  `media-encryption-authorization: ${passed} passed, 0 failed; isolated db cleaned ${directory}`,
);
