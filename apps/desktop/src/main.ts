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
} from "electron";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import {
  DesktopNotificationPayload,
  DesktopSource,
  UserStatus,
  SupportedLocale,
  DesktopWindowMode,
  DesktopWindowBounds,
} from "@tescord/types";
import { detectLocalNetwork, UPnPClient } from "./upnp.js";
import { getDesktopLocale } from "./locales.js";
import { gameDetector } from "./gameDetector.js";
import { UpdateManager } from "./updater/update-manager.js";
import { SplashWindow } from "./updater/splash.js";
import { ProxyManager } from "./updater/proxy-manager.js";
import { BUILD_CONFIG } from "./build-config.js";


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
app.commandLine.appendSwitch(
  "disable-features",
  "CalculateNativeWinOcclusion",
);

// 1. 单例进程保护 (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();
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
let tray: Tray | null = null;
let isQuitting = false;
let currentPTTKey: string | null = null;
let currentUserStatus: UserStatus = "ONLINE";

function getDesktopSettingsPath(): string {
  try {
    return path.join(app.getPath("userData"), "desktop-settings.json");
  } catch {
    return "";
  }
}

function loadPersistedLocale(): SupportedLocale {
  try {
    const p = getDesktopSettingsPath();
    if (p && fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (data.locale === "zh-CN" || data.locale === "en-US" || data.locale === "ja-JP") {
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
      fs.writeFileSync(p, JSON.stringify({ ...existing, locale }, null, 2), "utf-8");
    }
  } catch {}
}

let currentLocale: SupportedLocale = loadPersistedLocale();

let currentWindowMode: DesktopWindowMode = "auth";

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

function animateWindowBounds(
  win: BrowserWindow,
  start: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
  durationMs: number = 180,
): Promise<void> {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    if (!win.isVisible()) {
      try {
        win.setBounds(target);
      } catch {}
      return resolve();
    }

    const steps = 10;
    const interval = Math.max(12, Math.floor(durationMs / steps));
    let step = 0;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearInterval(timer);
      clearTimeout(safetyTimer);
      if (win && !win.isDestroyed()) {
        try {
          win.setBounds(target);
        } catch {}
      }
      resolve();
    };

    const timer = setInterval(() => {
      if (!win || win.isDestroyed()) {
        finish();
        return;
      }
      step++;
      const progress = step / steps;
      const ease = 1 - Math.pow(1 - progress, 3);

      const curBounds = {
        x: Math.round(start.x + (target.x - start.x) * ease),
        y: Math.round(start.y + (target.y - start.y) * ease),
        width: Math.round(start.width + (target.width - start.width) * ease),
        height: Math.round(start.height + (target.height - start.height) * ease),
      };

      try {
        win.setBounds(curBounds);
      } catch {}

      if (step >= steps) {
        finish();
      }
    }, interval);

    // 兜底超时计时器，防止因任何操作系统异常导致 Promise 未能 resolve
    const safetyTimer = setTimeout(finish, durationMs + 120);
  });
}

