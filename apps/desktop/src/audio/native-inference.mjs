import { createRequire } from "node:module";
import path from "node:path";
import { DtlnProcessor } from "./dtln-core.mjs";
import { Dfn3Processor } from "./dfn3-core.mjs";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const ort = require("onnxruntime-node");

class NativeRnnoiseProcessor {
  constructor() {
    this.addon = require("./rnnoise.node");
    this.state = this.addon.createState();
    this.pending = new Float32Array(480);
    this.pendingLength = 0;
    this.processedFrames = 0;
    this.processingTimes = [];
  }
  push48k(input) {
    const output = [];
    for (const sample of input) {
      if (!Number.isFinite(sample))
        throw new RangeError("Non-finite RNNoise PCM");
      this.pending[this.pendingLength++] = sample;
      if (this.pendingLength === 480) {
        const started = performance.now();
        const frame = this.addon.processFrame(this.state, this.pending);
        this.processingTimes.push(performance.now() - started);
        if (this.processingTimes.length > 256) this.processingTimes.shift();
        for (const value of frame) output.push(value);
        this.pendingLength = 0;
        this.processedFrames++;
      }
    }
    return Float32Array.from(output);
  }
  processingStats() {
    const sorted = [...this.processingTimes].sort((a, b) => a - b);
    const at = (fraction) =>
      sorted[
        Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
      ] ?? 0;
    return {
      processingMs: sorted.at(-1) ?? 0,
      processingP50Ms: at(0.5),
      processingP95Ms: at(0.95),
      processingP99Ms: at(0.99),
    };
  }
}

process.parentPort.on("message", async ({ data, ports }) => {
  const port = ports?.[0];
  if (
    !port ||
    !["rnnoise", "dtln", "dfn3"].includes(data?.mode) ||
    typeof data.modelDir !== "string"
  )
    return;
  let closed = false;
  const queue = [];
  let busy = false;
  let lastStats = 0;
  let lastPcmAt = performance.now();
  let pcmCredit = 128;
  let expectedSequence = 0;
  let receivedSamples = 0;
  try {
    const processor =
      data.mode === "rnnoise"
        ? new NativeRnnoiseProcessor()
        : data.mode === "dtln"
          ? new DtlnProcessor(
              await ort.InferenceSession.create(
                path.join(data.modelDir, "model_1.onnx"),
              ),
              await ort.InferenceSession.create(
                path.join(data.modelDir, "model_2.onnx"),
              ),
              ort.Tensor,
            )
          : new Dfn3Processor(
              await ort.InferenceSession.create(
                path.join(data.modelDir, "denoiser_model.onnx"),
              ),
              ort.Tensor,
              JSON.parse(
                fs.readFileSync(path.join(data.modelDir, "meta.json"), "utf8"),
              ),
              JSON.parse(
                fs.readFileSync(
                  path.join(data.modelDir, "initial-state-layout.json"),
                  "utf8",
                ),
              ),
              fs.readFileSync(path.join(data.modelDir, "initial-states.f32")),
              12,
            );
    if (data.mode !== "rnnoise") {
      // ONNX performs expensive first-run initialization. Finish it before
      // telling the audio thread to start its real-time PCM clock.
      await processor.push48k(new Float32Array(2048));
      processor.reset();
    }
    const drain = async () => {
      if (busy) return;
      busy = true;
      try {
        while (queue.length && !closed) {
          const frame = queue.shift();
          const output = await processor.push48k(frame.pcm);
          if (output.length)
            port.postMessage({
              type: "PCM",
              pcm: output,
              sequence: frame.sequence,
              sampleCount: frame.sampleCount,
            });
          if (performance.now() - lastStats >= 100) {
            lastStats = performance.now();
            port.postMessage({
              type: "STATS",
              processedFrames: processor.processedFrames,
              queueMs: (queue.length * 128) / 48,
              ...processor.processingStats(),
            });
          }
        }
      } catch (error) {
        closed = true;
        port.postMessage({ type: "ERROR", reason: String(error) });
      } finally {
        busy = false;
      }
    };
    port.on("message", ({ data: message }) => {
      if (closed) return;
      if (message?.type === "STOP") {
        closed = true;
        port.close();
        process.exit(0);
      } else if (message?.type === "PCM") {
        const now = performance.now();
        pcmCredit = Math.min(128, pcmCredit + ((now - lastPcmAt) * 750) / 1000);
        lastPcmAt = now;
        const invalidPcm =
          !(message.pcm instanceof Float32Array) ||
          message.pcm.length > 128 ||
          message.pcm.length === 0;
        const invalidSequence =
          !invalidPcm &&
          (message.sequence !== expectedSequence ||
            message.sampleCount !== receivedSamples + message.pcm.length);
        if (
          invalidPcm ||
          invalidSequence ||
          queue.length >= 96 ||
          pcmCredit < 1
        ) {
          closed = true;
          port.postMessage({
            type: "ERROR",
            reason: invalidPcm
              ? "Invalid PCM frame"
              : invalidSequence
                ? "Invalid PCM sequence"
                : queue.length >= 96
                  ? "PCM queue overflow"
                  : "PCM rate exceeded",
          });
          return;
        }
        pcmCredit--;
        expectedSequence++;
        receivedSamples = message.sampleCount;
        queue.push({
          pcm: message.pcm,
          sequence: message.sequence,
          sampleCount: message.sampleCount,
        });
        void drain();
      }
    });
    port.start();
    port.postMessage({ type: "READY" });
  } catch (error) {
    port.postMessage({ type: "ERROR", reason: String(error) });
  }
});
