import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { DtlnProcessor } from "../packages/audio-dsp/dtln-core.mjs";
import { Dfn3Processor } from "../packages/audio-dsp/dfn3-core.mjs";

const require = createRequire(path.resolve("apps/desktop/package.json"));
const ort = require("onnxruntime-node");
const webRequire = createRequire(path.resolve("apps/web/package.json"));
const ortWeb = webRequire("onnxruntime-web/wasm");
ortWeb.env.wasm.wasmPaths = pathToFileURL(
  path.resolve("apps/web/public/ort") + path.sep,
).href;
ortWeb.env.wasm.numThreads = 1;

function readWav(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  let format, data;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === "fmt ") format = bytes.subarray(at + 8, at + 8 + size);
    if (id === "data") data = bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  assert(format && data);
  assert.equal(format.readUInt32LE(4), 48000);
  assert.equal(format.readUInt16LE(2), 1);
  const encoding = format.readUInt16LE(0),
    bits = format.readUInt16LE(14);
  const samples = new Float32Array(data.length / (bits / 8));
  for (let i = 0; i < samples.length; i++) {
    samples[i] =
      encoding === 1 && bits === 16
        ? data.readInt16LE(i * 2) / 32768
        : encoding === 3 && bits === 32
          ? data.readFloatLE(i * 4)
          : (() => {
              throw new Error(`Unsupported WAV ${encoding}/${bits}`);
            })();
  }
  return samples;
}

const modelRoot = path.resolve("apps/web/public/models");
const dfnDir = path.join(modelRoot, "dfn3");
const [dfnSession, dtlnOne, dtlnTwo] = await Promise.all([
  ort.InferenceSession.create(path.join(dfnDir, "denoiser_model.onnx")),
  ort.InferenceSession.create(path.join(modelRoot, "dtln", "model_1.onnx")),
  ort.InferenceSession.create(path.join(modelRoot, "dtln", "model_2.onnx")),
]);
const createDfn = () =>
  new Dfn3Processor(
    dfnSession,
    ort.Tensor,
    JSON.parse(fs.readFileSync(path.join(dfnDir, "meta.json"))),
    JSON.parse(fs.readFileSync(path.join(dfnDir, "initial-state-layout.json"))),
    fs.readFileSync(path.join(dfnDir, "initial-states.f32")),
    100,
  );

const noisy = readWav("e2e/fixtures/audio/noisy_2s_48k.wav");
const reference = readWav("e2e/fixtures/audio/reference_dfn3_2s_48k.wav");
const dfn = createDfn();
const padding = (512 - (noisy.length % 512)) % 512;
const padded = new Float32Array(noisy.length + padding + 1024);
padded.set(noisy);
const chunks = [];
for (let offset = 0; offset < padded.length; offset += 512)
  chunks.push(await dfn.push48k(padded.subarray(offset, offset + 512)));
const out = Float32Array.from(chunks.flatMap((chunk) => Array.from(chunk)));
let maxDifference = 0;
for (let i = 0; i < reference.length; i++)
  maxDifference = Math.max(
    maxDifference,
    Math.abs(out[i + 512] - reference[i]),
  );
console.log(
  `DFN3 reference parity: ${dfn.processedFrames} frames, max difference ${maxDifference}`,
);
assert(
  maxDifference < 1e-4,
  "DFN3 output diverges from the published reference WAV",
);

const createDtln = () => new DtlnProcessor(dtlnOne, dtlnTwo, ort.Tensor);
const first = createDtln(),
  second = createDtln();
const onePass = await first.push48k(noisy);
const streamChunks = [];
for (let offset = 0; offset < noisy.length; offset += 128)
  streamChunks.push(await second.push48k(noisy.subarray(offset, offset + 128)));
const streamed = Float32Array.from(
  streamChunks.flatMap((chunk) => Array.from(chunk)),
);
assert.equal(streamed.length, onePass.length);
let chunkDifference = 0;
for (let i = 0; i < streamed.length; i++)
  chunkDifference = Math.max(
    chunkDifference,
    Math.abs(streamed[i] - onePass[i]),
  );
const firSum = first.taps.reduce((sum, value) => sum + value, 0);
console.log(
  `DTLN chunk invariance: ${first.processedFrames} frames, max difference ${chunkDifference}, FIR sum ${firSum}`,
);
assert(chunkDifference < 1e-5);
assert(Math.abs(firSum - 1) < 1e-5);
assert(streamed.every(Number.isFinite));

const interpolation = createDtln();
const tone16k = Float32Array.from({ length: 4096 }, (_, i) =>
  Math.sin((2 * Math.PI * 1000 * i) / 16000),
);
const tone48k = interpolation.upsample16k(tone16k);
const projectedAmplitude = (frequency) => {
  let cosine = 0;
  let sine = 0;
  for (let i = 300; i < tone48k.length; i++) {
    cosine += tone48k[i] * Math.cos((2 * Math.PI * frequency * i) / 48000);
    sine += tone48k[i] * Math.sin((2 * Math.PI * frequency * i) / 48000);
  }
  return (2 * Math.hypot(cosine, sine)) / (tone48k.length - 300);
};
const passband = projectedAmplitude(1000);
const image = projectedAmplitude(15000);
console.log(`DTLN upsampling: 1 kHz gain ${passband}, 15 kHz image ${image}`);
assert(Math.abs(passband - 1) < 0.01);
assert(image < 0.01);

