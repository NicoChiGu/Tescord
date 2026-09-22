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
import http from "http";
import https from "https";
import {
  DesktopNotificationPayload,
  DesktopSource,
  UserStatus,
  SupportedLocale,
} from "@tescord/types";
import { detectLocalNetwork, UPnPClient } from "./upnp.js";
import { getDesktopLocale } from "./locales.js";

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
let currentLocale: SupportedLocale = "zh-CN";

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

function createWindow() {
  // 隐藏系统原生菜单栏 (去掉 Alt 菜单与原生白条)
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 500,
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
    },
  });

  // 监听窗口最大化与还原事件，向渲染进程实时广播以同步自定义顶栏按钮图标
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window-maximized-change", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window-maximized-change", false);
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
  const distPath = path.join(__dirname, "../../web/dist/index.html");

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

  (async () => {
    for (const url of devUrls) {
      if (await probe(url)) {
        mainWindow?.loadURL(url);
        return;
      }
    }
    mainWindow?.loadFile(distPath);
  })();

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
    updateTrayContextMenu(currentUserStatus);
  }
});

// 7. 窗口控制接口
ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
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

// 单例唤醒监听
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow();
  setupSystemTray();

  // 注册系统全局静音热键 (Ctrl+Shift+M / Command+Shift+M)
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    mainWindow?.webContents.send("toggle-global-mute");
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
