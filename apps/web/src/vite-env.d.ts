/// <reference types="vite/client" />

interface ElectronAPI {
  platform: string;
  getDesktopSources: () => Promise<
    Array<{
      id: string;
      name: string;
      thumbnail: string;
      type: "screen" | "window";
      appIcon?: string;
    }>
  >;
  showNotification: (payload: {
    title: string;
    body: string;
    channelId?: string;
    guildId?: string;
    icon?: string;
    silent?: boolean;
  }) => Promise<boolean>;
  onNotificationClick: (
    callback: (data: { channelId?: string; guildId?: string }) => void,
  ) => () => void;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  onStatusChangeFromTray: (
    callback: (status: import("@tescord/types").UserStatus) => void,
  ) => () => void;
  syncUserStatus: (status: import("@tescord/types").UserStatus) => void;
  onGlobalMuteToggle: (callback: () => void) => () => void;
  onGlobalPTTDown: (callback: () => void) => () => void;
  onGlobalPTTUp: (callback: () => void) => () => void;
  setPTTKeybind: (key: string) => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