async function applyWindowMode(targetMode: DesktopWindowMode): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (currentWindowMode === targetMode && mainWindow.isVisible() && !isSwitchingWindowMode) return;

  // 防抖并发等待：若当前已有窗口切换在进行中，等待其完成或最多等待 350ms
  if (isSwitchingWindowMode) {
    let waitCount = 0;
    while (isSwitchingWindowMode && waitCount < 7) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      waitCount++;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (currentWindowMode === targetMode && mainWindow.isVisible()) return;
  }

  isSwitchingWindowMode = true;
  currentWindowMode = targetMode;

  try {
    if (targetMode === "auth") {
      // 1. 如果窗口当前为最大化状态，先取消最大化并记录
      if (mainWindow.isMaximized()) {
        savedMainBounds = {
          width: MAIN_WINDOW_CONFIG.width,
          height: MAIN_WINDOW_CONFIG.height,
          isMaximized: true,
        };
        savePersistedWindowBounds(savedMainBounds);
        mainWindow.unmaximize();
      } else {
        const bounds = mainWindow.getBounds();
        if (bounds.width >= 600 && bounds.height >= 500) {
          savedMainBounds = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: false,
          };
          savePersistedWindowBounds(savedMainBounds);
        }
      }

      // 2. 临时解除拉伸与尺寸限制以执行尺寸调整
      mainWindow.setMinimumSize(300, 300);
      mainWindow.setMaximumSize(10000, 10000);
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(false);

      // 3. 计算屏幕居中位置
      const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
      const workArea = currentDisplay.workArea;
      const targetX = Math.round(
        workArea.x + (workArea.width - AUTH_WINDOW_CONFIG.width) / 2,
      );
      const targetY = Math.round(
        workArea.y + (workArea.height - AUTH_WINDOW_CONFIG.height) / 2,
      );

      const startBounds = mainWindow.getBounds();
      const targetBounds = {
        x: targetX,
        y: targetY,
        width: AUTH_WINDOW_CONFIG.width,
        height: AUTH_WINDOW_CONFIG.height,
      };

      if (process.platform === "darwin") {
        mainWindow.setBounds(targetBounds, true);
      } else {
        await animateWindowBounds(mainWindow, startBounds, targetBounds, 180);
      }

      // 4. 锁定小窗口属性
      mainWindow.setMinimumSize(
        AUTH_WINDOW_CONFIG.width,
        AUTH_WINDOW_CONFIG.height,
      );
      mainWindow.setMaximumSize(
        AUTH_WINDOW_CONFIG.width,
        AUTH_WINDOW_CONFIG.height,
      );
      mainWindow.setResizable(false);
      mainWindow.setMaximizable(false);
    } else {
      // targetMode === "main"
      // 1. 解除小窗口限制：先设置松弛的最小尺寸 (300, 300)，确保在 Windows 上动画从 480 放大时不会因 minWidth=940 导致 Win32 限制报错
      mainWindow.setMaximumSize(10000, 10000);
      mainWindow.setMinimumSize(300, 300);
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(true);

      const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds());
      const workArea = currentDisplay.workArea;

      let targetBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      let shouldMaximize = false;

      // 若内存中没有 savedMainBounds，尝试从磁盘读取持久化配置
      if (!savedMainBounds) {
        savedMainBounds = loadPersistedWindowBounds();
      }

      if (savedMainBounds) {
        if (savedMainBounds.isMaximized) {
          shouldMaximize = true;
          targetBounds = {
            x: Math.round(
              workArea.x + (workArea.width - MAIN_WINDOW_CONFIG.width) / 2,
            ),
            y: Math.round(
              workArea.y + (workArea.height - MAIN_WINDOW_CONFIG.height) / 2,
            ),
            width: MAIN_WINDOW_CONFIG.width,
            height: MAIN_WINDOW_CONFIG.height,
          };
        } else {
          const width = Math.min(
            Math.max(savedMainBounds.width, MAIN_WINDOW_CONFIG.minWidth),
            workArea.width,
          );
          const height = Math.min(
            Math.max(savedMainBounds.height, MAIN_WINDOW_CONFIG.minHeight),
            workArea.height,
          );
          const x =
            savedMainBounds.x !== undefined
              ? Math.max(
                  workArea.x,
                  Math.min(savedMainBounds.x, workArea.x + workArea.width - width),
                )
              : Math.round(workArea.x + (workArea.width - width) / 2);
          const y =
            savedMainBounds.y !== undefined
              ? Math.max(
                  workArea.y,
                  Math.min(
                    savedMainBounds.y,
                    workArea.y + workArea.height - height,
                  ),
                )
              : Math.round(workArea.y + (workArea.height - height) / 2);
          targetBounds = { x, y, width, height };
        }
      } else {
        const width = Math.min(MAIN_WINDOW_CONFIG.width, workArea.width);
        const height = Math.min(MAIN_WINDOW_CONFIG.height, workArea.height);
        const x = Math.round(workArea.x + (workArea.width - width) / 2);
        const y = Math.round(workArea.y + (workArea.height - height) / 2);
        targetBounds = { x, y, width, height };
      }

      const startBounds = mainWindow.getBounds();

      if (process.platform === "darwin") {
        mainWindow.setBounds(targetBounds, true);
      } else {
        await animateWindowBounds(mainWindow, startBounds, targetBounds, 180);
      }

      // 动画完成后，正式设置主窗口的最小尺寸限制，并确保开启可拉伸与最大化
      mainWindow.setMinimumSize(
        MAIN_WINDOW_CONFIG.minWidth,
        MAIN_WINDOW_CONFIG.minHeight,
      );
      mainWindow.setResizable(true);
      mainWindow.setMaximizable(true);

      if (shouldMaximize) {
        mainWindow.maximize();
      }
    }

    mainWindow.webContents.send("window-mode-changed", targetMode);
  } finally {
    isSwitchingWindowMode = false;
  }
}

const isSafeExternalUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const isTrustedIpcSender = (event: IpcMainInvokeEvent | IpcMainEvent) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  try {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) return false;
    const url = new URL(senderUrl);
    return url.protocol === "file:" ||
      ((url.protocol === "https:" || url.protocol === "http:") &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
};

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

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t.openApp,
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
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
  ]);

  tray.setContextMenu(contextMenu);
}

function setupSystemTray() {
  if (tray) return;
  const t = getDesktopLocale(currentLocale);
  const icon = createDefaultTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(t.trayTooltip);

  updateTrayContextMenu();

  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  tray.on("double-click", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow(targetEntryPath?: string) {
  // 隐藏系统原生菜单栏 (去掉 Alt 菜单与原生白条)
  Menu.setApplicationMenu(null);

  const initialIsAuth = currentWindowMode === "auth";
  const initialWidth = initialIsAuth
    ? AUTH_WINDOW_CONFIG.width
    : MAIN_WINDOW_CONFIG.width;
  const initialHeight = initialIsAuth
    ? AUTH_WINDOW_CONFIG.height
    : MAIN_WINDOW_CONFIG.height;

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: initialIsAuth
      ? AUTH_WINDOW_CONFIG.width
      : MAIN_WINDOW_CONFIG.minWidth,
    minHeight: initialIsAuth
      ? AUTH_WINDOW_CONFIG.height
      : MAIN_WINDOW_CONFIG.minHeight,
    maxWidth: initialIsAuth ? AUTH_WINDOW_CONFIG.width : undefined,
    maxHeight: initialIsAuth ? AUTH_WINDOW_CONFIG.height : undefined,
    resizable: !initialIsAuth,
    maximizable: !initialIsAuth,
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

  // 监听窗口最大化与还原事件，向渲染进程实时广播以同步自定义顶栏按钮图标
  mainWindow.on("maximize", () => {
    if (currentWindowMode === "main" && savedMainBounds) {
      savedMainBounds.isMaximized = true;
      savePersistedWindowBounds(savedMainBounds);
    }
    mainWindow?.webContents.send("window-maximized-change", true);
  });

  mainWindow.on("unmaximize", () => {
    if (currentWindowMode === "main" && savedMainBounds) {
      savedMainBounds.isMaximized = false;
      savePersistedWindowBounds(savedMainBounds);
    }
    mainWindow?.webContents.send("window-maximized-change", false);
  });

  mainWindow.on("resize", () => {
    if (
      currentWindowMode === "main" &&
      mainWindow &&
      !mainWindow.isMaximized()
    ) {
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
    }
  });

  mainWindow.on("move", () => {
    if (
      currentWindowMode === "main" &&
      mainWindow &&
      !mainWindow.isMaximized()
    ) {
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
    }
  });

  // 注册 WebContents 原生右键上下文菜单 (编辑、选中文本、链接、图片及开发者调试)
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const t = getDesktopLocale(currentLocale);
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    // 1. 可编辑区域：输入框、文本域等
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
      // 2. 选中文本区域
      menuTemplate.push(
        { role: "copy", label: t.copy, enabled: params.editFlags.canCopy },
        {
          role: "selectAll",
          label: t.selectAll,
          enabled: params.editFlags.canSelectAll,
        },
      );
    }

    // 3. 超链接右键
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
            if (isSafeExternalUrl(params.linkURL)) void shell.openExternal(params.linkURL);
          },
        },
      );
    }

    // 4. 图片右键
    if (params.hasImageContents && params.srcURL) {
      if (menuTemplate.length > 0) menuTemplate.push({ type: "separator" });
      menuTemplate.push({
        label: t.copyImageLink,
        click: () => clipboard.writeText(params.srcURL),
      });
    }

    // 5. 开发者调试辅助（仅在存在有效操作项且处于非 production 环境时追加）
    if (menuTemplate.length > 0 && process.env.NODE_ENV !== "production") {
      menuTemplate.push(
        { type: "separator" },
        {
          label: t.inspectElement,
          click: () => {
            mainWindow?.webContents.inspectElement(params.x, params.y);
          },
        },
        {
          role: "reload",
          label: t.reload,
        },
      );
    }

    // 仅当存在有效菜单项时弹出系统原生上下文菜单
    if (menuTemplate.length > 0 && mainWindow) {
      Menu.buildFromTemplate(menuTemplate).popup({ window: mainWindow });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = mainWindow?.webContents.getURL();
    try {
      const target = new URL(targetUrl);
      const current = currentUrl ? new URL(currentUrl) : null;
      if (current && target.origin === current.origin && target.protocol === current.protocol) return;
    } catch {}
    event.preventDefault();
    if (isSafeExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
  });

  // 窗口关闭事件拦截：常驻系统托盘，防止误关
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // 智能探测本地开发服务器 (支持 HTTPS 与 HTTP)，未开启时秒级回退加载静态打包文件
  const devUrls = [
    process.env.VITE_DEV_SERVER_URL,
    "https://localhost:3000",
    "http://localhost:3000",
  ].filter(Boolean) as string[];

  const activeEntry = UpdateManager.getInstance().getActiveWebEntry();
  const distPath = targetEntryPath || activeEntry.indexPath;

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

  if (app.isPackaged) {
    mainWindow?.loadFile(distPath);
  } else {
    (async () => {
      for (const url of devUrls) {
        if (await probe(url)) {
          mainWindow?.loadURL(url);
          return;
        }
      }
      mainWindow?.loadFile(distPath);
    })();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// 2. 注册屏幕与窗口采集 IPC 处理 (支持应用图标与类型区分)
ipcMain.handle("get-desktop-sources", async (event): Promise<DesktopSource[]> => {
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
});

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

// 4. 原生桌面通知推送 (Native Notifications)
ipcMain.handle(
  "show-desktop-notification",
  async (event, payload: DesktopNotificationPayload) => {
    if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
    try {
      if (!Notification.isSupported()) {
        return false;
      }

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
    } catch (err) {
      console.error("Failed to show desktop notification:", err);
      return false;
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
  if (locale === "zh-CN" || locale === "en-US" || locale === "ja-JP") {
    currentLocale = locale;
    savePersistedLocale(locale);
    updateTrayContextMenu(currentUserStatus);
  }
});

// 7. 窗口控制接口
ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (currentWindowMode === "auth") return;
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window-close", () => {
  mainWindow?.hide();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("window-set-mode", async (event, mode: DesktopWindowMode) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  if (mode !== "auth" && mode !== "main") {
    return { success: false, mode: currentWindowMode };
  }
  await applyWindowMode(mode);
  return { success: true, mode: currentWindowMode };
});

ipcMain.handle("window-get-mode", (event) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  return currentWindowMode;
});

