import * as ort from "onnxruntime-web/wasm";
import { DtlnProcessor } from "../../../../packages/audio-dsp/dtln-core.mjs";
import { fetchVerifiedAsset } from "./verifyModelAsset.js";

type WorkerInput =
  { type: "START"; port: MessagePort; base: string } | { type: "STOP" };

let port: MessagePort | null = null;
let processor: InstanceType<typeof DtlnProcessor> | null = null;
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
      const out = await processor.push48k(frame.pcm);
      if (out.length)
        port?.postMessage(
          {
            type: "PCM",
            pcm: out,
            sequence: frame.sequence,
            sampleCount: frame.sampleCount,
          },
          [out.buffer],
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
    const [model1, model2] = await Promise.all([
      fetchVerifiedAsset(
        new URL("models/dtln/model_1.onnx", base),
        "22b91cae3855e5a0620e66a917ca6c82c58db0e842c770f58d86751c5e8d4ae3",
      ),
      fetchVerifiedAsset(
        new URL("models/dtln/model_2.onnx", base),
        "e20c92f9233fccf29cddf86970d0d0161a03aebccc26d6f4d5639c4d5ec2e639",
      ),
    ]);
    const [one, two] = await Promise.all([
      ort.InferenceSession.create(model1, { executionProviders: ["wasm"] }),
      ort.InferenceSession.create(model2, { executionProviders: ["wasm"] }),
    ]);
    processor = new DtlnProcessor(one, two, ort.Tensor);
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
          reason: "DTLN inference queue or PCM sequence invalid",
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
