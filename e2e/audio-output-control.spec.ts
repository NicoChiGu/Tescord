import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { buildAudioOutputHarness } from "./helpers/audio-output-harness";

let harness: string;
test.beforeAll(async () => {
  harness = await buildAudioOutputHarness();
});

test("user mute remains active when the rendered user menu volume is raised", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/audio-output-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body></body></html>",
    }),
  );
  await page.goto("/audio-output-fixture");
  await page.addScriptTag({ content: harness });
  await page.evaluate(() =>
    (
      window as unknown as { mountAudioOutputUserMenu: () => Promise<void> }
    ).mountAudioOutputUserMenu(),
  );
  const target = page.locator("#audio-target-menu");
  await target.click({ button: "right" });
  await page.getByRole("menuitem", { name: "静音成员", exact: true }).click();
  await target.click({ button: "right" });
  const slider = page.getByRole("slider");
  await slider.focus();
  await slider.press("End");
  await expect(slider).toHaveValue("200");
  const muted = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          audioOutputTest: {
            audioOutput: { isParticipantMuted: (id: string) => boolean };
          };
        }
      ).audioOutputTest.audioOutput.isParticipantMuted("target"),
    );
  expect(await muted()).toBe(true);
  await page.getByRole("menuitem", { name: "取消静音", exact: true }).click();
  expect(await muted()).toBe(false);
  expect(errors).toEqual([]);
});

for (const mode of [
  "mesh",
  "mesh-fallback",
  "livekit",
  "livekit-screen",
  "cloudflare",
  "screen",
]) {
  test(`encrypted RTP ${mode}: final PCM gain, master volume, deafen and late track`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/audio-output-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<html><body></body></html>",
      }),
    );
    await page.goto("/audio-output-fixture");
    await page.addScriptTag({ content: harness });
    const result = await page.evaluate(async (mode) => {
      return (
        window as unknown as {
          runAudioOutputAcceptance: (mode: string) => Promise<{
            volumes: Record<string, { output: number; independent: number }>;
            masterHalf: { output: number };
            participantMuted: { output: number; independent: number };
            participantRestored: { output: number };
            zero: { output: number };
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
            microphoneMuted: { output: number; independent: number };
            microphoneRestored: { independent: number };
            rtp: {
              bytesSent: number;
              bytesReceived: number;
              codec: string;
              candidate: string;
              selectedPair: { id: string; state: string };
            };
            crypto: {
              send: { framesEncrypted: number };
              receive: { framesDecrypted: number };
            };
          }>;
        }
      ).runAudioOutputAcceptance(mode);
    }, mode);
    await mkdir(resolve("test-results/audio-output-validation"), {
      recursive: true,
    });
    await writeFile(
      resolve(
        `test-results/audio-output-validation/${process.env.TESCORD_E2E_BROWSER_CHANNEL ? `${process.env.TESCORD_E2E_BROWSER_CHANNEL}-` : ""}${mode}-pcm.json`,
      ),
      JSON.stringify(
        {
          browser: testInfo.project.use.channel || "chromium",
          version: browser.version(),
          ...result,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("output-pcm-and-rtp.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    const baseline = result.volumes["100"].output;
    expect(baseline).toBeGreaterThan(0.001);
    expect(result.volumes["50"].output / baseline).toBeGreaterThan(0.45);
    expect(result.volumes["50"].output / baseline).toBeLessThan(0.55);
    expect(result.volumes["200"].output / baseline).toBeGreaterThan(1.8);
    expect(result.volumes["200"].output / baseline).toBeLessThan(2.2);
    expect(result.masterHalf.output / baseline).toBeGreaterThan(0.9);
    expect(result.masterHalf.output / baseline).toBeLessThan(1.1);
    expect(result.zero.output).toBeLessThan(1e-5);
    expect(result.participantMuted.output).toBeLessThan(1e-5);
    expect(result.participantMuted.independent).toBeGreaterThan(0.001);
    expect(result.participantRestored.output).toBeGreaterThan(0.001);
    expect(result.deaf.output).toBeLessThan(1e-5);
    if (mode.startsWith("livekit")) {
      expect(result.sdkResume?.decoderMuted).toBe(true);
      expect(result.sdkResume?.attachedElements).toBe(0);
      expect(result.sdkResume?.resumed).toBe(true);
      expect(result.sdkResume?.output).toBeLessThan(1e-5);
    }
    expect(result.late).toBeLessThan(1e-5);
    expect(result.lateRoute).toBeLessThan(1e-5);
    expect(result.restored.output / baseline).toBeGreaterThan(1.8);
    for (const volume of ["50", "200"]) {
      expect(
        result.volumes[volume].independent / result.volumes["100"].independent,
      ).toBeGreaterThan(0.9);
      expect(
        result.volumes[volume].independent / result.volumes["100"].independent,
      ).toBeLessThan(1.1);
    }
    expect(result.microphoneMuted.independent).toBeLessThan(1e-5);
    expect(result.microphoneMuted.output).toBeGreaterThan(0.001);
    expect(result.microphoneRestored.independent).toBeGreaterThan(0.001);
    expect(result.rtp.bytesReceived).toBeGreaterThan(1000);
    expect(result.rtp.bytesSent).toBeGreaterThan(1000);
    expect(result.rtp.selectedPair.id).toBeTruthy();
    expect(result.rtp.selectedPair.state).toBe("succeeded");
    expect(result.rtp.codec.toLowerCase()).toContain("opus");
    expect(result.rtp.candidate).toBeTruthy();
    expect(result.crypto.send.framesEncrypted).toBeGreaterThan(0);
    expect(result.crypto.receive.framesDecrypted).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
