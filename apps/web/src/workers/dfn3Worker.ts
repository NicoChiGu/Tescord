import * as ort from "onnxruntime-web/wasm";
import { Dfn3Processor } from "../../../../packages/audio-dsp/dfn3-core.mjs";
import { fetchVerifiedAsset } from "./verifyModelAsset.js";

type WorkerInput =
  { type: "START"; port: MessagePort; base: string } | { type: "STOP" };
let port: MessagePort | null = null;
let processor: InstanceType<typeof Dfn3Processor> | null = null;
let stopped = false;
let busy = false;
const pending: { pcm: Float32Array; sequence: number; sampleCount: number }[] =
  [];
let expectedSequence = 0;
let receivedSamples = 0;
let lastStats = 0;

async function drain() {
  if (busy || !processor) return;
  busy = true;
  try {
    while (pending.length && !stopped) {
      const frame = pending.shift()!;
      const output = await processor.push48k(frame.pcm);
      if (output.length)
        port?.postMessage(
          {
            type: "PCM",
            pcm: output,
            sequence: frame.sequence,
            sampleCount: frame.sampleCount,
          },
          [output.buffer],
        );
      if (performance.now() - lastStats >= 100) {
        lastStats = performance.now();
        port?.postMessage({
          type: "STATS",
          processedFrames: processor.processedFrames,
          queueMs: (pending.length * 128) / 48,
          ...processor.processingStats(),
        });
      }
    }
  } catch (error) {
    stopped = true;
    port?.postMessage({ type: "ERROR", reason: String(error) });
  } finally {
    busy = false;
  }
}

self.onmessage = async ({ data }: MessageEvent<WorkerInput>) => {
  if (data.type === "STOP") {
    stopped = true;
    pending.length = 0;
    port?.close();
    self.close();
    return;
  }
  if (data.type !== "START" || processor) return;
  try {
    port = data.port;
    const base = new URL(data.base, self.location.href);
    ort.env.wasm.wasmPaths = new URL("ort/", base).href;
    ort.env.wasm.numThreads = 1;
    const dir = new URL("models/dfn3/", base);
    const [modelBytes, metaBytes, layoutBytes, stateBytes] = await Promise.all([
      fetchVerifiedAsset(
        new URL("denoiser_model.onnx", dir),
        "b758c49d6708a5b7979e3de185705a8a4915076c862fb17b1b304d9a72b75cdc",
      ),
      fetchVerifiedAsset(
        new URL("meta.json", dir),
        "f069011a01849629ad23fbb1d00f4417cf106d5e316e3f7fbcba65cce3440818",
      ),
      fetchVerifiedAsset(
        new URL("initial-state-layout.json", dir),
        "53ba88f801e07015dc508ea2c1cc2c461c32ae32f992f5764a32ac46fb3bab1e",
      ),
      fetchVerifiedAsset(
        new URL("initial-states.f32", dir),
        "7664728d90e7b17655cf4d308d46d42fdea6c3a69c374e494164c7cb44d783fc",
      ),
    ]);
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
    });
    const decoder = new TextDecoder();
    processor = new Dfn3Processor(
      session,
      ort.Tensor,
      JSON.parse(decoder.decode(metaBytes)),
      JSON.parse(decoder.decode(layoutBytes)),
      new Uint8Array(stateBytes),
      12,
    );
    port.onmessage = ({ data: frame }) => {
      if (frame?.type !== "PCM" || !(frame.pcm instanceof Float32Array)) return;
      if (
        pending.length >= 16 ||
        frame.pcm.length !== 128 ||
        frame.sequence !== expectedSequence ||
        frame.sampleCount !== receivedSamples + frame.pcm.length
      ) {
        stopped = true;
        port?.postMessage({
          type: "ERROR",
          reason: "DFN3 inference queue or PCM sequence invalid",
        });
        return;
      }
      expectedSequence++;
      receivedSamples = frame.sampleCount;
      pending.push({
        pcm: frame.pcm,
        sequence: frame.sequence,
        sampleCount: frame.sampleCount,
      });
      void drain();
    };
    port.start();
    self.postMessage({ type: "READY" });
  } catch (error) {
    self.postMessage({ type: "ERROR", reason: String(error) });
  }
};
