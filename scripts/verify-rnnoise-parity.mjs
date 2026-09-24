import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const native = require(path.join(root, "apps/desktop/dist/audio/rnnoise.node"));
const wasmEntry = require.resolve("@shiguredo/rnnoise-wasm");
globalThis.require = require;
globalThis.__dirname = path.dirname(wasmEntry);
globalThis.fetch = undefined;
const { Rnnoise } = await import(pathToFileURL(wasmEntry).href);
const wasm = await Rnnoise.load({ assetsPath: path.dirname(wasmEntry) });
const nativeState = native.createState();
const wasmState = wasm.createDenoiseState();
let seed = 0x12345678;
let maxDifference = 0;
let rmsDifference = 0;
let count = 0;
try {
  for (let frameIndex = 0; frameIndex < 100; frameIndex++) {
    const input = new Float32Array(480);
    for (let i = 0; i < input.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      input[i] = 0.08 * Math.sin((frameIndex * 480 + i) * 0.0123) +
        0.025 * ((seed >>> 0) / 0xffffffff * 2 - 1);
    }
    const nativeOutput = native.processFrame(nativeState, input);
    const wasmOutput = Float32Array.from(input, (value) => value * 32767);
    wasmState.processFrame(wasmOutput);
    for (let i = 0; i < input.length; i++) {
      const difference = Math.abs(nativeOutput[i] - wasmOutput[i] / 32767);
      maxDifference = Math.max(maxDifference, difference);
      rmsDifference += difference * difference;
      count++;
    }
  }
} finally { wasmState.destroy(); }
rmsDifference = Math.sqrt(rmsDifference / count);
console.log(JSON.stringify({ frames: 100, maxDifference, rmsDifference }));
assert(maxDifference < 0.0005, "Native RNNoise differs from browser WASM reference");
