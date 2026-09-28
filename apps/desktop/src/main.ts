import {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  Notification,
  clipboard,
  shell,
  screen,
  IpcMainEvent,
  IpcMainInvokeEvent,
  utilityProcess,
} from "electron";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import http from "http";
import https from "https";
import {
  DesktopNotificationPayload,
  DesktopSource,
  UserStatus,
  SupportedLocale,
  DesktopWindowMode,
  DesktopWindowBounds,
  DesktopAudioInferenceStart,
  DesktopAudioInferenceStop,
  DesktopAudioInferenceFailure,
} from "@tescord/types";
import { detectLocalNetwork, UPnPClient } from "./upnp.js";
import { getDesktopLocale } from "./locales.js";
import { gameDetector } from "./gameDetector.js";
import { UpdateManager } from "./updater/update-manager.js";
import { SplashWindow } from "./updater/splash.js";
import { ProxyManager } from "./updater/proxy-manager.js";
import { BUILD_CONFIG } from "./build-config.js";
import { ToastManager } from "./toastManager.js";
import { StorageManager } from "./storage/storageManager.js";

if (process.env.TESCORD_E2E_USER_DATA_DIR) {
  app.setPath("userData", process.env.TESCORD_E2E_USER_DATA_DIR);
}

let toastManager: ToastManager | null = null;

// 开发环境下忽略自签名证书错误 (配合 Vite basicSsl HTTPS 开发模式)
if (process.env.NODE_ENV !== "production") {
  app.commandLine.appendSwitch("ignore-certificate-errors");
}

// 硬件编解码加速与现代视频编码特性开关 (支持 H.264 / AV1 / H.265 HEVC 平台与 WebRTC 硬编硬解)
app.commandLine.appendSwitch(
  "enable-features",
  [
    "PlatformHEVCDecoderSupport",
    "PlatformHEVCEncoderSupport",
    "WebRtcAllowH265Send",
    "WebRtcAllowH265Receive",
  ].join(","),
);
app.commandLine.appendSwitch(
  "force-fieldtrials",
  "WebRTC-Video-H26xPacketBuffer/Enabled/",
);
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-accelerated-video-encode");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// 1. 单例进程保护 (Single Instance Lock)
const gotTheLock =
  process.env.TESCORD_E2E_SKIP_SINGLE_INSTANCE === "true"
    ? true
    : app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log(
    "⚠️ 检测到已有 Tescord 实例在运行，本进程将直接退出并唤醒前台窗口。",
  );
  app.quit();
  process.exit(0);
}

// Windows 原生应用通知注册 AppUserModelId (解决 Win10/Win11 原生通知无法弹出或不展示应用名的问题)
if (process.platform === "win32") {
  app.setAppUserModelId("com.tescord.desktop");
}

let mainWindow: BrowserWindow | null = null;
const audioProcesses = new Map<
  number,
  Map<string, ReturnType<typeof utilityProcess.fork>>
>();
const DTLN_MODEL_HASHES = [
  "22b91cae3855e5a0620e66a917ca6c82c58db0e842c770f58d86751c5e8d4ae3",
  "e20c92f9233fccf29cddf86970d0d0161a03aebccc26d6f4d5639c4d5ec2e639",
];
const DFN3_MODEL_HASHES: Record<string, string> = {
  "denoiser_model.onnx":
    "b758c49d6708a5b7979e3de185705a8a4915076c862fb17b1b304d9a72b75cdc",
  "meta.json":
    "e3a8fefd13c43747b97471bf889d54608465198a58c2b99006483b1b4bad2962",
  "initial-state-layout.json":
    "53ba88f801e07015dc508ea2c1cc2c461c32ae32f992f5764a32ac46fb3bab1e",
  "initial-states.f32":
    "7664728d90e7b17655cf4d308d46d42fdea6c3a69c374e494164c7cb44d783fc",
};

