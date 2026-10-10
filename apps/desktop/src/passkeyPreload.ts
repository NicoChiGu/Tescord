import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronPasskeyBridge", {
  sendResult: (result: unknown) => {
    ipcRenderer.send("passkey-auth-result", result);
  },
  cancel: () => {
    ipcRenderer.send("passkey-auth-cancel");
  },
});
