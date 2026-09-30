import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const webRoot = path.resolve(process.cwd(), "apps/web");
const webRequire = createRequire(path.join(webRoot, "package.json"));
let server: {
  listen(): Promise<void>;
  close(): Promise<void>;
  resolvedUrls?: { local: string[] };
};
let origin: string;

test.beforeAll(async () => {
  const { createServer } = await import(webRequire.resolve("vite"));
  server = await createServer({
    root: webRoot,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  origin = server.resolvedUrls?.local[0] || "";
  expect(origin).not.toBe("");
});
test.afterAll(async () => {
  await server?.close();
});

test("发送端电平反映手动增益并在静音时归零", async ({ page }) => {
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const levels = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    audioEngine.config.inputMode = "PTT";
    const stream = await audioEngine.initMicrophone();
    if (!stream) throw new Error(audioEngine.lastError || "Microphone failed");
    await audioEngine.applyNoiseSuppressionRouting("off");
    audioEngine.setPTTActive(true);
    const samples: number[] = [];
    const unbind = audioEngine.onSpeakingChange((_speaking, volume) => {
      samples.push(volume);
    });
    const sample = async () => {
      samples.length = 0;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return Math.max(...samples, 0);
    };
    audioEngine.updateConfig({ manualGain: 0 });
    const zero = await sample();
    audioEngine.updateConfig({ manualGain: 100 });
    const normal = await sample();
    audioEngine.setMute(true);
    const muted = await sample();
    unbind();
    audioEngine.stop();
    return { zero, normal, muted };
  });
  expect(levels.zero).toBe(0);
  expect(levels.normal).toBeGreaterThan(0);
  expect(levels.muted).toBe(0);
});

test("真实三引擎切换、关闭、PTT 与资源释放", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Audio engine test</body></html>",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const result = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    audioEngine.config.inputMode = "PTT";
    const stream = await audioEngine.initMicrophone();
    if (!stream) throw new Error(audioEngine.lastError || "Microphone failed");
    const stableTrack = stream.getAudioTracks()[0];
    audioEngine.setPTTActive(true);
    let maxVolume = 0;
    let speakingSeen = false;
    const unbindSpeaking = audioEngine.onSpeakingChange((speaking, volume) => {
      maxVolume = Math.max(maxVolume, volume);
      speakingSeen ||= speaking;
    });
    const modes = [];
    for (const mode of ["rnnoise", "dtln", "dfn3", "off"] as const) {
      audioEngine.config.noiseSuppressionMode = mode;
      await audioEngine.applyNoiseSuppressionRouting(mode);
      if (mode === "dtln" || mode === "dfn3")
        await new Promise((resolve) => setTimeout(resolve, 650));
      modes.push({ ...audioEngine.noiseStatus });
    }
    await audioEngine.applyNoiseSuppressionRouting("rnnoise");
    await audioEngine.applyNoiseSuppressionRouting("dtln");
    await audioEngine.applyNoiseSuppressionRouting("rnnoise");
    await new Promise((resolve) => setTimeout(resolve, 180));
    const restoredMode = audioEngine.noiseStatus.effectiveMode;
    await Promise.all([
      audioEngine.applyNoiseSuppressionRouting("dfn3"),
      audioEngine.applyNoiseSuppressionRouting("rnnoise"),
      audioEngine.applyNoiseSuppressionRouting("off"),
    ]);
    const rapidFinalMode = audioEngine.noiseStatus.effectiveMode;
    audioEngine.setPTTActive(false);
    const pttClosed = !stableTrack.enabled;
    audioEngine.setPTTActive(true);
    const pttOpen = stableTrack.enabled;
    audioEngine.setMute(true);
    const muted = !stableTrack.enabled;
    audioEngine.setMute(false);
    const sameTrack = stream.getAudioTracks()[0] === stableTrack;
    unbindSpeaking();
    audioEngine.stop();
    return {
      modes,
      maxVolume,
      speakingSeen,
      restoredMode,
      rapidFinalMode,
      pttClosed,
      pttOpen,
      muted,
      sameTrack,
      stopped: stableTrack.readyState,
    };
  });
  expect(result.modes.map((entry) => entry.effectiveMode)).toEqual([
    "rnnoise",
    "dtln",
    "dfn3",
    "off",
  ]);
  expect(result.modes.every((entry) => entry.phase === "ready")).toBe(true);
  expect(
    result.modes
      .filter((entry) => entry.effectiveMode !== "off")
      .every((entry) => entry.backend === "web-wasm"),
  ).toBe(true);
  expect(
    result.modes
      .filter(
        (entry) =>
          entry.effectiveMode === "dtln" || entry.effectiveMode === "dfn3",
      )
      .every(
        (entry) =>
          Number.isFinite(entry.processingP95Ms) &&
          (entry.processedFrames ?? 0) > 0,
      ),
  ).toBe(true);
  expect(result).toMatchObject({
    pttClosed: true,
    pttOpen: true,
    muted: true,
    rapidFinalMode: "off",
    restoredMode: "rnnoise",
    sameTrack: true,
    stopped: "ended",
  });
  expect(result.maxVolume).toBeGreaterThan(5);
  expect(result.speakingSeen).toBe(true);
  expect(errors).toEqual([]);
});