ipcMain.on("audio-inference-start", (event, request: unknown) => {
  const port = event.ports[0];
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (
    !port ||
    !isTrustedIpcSender(event) ||
    sender !== mainWindow ||
    event.senderFrame !== event.sender.mainFrame ||
    typeof request !== "object" ||
    request === null ||
    !["rnnoise", "dtln", "dfn3"].includes(
      (request as { mode?: string }).mode ?? "",
    ) ||
    !/^[a-f0-9]{32}$/.test((request as { requestId?: string }).requestId ?? "")
  ) {
    port?.close();
    return;
  }
  const parsed = request as DesktopAudioInferenceStart;
  const ownerId = event.sender.id;
  const active = audioProcesses.get(ownerId) ?? new Map();
  const requestId = parsed.requestId;
  if (active.size >= 4 || active.has(requestId)) {
    const failure: DesktopAudioInferenceFailure = {
      requestId,
      reason: active.has(requestId)
        ? "Duplicate audio inference session"
        : "Too many audio inference sessions",
    };
    event.sender.send("audio-inference-error", failure);
    port.close();
    return;
  }
  const webDir = app.isPackaged
    ? path.join(process.resourcesPath, "web", "dist")
    : path.resolve(__dirname, "../../web/dist");
  const mode = parsed.mode;
  const modelDir = path.join(webDir, "models", mode);
  let child: ReturnType<typeof utilityProcess.fork> | null = null;
  try {
    const assets =
      mode === "rnnoise"
        ? {}
        : mode === "dtln"
          ? {
              "model_1.onnx": DTLN_MODEL_HASHES[0],
              "model_2.onnx": DTLN_MODEL_HASHES[1],
            }
          : DFN3_MODEL_HASHES;
    for (const [name, expected] of Object.entries(assets)) {
      const bytes = fs.readFileSync(path.join(modelDir, name));
      if (createHash("sha256").update(bytes).digest("hex") !== expected)
        throw new Error(`${mode} model checksum mismatch: ${name}`);
    }
    child = utilityProcess.fork(
      path.join(__dirname, "audio", "native-inference.mjs"),
      [],
      {
        serviceName: `Tescord ${mode} inference`,
      },
    );
    const launched = child;
    active.set(requestId, launched);
    audioProcesses.set(ownerId, active);
    const onSenderDestroyed = () => launched.kill();
    event.sender.once("destroyed", onSenderDestroyed);
    launched.on("exit", (code) => {
      if (!event.sender.isDestroyed())
        event.sender.removeListener("destroyed", onSenderDestroyed);
      if (active.get(requestId) === launched) active.delete(requestId);
      if (!active.size) audioProcesses.delete(ownerId);
      if (!event.sender.isDestroyed())
        event.sender.send("audio-inference-exit", { requestId, code });
    });
    launched.postMessage({ mode, modelDir }, [port]);
  } catch (error) {
    child?.kill();
    active.delete(requestId);
    if (!active.size) audioProcesses.delete(ownerId);
    console.error(`Failed to start ${mode} inference:`, error);
    const failure: DesktopAudioInferenceFailure = {
      requestId,
      reason: String(error),
    };
    event.sender.send("audio-inference-error", failure);
    port.close();
  }
});
ipcMain.on("audio-inference-stop", (event, request: unknown) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (
    !isTrustedIpcSender(event) ||
    sender !== mainWindow ||
    event.senderFrame !== event.sender.mainFrame ||
    typeof request !== "object" ||
    request === null ||
    !/^[a-f0-9]{32}$/.test((request as { requestId?: string }).requestId ?? "")
  )
    return;
  const { requestId } = request as DesktopAudioInferenceStop;
  const active = audioProcesses.get(event.sender.id);
  const child = active?.get(requestId);
  if (!child) return;
  active!.delete(requestId);
  if (!active!.size) audioProcesses.delete(event.sender.id);
  child.kill();
});
let authWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let isSwitchingToMain = false;
let isSwitchingToAuth = false;
let currentPTTKey: string | null = null;
let currentUserStatus: UserStatus = "ONLINE";

function getDesktopSettingsPath(): string {
  try {
    return path.join(app.getPath("userData"), "desktop-settings.json");
  } catch {
    return "";
  }
}

function loadHasAuthSession(): boolean {
  try {
    const p = getDesktopSettingsPath();
    if (p && fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      return Boolean(data.hasAuthSession);
    }
  } catch {}
  return false;
}

function saveHasAuthSession(hasAuthSession: boolean): void {
  try {
    const p = getDesktopSettingsPath();
    if (p) {
      let existing: any = {};
      if (fs.existsSync(p)) {
        try {
          existing = JSON.parse(fs.readFileSync(p, "utf-8"));
        } catch {}
      }
      fs.writeFileSync(
        p,
        JSON.stringify({ ...existing, hasAuthSession }, null, 2),
        "utf-8",
      );
    }
  } catch (err) {
    console.warn("[Desktop] 保存登录会话状态失败:", err);
  }
}

function loadPersistedLocale(): SupportedLocale {
  try {
    const p = getDesktopSettingsPath();
    if (p && fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (
        data.locale === "zh-CN" ||
        data.locale === "en-US" ||
        data.locale === "ja-JP" ||
        data.locale === "zh-TW" ||
        data.locale === "zh-HK"
      ) {
        return data.locale;
      }
    }
  } catch {}
  return "zh-CN";
}

function savePersistedLocale(locale: SupportedLocale): void {
  try {
    const p = getDesktopSettingsPath();
    if (p) {
      let existing: any = {};
      if (fs.existsSync(p)) {
        try {
          existing = JSON.parse(fs.readFileSync(p, "utf-8"));
        } catch {}
      }
      fs.writeFileSync(
        p,
        JSON.stringify({ ...existing, locale }, null, 2),
        "utf-8",
      );
    }
  } catch {}
}

let currentLocale: SupportedLocale = loadPersistedLocale();

let currentWindowMode: DesktopWindowMode = loadHasAuthSession()
  ? "main"
  : "auth";

function getWindowStatePath(): string {
  try {
    return path.join(app.getPath("userData"), "window-bounds.json");
  } catch {
    return "";
  }
}

function loadPersistedWindowBounds(): DesktopWindowBounds | null {
  try {
    const p = getWindowStatePath();
    if (p && fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (
        data &&
        typeof data.width === "number" &&
        typeof data.height === "number" &&
        data.width >= 600 &&
        data.height >= 500
      ) {
        return data;
      }
    }
  } catch (err) {
    console.warn("[Desktop] 读取本地窗口大小记忆失败:", err);
  }
  return null;
}

