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
} from "electron";
import path from "path";
import http from "http";
import https from "https";
import {
  DesktopNotificationPayload,
  DesktopSource,
  UserStatus,
} from "@tescord/types";

// 开发环境下忽略自签名证书错误 (配合 Vite basicSsl HTTPS 开发模式)
if (process.env.NODE_ENV !== "production") {
  app.commandLine.appendSwitch("ignore-certificate-errors");
}

// 1. 单例进程保护 (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("⚠️ 检测到已有 Tescord 实例在运行，本进程将直接退出并唤醒前台窗口。");
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

function updateTrayContextMenu(currentUserStatus: UserStatus = "ONLINE") {
  if (!tray) return;

  const isAutoLaunch = app.getLoginItemSettings().openAtLogin;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开 Tescord",
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
      label: "在线状态",
      submenu: [
        {
          label: "🟢 在线 (Online)",
          type: "radio",
          checked: currentUserStatus === "ONLINE",
          click: () => {
            mainWindow?.webContents.send("tray-status-change", "ONLINE");
          },
        },
        {
          label: "🟡 闲置 (Idle)",
          type: "radio",
          checked: currentUserStatus === "IDLE",
          click: () => {
            mainWindow?.webContents.send("tray-status-change", "IDLE");
          },
        },
        {
          label: "🔴 请勿打扰 (Do Not Disturb)",
          type: "radio",
          checked: currentUserStatus === "DND",
          click: () => {
            mainWindow?.webContents.send("tray-status-change", "DND");
          },
        },
        {
          label: "⚪ 隐身 (Invisible)",
          type: "radio",
          checked: currentUserStatus === "OFFLINE",
          click: () => {
            mainWindow?.webContents.send("tray-status-change", "OFFLINE");
          },
        },
      ],
    },
    { type: "separator" },
    {
      label: "静音麦克风 (Ctrl+Shift+M)",
      click: () => {
        mainWindow?.webContents.send("toggle-global-mute");
      },
    },
    {
      label: "开机自启动",
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
      label: "退出 Tescord",
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
  const icon = createDefaultTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("Tescord 本地私有化实时通讯客户端");

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 500,
    backgroundColor: "#313338",
    title: "Tescord 客户端",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
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
ipcMain.handle("get-desktop-sources", async (): Promise<DesktopSource[]> => {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    type: s.id.startsWith("screen") ? "screen" : "window",
    appIcon:
      s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined,
  }));
});

// 3. 注册按键说话 (PTT) 系统级热键
ipcMain.handle("set-ptt-keybind", async (_event, key: string) => {
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
  async (_event, payload: DesktopNotificationPayload) => {
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
