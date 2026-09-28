import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("splashApi", {
  onStatus: (
    callback: (options: {
      text?: string;
      percent?: number;
      showProgress?: boolean;
      hideSpinner?: boolean;
      version?: string;
    }) => void,
  ) => {
    ipcRenderer.on("splash-status", (_event, options) => callback(options));
  },
});