function savePersistedWindowBounds(bounds: DesktopWindowBounds | null): void {
  if (!bounds) return;
  try {
    const p = getWindowStatePath();
    if (p) {
      fs.writeFileSync(p, JSON.stringify(bounds), "utf-8");
    }
  } catch (err) {
    console.warn("[Desktop] 持久化保存窗口大小记忆失败:", err);
  }
}

let savedMainBounds: DesktopWindowBounds | null = loadPersistedWindowBounds();
let isSwitchingWindowMode = false;

const AUTH_WINDOW_CONFIG = {
  width: 480,
  height: 680,
};

const MAIN_WINDOW_CONFIG = {
  width: 1280,
  height: 800,
  minWidth: 940,
  minHeight: 500,
};

const isSafeExternalUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const isTrustedIpcSender = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  const isFromMain = Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents,
  );
  const isFromAuth = Boolean(
    authWindow &&
    !authWindow.isDestroyed() &&
    event.sender === authWindow.webContents,
  );
  if (!isFromMain && !isFromAuth) return false;
  try {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) return false;
    const url = new URL(senderUrl);
    return (
      url.protocol === "file:" ||
      ((url.protocol === "https:" || url.protocol === "http:") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
};

function setupWindowHandlers(win: BrowserWindow, _isAuth: boolean) {
  win.webContents.on("context-menu", (_event, params) => {
    const t = getDesktopLocale(currentLocale);
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      menuTemplate.push(
        { role: "undo", label: t.undo },
        { role: "redo", label: t.redo },
        { type: "separator" },
        { role: "cut", label: t.cut, enabled: params.editFlags.canCut },
        { role: "copy", label: t.copy, enabled: params.editFlags.canCopy },
        { role: "paste", label: t.paste, enabled: params.editFlags.canPaste },
        { type: "separator" },
        {
          role: "selectAll",
          label: t.selectAll,
          enabled: params.editFlags.canSelectAll,
        },
      );
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menuTemplate.push(
        { role: "copy", label: t.copy, enabled: params.editFlags.canCopy },
        {
          role: "selectAll",
          label: t.selectAll,
          enabled: params.editFlags.canSelectAll,
        },
      );
    }

    if (params.linkURL) {
      if (menuTemplate.length > 0) menuTemplate.push({ type: "separator" });
      menuTemplate.push(
        {
          label: t.copyLink,
          click: () => clipboard.writeText(params.linkURL),
        },
        {
          label: t.openInBrowser,
          click: () => {
            if (isSafeExternalUrl(params.linkURL))
              void shell.openExternal(params.linkURL);
          },
        },
      );
    }

    if (params.hasImageContents && params.srcURL) {
      if (menuTemplate.length > 0) menuTemplate.push({ type: "separator" });
      menuTemplate.push({
        label: t.copyImageLink,
        click: () => clipboard.writeText(params.srcURL),
      });
    }

    if (menuTemplate.length > 0 && process.env.NODE_ENV !== "production") {
      menuTemplate.push(
        { type: "separator" },
        {
          label: t.inspectElement,
          click: () => {
            if (!win.isDestroyed())
              win.webContents.inspectElement(params.x, params.y);
          },
        },
        {
          role: "reload",
          label: t.reload,
        },
      );
    }

    if (menuTemplate.length > 0 && !win.isDestroyed()) {
      Menu.buildFromTemplate(menuTemplate).popup({ window: win });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = win.webContents.getURL();
    try {
      const target = new URL(targetUrl);
      const current = currentUrl ? new URL(currentUrl) : null;
      if (
        current &&
        target.origin === current.origin &&
        target.protocol === current.protocol
      )
        return;
    } catch {}
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
  });
}

const probe = (url: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, { rejectUnauthorized: false }, (res) => {
      resolve(Boolean(res.statusCode && res.statusCode < 400));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(600, () => {
      req.destroy();
      resolve(false);
    });
  });
};

async function loadWindowContent(
  win: BrowserWindow,
  isAuth: boolean,
  targetEntryPath?: string,
): Promise<void> {
  const devUrls =
    process.env.TESCORD_E2E_FORCE_FILE === "true"
      ? []
      : ([
          process.env.VITE_DEV_SERVER_URL,
          "https://localhost:3000",
          "http://localhost:3000",
        ].filter(Boolean) as string[]);

  const activeEntry = UpdateManager.getInstance().getActiveWebEntry();
  const distPath = targetEntryPath || activeEntry.indexPath;
  const hash = isAuth ? "auth" : "main";
  const search = isAuth ? "window=auth" : "window=main";

  if (app.isPackaged) {
    win.loadFile(distPath, { hash, search });
  } else {
    for (const url of devUrls) {
      if (await probe(url)) {
        if (!win || win.isDestroyed()) return;
        win.loadURL(`${url}/?${search}#${hash}`);
        return;
      }
    }
    if (!win || win.isDestroyed()) return;
    win.loadFile(distPath, { hash, search });
  }
}

