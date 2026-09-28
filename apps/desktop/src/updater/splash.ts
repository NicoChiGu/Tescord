import { BrowserWindow } from "electron";
import path from "node:path";

export interface SplashStatusOptions {
  text?: string;
  percent?: number;
  showProgress?: boolean;
  hideSpinner?: boolean;
  version?: string;
}

export class SplashWindow {
  private win: BrowserWindow | null = null;

  constructor() {
    this.createWindow();
  }

  private createWindow(): void {
    this.win = new BrowserWindow({
      width: 320,
      height: 380,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      center: true,
      show: false,
      backgroundColor: "#1e1f22",
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "splashPreload.js"),
      },
    });

    this.win.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const htmlPath = path.join(__dirname, "splash.html");
    this.win.loadFile(htmlPath);

    this.win.once("ready-to-show", () => {
      if (this.win && !this.win.isDestroyed()) {
        this.win.show();
      }
    });

    this.win.on("closed", () => {
      this.win = null;
    });
  }

  public updateStatus(options: SplashStatusOptions): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send("splash-status", options);
    }
  }

  public close(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
      this.win = null;
    }
  }

  public isDestroyed(): boolean {
    return !this.win || this.win.isDestroyed();
  }
}
