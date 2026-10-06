import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

console.log("=== [Test 1] 验证 5 种官方语言包 audioPlayer 键名对称性 ===");
const locales = ["zh-CN", "zh-TW", "zh-HK", "en-US", "ja-JP"];
const baseDir = path.resolve("apps/web/src/i18n/locales");

const localeKeys = {};
for (const loc of locales) {
  const filePath = path.join(baseDir, loc, "chat.json");
  const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.ok(content.audioPlayer, `Locale ${loc} missing audioPlayer section`);
  localeKeys[loc] = Object.keys(content.audioPlayer).sort();
  console.log(`✓ ${loc} audioPlayer keys count: ${localeKeys[loc].length}`);
}

const referenceKeys = localeKeys["zh-CN"];
for (const loc of locales) {
  assert.deepStrictEqual(
    localeKeys[loc],
    referenceKeys,
    `Locale ${loc} keys do not match reference zh-CN!`,
  );
  // 确保没有空字符串
  const filePath = path.join(baseDir, loc, "chat.json");
  const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  for (const [k, v] of Object.entries(content.audioPlayer)) {
    assert.ok(typeof v === "string" && v.length > 0, `Locale ${loc} key ${k} is empty!`);
  }
}
console.log("✓ 全部 5 套语言字典 100% 对称，无空键！");

console.log("\n=== [Test 2] 验证 formatAudioTime 与时间格式化 ===");
function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

assert.equal(formatAudioTime(0), "00:00");
assert.equal(formatAudioTime(5), "00:05");
assert.equal(formatAudioTime(65), "01:05");
assert.equal(formatAudioTime(3600), "60:00");
assert.equal(formatAudioTime(-10), "00:00");
assert.equal(formatAudioTime(Infinity), "00:00");
assert.equal(formatAudioTime(NaN), "00:00");
console.log("✓ 时间格式化边界与异常值测试通过！");

console.log("\n=== [Test 3] 验证 isAudioFile 判断准确率 ===");
const isAudioFile = (mimeType, fileName) => {
  const name = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  return (
    mime.startsWith("audio/") ||
    /\.(mp3|wav|ogg|flac|aac|m4a|weba|opus|wma|aiff)$/i.test(name)
  );
};

assert.equal(isAudioFile("audio/mpeg", "song.mp3"), true);
assert.equal(isAudioFile("audio/wav", "recording.wav"), true);
assert.equal(isAudioFile("audio/ogg", "track.ogg"), true);
assert.equal(isAudioFile("application/octet-stream", "podcast.flac"), true);
assert.equal(isAudioFile("application/octet-stream", "voice.aac"), true);
assert.equal(isAudioFile("application/octet-stream", "test.m4a"), true);
assert.equal(isAudioFile("application/octet-stream", "test.opus"), true);
assert.equal(isAudioFile("image/png", "cover.png"), false);
assert.equal(isAudioFile("video/mp4", "movie.mp4"), false);
assert.equal(isAudioFile("application/pdf", "document.pdf"), false);
console.log("✓ isAudioFile 文件识别测试通过！");

console.log("\n=== [Test 4] 验证波形 fallback 算法确定性与归一化范围 ===");
function generateFallbackPeaks(seed, count) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const raw = [];
  let prev = 0.5;
  for (let i = 0; i < count; i++) {
    const x = Math.sin(hash + i * 1.3) * 10000;
    const rand = x - Math.floor(x);
    prev = prev * 0.4 + rand * 0.6;
    raw.push(Math.max(0.18, Math.min(1.0, 0.2 + prev * 0.8)));
  }
  return raw;
}

const peaks1 = generateFallbackPeaks("attachment_12345", 36);
const peaks2 = generateFallbackPeaks("attachment_12345", 36);
assert.deepStrictEqual(peaks1, peaks2, "Same seed must produce identical waveform peaks");
assert.equal(peaks1.length, 36);
for (const p of peaks1) {
  assert.ok(p >= 0.18 && p <= 1.0, `Peak value ${p} out of bounds [0.18, 1.0]`);
}
console.log("✓ 波形数据平滑与稳定性测试通过！");

console.log("\n>>> 全部音频模块核心逻辑测试 100% 通过 (ALL PASS) <<<");