function createAuthWindow(targetEntryPath?: string): BrowserWindow {
  if (authWindow && !authWindow.isDestroyed()) {
    return authWindow;
  }

  Menu.setApplicationMenu(null);

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const x = Math.round(
    workArea.x + (workArea.width - AUTH_WINDOW_CONFIG.width) / 2,
  );
  const y = Math.round(
    workArea.y + (workArea.height - AUTH_WINDOW_CONFIG.height) / 2,
  );

  authWindow = new BrowserWindow({
    width: AUTH_WINDOW_CONFIG.width,
    height: AUTH_WINDOW_CONFIG.height,
    x,
    y,
    minWidth: AUTH_WINDOW_CONFIG.width,
    minHeight: AUTH_WINDOW_CONFIG.height,
    maxWidth: AUTH_WINDOW_CONFIG.width,
    maxHeight: AUTH_WINDOW_CONFIG.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#313338",
    title: "Tescord - 登录",
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  setupWindowHandlers(authWindow, true);

  // 登录窗口关闭行为：直接彻底退出应用（对齐 Discord 原生规范）
  authWindow.on("close", () => {
    if (!isQuitting && !isSwitchingToMain) {
      isQuitting = true;
      app.quit();
    }
  });

  authWindow.on("closed", () => {
    authWindow = null;
    updateTrayContextMenu();
  });

  void loadWindowContent(authWindow, true, targetEntryPath);

  return authWindow;
}

function createMainWindow(targetEntryPath?: string): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  Menu.setApplicationMenu(null);

  if (!savedMainBounds) {
    savedMainBounds = loadPersistedWindowBounds();
  }

  const displays = screen.getAllDisplays();
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;

  let targetX: number;
  let targetY: number;
  let targetWidth = MAIN_WINDOW_CONFIG.width;
  let targetHeight = MAIN_WINDOW_CONFIG.height;

  if (
    savedMainBounds &&
    savedMainBounds.width >= 600 &&
    savedMainBounds.height >= 500
  ) {
    targetWidth = Math.max(savedMainBounds.width, MAIN_WINDOW_CONFIG.minWidth);
    targetHeight = Math.max(
      savedMainBounds.height,
      MAIN_WINDOW_CONFIG.minHeight,
    );

    if (
      typeof savedMainBounds.x === "number" &&
      typeof savedMainBounds.y === "number"
    ) {
      const isInAnyDisplay = displays.some((d) => {
        const wa = d.workArea;
        return (
          savedMainBounds!.x! >= wa.x - 100 &&
          savedMainBounds!.x! < wa.x + wa.width &&
          savedMainBounds!.y! >= wa.y - 100 &&
          savedMainBounds!.y! < wa.y + wa.height
        );
      });

      if (isInAnyDisplay) {
        targetX = savedMainBounds.x;
        targetY = savedMainBounds.y;
      } else {
        targetX = Math.round(
          primaryWorkArea.x + (primaryWorkArea.width - targetWidth) / 2,
        );
        targetY = Math.round(
          primaryWorkArea.y + (primaryWorkArea.height - targetHeight) / 2,
        );
      }
    } else {
      targetX = Math.round(
        primaryWorkArea.x + (primaryWorkArea.width - targetWidth) / 2,
      );
      targetY = Math.round(
        primaryWorkArea.y + (primaryWorkArea.height - targetHeight) / 2,
      );
    }
  } else {
    targetWidth = Math.min(MAIN_WINDOW_CONFIG.width, primaryWorkArea.width);
    targetHeight = Math.min(MAIN_WINDOW_CONFIG.height, primaryWorkArea.height);
    targetX = Math.round(
      primaryWorkArea.x + (primaryWorkArea.width - targetWidth) / 2,
    );
    targetY = Math.round(
      primaryWorkArea.y + (primaryWorkArea.height - targetHeight) / 2,
    );
  }

  mainWindow = new BrowserWindow({
    width: targetWidth,
    height: targetHeight,
    x: targetX,
    y: targetY,
    minWidth: MAIN_WINDOW_CONFIG.minWidth,
    minHeight: MAIN_WINDOW_CONFIG.minHeight,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false,
    backgroundColor: "#313338",
    title: "Tescord 客户端",
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  setupWindowHandlers(mainWindow, false);

  mainWindow.on("maximize", () => {
    if (savedMainBounds) {
      savedMainBounds.isMaximized = true;
      savePersistedWindowBounds(savedMainBounds);
    }
    mainWindow?.webContents.send("window-maximized-change", true);
  });

  mainWindow.on("unmaximize", () => {
    if (savedMainBounds) {
      savedMainBounds.isMaximized = false;
      savePersistedWindowBounds(savedMainBounds);
    }
    mainWindow?.webContents.send("window-maximized-change", false);
  });

  const recordBounds = () => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.isMaximized() ||
      mainWindow.isMinimized()
    )
      return;
    const b = mainWindow.getBounds();
    if (b.width >= 600 && b.height >= 500) {
      savedMainBounds = {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        isMaximized: false,
      };
      savePersistedWindowBounds(savedMainBounds);
    }
  };

  mainWindow.on("resize", recordBounds);
  mainWindow.on("move", recordBounds);

  // 主窗口关闭拦截：隐藏到系统托盘（对齐 Discord 原生规范）
  mainWindow.on("close", (event) => {
    if (!isQuitting && !isSwitchingToAuth) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    updateTrayContextMenu();
  });

  void loadWindowContent(mainWindow, false, targetEntryPath);

  return mainWindow;
}

async function switchToMainWindow(): Promise<void> {
  saveHasAuthSession(true);
  currentWindowMode = "main";

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (savedMainBounds?.isMaximized) mainWindow.maximize();
    if (authWindow && !authWindow.isDestroyed()) {
      isSwitchingToMain = true;
      try {
        authWindow.destroy();
      } finally {
        isSwitchingToMain = false;
        authWindow = null;
      }
    }
    updateTrayContextMenu();
    mainWindow.webContents.send("window-mode-changed", "main");
    return;
  }

  const win = createMainWindow();

  let hasSwitched = false;
  const finishSwitch = () => {
    if (hasSwitched) return;
    hasSwitched = true;
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      if (savedMainBounds?.isMaximized) {
        win.maximize();
      }
      win.webContents.send("window-mode-changed", "main");
    }
    if (authWindow && !authWindow.isDestroyed()) {
      isSwitchingToMain = true;
      try {
        authWindow.destroy();
      } finally {
        isSwitchingToMain = false;
        authWindow = null;
      }
    }
    updateTrayContextMenu();
  };

  win.once("ready-to-show", finishSwitch);
  setTimeout(finishSwitch, 4000);
}