function readFloat32(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length % 4, 0);
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}

// Generated by scripts/generate-dtln-reference.py from the upstream
// real_time_processing_onnx.py buffer/state algorithm. This compares model
// inference and overlap/add at 16 kHz separately from resampling invariance.
const dtlnInput = readFloat32(
  "e2e/fixtures/audio/dtln_reference_input_16k.f32",
);
const dtlnReference = readFloat32(
  "e2e/fixtures/audio/dtln_reference_output_16k.f32",
);
const dtlnParity = createDtln();
let dtlnMaxDifference = 0;
const referenceHops = Math.floor((dtlnInput.length - 384) / 128);
for (let hop = 0; hop < referenceHops; hop++) {
  dtlnParity.inputWindow.copyWithin(0, 128);
  dtlnParity.inputWindow.set(
    dtlnInput.subarray(hop * 128, (hop + 1) * 128),
    384,
  );
  const actual = await dtlnParity.processFrame();
  for (let i = 0; i < 128; i++)
    dtlnMaxDifference = Math.max(
      dtlnMaxDifference,
      Math.abs(actual[i] - dtlnReference[hop * 128 + i]),
    );
}
console.log(
  `DTLN official reference parity: ${referenceHops} hops, max difference ${dtlnMaxDifference}`,
);
assert(
  dtlnMaxDifference < 1e-4,
  "DTLN output diverges from the official algorithm reference",
);

const [webDtlnOne, webDtlnTwo, webDfnSession] = await Promise.all([
  ortWeb.InferenceSession.create(
    fs.readFileSync(path.join(modelRoot, "dtln", "model_1.onnx")),
    { executionProviders: ["wasm"] },
  ),
  ortWeb.InferenceSession.create(
    fs.readFileSync(path.join(modelRoot, "dtln", "model_2.onnx")),
    { executionProviders: ["wasm"] },
  ),
  ortWeb.InferenceSession.create(
    fs.readFileSync(path.join(dfnDir, "denoiser_model.onnx")),
    { executionProviders: ["wasm"] },
  ),
]);
const dfnMeta = JSON.parse(fs.readFileSync(path.join(dfnDir, "meta.json")));
const dfnLayout = JSON.parse(
  fs.readFileSync(path.join(dfnDir, "initial-state-layout.json")),
);
const dfnState = fs.readFileSync(path.join(dfnDir, "initial-states.f32"));
const parityProcessors = [
  [
    "DTLN",
    createDtln(),
    new DtlnProcessor(webDtlnOne, webDtlnTwo, ortWeb.Tensor),
  ],
  [
    "DFN3",
    new Dfn3Processor(dfnSession, ort.Tensor, dfnMeta, dfnLayout, dfnState, 12),
    new Dfn3Processor(
      webDfnSession,
      ortWeb.Tensor,
      dfnMeta,
      dfnLayout,
      dfnState,
      12,
    ),
  ],
];
for (const [name, nativeProcessor, wasmProcessor] of parityProcessors) {
  let maxBackendDifference = 0;
  const input = noisy.subarray(0, 48000);
  for (let offset = 0; offset < input.length; offset += 128) {
    const chunk = input.subarray(offset, offset + 128);
    const nativeOutput = await nativeProcessor.push48k(chunk);
    const wasmOutput = await wasmProcessor.push48k(chunk);
    assert.equal(wasmOutput.length, nativeOutput.length);
    for (let i = 0; i < nativeOutput.length; i++)
      maxBackendDifference = Math.max(
        maxBackendDifference,
        Math.abs(nativeOutput[i] - wasmOutput[i]),
      );
  }
  nativeProcessor.reset();
  wasmProcessor.reset();
  let maxResetDifference = 0;
  for (let offset = 0; offset < 128 * 12; offset += 128) {
    const chunk = input.subarray(offset, offset + 128);
    const nativeOutput = await nativeProcessor.push48k(chunk);
    const wasmOutput = await wasmProcessor.push48k(chunk);
    assert.equal(wasmOutput.length, nativeOutput.length);
    for (let i = 0; i < nativeOutput.length; i++)
      maxResetDifference = Math.max(
        maxResetDifference,
        Math.abs(nativeOutput[i] - wasmOutput[i]),
      );
  }
  console.log(
    `${name} native/WASM parity: max difference ${maxBackendDifference}, after reset ${maxResetDifference}`,
  );
  assert(maxBackendDifference < 1e-3);
  assert(maxResetDifference < 1e-3);
}
await Promise.all([
  webDtlnOne.release(),
  webDtlnTwo.release(),
  webDfnSession.release(),
]);
