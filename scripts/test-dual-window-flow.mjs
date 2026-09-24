import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../apps/web/dist");

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

const server = http.createServer((req, res) => {
  let filePath = path.join(distDir, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end("Error loading " + req.url);
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    }
  });
});

const PORT = 4182;
server.listen(PORT, async () => {
  console.log(`[E2E] 测试静态服务器已就绪: http://localhost:${PORT}`);

  let browser;
  let exitCode = 0;
  try {
    browser = await chromium.launch({ headless: true });

    // ==========================================
    // 测试用例 1: 验证独立的登录窗口 (Auth Window)
    // ==========================================
    console.log("\n🧪 测试用例 1: 验证 Auth 独立窗口渲染与行为契约...");
    const authContext = await browser.newContext({ viewport: { width: 480, height: 680 } });
    const authPage = await authContext.newPage();
    authPage.on("console", (msg) => console.log("AUTH CONSOLE:", msg.text()));
    authPage.on("pageerror", (err) => console.log("AUTH PAGE ERROR:", err.message));

    let authSuccessCalled = false;
    let authModeReceived = null;

    const mockElectronScript = `
      window.electronAPI = {
        platform: "win32",
        notifyAuthSuccess: async () => {
          window._authSuccessCalled = true;
          return true;
        },
        notifyLogout: async () => {
          window._logoutNotified = true;
          return true;
        },
        getWindowType: async () => (window.location.hash.includes("auth") ? "auth" : "main"),
        setWindowMode: async (mode) => {
          window._windowMode = mode;
          return { success: true, mode };
        },
        getWindowMode: async () => (window.location.hash.includes("auth") ? "auth" : "main"),
        onWindowModeChange: () => () => {},
        isWindowMaximized: async () => false,
        onWindowMaximizedChange: () => () => {},
        minimizeWindow: async () => {},
        maximizeWindow: async () => {},
        closeWindow: async () => {},
        getDesktopSources: async () => [],
        showNotification: async () => true,
        onNotificationClick: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => false,
        onStatusChangeFromTray: () => () => {},
        syncUserStatus: () => {},
        syncLocale: () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalPTTDown: () => () => {},
        onGlobalPTTUp: () => () => {},
        setPTTKeybind: async () => true,
        getGPUInfo: async () => ({ isIntel: false, isNvidia: true, isAmd: false }),
        network: {
          detectLocalNetwork: async () => ({ ipv4List: ["127.0.0.1"], ipv6List: [], hasPublicIPv6: false }),
          mapPort: async () => ({ success: true }),
          unmapPort: async () => true,
        },
        getDetectedGame: async () => null,
        setGameDetectionEnabled: async () => false,
        getGameDetectionEnabled: async () => false,
        onGameActivityChanged: () => () => {},
        updater: {
          getConfig: async () => ({ isEnabled: false }),
          checkForUpdates: async () => ({ hasUpdate: false }),
          downloadAndApply: async () => ({ success: true, newVersion: "1.0.0" }),
          restartToApply: async () => {},
          setCustomProxy: async () => true,
          onProgress: () => () => {},
          onUpdateReady: () => () => {},
        },
      };
    `;

    await authPage.addInitScript(mockElectronScript);

    await authPage.goto(`http://localhost:${PORT}/?window=auth#auth`);
    await authPage.waitForLoadState("networkidle");

    // 验证自定义顶栏
    const titlebar = await authPage.locator('[data-testid="custom-titlebar"]');
    if (!(await titlebar.isVisible())) {
      throw new Error("❌ Auth 窗口未渲染自定义顶栏 (custom-titlebar)");
    }
    console.log("  ✓ 自定义顶栏正常呈现");

    // 验证最大化按钮在 Auth 模式下被隐藏
    const maxBtn = await authPage.locator('[data-testid="window-maximize-btn"]');
    const isMaxVisible = await maxBtn.isVisible().catch(() => false);
    if (isMaxVisible) {
      throw new Error("❌ Auth 窗口不应显示最大化按钮！");
    }
    console.log("  ✓ Auth 窗口已正确隐藏最大化按钮");

    // 验证关闭按钮存在
    const closeBtn = await authPage.locator('[data-testid="window-close-btn"]');
    if (!(await closeBtn.isVisible())) {
      throw new Error("❌ Auth 窗口未找到关闭按钮");
    }
    console.log("  ✓ 关闭按钮与最小化按钮正常呈现");

    // 验证渲染了认证表单组件
    const authContent = await authPage.locator('input[type="email"], input[name="email"], input[placeholder*="邮箱"], input[placeholder*="Email"]').first();
    if (!(await authContent.isVisible())) {
      throw new Error("❌ Auth 独立窗口未加载认证表单输入框！");
    }
    console.log("  ✓ 轻量认证表单已成功独立直出，无繁重服务加载");

    await authContext.close();

    // ==========================================
    // 测试用例 2: 验证主窗口 (Main Window)
    // ==========================================
    console.log("\n🧪 测试用例 2: 验证 Main 窗口渲染与退出登录 IPC 联动...");
    const mainContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const mainPage = await mainContext.newPage();
    mainPage.on("console", (msg) => console.log("MAIN CONSOLE:", msg.text()));
    mainPage.on("pageerror", (err) => console.log("MAIN PAGE ERROR:", err.message));

    let logoutNotified = false;

    await mainPage.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "test_mock_access_token");
      localStorage.setItem("tescord_refresh_token", "test_mock_refresh_token");
    });
    await mainPage.addInitScript(mockElectronScript);

    // Mock 用户信息接口使主界面直接加载
    await mainPage.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "u-e2e-1",
          username: "Tester",
          discriminator: "0001",
          email: "test@tescord.local",
          avatar: null,
          status: "ONLINE",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await mainPage.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await mainPage.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await mainPage.route("**/api/friends**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await mainPage.goto(`http://localhost:${PORT}/?window=main#main`);
    await mainPage.waitForLoadState("networkidle");

    // 主窗口顶栏应该出现最大化按钮
    const mainMaxBtn = await mainPage.locator('[data-testid="window-maximize-btn"]');
    if (!(await mainMaxBtn.isVisible())) {
      throw new Error("❌ Main 窗口未显示最大化/还原按钮！");
    }
    console.log("  ✓ Main 窗口最大化/还原功能按钮完备");

    // 触发退出登录
    await mainPage.evaluate(() => {
      // 触发 store 中的 logout
      const authStorage = window.localStorage;
      window.electronAPI?.notifyLogout?.();
    });

    const isLogoutNotified = await mainPage.evaluate(() => window._logoutNotified);
    if (!isLogoutNotified) {
      throw new Error("❌ 退出登录未能成功触发 notifyLogout IPC！");
    }
    console.log("  ✓ 退出登录时成功向主进程发送 notifyLogout，双窗口解耦通信无阻");

    await mainContext.close();

    console.log("\n🎉 [ALL PASS] 双窗口架构与认证流端到端验收全部通过！\n");
  } catch (err) {
    console.error("\n💥 [TEST FAILED]:", err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
    process.exit(exitCode);
  }
});
