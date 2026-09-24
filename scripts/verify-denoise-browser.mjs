import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin =
  process.env.TESCORD_AUDIO_TEST_ORIGIN || "https://127.0.0.1:3000";
const soakMs = Number(process.env.TESCORD_AUDIO_SOAK_MS || 0);
if (!Number.isSafeInteger(soakMs) || soakMs < 0)
  throw new Error("TESCORD_AUDIO_SOAK_MS must be a non-negative integer");
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(`${origin}/audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Audio test</body></html>",
    }),
  );
  await page.goto(`${origin}/audio-test`);
  const result = await page.evaluate(async (soakMs) => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    audioEngine.config.inputMode = "PTT";
    const stream = await audioEngine.initMicrophone();
    if (!stream) throw new Error(audioEngine.lastError || "Microphone failed");
    audioEngine.setPTTActive(true);
    const context = new AudioContext({ sampleRate: 48000 });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 1024;
    const results = [];
    for (const mode of ["rnnoise", "dtln", "dfn3"]) {
      audioEngine.config.noiseSuppressionMode = mode;
      await audioEngine.applyNoiseSuppressionRouting(mode);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const data = new Float32Array(1024);
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(
        data.reduce((sum, value) => sum + value * value, 0) / data.length,
      );
      results.push({ mode, status: { ...audioEngine.noiseStatus }, rms });
    }
    const soak = [];
    if (soakMs) {
      for (const mode of ["dtln", "dfn3"]) {
        await audioEngine.applyNoiseSuppressionRouting(mode);
        const started = performance.now();
        const samples = [];
        while (performance.now() - started < soakMs / 2) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const status = { ...audioEngine.noiseStatus };
          if (status.phase !== "ready" || status.effectiveMode !== mode)
            throw new Error(
              `${mode} failed during soak: ${JSON.stringify(status)}`,
            );
          if (!Number.isFinite(status.queueMs) || status.queueMs > 50)
            throw new Error(`${mode} queue exceeded 50 ms: ${status.queueMs}`);
          samples.push({
            processedFrames: status.processedFrames,
            queueMs: status.queueMs,
            processingP95Ms: status.processingP95Ms,
          });
        }
        if (
          (samples.at(-1)?.processedFrames || 0) <=
          (samples[0]?.processedFrames || 0)
        )
          throw new Error(`${mode} inference stopped progressing`);
        soak.push({
          mode,
          elapsedMs: performance.now() - started,
          samples: samples.length,
          firstFrames: samples[0]?.processedFrames,
          lastFrames: samples.at(-1)?.processedFrames,
          maxQueueMs: Math.max(...samples.map((sample) => sample.queueMs)),
          maxP95Ms: Math.max(
            ...samples.map((sample) => sample.processingP95Ms || 0),
          ),
        });
      }
    }
    source.disconnect();
    await context.close();
    audioEngine.stop();
    return { results, soak };
  }, soakMs);
  console.log(JSON.stringify({ result, pageErrors: errors }, null, 2));
  assert.deepEqual(
    result.results.map((item) => item.status.effectiveMode),
    ["rnnoise", "dtln", "dfn3"],
  );
  assert(result.results.every((item) => item.status.phase === "ready"));
  assert(
    result.results.every(
      (item) => Number.isFinite(item.rms) && item.rms > 1e-7,
    ),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
