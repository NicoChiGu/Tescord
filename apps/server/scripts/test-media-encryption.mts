import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import type {
  VoiceState,
  MediaEncryptionJoinRequest,
  MediaStreamKeyEnvelope,
} from "@tescord/types";
import {
  PermissionFlags,
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
const { MediaEncryptionRegistry } =
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
const pushedEvents: Array<{
  userId: string;
  sessionId: string;
  payload: any;
}> = [];
const registry = new MediaEncryptionRegistry({
  hasIdentifiedLoginSession: (userId, sessionId, loginId) =>
    activeLogin.get(`${userId}:${sessionId}`) === loginId,
  getMediaVoiceState: (id) => states.get(id) || null,
  getMediaVoiceRoster: (id) =>
    [...states.values()].filter((state) => state.channelId === id),
  sendToSession: (userId, sessionId, payload) => {
    pushedEvents.push({ userId, sessionId, payload });
    return true;
  },
});
const keys = new Map<string, CryptoKeyPair>();
for (const id of ["alice", "bob", "eve"]) {
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
      expiresAt: new Date(Date.now() + 60000),
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
const body = (userId: string): MediaEncryptionJoinRequest => ({
  version: 2,
  deviceId: `device-${userId}`,
  gatewaySessionId: `gateway-${userId}`,
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
        version: 1 as 2,
      }),
    /MEDIA_E2EE_UNSUPPORTED/,
  );
});
const ephemeral = await webcrypto.subtle.generateKey(
  { name: "ECDH", namedCurve: "P-256" },
  true,
  ["deriveBits"],
);
const unsigned: Omit<MediaStreamKeyEnvelope, "signature"> = {
  version: 2,
  contextId: current.context.contextId,
  membershipVersion: current.context.membershipVersion,
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
  streamId: "microphone",
  keyId: 123,
  envelopes: [envelope],
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
  assert.equal(envelopePush.payload.d.envelope.keyId, 123);

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
  await registry.acknowledge("bob", "login-bob", "voice", body("bob"), 123);
  // Verify real-time Gateway WebSocket ACK dispatch to Alice
  const ackPush = pushedEvents.find(
    (e) => e.userId === "alice" && e.payload.t === "MEDIA_KEY_ACK",
  );
  assert.ok(
    ackPush,
    "Alice should receive real-time MEDIA_KEY_ACK via sendToSession",
  );
  assert.equal(ackPush.payload.d.keyId, 123);
  assert.equal(ackPush.payload.d.acknowledged, true);

  assert.deepEqual(
    (await registry.snapshot("alice", "login-alice", "voice", body("alice")))
      .acknowledgedKeyIds,
    [123],
  );
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
await app.close();
await prisma.$disconnect();
console.log(
  `media-encryption-authorization: ${passed} passed, 0 failed; isolated db ${directory}`,
);
