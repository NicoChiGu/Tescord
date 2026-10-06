import { expect, test } from "@playwright/test";
import fs from "node:fs";
import ts from "typescript";

test("display audio honors captured scope and releases browser/native resources", async ({
  page,
}) => {
  await page.route("**/capture-policy-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Capture policy fixture</title>",
    }),
  );
  await page.route("**/models/displayAudioWorklet.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fs.readFileSync(
        "apps/web/public/models/displayAudioWorklet.js",
        "utf8",
      ),
    }),
  );
  await page.goto("/capture-policy-fixture");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = ts
    .transpileModule(
      fs.readFileSync("apps/web/src/services/displayCapture.ts", "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(
      "export async function captureDisplay",
      "window.captureDisplay = async function captureDisplay",
    )
    .replace("import.meta.env.BASE_URL", '"/"');
  const isolatedSource = source.replace(
    'import { useToastStore } from "../stores/useToastStore.js";',
    "const useToastStore = {getState: () => ({showToast() {}})};",
  );
  await page.addScriptTag({ content: isolatedSource });
  const results = await page.evaluate(async () => {
    // Actual canvas/video and WebAudio tracks; only the user picker is replaced.
    const runtime = window as unknown as {
      captureDisplay: (options: {
        captureAudio: boolean;
        sourceId?: string;
      }) => Promise<{
        stream: MediaStream;
        cleanup: () => void;
        audioScope: string;
        reason?: string;
      }>;
      electronAPI?: unknown;
    };
    const audio = new AudioContext();
    const fixtureTracks: MediaStreamTrack[] = [];
    const canvases: HTMLCanvasElement[] = [];
    let surface = "window";
    let includeAudio = true;
    let latestHints: DisplayMediaStreamOptions | undefined;
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async (hints: DisplayMediaStreamOptions) => {
        latestHints = hints;
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        canvases.push(canvas);
        const stream = canvas.captureStream(10);
        const video = stream.getVideoTracks()[0];
        Object.defineProperty(video, "getSettings", {
          value: () => ({ displaySurface: surface }),
        });
        if (includeAudio)
          stream.addTrack(
            audio.createMediaStreamDestination().stream.getAudioTracks()[0],
          );
        fixtureTracks.push(...stream.getTracks());
        return stream;
      },
    });
    const cases = [];
    for (const value of ["window", "browser", "monitor"]) {
      surface = value;
      const result = await runtime.captureDisplay({ captureAudio: true });
      cases.push({
        surface: value,
        scope: result.audioScope,
        reason: result.reason,
        audio: result.stream.getAudioTracks().length,
      });
      result.cleanup();
    }
    includeAudio = false;
    const missing = await runtime.captureDisplay({ captureAudio: true });
    cases.push({
      surface: "missing",
      scope: missing.audioScope,
      reason: missing.reason,
      audio: missing.stream.getAudioTracks().length,
    });
    missing.cleanup();
    let stoppedRequest = "";
    let audioChannel: MessageChannel | undefined;
    runtime.electronAPI = {
      prepareDisplayCapture: async () => ({
        grantId: "1".repeat(32),
        audioScope: "application",
      }),
      openDisplayAudioPort: (request: { requestId: string }) => {
        audioChannel = new MessageChannel();
        window.postMessage(
          { type: "tescord-display-audio-port", requestId: request.requestId },
          "*",
          [audioChannel.port1],
        );
        audioChannel.port2.postMessage({
          type: "ready",
          sampleRate: 48000,
          channels: 2,
        });
        audioChannel.port2.postMessage({
          type: "pcm",
          samples: new Float32Array(960).fill(0.01),
        });
      },
      stopDisplayCapture: (requestId: string) => {
        stoppedRequest = requestId;
      },
    };
    const native = await runtime.captureDisplay({
      captureAudio: true,
      sourceId: "window:100:0",
    });
    cases.push({
      surface: "native",
      scope: native.audioScope,
      reason: native.reason,
      audio: native.stream.getAudioTracks().length,
    });
    const nativeHintsAudio = latestHints?.audio;
    const nativeTracks = native.stream.getTracks();
    native.stream.getVideoTracks()[0].dispatchEvent(new Event("ended"));
    native.cleanup();
    audioChannel?.port2.close();
    await audio.close();
    return {
      cases,
      nativeHintsAudio,
      nativeTracksEnded: nativeTracks.every(
        (track) => track.readyState === "ended",
      ),
      browserTracksEnded: fixtureTracks.every(
        (track) => track.readyState === "ended",
      ),
      nativeStopped: /^[a-f0-9]{32}$/.test(stoppedRequest),
    };
  });
  expect(results.cases).toEqual([
    { surface: "window", scope: "none", reason: "unsupported", audio: 0 },
    { surface: "browser", scope: "tab", reason: undefined, audio: 1 },
    { surface: "monitor", scope: "system", reason: undefined, audio: 1 },
    { surface: "missing", scope: "none", reason: "no_audio", audio: 0 },
    { surface: "native", scope: "application", reason: undefined, audio: 1 },
  ]);
  expect(results.nativeHintsAudio).toBe(false);
  expect(results.nativeTracksEnded).toBe(true);
  expect(results.browserTracksEnded).toBe(true);
  expect(results.nativeStopped).toBe(true);
  expect(errors).toEqual([]);
});
