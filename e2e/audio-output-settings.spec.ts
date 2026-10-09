import { test, expect, type Page } from "@playwright/test";
import { installEncryptedVoiceUi } from "./helpers/encrypted-voice-ui";

async function openSettings(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
    .first()
    .click();
  await page.getByTestId("user-settings-gear-btn").click();
  await expect(page.getByTestId("audio-output-device")).toBeVisible();
}

test("output device routing commits after success, rolls back failure, follows unplug and persists", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const scope = window as unknown as {
      sinks: string[];
      outputs: string[];
      audioPermission: PermissionStatus;
    };
    scope.sinks = [];
    scope.outputs = ["speaker-a", "speaker-b", "denied"];
    scope.audioPermission = Object.assign(new EventTarget(), {
      state: "granted",
    }) as PermissionStatus;
    navigator.permissions.query = async () => scope.audioPermission;
    Object.defineProperty(AudioContext.prototype, "setSinkId", {
      configurable: true,
      value: async function (id: string) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (id === "denied")
          throw new DOMException("Denied", "NotAllowedError");
        scope.sinks.push(id);
        Object.defineProperty(this, "sinkId", {
          configurable: true,
          value: id,
        });
      },
    });
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        {
          deviceId: "default",
          kind: "audioinput",
          groupId: "mic",
          label: "System microphone",
        },
        ...scope.outputs.map((id) => ({
          deviceId: id,
          kind: "audiooutput",
          groupId: id,
          label:
            id === "denied"
              ? "Denied output"
              : id === "permitted-speaker"
                ? "Permission output"
                : id === "speaker-a"
                  ? "USB headset"
                  : "Monitor speakers",
        })),
      ] as MediaDeviceInfo[];
  });
  await openSettings(page);
  const output = page.getByTestId("audio-output-device");
  await expect(output).toContainText("默认系统扬声器");
  await output.click();
  await page.getByRole("option", { name: "USB headset" }).click();
  await expect(output).toContainText("USB headset");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_output_id"),
    ),
  ).toBe("speaker-a");
  await page.evaluate(() => {
    const scope = window as unknown as {
      outputs: string[];
      audioPermission: PermissionStatus;
    };
    scope.outputs.push("permitted-speaker");
    scope.audioPermission.dispatchEvent(new Event("change"));
  });
  await output.click();
  await expect(
    page.getByRole("option", { name: "Permission output" }),
  ).toBeVisible();
  await output.click();
  await output.click();
  await page.getByRole("option", { name: "Denied output" }).click();
  await expect(
    page.getByText("无法切换输出设备，请检查设备和权限。"),
  ).toBeVisible();
  await expect(output).toContainText("USB headset");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_output_id"),
    ),
  ).toBe("speaker-a");
  const selections = await page.evaluate(async () => {
    const service = (
      window as unknown as {
        __livekitService: {
          switchAudioOutputDevice: (id: string) => Promise<boolean>;
        };
      }
    ).__livekitService;
    return Promise.all([
      service.switchAudioOutputDevice("speaker-a"),
      service.switchAudioOutputDevice("speaker-b"),
    ]);
  });
  expect(selections).toEqual([true, true]);
  await expect(output).toContainText("Monitor speakers");
  await page.reload();
  await page
    .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
    .first()
    .click();
  await page.getByTestId("user-settings-gear-btn").click();
  await expect(output).toContainText("Monitor speakers");
  await page.evaluate(() => {
    (window as unknown as { outputs: string[] }).outputs = [
      "speaker-a",
      "denied",
    ];
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect(output).toContainText("默认系统扬声器");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_output_id"),
    ),
  ).toBe("default");
  expect(
    await page.evaluate(() => (window as unknown as { sinks: string[] }).sinks),
  ).toContain("");
  expect(errors).toEqual([]);
});

test("actual P2P output obeys sidebar deafen and settings volume without unmuting microphone", async ({
  page,
}) => {
  await installEncryptedVoiceUi(page);
  await page.goto("/");
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
  ).toBeVisible();
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
      "audio-output-peer",
      destination.stream,
    );
    const analyser = scope.voiceMeshManager.sharedAudioContext.createAnalyser();
    scope.voiceMeshManager.masterGain.connect(analyser);
    scope.sampleOutput = () => {
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      return Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0) / values.length,
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
  await page.getByTestId("user-settings-gear-btn").click();
  const volume = page.getByTestId("audio-output-volume");
  await volume.focus();
  await volume.press("End");
  await expect.poll(sample).toBeLessThan(1e-5);
  await volume.focus();
  await volume.press("Home");
  await page.getByTestId("close-user-settings-btn").click();
  await page.getByTestId("user-bar-deafen-btn").click();
  await expect.poll(sample).toBeLessThan(1e-5);
  await page.getByTestId("user-settings-gear-btn").click();
  await volume.evaluate((element) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "100");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(sample).toBeGreaterThan(0.001);
  await page.getByTestId("close-user-settings-btn").click();
  await expect(page.getByTestId("user-bar-mic-btn")).toHaveClass(
    /text-discord-danger/,
  );
  await expect.poll(localTrackEnabled).toBe(false);
  await page.evaluate(() =>
    (window as unknown as { stopOutput: () => void }).stopOutput(),
  );
});

