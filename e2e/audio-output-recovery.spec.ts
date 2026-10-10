import { test, expect } from "@playwright/test";
import { buildAudioOutputHarness } from "./helpers/audio-output-harness";
import type { AudioOutputController } from "../apps/web/src/services/audioOutput";

for (const name of ["NotFoundError", "NotAllowedError"] as const) {
  test(`initial output ${name} preserves device permission boundaries`, async ({
    page,
  }) => {
    const harness = await buildAudioOutputHarness();
    await page.route("**/audio-output-recovery", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<html><body><button>Start</button></body></html>",
      }),
    );
    await page.addInitScript((errorName) => {
      localStorage.setItem(
        "tescord_selected_audio_output_id",
        "vanished-output",
      );
      navigator.mediaDevices.enumerateDevices = async () =>
        [
          { deviceId: "default", kind: "audiooutput", groupId: "", label: "" },
        ] as MediaDeviceInfo[];
      Object.defineProperty(AudioContext.prototype, "setSinkId", {
        configurable: true,
        value: async function (id: string) {
          if (id === "vanished-output")
            throw new DOMException("Output unavailable", errorName);
          Object.defineProperty(this, "sinkId", {
            configurable: true,
            value: id,
          });
        },
      });
    }, name);
    await page.goto("/audio-output-recovery");
    await page.addScriptTag({ content: harness });
    await page.getByRole("button", { name: "Start" }).click();
    const result = await page.evaluate(async () => {
      const output = (
        window as unknown as {
          audioOutputTest: { audioOutput: AudioOutputController };
        }
      ).audioOutputTest.audioOutput;
      const context = new AudioContext(),
        master = context.createGain();
      await context.resume();
      const binding = output.register(context, master);
      let ready = true;
      try {
        await binding.ready;
      } catch {
        ready = false;
      }
      const state = output.getState();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const gain = master.gain.value;
      binding.dispose();
      await context.close();
      return {
        ready,
        state,
        gain,
        saved: localStorage.getItem("tescord_selected_audio_output_id"),
      };
    });
    const recovered = name === "NotFoundError";
    expect(result.ready).toBe(recovered);
    expect(result.state.deviceId).toBe(
      recovered ? "default" : "vanished-output",
    );
    expect(result.saved).toBe(recovered ? "default" : "vanished-output");
    expect(result.gain).toBe(recovered ? 1 : 0);
  });
}
