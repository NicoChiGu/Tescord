import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createMultiplayerRoom,
  multiplayerProof,
} from "./helpers/encrypted-multiplayer";

test("real signed DM call: mute retains reception, deafen silences final PCM across repeated toggles", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(120000);
  const diagnostics: unknown[] = [];
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    2,
    "p2p_mesh",
    false,
    async (page, index) => {
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning")
          diagnostics.push({
            index,
            type: message.type(),
            text: message.text(),
          });
      });
    },
  );
  const [caller, callee] = room.endpoints;
  const observations: unknown[] = [];
  try {
    const response = await request.post("/api/users/@me/channels", {
      headers: { Authorization: `Bearer ${caller.session.accessToken}` },
      data: { recipientId: callee.session.user.id },
    });
    expect(response.ok()).toBe(true);
    const channel = (await response.json()) as { id: string };
    for (const endpoint of room.endpoints) {
      await endpoint.page.getByTestId("home-nav-button").click();
      await endpoint.page.getByTestId(`dm-item-${channel.id}`).click();
    }
    await caller.page.getByTestId("dm-start-voice-call-btn").click();
    await callee.page.getByTestId("accept-call-btn").click();
    await room.waitForMedia(room.endpoints);
    await expect(caller.page.getByTestId("dm-active-call-stage")).toBeVisible();
    const initialize = async (page: Page) =>
      page.evaluate(() => {
        const global = window as unknown as {
          voiceMeshManager: {
            sharedAudioContext: AudioContext;
            masterGain: GainNode;
          };
          dmOutputAnalyser?: AnalyserNode;
        };
        global.dmOutputAnalyser =
          global.voiceMeshManager.sharedAudioContext.createAnalyser();
        global.dmOutputAnalyser.fftSize = 4096;
        global.voiceMeshManager.masterGain.connect(global.dmOutputAnalyser);
      });
    await initialize(caller.page);
    const sample = () =>
      caller.page.evaluate(() => {
        const global = window as unknown as {
          dmOutputAnalyser: AnalyserNode;
          voiceMeshManager: { localAudioTrack: MediaStreamTrack | null };
        };
        const values = new Float32Array(global.dmOutputAnalyser.fftSize);
        global.dmOutputAnalyser.getFloatTimeDomainData(values);
        return {
          rms: Math.sqrt(
            values.reduce((sum, value) => sum + value * value, 0) /
              values.length,
          ),
          microphoneEnabled: global.voiceMeshManager.localAudioTrack?.enabled,
        };
      });
    await expect.poll(async () => (await sample()).rms).toBeGreaterThan(0.001);
    observations.push({
      phase: "connected",
      output: await sample(),
      proof: await multiplayerProof(caller.page, "p2p_mesh"),
    });
    await caller.page.getByTestId("dm-mute-btn").click();
    await expect
      .poll(async () => (await sample()).microphoneEnabled)
      .toBe(false);
    await expect.poll(async () => (await sample()).rms).toBeGreaterThan(0.001);
    observations.push({ phase: "microphone-muted", output: await sample() });
    for (let iteration = 0; iteration < 3; iteration++) {
      await caller.page.getByTestId("dm-deafen-btn").click();
      await expect.poll(async () => (await sample()).rms).toBeLessThan(1e-5);
      expect((await sample()).microphoneEnabled).toBe(false);
      observations.push({
        phase: "deafened",
        iteration,
        output: await sample(),
        proof: await multiplayerProof(caller.page, "p2p_mesh"),
      });
      await caller.page.getByTestId("dm-deafen-btn").click();
      await expect
        .poll(async () => (await sample()).rms)
        .toBeGreaterThan(0.001);
      expect((await sample()).microphoneEnabled).toBe(false);
    }
    await caller.page.getByTestId("dm-deafen-btn").click();
    await expect.poll(async () => (await sample()).rms).toBeLessThan(1e-5);
    await caller.page.getByTestId("dm-disconnect-call-btn").click();
    await expect(caller.page.getByTestId("dm-active-call-stage")).toHaveCount(
      0,
    );
    await expect(callee.page.getByTestId("dm-active-call-stage")).toHaveCount(
      0,
    );
    await caller.page.getByTestId("dm-start-voice-call-btn").click();
    await callee.page.getByTestId("accept-call-btn").click();
    await expect
      .poll(
        async () => {
          const proof = await multiplayerProof(caller.page, "p2p_mesh");
          return proof.peers.some(
            (peer) =>
              peer.connected &&
              peer.received > 0 &&
              peer.decrypted > 0 &&
              peer.rms > 0.001 &&
              peer.pair &&
              peer.codec.toLowerCase() === "audio/opus",
          );
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await initialize(caller.page);
    await expect.poll(async () => (await sample()).rms).toBeLessThan(1e-5);
    expect((await sample()).microphoneEnabled).toBe(false);
    observations.push({
      phase: "rejoined-while-deafened",
      output: await sample(),
      proof: await multiplayerProof(caller.page, "p2p_mesh"),
    });
    await caller.page.getByTestId("dm-deafen-btn").click();
    await expect.poll(async () => (await sample()).rms).toBeGreaterThan(0.001);
    expect((await sample()).microphoneEnabled).toBe(false);
    await caller.page.getByTestId("dm-mute-btn").click();
    await expect
      .poll(async () => (await sample()).microphoneEnabled)
      .toBe(true);
    await room.waitForMedia(room.endpoints);
    await caller.page.getByTestId("dm-disconnect-call-btn").click();
    await expect(caller.page.getByTestId("dm-active-call-stage")).toHaveCount(
      0,
    );
    await expect
      .poll(() =>
        caller.page.evaluate(
          () =>
            (
              window as unknown as {
                voiceMeshManager: { sharedAudioContext: AudioContext | null };
              }
            ).voiceMeshManager.sharedAudioContext,
        ),
      )
      .toBeNull();
    expect(room.errors).toEqual([]);
  } finally {
    await mkdir(resolve("test-results/audio-output-validation"), {
      recursive: true,
    });
    await writeFile(
      resolve("test-results/audio-output-validation/dm-pcm.json"),
      JSON.stringify({ observations, diagnostics }, null, 2),
    );
    await info.attach("dm-output-pcm.json", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
    await room.cleanup();
  }
});