test("settings test tone uses the chosen sink, responds to volume and releases its context", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      toneContext?: AudioContext & { sinkId: string; gains: GainNode[] };
    };
    const createOscillator = AudioContext.prototype.createOscillator;
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createOscillator = function () {
      scope.toneContext = this as AudioContext & {
        sinkId: string;
        gains: GainNode[];
      };
      return createOscillator.call(this);
    };
    AudioContext.prototype.createGain = function () {
      const gain = createGain.call(this);
      const context = this as AudioContext & { gains: GainNode[] };
      (context.gains ||= []).push(gain);
      return gain;
    };
    Object.defineProperty(AudioContext.prototype, "setSinkId", {
      configurable: true,
      value: async function (id: string) {
        Object.defineProperty(this, "sinkId", {
          configurable: true,
          value: id,
        });
      },
    });
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        {
          deviceId: "default",
          kind: "audioinput",
          label: "System microphone",
          groupId: "mic",
        },
        {
          deviceId: "test-speaker",
          kind: "audiooutput",
          label: "Test speaker",
          groupId: "speaker",
        },
      ] as MediaDeviceInfo[];
  });
  await openSettings(page);
  await page.getByTestId("audio-output-device").click();
  await page.getByRole("option", { name: "Test speaker" }).click();
  await page.getByRole("button", { name: "试听声音", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { toneContext?: { sinkId: string } })
            .toneContext?.sinkId,
      ),
    )
    .toBe("test-speaker");
  const volume = page.getByTestId("audio-output-volume");
  await volume.focus();
  await volume.press("End");
  const gain = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { toneContext: { gains: GainNode[] } }
        ).toneContext.gains.at(-1)?.gain.value,
    );
  await expect.poll(gain).toBe(2);
  await volume.press("Home");
  await expect.poll(gain).toBe(0);
  await page.getByRole("button", { name: "响铃中...", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { toneContext: AudioContext }).toneContext
            .state,
      ),
    )
    .toBe("closed");
  await page.getByRole("button", { name: "试听声音", exact: true }).click();
  await page.getByTestId("close-user-settings-btn").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { toneContext: AudioContext }).toneContext
            .state,
      ),
    )
    .toBe("closed");
});

test("microphone selection follows capture settings and retains the old input on denial", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        {
          deviceId: "default",
          kind: "audioinput",
          label: "System microphone",
          groupId: "default",
        },
        {
          deviceId: "requested-mic",
          kind: "audioinput",
          label: "USB microphone",
          groupId: "usb",
        },
        {
          deviceId: "actual-mic",
          kind: "audioinput",
          label: "Actual USB microphone",
          groupId: "usb",
        },
        {
          deviceId: "denied-mic",
          kind: "audioinput",
          label: "Denied microphone",
          groupId: "bad",
        },
      ] as MediaDeviceInfo[];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const audio = constraints?.audio;
      const selected =
        typeof audio === "object" &&
        typeof audio.deviceId === "object" &&
        "exact" in audio.deviceId
          ? audio.deviceId.exact
          : "default";
      if (selected === "denied-mic")
        throw new DOMException("Denied", "NotAllowedError");
      const stream = await getUserMedia({
        ...constraints,
        audio:
          typeof audio === "object" ? { ...audio, deviceId: undefined } : audio,
      });
      for (const track of stream.getAudioTracks()) {
        const settings = track.getSettings.bind(track);
        track.getSettings = () => ({
          ...settings(),
          deviceId: selected === "default" ? "default" : "actual-mic",
        });
      }
      return stream;
    };
  });
  await openSettings(page);
  const input = page.getByTestId("audio-input-device");
  await input.click();
  await page
    .getByRole("option", { name: "USB microphone", exact: true })
    .click();
  await expect(input).toContainText("Actual USB microphone");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_input_id"),
    ),
  ).toBe("actual-mic");
  await input.click();
  await page.getByRole("option", { name: "Denied microphone" }).click();
  await expect(
    page.getByText("无法切换麦克风，请检查设备和权限。"),
  ).toBeVisible();
  await expect(input).toContainText("Actual USB microphone");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_input_id"),
    ),
  ).toBe("actual-mic");
});

test("unsupported browsers cannot report a successful output selection", async ({
  page,
}) => {
  await page.route("**/api/users/@me/settings", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 200, json: {} })
      : route.continue(),
  );
  await page.addInitScript(() => {
    localStorage.removeItem("tescord_user_settings");
    localStorage.setItem("tescord_master_volume", "135");
    localStorage.setItem("tescord_user_volumes", '{"legacy-user":175}');
    localStorage.setItem("tescord_selected_audio_output_id", "old-speaker");
    Object.defineProperty(AudioContext.prototype, "setSinkId", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: undefined,
    });
  });
  await openSettings(page);
  await expect(page.getByTestId("audio-output-device")).toBeDisabled();
  await expect(page.getByTestId("audio-output-device")).toContainText(
    "默认系统扬声器",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_output_id"),
    ),
  ).toBe("default");
  await expect(page.getByTestId("audio-output-volume")).toHaveValue("135");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            useSettingsStore: {
              getState: () => { userVolumes: Record<string, number> };
            };
          }
        ).useSettingsStore.getState().userVolumes["legacy-user"],
    ),
  ).toBe(175);
});