async function switchToAuthWindow(): Promise<void> {
  saveHasAuthSession(false);
  currentWindowMode = "auth";

  // 记录主窗口最后退出前的有效尺寸与最大化状态
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      if (savedMainBounds) savedMainBounds.isMaximized = true;
    } else {
      const b = mainWindow.getBounds();
      if (b.width >= 600 && b.height >= 500) {
        savedMainBounds = {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          isMaximized: false,
        };
      }
    }
    savePersistedWindowBounds(savedMainBounds);
  }

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.show();
    authWindow.focus();
    if (mainWindow && !mainWindow.isDestroyed()) {
      isSwitchingToAuth = true;
      try {
        mainWindow.destroy();
      } finally {
        isSwitchingToAuth = false;
        mainWindow = null;
      }
    }
    updateTrayContextMenu();
    authWindow.webContents.send("window-mode-changed", "auth");
    return;
  }

  const win = createAuthWindow();

  let hasSwitched = false;
  const finishSwitch = () => {
    if (hasSwitched) return;
    hasSwitched = true;
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      win.webContents.send("window-mode-changed", "auth");
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      isSwitchingToAuth = true;
      try {
        mainWindow.destroy();
      } finally {
        isSwitchingToAuth = false;
        mainWindow = null;
      }
    }
    updateTrayContextMenu();
  };

  win.once("ready-to-show", finishSwitch);
  setTimeout(finishSwitch, 4000);
}

async function applyWindowMode(targetMode: DesktopWindowMode): Promise<void> {
  if (targetMode === "main") {
    await switchToMainWindow();
  } else {
    await switchToAuthWindow();
  }
}

// 生成高保真矢量自适应托盘图标 (16x16 RGBA 蓝紫圆角徽标，零外部静态资源依赖)
function createDefaultTrayIcon(): Electron.NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - 7.5;
      const dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 7.0) {
        // Discord 经典 Indigo 品牌色 #5865F2 (RGBA: 88, 101, 242, 255)
        buffer[idx] = 88;
        buffer[idx + 1] = 101;
        buffer[idx + 2] = 242;
        buffer[idx + 3] = dist > 6.0 ? Math.round((7.0 - dist) * 255) : 255;
      } else {
        buffer[idx + 3] = 0; // 透明
      }
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function updateTrayContextMenu(status: UserStatus = currentUserStatus) {
  if (!tray) return;
  currentUserStatus = status;
  const t = getDesktopLocale(currentLocale);
  const isAutoLaunch = app.getLoginItemSettings().openAtLogin;

  tray.setToolTip(t.trayTooltip);

  const isMainActive = Boolean(mainWindow && !mainWindow.isDestroyed());

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: t.openApp,
      click: () => {
        const targetWin = mainWindow || authWindow;
        if (targetWin && !targetWin.isDestroyed()) {
          if (targetWin.isMinimized()) targetWin.restore();
          targetWin.show();
          targetWin.focus();
        }
      },
    },
    { type: "separator" },
  ];

  if (isMainActive) {
    menuTemplate.push(
      {
        label: t.statusMenu,
        submenu: [
          {
            label: t.statusOnline,
            type: "radio",
            checked: currentUserStatus === "ONLINE",
            click: () => {
              mainWindow?.webContents.send("tray-status-change", "ONLINE");
            },
          },
          {
            label: t.statusIdle,
            type: "radio",
            checked: currentUserStatus === "IDLE",
            click: () => {
              mainWindow?.webContents.send("tray-status-change", "IDLE");
            },
          },
          {
            label: t.statusDnd,
            type: "radio",
            checked: currentUserStatus === "DND",
            click: () => {
              mainWindow?.webContents.send("tray-status-change", "DND");
            },
          },
          {
            label: t.statusInvisible,
            type: "radio",
            checked: currentUserStatus === "INVISIBLE",
            click: () => {
              mainWindow?.webContents.send("tray-status-change", "INVISIBLE");
            },
          },
        ],
      },
      { type: "separator" },
      {
        label: t.muteMic,
        click: () => {
          mainWindow?.webContents.send("toggle-global-mute");
        },
      },
    );
  }

  menuTemplate.push(
    {
      label: t.autoLaunch,
      type: "checkbox",
      checked: isAutoLaunch,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true,
        });
      },
    },
    { type: "separator" },
    {
      label: t.quit,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function setupSystemTray() {
  if (tray) return;
  const t = getDesktopLocale(currentLocale);
  const icon = createDefaultTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(t.trayTooltip);

  updateTrayContextMenu();

  tray.on("click", () => {
    const targetWin = mainWindow || authWindow;
    if (!targetWin || targetWin.isDestroyed()) return;
    if (targetWin.isVisible()) {
      if (targetWin === mainWindow) {
        targetWin.hide();
      }
    } else {
      targetWin.show();
      targetWin.focus();
    }
  });

  tray.on("double-click", () => {
    const targetWin = mainWindow || authWindow;
    if (!targetWin || targetWin.isDestroyed()) return;
    targetWin.show();
    targetWin.focus();
  });
}

// 2. 注册屏幕与窗口采集 IPC 处理 (支持应用图标与类型区分)
ipcMain.handle(
  "get-desktop-sources",
  async (event): Promise<DesktopSource[]> => {
    if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });

    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return sources.map((s, idx) => {
      let displayDimensions: { width: number; height: number } | undefined;

      if (s.id.startsWith("screen")) {
        const displayId = (s as any).display_id;
        const matchedDisplay = displays.find(
          (d) => d.id.toString() === displayId,
        );
        const targetDisplay = matchedDisplay || displays[idx] || primaryDisplay;
        if (targetDisplay) {
          displayDimensions = {
            width: Math.round(
              targetDisplay.bounds.width * (targetDisplay.scaleFactor || 1),
            ),
            height: Math.round(
              targetDisplay.bounds.height * (targetDisplay.scaleFactor || 1),
            ),
          };
        }
      } else {
        if (primaryDisplay) {
          displayDimensions = {
            width: Math.round(
              primaryDisplay.bounds.width * (primaryDisplay.scaleFactor || 1),
            ),
            height: Math.round(
              primaryDisplay.bounds.height * (primaryDisplay.scaleFactor || 1),
            ),
          };
        }
      }

      return {
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        type: s.id.startsWith("screen") ? "screen" : "window",
        appIcon:
          s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
        displayDimensions,
      };
    });
  },
);

