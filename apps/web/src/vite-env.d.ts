/// <reference types="vite/client" />

interface ElectronAPI {
  platform: string;
  getDesktopSources: () => Promise<import("@tescord/types").DesktopSource[]>;
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
  syncLocale?: (locale: import("@tescord/types").SupportedLocale) => void;
  onGlobalMuteToggle: (callback: () => void) => () => void;
  onGlobalPTTDown: (callback: () => void) => () => void;
  onGlobalPTTUp: (callback: () => void) => () => void;
  setPTTKeybind: (key: string) => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximizedChange: (
    callback: (isMaximized: boolean) => void,
  ) => () => void;
  getGPUInfo?: () => Promise<{
    isIntel: boolean;
    isNvidia: boolean;
    isAmd: boolean;
    gpuInfo?: any;
    featureStatus?: any;
    error?: string;
  }>;
  network?: {
    detectLocalNetwork: () => Promise<{
      ipv4List: string[];
      ipv6List: string[];
      hasPublicIPv6: boolean;
      defaultIPv4?: string;
      defaultIPv6?: string;
    }>;
    mapPort: (
      port: number,
      protocol?: "UDP" | "TCP",
    ) => Promise<{
      success: boolean;
      externalIP?: string;
      mappedPort?: number;
      protocol?: string;
      error?: string;
    }>;
    unmapPort: (port: number, protocol?: "UDP" | "TCP") => Promise<boolean>;
  };
  getDetectedGame?: () => Promise<import("@tescord/types").Activity | null>;
  setGameDetectionEnabled?: (enabled: boolean) => Promise<boolean>;
  getGameDetectionEnabled?: () => Promise<boolean>;
  onGameActivityChanged?: (
    callback: (activity: import("@tescord/types").Activity | null) => void,
  ) => () => void;
  updater?: {
    getConfig: () => Promise<import("@tescord/types").UpdaterConfig>;
    checkForUpdates: () => Promise<import("@tescord/types").UpdateCheckResult>;
    downloadAndApply: () => Promise<{ success: boolean; newVersion: string; error?: string }>;
    restartToApply: () => Promise<void>;
    setCustomProxy: (proxyUrl: string) => Promise<boolean>;
    onProgress: (
      callback: (progress: import("@tescord/types").UpdateProgress) => void,
    ) => () => void;
    onUpdateReady: (callback: (data: { version: string }) => void) => () => void;
  };
}

interface Window {
  electronAPI?: ElectronAPI;
}

