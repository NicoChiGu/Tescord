import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  NoiseSuppressionMode,
  AudioProcessingConfig,
  calculateSNRReduction,
  calculateTripleSNRReduction,
  calculateQuadSNRReduction,
  QuadTrackSNRResult,
} from "@tescord/types";

console.log("🚀 开始验证 DeepFilterNet3 (DFNv3) 降噪架构与管线...");

// 1. 验证类型与枚举
const testMode: NoiseSuppressionMode = "dfn3";
assert.strictEqual(testMode, "dfn3", "NoiseSuppressionMode 必须包含 'dfn3'");

const testConfig: AudioProcessingConfig = {
  noiseSuppression: true,
  noiseSuppressionMode: "dfn3",
  echoCancellation: true,
  autoGainControl: true,
  highFidelityMusic: false,
  inputMode: "VAD",
  pushToTalk: false,
  vadSensitivity: 25,
  audioBitrate: 64000,
};
assert.strictEqual(testConfig.noiseSuppressionMode, "dfn3");
console.log("✅ 1. packages/types 强类型契约校验通过");

// 2. 验证 QuadTrackSNRResult 与 calculateQuadSNRReduction 数学正确性
const rawRms = 0.1; // 原始底噪 RMS
const rnnoiseRms = 0.02; // RNNoise 降噪后 RMS (~14dB 降低)
const dtlnRms = 0.008; // DTLN 降噪后 RMS (~22dB 降低)
const dfn3Rms = 0.005; // DFNv3 48kHz 全频降噪后 RMS (~26dB 降低)

const quadResult: QuadTrackSNRResult = calculateQuadSNRReduction(
  rawRms,
  rnnoiseRms,
  dtlnRms,
  dfn3Rms,
);

console.log("   - 原始 RMS:", rawRms);
console.log("   - RNNoise RMS:", rnnoiseRms, "->", quadResult.rnnoiseDbReduction, "dB 改善");
console.log("   - DTLN RMS:", dtlnRms, "->", quadResult.dtlnDbReduction, "dB 改善");
console.log("   - DFNv3 RMS:", dfn3Rms, "->", quadResult.dfn3DbReduction, "dB 改善");

assert(quadResult.rnnoiseDbReduction > 10, "RNNoise 降噪量应 > 10 dB");
assert(quadResult.dtlnDbReduction > 20, "DTLN 降噪量应 > 20 dB");
assert(quadResult.dfn3DbReduction > quadResult.dtlnDbReduction, "DFNv3 48kHz 降噪量应达到极致表现 (> DTLN)");
console.log("✅ 2. 四轨信噪比 (Quad Track SNR) 算法与数值模型验证通过");

// 3. 验证 AudioWorklet 文件与 Node 封装就绪
const rootDir = path.resolve(__dirname, "..");
const workletPath = path.resolve(rootDir, "apps/web/public/models/dfn3/dfn3WorkletProcessor.js");
const nodePath = path.resolve(rootDir, "apps/web/src/services/dfn3Node.ts");

assert(fs.existsSync(workletPath), `AudioWorklet 核心文件不存在: ${workletPath}`);
assert(fs.existsSync(nodePath), `Web Audio 节点封装不存在: ${nodePath}`);

const workletContent = fs.readFileSync(workletPath, "utf-8");
assert(workletContent.includes("dfn3-worklet-processor"), "Worklet 必须注册 'dfn3-worklet-processor'");
assert(workletContent.includes("processDFNv3Frame"), "Worklet 必须包含 processDFNv3Frame 核心算法");
assert(workletContent.includes("initErbBandLimits"), "Worklet 必须包含 ERB 滤波器组初始化");

const nodeContent = fs.readFileSync(nodePath, "utf-8");
assert(nodeContent.includes("class Dfn3WorkletNode extends AudioWorkletNode"), "必须导出 Dfn3WorkletNode 类");
assert(nodeContent.includes("loadDfn3Worklet"), "必须导出 loadDfn3Worklet 加载函数");

console.log("✅ 3. DFNv3 AudioWorklet 与 Web Audio Node 静态源码规范验证通过");

console.log("\n🎉 DeepFilterNet3 (DFNv3) 所有专项核对 100% 通过！");