test("DTLN 模型校验失败时回退真实 RNNoise 并报告原因", async ({ page }) => {
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Audio fallback test</body></html>",
    }),
  );
  await page.route("**/models/dtln/model_1.onnx", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: "corrupt model",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const status = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    audioEngine.config.inputMode = "PTT";
    const stream = await audioEngine.initMicrophone();
    if (!stream) throw new Error(audioEngine.lastError || "Microphone failed");
    audioEngine.config.noiseSuppressionMode = "dtln";
    await audioEngine.applyNoiseSuppressionRouting("dtln");
    const result = { ...audioEngine.noiseStatus };
    audioEngine.stop();
    return result;
  });
  expect(status).toMatchObject({
    requestedMode: "dtln",
    effectiveMode: "rnnoise",
    phase: "failed",
    backend: "web-wasm",
  });
  expect(status.reason).toContain("checksum mismatch");
});

test("RNNoise 无法加载时明确直通且保留用户选择", async ({ page }) => {
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.route("**/rnnoise/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "missing" }),
  );
  await page.goto(`${origin}audio-test`);
  const result = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    const stream = await audioEngine.initMicrophone();
    if (!stream) throw new Error(audioEngine.lastError || "Microphone failed");
    await audioEngine.applyNoiseSuppressionRouting("rnnoise");
    const status = { ...audioEngine.noiseStatus };
    const savedMode = audioEngine.config.noiseSuppressionMode;
    audioEngine.stop();
    return { status, savedMode };
  });
  expect(result.status).toMatchObject({
    requestedMode: "rnnoise",
    effectiveMode: "off",
    backend: "bypass",
    phase: "failed",
  });
  expect(result.status.reason).toContain("RNNoise WASM checksum mismatch");
  expect(result.savedMode).toBe("rnnoise");
});

test("四轨试听取消后保留通话麦克风并释放试听实例", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const result = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    const stream = await audioEngine.initMicrophone();
    if (!stream) throw new Error(audioEngine.lastError || "Microphone failed");
    const track = stream.getAudioTracks()[0];
    const controller = new AbortController();
    let cancelled = false;
    try {
      await audioEngine.recordTripleABComparison(
        2,
        (remaining) => {
          if (remaining === 2) setTimeout(() => controller.abort(), 50);
        },
        controller.signal,
      );
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === "AbortError";
    }
    const stillActive = track.readyState === "live";
    audioEngine.stop();
    return { cancelled, stillActive, stopped: track.readyState };
  });
  expect(result).toEqual({
    cancelled: true,
    stillActive: true,
    stopped: "ended",
  });
  expect(errors).toEqual([]);
});