// 3. 注册按键说话 (PTT) 系统级热键
ipcMain.handle("set-ptt-keybind", async (event, key: string) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  if (typeof key !== "string" || key.length > 64) return false;
  try {
    if (currentPTTKey) {
      globalShortcut.unregister(currentPTTKey);
      currentPTTKey = null;
    }
    if (!key) return true;

    const accelerator = key
      .replace("Key", "")
      .replace("ControlLeft", "Control")
      .replace("ControlRight", "Control")
      .replace("AltLeft", "Alt")
      .replace("AltRight", "Alt")
      .replace("ShiftLeft", "Shift")
      .replace("ShiftRight", "Shift");

    const success = globalShortcut.register(accelerator, () => {
      mainWindow?.webContents.send("global-ptt-down");
      setTimeout(() => {
        mainWindow?.webContents.send("global-ptt-up");
      }, 600);
    });

    if (success) {
      currentPTTKey = accelerator;
    }
    return success;
  } catch (err) {
    console.error("Failed to register global PTT shortcut:", err);
    return false;
  }
});

// 4. 原生桌面通知与类似 Discord 的悬浮弹窗 (Desktop Notifications / Toast)
ipcMain.handle(
  "show-desktop-notification",
  async (event, payload: DesktopNotificationPayload) => {
    if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
    try {
      if (!toastManager) {
        toastManager = new ToastManager((channelId, guildId) => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("desktop-notification-clicked", {
              channelId,
              guildId,
            });
          }
        });
      }

      toastManager.showToast(payload);
      return true;
    } catch (err) {
      console.warn(
        "Failed to show custom toast, falling back to native notification:",
        err,
      );
      try {
        if (!Notification.isSupported()) return false;
        const notification = new Notification({
          title: payload.title || "Tescord 通知",
          body: payload.body || "",
          silent: !!payload.silent,
        });

        notification.on("click", () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send("desktop-notification-clicked", {
              channelId: payload.channelId,
              guildId: payload.guildId,
            });
          }
        });

        notification.show();
        return true;
      } catch (nativeErr) {
        console.error(
          "Failed to show native notification fallback:",
          nativeErr,
        );
        return false;
      }
    }
  },
);

// 5. 开机自启动设置 (Auto Launch)
ipcMain.handle("get-auto-launch", async () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("set-auto-launch", async (_event, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
  updateTrayContextMenu(currentUserStatus);
  return app.getLoginItemSettings().openAtLogin;
});

// 6. 状态同步与托盘菜单刷新
ipcMain.on("sync-user-status", (_event, status: UserStatus) => {
  currentUserStatus = status;
  updateTrayContextMenu(status);
});

ipcMain.on("sync-locale", (_event, locale: SupportedLocale) => {
  if (
    locale === "zh-CN" ||
    locale === "en-US" ||
    locale === "ja-JP" ||
    locale === "zh-TW" ||
    locale === "zh-HK"
  ) {
    currentLocale = locale;
    savePersistedLocale(locale);
    updateTrayContextMenu(currentUserStatus);
  }
});

// 7. 窗口控制接口与认证状态联动
ipcMain.handle("window-minimize", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  senderWin?.minimize();
});

