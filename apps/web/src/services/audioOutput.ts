import {
  clampVolume,
  type AudioOutputState,
  type AudioDeviceSelectionResult,
} from "@tescord/types";
import { useSettingsStore } from "../stores/useSettingsStore.js";

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type SinkElement = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

interface OutputBinding {
  context: AudioContext;
  gain: GainNode;
  deafenable: boolean;
  masterVolume: boolean;
  ready: boolean;
  destination?: MediaStreamAudioDestinationNode;
  element?: SinkElement;
}

export class AudioOutputController {
  private bindings = new Set<OutputBinding>();
  private listeners = new Set<(state: AudioOutputState) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private deafened = false;
  private mutedParticipants = new Set<string>();
  private streamVolumes = new Map<string, number>();
  private deviceId: string;
  private recovering = false;
  private attemptRecovery = () => {
    if (this.recovering || document.visibilityState !== "visible") return;
    const contexts = new Set(
      [...this.bindings]
        .filter(
          (binding) =>
            !binding.ready ||
            binding.context.state === "suspended" ||
            binding.element?.paused,
        )
        .map((binding) => binding.context),
    );
    if (!contexts.size) return;
    this.recovering = true;
    void Promise.allSettled(
      [...contexts].map((context) => this.resumeContext(context)),
    ).finally(() => {
      this.recovering = false;
    });
  };