test("一次录音重放为四轨真实引擎试听", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const result = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    const comparison = await audioEngine.recordTripleABComparison(1);
    const entries = [
      comparison.rawUrl,
      comparison.rnnoiseUrl,
      comparison.dtlnUrl,
      comparison.dfn3Url,
    ];
    const sizes = await Promise.all(
      entries.map(async (url) =>
        url ? (await (await fetch(url)).blob()).size : 0,
      ),
    );
    const context = new AudioContext();
    const audio = await Promise.all(
      entries.map(async (url) => {
        if (!url) return { samples: 0, energy: 0 };
        const decoded = await context.decodeAudioData(
          await (await fetch(url)).arrayBuffer(),
        );
        const pcm = decoded.getChannelData(0);
        return {
          samples: decoded.length,
          energy: pcm.reduce((sum, value) => sum + value * value, 0),
        };
      }),
    );
    await context.close();
    entries.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    audioEngine.stop();
    return {
      sizes,
      audio,
      errors: [
        comparison.rnnoiseError,
        comparison.dtlnError,
        comparison.dfn3Error,
      ],
    };
  });
  expect(
    result.sizes.every((size) => size > 0),
    JSON.stringify(result),
  ).toBe(true);
  expect(result.errors).toEqual([undefined, undefined, undefined]);
  expect(result.audio.every((clip) => clip.energy > 0)).toBe(true);
  expect(
    result.audio.every((clip) => clip.samples === result.audio[0].samples),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("离线 DFN3 试听取消后终止推理 worker 并保留麦克风", async ({ page }) => {
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const result = await page.evaluate(async () => {
    const { audioEngine } = await import("/src/services/audioEngine.ts");
    const controller = new AbortController();
    const NativeWorker = window.Worker;
    let comparisonWorker: Worker | undefined;
    let terminated = false;
    window.Worker = class extends NativeWorker {
      postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        if ((message as { type?: string })?.type === "COMPARE") {
          comparisonWorker = this;
          setTimeout(() => controller.abort(), 10);
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
      terminate() {
        if (this === comparisonWorker) terminated = true;
        super.terminate();
      }
    };
    const stream = await audioEngine.initMicrophone();
    const track = stream!.getAudioTracks()[0];
    let cancelled = false;
    try {
      await audioEngine.recordTripleABComparison(
        1,
        undefined,
        controller.signal,
      );
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === "AbortError";
    } finally {
      window.Worker = NativeWorker;
    }
    const stillActive = track.readyState === "live";
    audioEngine.stop();
    return { cancelled, terminated, stillActive, stopped: track.readyState };
  });
  expect(result).toEqual({
    cancelled: true,
    terminated: true,
    stillActive: true,
    stopped: "ended",
  });
});

test("试听时间轴识别并校正 50 ms 延迟", async ({ page }) => {
  await page.route(`${origin}audio-test`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html></html>",
    }),
  );
  await page.goto(`${origin}audio-test`);
  const result = await page.evaluate(async () => {
    const { estimateComparisonLag, alignComparisonPcm, wavBlob } =
      await import("/src/services/audioComparison.ts");
    const raw = new Float32Array(48000);
    for (let i = 0; i < raw.length; i++) {
      const envelope = i < 5000 || (i > 19000 && i < 29000) ? 0.03 : 0.22;
      raw[i] = envelope * Math.sin((2 * Math.PI * 233 * i) / 48000);
    }
    const processed = new Float32Array(raw.length + 2400);
    for (let i = 0; i < raw.length; i++) processed[i + 2400] = raw[i] * 0.5;
    const lag = estimateComparisonLag(raw, processed, 48000);
    const aligned = alignComparisonPcm(processed, lag.samples, raw.length);
    let maxDifference = 0;
    for (let i = 0; i < raw.length; i++)
      maxDifference = Math.max(
        maxDifference,
        Math.abs(aligned[i] - raw[i] * 0.5),
      );
    return { lag, maxDifference, wavBytes: wavBlob(aligned, 48000).size };
  });
  expect(result.lag.samples).toBe(2400);
  expect(result.lag.correlation).toBeGreaterThan(0.9);
  expect(result.maxDifference).toBeLessThan(1e-5);
  expect(result.wavBytes).toBe(44 + 48000 * 2);
});
