import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  encodeSFrameHeader,
  decodeSFrameHeader,
  encryptSFramePacket,
  decryptSFramePacket,
  mediaStreamEnvelopeSigningBytes,
  encodedFrameLayout,
  escapeMediaRbsp,
  unescapeMediaRbsp,
  joinMediaFrame,
} from "../packages/types/src/index.ts";
import { SFrameManager } from "../apps/web/src/services/sframe.js";
import {
  AudioQualitySampler,
  tuneOpusDescription,
} from "../apps/web/src/services/p2p/audioQuality.js";
if (!globalThis.crypto)
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
let passed = 0;
const test = async (name: string, run: () => void | Promise<void>) => {
  await run();
  passed++;
  console.log(`PASS ${name}`);
};
await test("RFC 9605 compact header vectors and counter bounds", () => {
  for (const [kid, counter, hex] of [
    [0, 0n, "00"],
    [1, 1n, "11"],
    [7, 7n, "77"],
    [8, 8n, "880808"],
    [255, 255n, "88ffff"],
    [256, 256n, "9901000100"],
    [1, 0xffffffffffffffffn, "1fffffffffffffffff"],
  ] as const) {
    const header = encodeSFrameHeader(kid, counter);
    assert.equal(Buffer.from(header).toString("hex"), hex);
    const decoded = decodeSFrameHeader(header);
    assert.equal(decoded.kid, kid);
    assert.equal(decoded.counter, counter);
  }
  assert.throws(() => encodeSFrameHeader(1, -1n));
  assert.throws(() => encodeSFrameHeader(1, 1n << 64n));
  assert.throws(() => decodeSFrameHeader(Uint8Array.from([0x88, 8])));
  assert.throws(() => decodeSFrameHeader(Uint8Array.from([0x80, 7])));
});
await test("RFC 9605 appendix C.3 AES_256_GCM_SHA512_128 published ciphertext vector", async () => {
  const fromHex = (value: string) => new Uint8Array(Buffer.from(value, "hex"));
  const key = fromHex("000102030405060708090a0b0c0d0e0f"),
    metadata = fromHex("4945544620534672616d65205747"),
    plain = fromHex("64726166742d696574662d736672616d652d656e63");
  const packet = await encryptSFramePacket(
    plain,
    key,
    0x123,
    0x4567n,
    metadata,
  );
  assert.equal(
    Buffer.from(packet).toString("hex"),
    "990123456794f509d36e9beacb0e261d99c7d1e972f1fed787d4049f17ca21353c1cc24d56ceabced279",
  );
  assert.deepEqual(
    (await decryptSFramePacket(packet, key, metadata)).decryptedPayload,
    plain,
  );
});
await test("distinct sender/stream secrets and KIDs produce independent ciphertext", async () => {
  const frame = new Uint8Array([0, 255, 42]),
    keyA = crypto.getRandomValues(new Uint8Array(32)),
    keyB = crypto.getRandomValues(new Uint8Array(32));
  const a = await encryptSFramePacket(frame, keyA, 12345, 0n),
    b = await encryptSFramePacket(frame, keyB, 12346, 0n);
  assert.notDeepEqual(a, b);
  assert.deepEqual(
    (await decryptSFramePacket(a, keyA)).decryptedPayload,
    frame,
  );
  await assert.rejects(() => decryptSFramePacket(a, keyB));
  await assert.rejects(() =>
    encryptSFramePacket(frame, new Uint8Array(31), 1, 0),
  );
});
await test("authenticated replay handling rejects tamper without poisoning valid counters", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32)),
    sender = new SFrameManager(),
    receiver = new SFrameManager();
  sender.setNegotiatedKey(key);
  receiver.setNegotiatedKey(key);
  const clear = new Uint8Array([1, 2, 3]),
    packet = await sender.encryptFrame(clear);
  const forged = packet.slice();
  forged[forged.length - 1] ^= 1;
  assert.equal(await receiver.decryptFrame(forged), null);
  assert.deepEqual(await receiver.decryptFrame(packet), clear);
  assert.equal(await receiver.decryptFrame(packet), null);
  sender.setNegotiatedKey(key);
  const next = await sender.encryptFrame(clear);
  assert.equal(
    decodeSFrameHeader(next).counter,
    1n,
    "reapplying a live key never resets its counter",
  );
  sender.disable();
  await assert.rejects(
    () => sender.encryptFrame(clear),
    /MEDIA_KEY_UNAVAILABLE/,
  );
});
await test("signed envelope binds all membership, sender, recipient and stream identity fields", () => {
  const envelope = {
    version: 2 as const,
    contextId: "room",
    membershipVersion: "epoch",
    streamId: "mic",
    keyId: 1,
    senderId: "alice",
    senderDeviceId: "a",
    recipientId: "bob",
    recipientDeviceId: "b",
    ephemeralPublicKey: "{}",
    iv: "iv",
    ciphertext: "ct",
    createdAt: "now",
  };
  const baseline = mediaStreamEnvelopeSigningBytes(envelope);
  for (const [field, value] of [
    ["membershipVersion", "next"],
    ["recipientId", "eve"],
    ["streamId", "screen"],
    ["keyId", 2],
  ] as const)
    assert.notDeepEqual(
      mediaStreamEnvelopeSigningBytes({ ...envelope, [field]: value }),
      baseline,
    );
});
await test("short-window loss/concealment excludes old cumulative loss and resets", () => {
  const sampler = new AudioQualitySampler();
  assert.equal(
    sampler.sample({
      id: "audio",
      timestamp: 1000,
      packetsReceived: 900,
      packetsLost: 100,
      bytesReceived: 1000,
    }).packetLossPercent,
    undefined,
  );
  const fresh = sampler.sample({
    id: "audio",
    timestamp: 2500,
    packetsReceived: 999,
    packetsLost: 101,
    bytesReceived: 1200,
    concealedSamples: 100,
    totalSamplesReceived: 10000,
    jitterBufferDelay: 1,
    jitterBufferEmittedCount: 100,
  });
  assert.equal(fresh.packetLossPercent, 1);
  assert.equal(fresh.concealmentPercent, 1);
  assert.equal(fresh.jitterBufferDelayMs, 10);
  assert.equal(fresh.bytesReceived, 200);
  assert.equal(
    sampler.sample({
      id: "audio",
      timestamp: 4000,
      packetsReceived: 1,
      packetsLost: 0,
      bytesReceived: 2,
    }).packetLossPercent,
    undefined,
  );
});
await test("Opus FEC, mono and 20ms negotiation preserves video sections", () => {
  const video = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
  const description = {
    type: "offer" as const,
    sdp: `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=0;stereo=1\r\n${video}`,
  };
  const tuned = tuneOpusDescription(description).sdp;
  assert.ok(tuned.includes("useinbandfec=1"));
  assert.ok(tuned.includes("stereo=0"));
  assert.ok(tuned.includes("a=ptime:20"));
  assert.ok(tuned.endsWith(video));
});
await test("video routing headers are authenticated; H26x RBSP and AV1 OBU framing round trip", async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const payload = new Uint8Array([0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 255]);
  assert.deepEqual(unescapeMediaRbsp(escapeMediaRbsp(payload)), payload);
  const h264 = new Uint8Array([
    0,
    0,
    0,
    1,
    0x67,
    0x20,
    0,
    0,
    0,
    1,
    0x65,
    0x88,
    ...payload,
  ]);
  const h265 = new Uint8Array([0, 0, 0, 1, 0x26, 1, ...payload]);
  for (const [codec, raw] of [
    ["h264", h264],
    ["h265", h265],
    ["vp8", new Uint8Array(25).fill(42)],
    ["vp9", payload],
    ["av1", payload],
  ] as const) {
    const layout = encodedFrameLayout(raw, "video", codec, "key");
    const sealed = await encryptSFramePacket(
      layout.payload,
      key,
      85,
      1n,
      layout.header,
    );
    const wire = joinMediaFrame(
      layout.header,
      layout.rbsp ? escapeMediaRbsp(sealed) : sealed,
    );
    const received = encodedFrameLayout(wire, "video", codec, "key", true);
    const packet = received.rbsp
      ? unescapeMediaRbsp(received.payload)
      : received.payload;
    const { decryptedPayload } = await decryptSFramePacket(
      packet,
      key,
      received.header,
    );
    assert.deepEqual(
      received.wrapper
        ? decryptedPayload
        : joinMediaFrame(received.header, decryptedPayload),
      raw,
    );
    const forged = received.header.slice();
    if (forged.length) {
      forged[forged.length - 1] ^= 1;
      await assert.rejects(() => decryptSFramePacket(packet, key, forged));
    }
  }
  assert.throws(() => encodedFrameLayout(payload, "video", "unknown", "key"));
  assert.throws(() =>
    encodedFrameLayout(
      new Uint8Array([0x32, 0xff, 0xff]),
      "video",
      "av1",
      "key",
      true,
    ),
  );
});
await test("H264 authenticates complete variable-length slice routing fields", async () => {
  for (const fields of [
    [0, 2, 17],
    [300, 9, 32],
  ]) {
    const bits = fields
      .map((value) => {
        const number = (value + 1).toString(2);
        return "0".repeat(number.length - 1) + number;
      })
      .join("");
    const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, "0");
    const routing = Uint8Array.from(
      padded.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
    );
    const prefix = joinMediaFrame(
      new Uint8Array([0, 0, 0, 1, 0x65]),
      escapeMediaRbsp(routing),
    );
    const raw = joinMediaFrame(prefix, new Uint8Array([0xab, 0xcd, 0xef]));
    const layout = encodedFrameLayout(raw, "video", "h264", "key");
    assert.deepEqual(layout.header, prefix);
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await encryptSFramePacket(
      layout.payload,
      key,
      85,
      1n,
      layout.header,
    );
    const wire = joinMediaFrame(layout.header, escapeMediaRbsp(sealed));
    const received = encodedFrameLayout(wire, "video", "h264", "key", true);
    const { decryptedPayload } = await decryptSFramePacket(
      unescapeMediaRbsp(received.payload),
      key,
      received.header,
    );
    assert.deepEqual(joinMediaFrame(received.header, decryptedPayload), raw);
  }
  assert.throws(() =>
    encodedFrameLayout(
      new Uint8Array([0, 0, 0, 1, 0x65, ...new Uint8Array(40)]),
      "video",
      "h264",
      "key",
    ),
  );
});
console.log(`media-encryption-crypto: ${passed} passed, 0 failed`);
