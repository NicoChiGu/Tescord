import assert from "node:assert/strict";
import { SFrameManager } from "../apps/web/src/services/sframe.js";
import type {
  MediaTransformControl,
  MediaTransformEvent,
} from "@tescord/types";

class TestTrack extends EventTarget {
  kind = "audio";
  readyState: MediaStreamTrackState = "live";
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<MediaTransformEvent>) => void) | null = null;
  onerror: (() => void) | null = null;
  deferAck = false;
  terminated = false;
  constructor() {
    TestWorker.instances.push(this);
  }
  postMessage(message: MediaTransformControl) {
    if (
      message.type === "receiver-key" &&
      message.requestId !== undefined &&
      !this.deferAck
    )
      queueMicrotask(() =>
        this.emit({ type: "key-installed", requestId: message.requestId! }),
      );
  }
  emit(data: MediaTransformEvent) {
    this.onmessage?.({ data } as MessageEvent<MediaTransformEvent>);
  }
  terminate() {
    this.terminated = true;
  }
}
const names = ["Worker", "RTCRtpScriptTransform"] as const;
const saved = new Map(
  names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  value: TestWorker,
});
Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
  configurable: true,
  value: class {},
});
let passed = 0;
const make = () => {
  const failures: Error[] = [];
  const manager = new SFrameManager();
  manager.beginContext(
    async (streamId) => ({ key: new Uint8Array(32), keyId: 1, streamId }),
    (error) => failures.push(error),
  );
  const tracks = [new TestTrack(), new TestTrack()];
  const receivers = tracks.map(
    (track) =>
      ({
        track,
        getParameters: () => ({ codecs: [] }),
      }) as unknown as RTCRtpReceiver,
  );
  receivers.forEach((receiver) => manager.attachReceiver(receiver));
  const workers = TestWorker.instances.slice(-2);
  return { manager, failures, tracks, receivers, workers };
};
try {
  {
    const { manager, failures, tracks, workers } = make();
    try {
      tracks[1].end();
      workers[1].emit({ type: "fatal", error: "MEDIA_KEY_UNAVAILABLE" });
      assert.equal(
        failures.length,
        0,
        "C's ended receiver must not fail B's active context",
      );
      assert.equal(workers[1].terminated, true);
      assert.equal(workers[0].terminated, false);
      passed++;
      console.log(
        "PASS ended receiver ignores queued failure and preserves remaining peer",
      );
    } finally {
      manager.disable();
    }
  }
  {
    const { manager, failures, tracks, workers } = make();
    try {
      workers[1].deferAck = true;
      const pending = manager.installReceiverKey(2, new Uint8Array(32));
      void pending.catch(() => {});
      tracks[1].end();
      await Promise.race([
        pending,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("ended receiver blocked live key install")),
            250,
          ),
        ),
      ]);
      assert.equal(failures.length, 0);
      passed++;
      console.log(
        "PASS ended receiver no longer blocks remaining key installation ACK",
      );
    } finally {
      manager.disable();
    }
  }
  {
    const { manager, failures, workers } = make();
    try {
      workers[0].emit({ type: "fatal", error: "MEDIA_KEY_INVALID" });
      assert.equal(
        failures.length,
        1,
        "live pipeline integrity failure remains fatal",
      );
      assert.equal(failures[0].message, "MEDIA_KEY_INVALID");
      passed++;
      console.log("PASS live receiver integrity failure remains fail closed");
    } finally {
      manager.disable();
    }
  }
} finally {
  for (const name of names) {
    const descriptor = saved.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
console.log(`receiver lifecycle: ${passed} passed, 0 failed`);
