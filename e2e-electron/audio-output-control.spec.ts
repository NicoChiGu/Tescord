import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { buildAudioOutputHarness } from "../e2e/helpers/audio-output-harness";
import { installEncryptedVoiceUi } from "../e2e/helpers/encrypted-voice-ui";

test("Electron file renderer: actual deafen button gates P2P output and encrypted received PCM gains", async ({}, testInfo) => {
  test.setTimeout(150000);
  const desktopRoot = resolve("apps/desktop");
  const require = createRequire(resolve(desktopRoot, "package.json"));
  await mkdir(testInfo.outputPath("user-data"), { recursive: true });
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [
      desktopRoot,
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env: {
      ...process.env,
      TESCORD_E2E_USER_DATA_DIR: testInfo.outputPath("user-data"),
      TESCORD_E2E_FORCE_FILE: "true",
      TESCORD_E2E_SKIP_SINGLE_INSTANCE: "true",
      NODE_ENV: "development",
    },
    timeout: 45000,
  });
  try {
    await installEncryptedVoiceUi(app.context());
    const auth = await app.firstWindow();
    await expect(auth.getByTestId("auth-email-input")).toBeVisible({
      timeout: 30000,
    });
    await auth.getByTestId("auth-email-input").fill("admin@tescord.local");
    await auth.getByTestId("auth-submit-btn").click();
    await auth.getByTestId("auth-password-input").fill("adminpassword123");
    const nextWindow = app.waitForEvent("window", {
      predicate: (candidate) => candidate !== auth,
    });
    await auth.getByTestId("auth-submit-btn").click();
    const page = await nextWindow;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("current-user-panel-btn")).toBeVisible({
      timeout: 20000,
    });
    expect(page.url()).toMatch(/^file:\/\//);
    await page.getByTestId("whats-new-got-it-btn").click();
    await page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first()
      .click();
    await page
      .locator('button[data-testid^="channel-button-"][title]')
      .first()
      .dblclick();
    await expect(
      page.getByRole("button", { name: "断开连接" }).first(),
    ).toBeVisible({ timeout: 15000 });
    const localTrackEnabled = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              voiceMeshManager: { localAudioTrack: MediaStreamTrack | null };
            }
          ).voiceMeshManager.localAudioTrack?.enabled,
      );
    await expect.poll(localTrackEnabled).toBe(true);
    await page.evaluate(async () => {
      const scope = window as unknown as {
        voiceMeshManager: {
          attachRemoteAudio: (id: string, stream: MediaStream) => void;
          sharedAudioContext: AudioContext;
          masterGain: GainNode;
        };
        sampleOutput: () => number;
        stopOutput: () => void;
      };
      const context = new AudioContext(),
        oscillator = context.createOscillator(),
        gain = context.createGain(),
        destination = context.createMediaStreamDestination();
      gain.gain.value = 0.02;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await context.resume();
      scope.voiceMeshManager.attachRemoteAudio(
        "electron-output-peer",
        destination.stream,
      );
      const analyser =
        scope.voiceMeshManager.sharedAudioContext.createAnalyser();
      scope.voiceMeshManager.masterGain.connect(analyser);
      scope.sampleOutput = () => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        return Math.sqrt(
          data.reduce((sum, value) => sum + value * value, 0) / data.length,
        );
      };
      scope.stopOutput = () => {
        oscillator.stop();
        analyser.disconnect();
        void context.close();
      };
    });
    const sample = () =>
      page.evaluate(() =>
        (window as unknown as { sampleOutput: () => number }).sampleOutput(),
      );
    await expect.poll(sample).toBeGreaterThan(0.001);
    await page.getByTestId("user-bar-mic-btn").click();
    await expect.poll(localTrackEnabled).toBe(false);
    await expect.poll(sample).toBeGreaterThan(0.001);
    await page.getByTestId("user-bar-mic-btn").click();
    await expect.poll(localTrackEnabled).toBe(true);
    await page.getByTestId("user-bar-deafen-btn").click();
    await expect.poll(sample).toBeLessThan(1e-5);
    await expect.poll(localTrackEnabled).toBe(false);
    await page.getByTestId("user-bar-deafen-btn").click();
    await expect.poll(sample).toBeGreaterThan(0.001);
    await expect.poll(localTrackEnabled).toBe(false);
    await expect(page.getByTestId("user-bar-mic-btn")).toHaveClass(
      /text-discord-danger/,
    );
    await page.evaluate(() =>
      (window as unknown as { stopOutput: () => void }).stopOutput(),
    );
    await page.getByRole("button", { name: "断开连接" }).first().click();
    await page.addScriptTag({ content: await buildAudioOutputHarness() });
    const results = [];
    for (const mode of [
      "mesh",
      "livekit",
      "livekit-screen",
      "cloudflare",
      "screen",
    ]) {
      const result = await page.evaluate(
        (mode) =>
          (
            window as unknown as {
              runAudioOutputAcceptance: (mode: string) => Promise<{
                volumes: Record<string, { output: number }>;
                deaf: { output: number };
                sdkResume?: {
                  decoderMuted: boolean;
                  attachedElements: number;
                  resumed: boolean;
                  output: number;
                };
                late: number;
                lateRoute: number;
                restored: { output: number };
                crypto: { receive: { framesDecrypted: number } };
                microphoneMuted: { output: number; independent: number };
                microphoneRestored: { independent: number };
                participantMuted: { output: number; independent: number };
                participantRestored: { output: number };
                rtp: {
                  bytesSent: number;
                  bytesReceived: number;
                  codec: string;
                  selectedPair: { id: string; state: string };
                };
              }>;
            }
          ).runAudioOutputAcceptance(mode),
        mode,
      );
      expect(result.volumes["100"].output).toBeGreaterThan(0.001);
      expect(
        result.volumes["200"].output / result.volumes["100"].output,
      ).toBeGreaterThan(1.8);
      expect(
        result.volumes["200"].output / result.volumes["100"].output,
      ).toBeLessThan(2.2);
      expect(result.deaf.output).toBeLessThan(1e-5);
      if (mode.startsWith("livekit")) {
        expect(result.sdkResume?.decoderMuted).toBe(true);
        expect(result.sdkResume?.attachedElements).toBe(0);
        expect(result.sdkResume?.resumed).toBe(true);
        expect(result.sdkResume?.output).toBeLessThan(1e-5);
      }
      expect(result.late).toBeLessThan(1e-5);
      expect(result.lateRoute).toBeLessThan(1e-5);
      expect(result.restored.output).toBeGreaterThan(0.001);
      expect(result.crypto.receive.framesDecrypted).toBeGreaterThan(0);
      expect(result.microphoneMuted.independent).toBeLessThan(1e-5);
      expect(result.microphoneMuted.output).toBeGreaterThan(0.001);
      expect(result.microphoneRestored.independent).toBeGreaterThan(0.001);
      expect(result.participantMuted.output).toBeLessThan(1e-5);
      expect(result.participantMuted.independent).toBeGreaterThan(0.001);
      expect(result.participantRestored.output).toBeGreaterThan(0.001);
      expect(result.rtp.bytesSent).toBeGreaterThan(1000);
      expect(result.rtp.bytesReceived).toBeGreaterThan(1000);
      expect(result.rtp.codec.toLowerCase()).toContain("opus");
      expect(result.rtp.selectedPair.id).toBeTruthy();
      expect(result.rtp.selectedPair.state).toBe("succeeded");
      results.push({ mode, ...result });
    }
    await testInfo.attach("electron-output-pcm.json", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
    await mkdir(resolve("test-results/audio-output-validation"), {
      recursive: true,
    });
    await writeFile(
      resolve("test-results/audio-output-validation/electron-pcm.json"),
      JSON.stringify(results, null, 2),
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
