import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopNotificationPayload,
  UserStatus,
  DesktopWindowMode,
  DesktopAuthSuccessPayload,
  DesktopAudioInferenceStart,
  DesktopAudioInferenceStop,
  SavedAccount,
  Message,
  ChannelMetaRecord,
  StorageSearchMessagesQuery,
} from "@tescord/types";

// The sandboxed preload can require Electron only. Keep IPC literals checked
// against the shared protocol type without loading the ESM/CJS package here.
const STORAGE_IPC_CHANNELS = {
  PREF_GET: "storage:pref-get",
  PREF_SET: "storage:pref-set",
  PREF_REMOVE: "storage:pref-remove",
  ACCOUNTS_GET: "storage:accounts-get",
  ACCOUNTS_SAVE: "storage:accounts-save",
  TOKENS_GET: "storage:tokens-get",
  TOKENS_SET: "storage:tokens-set",
  TOKENS_CLEAR: "storage:tokens-clear",
  USER_SWITCH: "storage:user-switch",
  MESSAGES_SAVE_BATCH: "storage:messages-save-batch",
  MESSAGE_SAVE_SINGLE: "storage:message-save-single",
  MESSAGES_GET_LATEST: "storage:messages-get-latest",
  CHANNEL_SNAPSHOT_GET: "storage:channel-snapshot-get",
  MESSAGE_DELETE: "storage:message-delete",
  CHANNEL_META_SAVE: "storage:channel-meta-save",
  CHANNEL_META_GET: "storage:channel-meta-get",
  CHANNEL_CLEAR: "storage:channel-clear",
  MESSAGES_CLEAR_ALL: "storage:messages-clear-all",
  MESSAGES_SEARCH_FTS: "storage:messages-search-fts",
  STATS_GET: "storage:stats-get",
} satisfies typeof import("@tescord/types").STORAGE_IPC_CHANNELS;

