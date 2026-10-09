export type AudioDeviceEntry = Pick<
  MediaDeviceInfo,
  "deviceId" | "kind" | "label" | "groupId"
>;
export interface AudioDeviceList {
  inputs: AudioDeviceEntry[];
  outputs: AudioDeviceEntry[];
  cameras: MediaDeviceInfo[];
}

export function audioDeviceLabel(
  device: AudioDeviceEntry,
  defaultLabel: string,
  unnamedLabel: string,
): string {
  if (device.deviceId === "default")
    return device.label ? `${defaultLabel} (${device.label})` : defaultLabel;
  return device.label || unnamedLabel;
}

class AudioDeviceRegistry {
  private devices: AudioDeviceList = { inputs: [], outputs: [], cameras: [] };
  private listeners = new Set<
    (devices: AudioDeviceList, hotplug: boolean) => void
  >();
  private pending: Promise<void> | undefined;
  private revision = 0;

  constructor() {
    navigator.mediaDevices?.addEventListener("devicechange", () => {
      void this.refresh(true);
    });
    if (navigator.permissions) {
      for (const name of ["microphone", "camera"]) {
        void navigator.permissions
          .query({ name: name as PermissionName })
          .then((permission) => {
            permission.addEventListener("change", () => {
              void this.refresh();
            });
          })
          .catch(() => undefined);
      }
    }
  }

  subscribe(
    listener: (devices: AudioDeviceList, hotplug: boolean) => void,
  ): () => void {
    this.listeners.add(listener);
    listener(this.devices, false);
    void this.refresh();
    return () => {
      this.listeners.delete(listener);
    };
  }

  refresh(hotplug = false): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve();
    if (this.pending && !hotplug) return this.pending;
    const revision = ++this.revision;
    const pending = navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (revision !== this.revision) return;
        const withDefault = (kind: MediaDeviceKind): AudioDeviceEntry[] => {
          const entries = devices.filter((device) => device.kind === kind);
          return entries.some((device) => device.deviceId === "default")
            ? entries
            : [
                { deviceId: "default", kind, label: "", groupId: "" },
                ...entries,
              ];
        };
        this.devices = {
          inputs: withDefault("audioinput"),
          outputs: withDefault("audiooutput"),
          cameras: devices.filter((device) => device.kind === "videoinput"),
        };
        for (const listener of this.listeners) listener(this.devices, hotplug);
      })
      .catch((error) => {
        console.warn("Audio device enumeration failed", error);
      })
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
    this.pending = pending;
    return pending;
  }
}

export const audioDevices = new AudioDeviceRegistry();
