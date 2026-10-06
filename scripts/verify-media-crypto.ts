import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { SFrameManager } from "../apps/web/src/services/sframe.js";

void (async () => {
  if (!globalThis.crypto)
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });

  const key = crypto.getRandomValues(new Uint8Array(32));
  const sender = new SFrameManager();
  const receiver = new SFrameManager();
  sender.setNegotiatedKey(key);
  receiver.setNegotiatedKey(key);

  const clear = new TextEncoder().encode("tescord-e2ee-media-frame");
  const encrypted = await sender.encryptFrame(clear);
  assert.notDeepEqual(
    encrypted,
    clear,
    "ciphertext must not equal the media frame",
  );
  assert.deepEqual(
    await receiver.decryptFrame(encrypted),
    clear,
    "the negotiated key must decrypt the frame",
  );
  assert.equal(
    await receiver.decryptFrame(encrypted),
    null,
    "a replayed frame must be rejected",
  );

  const tampered = encrypted.slice();
  tampered[tampered.length - 1] ^= 0xff;
  const freshReceiver = new SFrameManager();
  freshReceiver.setNegotiatedKey(key);
  assert.equal(
    await freshReceiver.decryptFrame(tampered),
    null,
    "tampered media must be rejected",
  );

  sender.disable();
  await assert.rejects(
    () => sender.encryptFrame(clear),
    /MEDIA_KEY_UNAVAILABLE/,
    "missing keys must fail closed",
  );

  console.log(
    "PASS media-crypto: negotiated decrypt, replay rejection, tamper rejection, fail-closed send",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