ipcRenderer.on("audio-inference-exit", (_event, data) => {
  if (typeof data?.requestId === "string")
    window.postMessage({ type: "tescord-audio-inference-exit", ...data }, "*");
});
ipcRenderer.on("audio-inference-error", (_event, data) => {
  if (typeof data?.requestId === "string" && typeof data?.reason === "string")
    window.postMessage({ type: "tescord-audio-inference-error", ...data }, "*");
});

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  openAudioInferencePort: (
    mode: DesktopAudioInferenceStart["mode"],
    requestId: string,
  ): void => {
    if (
      (mode !== "rnnoise" && mode !== "dtln" && mode !== "dfn3") ||
      typeof requestId !== "string" ||
      requestId.length > 80
    )
      return;
    const channel = new MessageChannel();
    const request: DesktopAudioInferenceStart = { mode, requestId };
    ipcRenderer.postMessage("audio-inference-start", request, [channel.port2]);
    window.postMessage(
      { type: "tescord-audio-inference-port", requestId },
      "*",
      [channel.port1],
    );
  },
  closeAudioInferencePort: (requestId: string): void => {
    if (typeof requestId !== "string" || !/^[a-f0-9]{32}$/.test(requestId))
      return;
    const request: DesktopAudioInferenceStop = { requestId };
    ipcRenderer.send("audio-inference-stop", request);
  },

  // 认证与双窗口状态联动
  notifyAuthSuccess: (payload?: DesktopAuthSuccessPayload) =>
    ipcRenderer.invoke("auth-success", payload),
  notifyLogout: () => ipcRenderer.invoke("auth-logout"),
  getWindowType: () => ipcRenderer.invoke("window-get-type"),

  // 屏幕与窗口采集
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),

  // 原生系统通知
  showNotification: (payload: DesktopNotificationPayload) =>
    ipcRenderer.invoke("show-desktop-notification", payload),
  onNotificationClick: (
    callback: (data: { channelId?: string; guildId?: string }) => void,
  ) => {
    const handler = (_e: any, data: { channelId?: string; guildId?: string }) =>
      callback(data);
    ipcRenderer.on("desktop-notification-clicked", handler);
    return () => {
      ipcRenderer.removeListener("desktop-notification-clicked", handler);
    };
  },

  // 开机自启动
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enabled: boolean) =>
    ipcRenderer.invoke("set-auto-launch", enabled),

  // 系统托盘与状态同步
  onStatusChangeFromTray: (callback: (status: UserStatus) => void) => {
    const handler = (_e: any, status: UserStatus) => callback(status);
    ipcRenderer.on("tray-status-change", handler);
    return () => {
      ipcRenderer.removeListener("tray-status-change", handler);
    };
  },
  syncUserStatus: (status: UserStatus) =>
    ipcRenderer.send("sync-user-status", status),
  syncLocale: (locale: any) => ipcRenderer.send("sync-locale", locale),

  // 全局热键与静音
  onGlobalMuteToggle: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("toggle-global-mute", handler);
    return () => {
      ipcRenderer.removeListener("toggle-global-mute", handler);
    };
  },
  onGlobalPTTDown: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("global-ptt-down", handler);
    return () => {
      ipcRenderer.removeListener("global-ptt-down", handler);
    };
  },
  onGlobalPTTUp: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("global-ptt-up", handler);
    return () => {
      ipcRenderer.removeListener("global-ptt-up", handler);
    };
  },
  setPTTKeybind: (key: string) => ipcRenderer.invoke("set-ptt-keybind", key),

  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
  isWindowMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowMaximizedChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_e: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on("window-maximized-change", handler);
    return () => {
      ipcRenderer.removeListener("window-maximized-change", handler);
    };
  },
  setWindowMode: (mode: DesktopWindowMode) =>
    ipcRenderer.invoke("window-set-mode", mode),
  getWindowMode: () => ipcRenderer.invoke("window-get-mode"),
  onWindowModeChange: (callback: (mode: DesktopWindowMode) => void) => {
    const handler = (_e: any, mode: DesktopWindowMode) => callback(mode);
    ipcRenderer.on("window-mode-changed", handler);
    return () => {
      ipcRenderer.removeListener("window-mode-changed", handler);
    };
  },

  // 显卡与硬件加速能力探测
  getGPUInfo: () => ipcRenderer.invoke("get-gpu-info"),

  // 原生网络穿透与 UPnP 自动打洞
  network: {
    detectLocalNetwork: () =>
      ipcRenderer.invoke("desktop-detect-local-network"),
    mapPort: (port: number, protocol?: "UDP" | "TCP") =>
      ipcRenderer.invoke("desktop-upnp-map-port", port, protocol),
    unmapPort: (port: number, protocol?: "UDP" | "TCP") =>
      ipcRenderer.invoke("desktop-upnp-unmap-port", port, protocol),
  },

  // 游戏状态侦测
  getDetectedGame: () => ipcRenderer.invoke("get-detected-game"),
  setGameDetectionEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("set-game-detection-enabled", enabled),
  getGameDetectionEnabled: () =>
    ipcRenderer.invoke("get-game-detection-enabled"),
  onGameActivityChanged: (callback: (activity: any) => void) => {
    const handler = (_e: any, activity: any) => callback(activity);
    ipcRenderer.on("game-activity-changed", handler);
    return () => {
      ipcRenderer.removeListener("game-activity-changed", handler);
    };
  },

  // 客户端自动更新服务 (基于 gh-proxy 阶梯加速与双轨增量热更新)
  updater: {
    getConfig: () => ipcRenderer.invoke("updater-get-config"),
    checkForUpdates: () => ipcRenderer.invoke("updater-check"),
    downloadAndApply: () => ipcRenderer.invoke("updater-download-apply"),
    restartToApply: () => ipcRenderer.invoke("updater-restart"),
    setCustomProxy: (proxyUrl: string) =>
      ipcRenderer.invoke("updater-set-proxy", proxyUrl),
    onProgress: (callback: (progress: any) => void) => {
      const handler = (_e: any, progress: any) => callback(progress);
      ipcRenderer.on("updater-progress", handler);
      return () => {
        ipcRenderer.removeListener("updater-progress", handler);
      };
    },
    onUpdateReady: (callback: (data: { version: string }) => void) => {
      const handler = (_e: any, data: { version: string }) => callback(data);
      ipcRenderer.on("updater-update-ready", handler);
      return () => {
        ipcRenderer.removeListener("updater-update-ready", handler);
      };
    },
  },

  // 本地 SQLite 统一离线存储服务 (包含 safeStorage 凭据加密与 FTS5 全文搜索)
  storage: {
    getPreference: (key: string) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.PREF_GET, key),
    setPreference: (key: string, value: any) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.PREF_SET, { key, value }),
    removePreference: (key: string) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.PREF_REMOVE, key),

    getSavedAccounts: () =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.ACCOUNTS_GET),
    saveSavedAccounts: (accounts: SavedAccount[]) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.ACCOUNTS_SAVE, accounts),
    getActiveTokens: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.TOKENS_GET),
    setActiveTokens: (
      tokens: { accessToken: string; refreshToken: string; user: any },
      remember: boolean,
    ) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.TOKENS_SET, { tokens, remember }),
    clearActiveTokens: () =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.TOKENS_CLEAR),

    switchUser: (userId: string | null) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.USER_SWITCH, userId),

    saveMessages: (channelId: string, messages: Message[]) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.MESSAGES_SAVE_BATCH, {
        channelId,
        messages,
      }),
    saveMessage: (message: Message) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.MESSAGE_SAVE_SINGLE, message),
    getLatestMessages: (channelId: string, limit?: number) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.MESSAGES_GET_LATEST, {
        channelId,
        limit,
      }),
    getChannelSnapshot: (channelId: string, limit?: number) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CHANNEL_SNAPSHOT_GET, {
        channelId,
        limit,
      }),
    deleteMessage: (messageId: string) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.MESSAGE_DELETE, messageId),
    saveChannelMeta: (channelId: string, meta: Partial<ChannelMetaRecord>) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CHANNEL_META_SAVE, {
        channelId,
        meta,
      }),
    getChannelMeta: (channelId: string) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CHANNEL_META_GET, channelId),
    clearChannel: (channelId: string) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CHANNEL_CLEAR, channelId),
    clearAllMessages: () =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.MESSAGES_CLEAR_ALL),

    searchMessages: (query: StorageSearchMessagesQuery) =>
      ipcRenderer.invoke(STORAGE_IPC_CHANNELS.MESSAGES_SEARCH_FTS, query),
    getStorageStats: () => ipcRenderer.invoke(STORAGE_IPC_CHANNELS.STATS_GET),
  },
});
