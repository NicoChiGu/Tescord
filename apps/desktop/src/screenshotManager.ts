import {
  BrowserWindow,
  screen,
  desktopCapturer,
  clipboard,
  nativeImage,
  dialog,
  ipcMain,
} from "electron";
import path from "path";
import fs from "fs";
import { SupportedLocale } from "@tescord/types";
import { getScreenshotLocale } from "./locales.js";

export class ScreenshotManager {
  private captureWindow: BrowserWindow | null = null;
  private isCapturing = false;
  private wasMainVisible = false;

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private getCurrentLocale: () => SupportedLocale,
  ) {}

  public async startCapture(
    onSendToChat?: (dataUrl: string) => void,
  ): Promise<void> {
    if (this.isCapturing) {
      if (this.captureWindow && !this.captureWindow.isDestroyed()) {
        try {
          this.captureWindow.focus();
        } catch {}
      }
      return;
    }

    this.isCapturing = true;
    const mainWin = this.getMainWindow();
    this.wasMainVisible = Boolean(
      mainWin && !mainWin.isDestroyed() && mainWin.isVisible(),
    );

    // 1. 隐藏主窗口避让背景，杜绝截取到应用自身
    if (this.wasMainVisible && mainWin && !mainWin.isDestroyed()) {
      try {
        mainWin.hide();
      } catch {}
    }

    // 等待操作系统 DWM 刷新
    await new Promise((resolve) => setTimeout(resolve, 80));

    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      const scaleFactor = primaryDisplay.scaleFactor || 1;
      const captureWidth = Math.round(width * scaleFactor);
      const captureHeight = Math.round(height * scaleFactor);

      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: captureWidth, height: captureHeight },
      });

      const primarySource =
        sources.find((s) => s.display_id === primaryDisplay.id.toString()) ||
        sources[0];

      if (!primarySource) {
        this.restoreMainWindow();
        this.isCapturing = false;
        return;
      }

      const imageSrc = primarySource.thumbnail.toDataURL();

      // 2. 创建全屏置顶无边框透明截图窗口
      const win = new BrowserWindow({
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        enableLargerThanScreen: true,
        hasShadow: false,
        show: false,
        backgroundColor: "#00000000",
        webPreferences: {
          preload: path.join(__dirname, "screenshotPreload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      this.captureWindow = win;
      win.setAlwaysOnTop(true, "screen-saver");

      let resolved = false;
      const closeCapture = () => {
        if (resolved) return;
        resolved = true;
        ipcMain.removeListener("screenshot-copy", onCopy);
        ipcMain.removeListener("screenshot-send", onSend);
        ipcMain.removeListener("screenshot-save", onSave);
        ipcMain.removeListener("screenshot-cancel", onCancel);

        if (win && !win.isDestroyed()) {
          try {
            win.close();
          } catch {}
        }
        this.captureWindow = null;
        this.isCapturing = false;
        this.restoreMainWindow();
      };

      const onCopy = (_e: Electron.IpcMainEvent, dataUrl: string) => {
        if (_e.sender.id !== win.webContents.id) return;
        try {
          if (dataUrl) {
            const img = nativeImage.createFromDataURL(dataUrl);
            clipboard.writeImage(img);
          }
        } catch {}
        closeCapture();
      };

      const onSend = (_e: Electron.IpcMainEvent, dataUrl: string) => {
        if (_e.sender.id !== win.webContents.id) return;
        try {
          if (dataUrl) {
            const img = nativeImage.createFromDataURL(dataUrl);
            clipboard.writeImage(img);
            onSendToChat?.(dataUrl);
          }
        } catch {}
        closeCapture();
      };

      const onSave = async (_e: Electron.IpcMainEvent, dataUrl: string) => {
        if (_e.sender.id !== win.webContents.id) return;
        try {
          if (dataUrl) {
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
              defaultPath: `tescord-screenshot-${Date.now()}.png`,
              filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
            });
            if (!canceled && filePath) {
              const base64Data = dataUrl.replace(
                /^data:image\/\w+;base64,/,
                "",
              );
              await fs.promises.writeFile(
                filePath,
                Buffer.from(base64Data, "base64"),
              );
            }
          }
        } catch {}
        closeCapture();
      };

      const onCancel = (_e: Electron.IpcMainEvent) => {
        if (_e.sender.id !== win.webContents.id) return;
        closeCapture();
      };

      ipcMain.on("screenshot-copy", onCopy);
      ipcMain.on("screenshot-send", onSend);
      ipcMain.on("screenshot-save", onSave);
      ipcMain.on("screenshot-cancel", onCancel);

      win.on("closed", () => {
        closeCapture();
      });

      win.once("ready-to-show", () => {
        if (resolved) return;
        win.show();
        win.focus();
        const locale = this.getCurrentLocale();
        const i18n = getScreenshotLocale(locale);
        win.webContents.send("screenshot-init", {
          imageSrc,
          i18n,
          bounds: {
            width: primaryDisplay.bounds.width,
            height: primaryDisplay.bounds.height,
            scaleFactor,
          },
        });
      });

      let htmlPath = path.join(__dirname, "screenshot", "screenshot.html");
      if (!fs.existsSync(htmlPath)) {
        htmlPath = path.join(__dirname, "../src/screenshot/screenshot.html");
      }
      win.loadFile(htmlPath).catch(() => {
        closeCapture();
      });
    } catch {
      this.restoreMainWindow();
      this.isCapturing = false;
    }
  }

  private restoreMainWindow(): void {
    const mainWin = this.getMainWindow();
    if (this.wasMainVisible && mainWin && !mainWin.isDestroyed()) {
      try {
        if (mainWin.isMinimized()) mainWin.restore();
        mainWin.show();
        mainWin.focus();
      } catch {}
    }
  }
}