// 原生网络穿透与 UPnP 自动打洞
ipcMain.handle("desktop-detect-local-network", async () => {
  return detectLocalNetwork();
});

ipcMain.handle(
  "desktop-upnp-map-port",
  async (event, port: number, protocol?: "UDP" | "TCP") => {
    if (!isTrustedIpcSender(event) || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("Invalid UPnP request");
    }
    return await UPnPClient.mapPort(port, protocol || "UDP");
  },
);

ipcMain.handle(
  "desktop-upnp-unmap-port",
  async (event, port: number, protocol?: "UDP" | "TCP") => {
    if (!isTrustedIpcSender(event) || !Number.isInteger(port) || port < 1024 || port > 65535) {
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

ipcMain.handle("set-game-detection-enabled", async (event, enabled: boolean) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted IPC sender");
  gameDetector.setEnabled(Boolean(enabled));
  return true;
});

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
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
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
        if (check.hasUpdate && !check.isHostUpdateRequired && check.latestVersion) {
          splashWindow.updateStatus({
            text: dLoc.splashFoundUpdate.replace("{{version}}", check.latestVersion),
            showProgress: true,
            percent: 5,
          });

          const applyRes = await updateManager.downloadAndApplyWebUpdate((prog) => {
            splashWindow?.updateStatus({
              text:
                prog.state === "extracting"
                  ? dLoc.splashExtracting
                  : dLoc.splashDownloading.replace("{{percent}}", String(prog.percent)),
              percent: prog.percent,
              showProgress: true,
            });
          });

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

  // 获取最终生效路径并创建主窗口
  const finalEntry = updateManager.getActiveWebEntry();
  createWindow(finalEntry.indexPath);

  mainWindow?.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();
    mainWindow?.focus();
  });

  // 兜底保护：若 6 秒后未能正常触发 ready-to-show，强制呈现主窗口
  setTimeout(() => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
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
      if (check.hasUpdate && !check.isHostUpdateRequired && check.latestVersion) {
        console.log(`⬇️ [Updater] 后台检测到增量更新 v${check.latestVersion}，开始静默下载...`);
        const applyRes = await updateManager.downloadAndApplyWebUpdate();
        if (applyRes.success) {
          console.log(`✨ [Updater] 增量包已静默准备就绪: v${check.latestVersion}`);
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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      mainWindow?.once("ready-to-show", () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
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