  constructor() {
    const settings = useSettingsStore.getState();
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("tescord_stream_volumes") || "{}",
      );
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        for (const [identity, volume] of Object.entries(saved))
          if (typeof volume === "number" && Number.isFinite(volume))
            this.streamVolumes.set(identity, clampVolume(volume));
    } catch (error) {
      console.warn("Stream volume preference load failed", error);
    }
    const legacyVolume = localStorage.getItem("tescord_master_volume");
    if (
      !localStorage.getItem("tescord_user_settings") &&
      legacyVolume !== null &&
      Number.isFinite(Number(legacyVolume))
    )
      settings.setOutputVolume(clampVolume(Number(legacyVolume)));
    this.deviceId =
      settings.audio.outputDeviceId ||
      localStorage.getItem("tescord_selected_audio_output_id") ||
      "default";
    if (!this.supportsDeviceSelection() && this.deviceId !== "default") {
      this.deviceId = "default";
      localStorage.setItem("tescord_selected_audio_output_id", "default");
      settings.setAudioConfig({ outputDeviceId: "default" });
    }
    useSettingsStore.subscribe((state, previous) => {
      if (state.outputVolume !== previous.outputVolume) {
        try {
          localStorage.setItem(
            "tescord_master_volume",
            String(clampVolume(state.outputVolume)),
          );
        } catch (error) {
          console.warn("Audio output preference persistence failed", error);
        }
      }
      const selected = state.audio.outputDeviceId || "default";
      if (
        state.audio.outputDeviceId !== previous.audio.outputDeviceId &&
        selected !== this.deviceId
      ) {
        void this.switchDevice(selected);
      }
      this.refresh();
    });
  }

  getState(): AudioOutputState {
    return {
      deviceId: this.deviceId,
      volume: clampVolume(useSettingsStore.getState().outputVolume),
      deafened: this.deafened,
    };
  }

  supportsDeviceSelection(): boolean {
    return (
      typeof (AudioContext.prototype as SinkContext).setSinkId === "function" ||
      typeof (HTMLMediaElement.prototype as SinkElement).setSinkId ===
        "function"
    );
  }

  subscribe(listener: (state: AudioOutputState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setDeafened(value: boolean): void {
    this.deafened = value;
    this.refresh();
  }

  setParticipantMuted(identity: string, muted: boolean): void {
    if (muted) this.mutedParticipants.add(identity);
    else this.mutedParticipants.delete(identity);
    this.refresh();
  }

  isParticipantMuted(identity: string): boolean {
    return this.mutedParticipants.has(identity);
  }

  getStreamVolume(identity: string): number {
    return this.streamVolumes.get(identity) ?? 100;
  }

  setStreamVolume(identity: string, volume: number): void {
    this.streamVolumes.set(identity, clampVolume(volume));
    try {
      localStorage.setItem(
        "tescord_stream_volumes",
        JSON.stringify(Object.fromEntries(this.streamVolumes)),
      );
    } catch (error) {
      console.warn("Stream volume preference persistence failed", error);
    }
    this.refresh();
  }

  resumeContext(context: AudioContext): Promise<void> {
    return this.enqueue(async () => {
      await context.resume();
      for (const binding of this.bindings) {
        if (binding.context !== context) continue;
        await this.applySink(binding, this.deviceId);
        if (binding.element) await binding.element.play();
        binding.ready = true;
      }
      this.refresh();
    });
  }

  refresh(): void {
    const state = this.getState();
    for (const binding of this.bindings) {
      if (binding.context.state === "closed") continue;
      const value =
        !binding.ready || (binding.deafenable && state.deafened)
          ? 0
          : binding.masterVolume
            ? state.volume / 100
            : 1;
      binding.gain.gain.setValueAtTime(value, binding.context.currentTime);
    }
    for (const listener of this.listeners) listener(state);
  }

  register(
    context: AudioContext,
    gain: GainNode,
    options: { deafenable?: boolean; masterVolume?: boolean } = {},
  ): { ready: Promise<void>; dispose: () => void } {
    const binding: OutputBinding = {
      context,
      gain,
      ready: false,
      deafenable: options.deafenable ?? true,
      masterVolume: options.masterVolume ?? true,
    };
    gain.gain.setValueAtTime(0, context.currentTime);
    if (
      typeof (context as SinkContext).setSinkId === "function" ||
      !this.supportsDeviceSelection()
    ) {
      gain.connect(context.destination);
    } else {
      binding.destination = context.createMediaStreamDestination();
      gain.connect(binding.destination);
      binding.element = document.createElement("audio") as SinkElement;
      binding.element.srcObject = binding.destination.stream;
      binding.element.autoplay = true;
      binding.element.dataset.audioOutput = "processed";
      binding.element.style.display = "none";
      document.body.append(binding.element);
    }
    if (!this.bindings.size) {
      window.addEventListener("pointerdown", this.attemptRecovery);
      window.addEventListener("keydown", this.attemptRecovery);
      document.addEventListener("visibilitychange", this.attemptRecovery);
    }
    this.bindings.add(binding);
    const ready = this.enqueue(async () => {
      if (!this.bindings.has(binding)) return;
      try {
        await this.applySink(binding, this.deviceId);
      } catch (error) {
        if (
          this.deviceId === "default" ||
          !(error instanceof DOMException) ||
          error.name !== "NotFoundError"
        )
          throw error;
        const recovery = await this.switchDeviceNow("default");
        if (!recovery.success) throw error;
      }
      if (!this.bindings.has(binding)) return;
      if (binding.element) await binding.element.play();
      binding.ready = true;
      this.refresh();
    });
    return {
      ready,
      dispose: () => {
        this.bindings.delete(binding);
        if (!this.bindings.size) {
          window.removeEventListener("pointerdown", this.attemptRecovery);
          window.removeEventListener("keydown", this.attemptRecovery);
          document.removeEventListener(
            "visibilitychange",
            this.attemptRecovery,
          );
        }
        gain.disconnect();
        if (binding.element) {
          binding.element.pause();
          binding.element.srcObject = null;
          binding.element.remove();
        }
        binding.destination?.stream
          .getTracks()
          .forEach((track) => track.stop());
      },
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async applySink(
    binding: OutputBinding,
    deviceId: string,
  ): Promise<void> {
    if (!this.bindings.has(binding) || binding.context.state === "closed")
      return;
    const sinkId = deviceId === "default" ? "" : deviceId;
    if (binding.element?.setSinkId) await binding.element.setSinkId(sinkId);
    else if ((binding.context as SinkContext).setSinkId)
      await (binding.context as SinkContext).setSinkId!(sinkId);
    else if (sinkId) throw new Error("AUDIO_DEVICE_UNSUPPORTED");
  }

  switchDevice(deviceId: string): Promise<AudioDeviceSelectionResult> {
    return this.enqueue(() => this.switchDeviceNow(deviceId));
  }

  private async switchDeviceNow(
    deviceId: string,
  ): Promise<AudioDeviceSelectionResult> {
    const previous = this.deviceId;
    if (deviceId !== "default" && !this.supportsDeviceSelection())
      return {
        success: false,
        deviceId: previous,
        code: "AUDIO_DEVICE_UNSUPPORTED",
      };
    let probe: { context: AudioContext; binding: OutputBinding } | undefined;
    const affected: { binding: OutputBinding; ready: boolean }[] = [];
    try {
      // Validate even when no call or sound context exists yet.
      if (!this.bindings.size) {
        const context = new AudioContext();
        const binding: OutputBinding = {
          context,
          gain: context.createGain(),
          ready: false,
          deafenable: false,
          masterVolume: false,
        };
        if (!(context as SinkContext).setSinkId)
          binding.element = document.createElement("audio") as SinkElement;
        probe = { context, binding };
        this.bindings.add(binding);
      }
      for (const binding of this.bindings) {
        affected.push({ binding, ready: binding.ready });
        await this.applySink(binding, deviceId);
        if (binding !== probe?.binding) {
          if (binding.element && !binding.ready) await binding.element.play();
          binding.ready = true;
        }
      }
      this.deviceId = deviceId;
      localStorage.setItem("tescord_selected_audio_output_id", deviceId);
      useSettingsStore.getState().setAudioConfig({ outputDeviceId: deviceId });
      this.refresh();
      return { success: true, deviceId };
    } catch {
      this.deviceId = previous;
      for (const { binding, ready } of affected) {
        try {
          await this.applySink(binding, previous);
          binding.ready = ready;
        } catch {
          binding.ready = false;
        }
      }
      if (useSettingsStore.getState().audio.outputDeviceId !== previous) {
        useSettingsStore
          .getState()
          .setAudioConfig({ outputDeviceId: previous });
      }
      this.refresh();
      return {
        success: false,
        deviceId: previous,
        code: "AUDIO_DEVICE_SWITCH_FAILED",
      };
    } finally {
      if (probe) {
        this.bindings.delete(probe.binding);
        await probe.context.close().catch(() => undefined);
      }
    }
  }
}

export const audioOutput = new AudioOutputController();
