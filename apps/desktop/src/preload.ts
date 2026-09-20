import { contextBridge, ipcRenderer } from "electron";
import { DesktopNotificationPayload, UserStatus } from "@tescord/types";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  // 屏幕与窗口采集
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),

  // 原生系统通知
  showNotification: (payload: DesktopNotificationPayload) =>
    ipcRenderer.invoke("show-desktop-notification", payload),
  onNotificationClick: (
    callback: (data: { channelId?: string; guildId?: string }) => void,
  ) => {
    const handler = (
      _e: any,
      data: { channelId?: string; guildId?: string },
    ) => callback(data);
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

  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window-maximize"),
  closeWindow: () => ipcRenderer.invoke("window-close"),
});