ipcMain.handle("window-maximize", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin === authWindow) return;
  if (senderWin?.isMaximized()) {
    senderWin?.unmaximize();
  } else {
    senderWin?.maximize();
  }
});

ipcMain.handle("window-close", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin === authWindow) {
    // 登录窗口点击 X：直接彻底退出应用（对齐 Discord 原生规范）
    isQuitting = true;
    app.quit();
  } else if (senderWin === mainWindow) {
    // 主窗口点击 X：隐藏至系统托盘常驻后台
    mainWindow?.hide();
  } else {
    senderWin?.close();
  }
});

ipcMain.handle("window-is-maximized", (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  return senderWin?.isMaximized() ?? false;
});

ipcMain.handle("auth-success", async (event, _payload) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  await switchToMainWindow();
  return true;
});

ipcMain.handle("auth-logout", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  await switchToAuthWindow();
  return true;
});

ipcMain.handle("window-get-type", (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  return senderWin === authWindow ? "auth" : "main";
});

ipcMain.handle("window-set-mode", async (event, mode: DesktopWindowMode) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  if (mode === "main") {
    await switchToMainWindow();
  } else if (mode === "auth") {
    await switchToAuthWindow();
  }
  return { success: true, mode: currentWindowMode };
});

ipcMain.handle("window-get-mode", (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  return senderWin === authWindow ? "auth" : "main";
});

// 原生网络穿透与 UPnP 自动打洞
ipcMain.handle("desktop-detect-local-network", async () => {
  return detectLocalNetwork();
});

ipcMain.handle(
  "desktop-upnp-map-port",
  async (event, port: number, protocol?: "UDP" | "TCP") => {
    if (
      !isTrustedIpcSender(event) ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535
    ) {
      throw new Error("Invalid UPnP request");
    }
    return await UPnPClient.mapPort(port, protocol || "UDP");
  },
);

ipcMain.handle(
  "desktop-upnp-unmap-port",
  async (event, port: number, protocol?: "UDP" | "TCP") => {
    if (
      !isTrustedIpcSender(event) ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535
    ) {
      throw new Error("Invalid UPnP request");
    }
    return await UPnPClient.unmapPort(port, protocol || "UDP");
  },
);

// 硬件加速与显卡供应商探测 (支持检测 Intel 0x8086 / NVIDIA 0x10de / AMD 0x1002)
ipcMain.handle("get-gpu-info", async () => {
  try {
    const gpuInfo = await app.getGPUInfo("basic");
    const featureStatus = app.getGPUFeatureStatus();
    const isIntel = (gpuInfo as any)?.gpuDevice?.some(
      (d: any) => d.vendorId === 0x8086,
    );
    const isNvidia = (gpuInfo as any)?.gpuDevice?.some(
      (d: any) => d.vendorId === 0x10de,
    );
    const isAmd = (gpuInfo as any)?.gpuDevice?.some(
      (d: any) => d.vendorId === 0x1002,
    );
    return {
      gpuInfo,
      featureStatus,
      isIntel: Boolean(isIntel),
      isNvidia: Boolean(isNvidia),
      isAmd: Boolean(isAmd),
    };
  } catch (e) {
    return {
      isIntel: false,
      isNvidia: false,
      isAmd: false,
      error: String(e),
    };
  }
});

// 游戏状态侦测 IPC 处理
ipcMain.handle("get-detected-game", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  return gameDetector.getCurrentActivity();
});

ipcMain.handle(
  "set-game-detection-enabled",
  async (event, enabled: boolean) => {
    if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
    gameDetector.setEnabled(Boolean(enabled));
    return true;
  },
);

ipcMain.handle("get-game-detection-enabled", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  return gameDetector.isDetectionEnabled();
});

// 客户端自动更新服务 IPC 处理 (基于 gh-proxy 阶梯加速与双轨增量热更新)
ipcMain.handle("updater-get-config", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  return UpdateManager.getInstance().getUpdaterConfig();
});

ipcMain.handle("updater-check", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  return await UpdateManager.getInstance().checkForUpdates();
});

ipcMain.handle("updater-download-apply", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  return await UpdateManager.getInstance().downloadAndApplyWebUpdate();
});

ipcMain.handle("updater-restart", async (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  UpdateManager.getInstance().restartToApply();
  return true;
});

ipcMain.handle("updater-set-proxy", async (event, proxyUrl: string) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  ProxyManager.getInstance().setCustomProxy(proxyUrl);
  return true;
});

// 单例唤醒监听
app.on("second-instance", () => {
  const targetWin = mainWindow || authWindow;
  if (targetWin && !targetWin.isDestroyed()) {
    if (targetWin.isMinimized()) targetWin.restore();
    if (!targetWin.isVisible()) targetWin.show();
    targetWin.focus();
  }
});

let splashWindow: SplashWindow | null = null;

