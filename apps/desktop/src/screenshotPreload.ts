import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("screenshotAPI", {
  onInit: (
    callback: (data: {
      imageSrc: string;
      i18n: Record<string, string>;
      bounds: { width: number; height: number; scaleFactor: number };
    }) => void,
  ) => {
    ipcRenderer.once("screenshot-init", (_event, data) => callback(data));
  },
  copyImage: (dataUrl: string) => {
    ipcRenderer.send("screenshot-copy", dataUrl);
  },
  sendImage: (dataUrl: string) => {
    ipcRenderer.send("screenshot-send", dataUrl);
  },
  saveImage: (dataUrl: string) => {
    ipcRenderer.send("screenshot-save", dataUrl);
  },
  cancel: () => {
    ipcRenderer.send("screenshot-cancel");
  },
});
