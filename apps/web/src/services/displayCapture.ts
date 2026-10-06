import type {
  DesktopCaptureAudioMessage,
  DisplayCaptureResult,
  DesktopDisplayCaptureGrant,
} from "@tescord/types";
import { useToastStore } from "../stores/useToastStore.js";

export interface DisplayCaptureOptions {
  sourceId?: string;
  captureAudio: boolean;
  video?: MediaTrackConstraints;
  onAudioUnavailable?: (
    reason: NonNullable<DisplayCaptureResult["reason"]>,
  ) => void;
}
export interface CapturedDisplay extends DisplayCaptureResult {
  stream: MediaStream;
  cleanup: () => void;
}
export async function captureDisplay(
  options: DisplayCaptureOptions,
): Promise<CapturedDisplay> {
  const api = window.electronAPI;
  let grant: DesktopDisplayCaptureGrant | undefined;
  if (api) {
    if (!api.prepareDisplayCapture || !options.sourceId)
      throw new Error("Display capture selection required");
    grant = await api.prepareDisplayCapture({
      sourceId: options.sourceId,
      captureAudio: options.captureAudio,
    });
  }
  const hints = {
    video: options.video ?? true,
    audio: !api && options.captureAudio,
    systemAudio: "include",
    windowAudio: "window",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
  } as DisplayMediaStreamOptions;
  let stream: MediaStream;
  let videoOnlyFallback = false;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(hints);
  } catch (error) {
    if (
      api ||
      !options.captureAudio ||
      !(error instanceof DOMException) ||
      !["NotReadableError", "TrackStartError", "OverconstrainedError"].includes(
        error.name,
      )
    )
      throw error;
    stream = await navigator.mediaDevices.getDisplayMedia({
      ...hints,
      audio: false,
    });
    videoOnlyFallback = true;
  }
  if (api || !options.captureAudio) {
    // Electron audio is authorized and supplied exclusively through its native grant.
    stream.getAudioTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
  }
  let context: AudioContext | undefined;
  let worklet: AudioWorkletNode | undefined;
  let port: MessagePort | undefined;
  let cancelAudioStartup: (() => void) | undefined;
  let stopped = false;
  let audioResult: DisplayCaptureResult = { audioScope: "none" };
  const requestId = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const stopAudio = () => {
    cancelAudioStartup?.();
    cancelAudioStartup = undefined;
    api?.stopDisplayCapture?.(requestId);
    port?.close();
    port = undefined;
    worklet?.disconnect();
    worklet?.port.close();
    worklet = undefined;
    if (context) {
      void context.close().catch(() => undefined);
      context = undefined;
    }
    stream.getAudioTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });
  };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    stopAudio();
    stream.getTracks().forEach((track) => track.stop());
  };
  stream
    .getVideoTracks()
    .forEach((track) =>
      track.addEventListener("ended", cleanup, { once: true }),
    );
  try {
    if (grant) {
      audioResult = { audioScope: grant.audioScope, reason: grant.reason };
      if (grant.audioScope !== "none" && options.captureAudio) {
        context = new AudioContext({ sampleRate: 48000 });
        const base = new URL(
          import.meta.env.BASE_URL || "./",
          window.location.href,
        );
        await context.audioWorklet.addModule(
          new URL("models/displayAudioWorklet.js", base),
        );
        worklet = new AudioWorkletNode(context, "tescord-display-audio", {
          numberOfInputs: 0,
          outputChannelCount: [2],
        });
        const destination = context.createMediaStreamDestination();
        worklet.connect(destination);
        await context.resume();
        await new Promise<void>((resolve, reject) => {
          let completed = false;
          const timeout = window.setTimeout(
            () => finish(new Error("Native audio activation timed out")),
            7000,
          );
          const finish = (error?: Error) => {
            if (completed) return;
            completed = true;
            cancelAudioStartup = undefined;
            clearTimeout(timeout);
            window.removeEventListener("message", listener);
            if (error) reject(error);
            else resolve();
          };
          cancelAudioStartup = () =>
            finish(new Error("Display capture cancelled"));
          const listener = (event: MessageEvent) => {
            if (
              event.source !== window ||
              event.data?.type !== "tescord-display-audio-port" ||
              event.data.requestId !== requestId ||
              !event.ports[0]
            )
              return;
            port = event.ports[0];
            port.onmessage = (
              message: MessageEvent<DesktopCaptureAudioMessage>,
            ) => {
              const data = message.data;
              if (data.type === "ready") finish();
              else if (data.type === "pcm")
                worklet?.port.postMessage(data.samples, [data.samples.buffer]);
              else if (data.type === "error" || data.type === "ended") {
                if (completed && !stopped) {
                  if (options.onAudioUnavailable)
                    options.onAudioUnavailable("capture_failed");
                  else
                    useToastStore
                      .getState()
                      .showToast(
                        { key: "voice:capture.capture_failed" },
                        "error",
                      );
                }
                finish(new Error("Native audio capture stopped"));
                stopAudio();
              }
            };
            port.start();
          };
          window.addEventListener("message", listener);
          api!.openDisplayAudioPort!({ grantId: grant!.grantId, requestId });
        });
        if (stopped) throw new Error("Display capture cancelled");
        destination.stream
          .getAudioTracks()
          .forEach((track) => stream.addTrack(track));
      }
    } else if (options.captureAudio) {
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
      if (videoOnlyFallback)
        audioResult = { audioScope: "none", reason: "capture_failed" };
      else if (!stream.getAudioTracks().length)
        audioResult = { audioScope: "none", reason: "no_audio" };
      else if (surface === "browser") audioResult = { audioScope: "tab" };
      else if (surface === "monitor") audioResult = { audioScope: "system" };
      else {
        // Browser hints do not prove window isolation. Reject ambiguous system audio.
        stopAudio();
        audioResult = { audioScope: "none", reason: "unsupported" };
      }
    }
  } catch {
    stopAudio();
    audioResult = { audioScope: "none", reason: "capture_failed" };
  }
  if (stopped) throw new Error("Display capture cancelled");
  return { stream, cleanup, ...audioResult };
}