async function startApplicationWithSplash(): Promise<void> {
  const updateManager = UpdateManager.getInstance();
  const activeEntry = updateManager.getActiveWebEntry();

  // 若处于打包环境或显式指定测试 Splash (开发环境下可通过 SHOW_SPLASH=true 开启)
  const shouldShowSplash = app.isPackaged || process.env.SHOW_SPLASH === "true";

  if (shouldShowSplash) {
    const dLoc = getDesktopLocale(currentLocale);
    splashWindow = new SplashWindow();
    splashWindow.updateStatus({
      text: dLoc.splashStarting,
      version: `v${activeEntry.version}`,
    });

    if (BUILD_CONFIG.IS_UPDATER_ENABLED) {
      splashWindow.updateStatus({ text: dLoc.splashCheckingUpdates });
      try {
        const check = await updateManager.checkForUpdates();
        if (
          check.hasUpdate &&
          !check.isHostUpdateRequired &&
          check.latestVersion
        ) {
          splashWindow.updateStatus({
            text: dLoc.splashFoundUpdate.replace(
              "{{version}}",
              check.latestVersion,
            ),
            showProgress: true,
            percent: 5,
          });

          const applyRes = await updateManager.downloadAndApplyWebUpdate(
            (prog) => {
              splashWindow?.updateStatus({
                text:
                  prog.state === "extracting"
                    ? dLoc.splashExtracting
                    : dLoc.splashDownloading.replace(
                        "{{percent}}",
                        String(prog.percent),
                      ),
                percent: prog.percent,
                showProgress: true,
              });
            },
          );

          if (applyRes.success) {
            splashWindow.updateStatus({
              text: dLoc.splashComplete,
              showProgress: false,
              hideSpinner: true,
            });
          }
        }
      } catch (err) {
        console.warn("⚠️ [Startup] 更新检测异常，继续启动:", err);
      }
    }

    // 稍作平滑过渡展示
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  // 获取最终生效路径并根据会话状态创建目标窗口 (对齐 Discord 原生逻辑)
  const finalEntry = updateManager.getActiveWebEntry();
  const hasSession = loadHasAuthSession();
  currentWindowMode = hasSession ? "main" : "auth";

  const targetWin = hasSession
    ? createMainWindow(finalEntry.indexPath)
    : createAuthWindow(finalEntry.indexPath);

  targetWin.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    targetWin.show();
    targetWin.focus();
    if (targetWin === mainWindow && savedMainBounds?.isMaximized) {
      mainWindow.maximize();
    }
    updateTrayContextMenu();
  });

  // 兜底保护：若 6 秒后未能正常触发 ready-to-show，强制呈现目标窗口
  setTimeout(() => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    if (targetWin && !targetWin.isDestroyed() && !targetWin.isVisible()) {
      targetWin.show();
      targetWin.focus();
      if (targetWin === mainWindow && savedMainBounds?.isMaximized) {
        mainWindow.maximize();
      }
      updateTrayContextMenu();
    }
  }, 6000);
}

function startBackgroundUpdateChecker(): void {
  if (!BUILD_CONFIG.IS_UPDATER_ENABLED) return;
  const updateManager = UpdateManager.getInstance();

  const runCheck = async () => {
    try {
      console.log("⏱️ [Updater] 触发后台静默更新检测...");
      const check = await updateManager.checkForUpdates();
      if (
        check.hasUpdate &&
        !check.isHostUpdateRequired &&
        check.latestVersion
      ) {
        console.log(
          `⬇️ [Updater] 后台检测到增量更新 v${check.latestVersion}，开始静默下载...`,
        );
        const applyRes = await updateManager.downloadAndApplyWebUpdate();
        if (applyRes.success) {
          console.log(
            `✨ [Updater] 增量包已静默准备就绪: v${check.latestVersion}`,
          );
          mainWindow?.webContents.send("updater-update-ready", {
            version: check.latestVersion,
          });
        }
      }
    } catch (err) {
      console.warn("⚠️ [Updater] 后台静默更新检测失败:", err);
    }
  };

  // 启动 45 秒后首次静默检测，之后每 30 分钟检测一次
  setTimeout(runCheck, 45 * 1000);
  setInterval(runCheck, 30 * 60 * 1000);
}

app.whenReady().then(async () => {
  StorageManager.getInstance().initialize();
  await startApplicationWithSplash();
  setupSystemTray();
  startBackgroundUpdateChecker();

  // 监听游戏状态变动并推送给渲染进程
  gameDetector.onActivityChange((activity) => {
    mainWindow?.webContents.send("game-activity-changed", activity);
  });

  // 注册系统全局静音热键 (Ctrl+Shift+M / Command+Shift+M)
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    mainWindow?.webContents.send("toggle-global-mute");
  });

  app.on("activate", () => {
    const activeWin = mainWindow || authWindow;
    if (!activeWin || activeWin.isDestroyed()) {
      const hasSession = loadHasAuthSession();
      const newWin = hasSession ? createMainWindow() : createAuthWindow();
      newWin.once("ready-to-show", () => {
        newWin.show();
        newWin.focus();
        if (newWin === mainWindow && savedMainBounds?.isMaximized) {
          mainWindow.maximize();
        }
        updateTrayContextMenu();
      });
    } else {
      if (activeWin.isMinimized()) activeWin.restore();
      activeWin.show();
      activeWin.focus();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  StorageManager.getInstance().destroy();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
