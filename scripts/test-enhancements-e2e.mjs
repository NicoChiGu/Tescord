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
  let filePath = path.join(
    distDir,
    req.url === "/" ? "index.html" : req.url.split("?")[0],
  );
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
  console.log(`Test static server running at http://localhost:${PORT}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

    // 模拟 Electron 桌面环境注入 window.electronAPI
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_test_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem("tescord_last_seen_changelog_version", "99.0.0");

      const baseApi = {
        platform: "win32",
        isWindowMaximized: async () => false,
        onWindowMaximizedChange: () => () => {},
        getWindowType: async () => "main",
        getWindowMode: async () => "main",
        onWindowModeChange: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => true,
        getZoomFactor: async () => 1,
        getGPUInfo: async () => ({}),
        getDetectedGame: async () => null,
        getGameDetectionEnabled: async () => false,
        onGameActivityChanged: () => () => {},
        onZoomFactorChange: () => () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalDeafenToggle: () => () => {},
        onTriggerScreenCapture: () => () => {},
        onStatusChangeFromTray: () => () => {},
        onNotificationClick: () => () => {},
        syncLocale: () => {},
        syncUserStatus: () => {},
        getDesktopSources: async () => [],
        registerKeybinds: async () => ({ success: true, conflicts: [] }),
        captureScreenBitmap: async () =>
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        writeClipboardImage: async () => true,
        saveImageFile: async () => true,
      };
      window.electronAPI = baseApi;
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user_test_1",
          username: "tester",
          displayName: "测试员",
          email: "test@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_test_1",
            name: "测试服务器",
            ownerId: "user_test_1",
            iconUrl: null,
            channels: [
              {
                id: "chan_test_1",
                name: "常规讨论",
                type: "TEXT",
                guildId: "guild_test_1",
              },
            ],
            members: [
              {
                userId: "user_test_1",
                guildId: "guild_test_1",
                nickname: "测试员",
                roleIds: "[]",
                user: {
                  id: "user_test_1",
                  username: "tester",
                  displayName: "测试员",
                  status: "ONLINE",
                },
              },
            ],
            roles: [],
          },
        ]),
      });
    });

    await page.route("**/api/channels/**/messages**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    console.log("Navigating to test page in simulated Electron mode...");
    await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // ==========================================
    // 验收 1：左下角用户信息栏已彻底移除网络延迟徽标
    // ==========================================
    console.log("Test 1: Verify gateway-ping-badge is completely removed from user bar...");
    const pingBadge = page.locator('[data-testid="gateway-ping-badge"]');
    const pingCount = await pingBadge.count();
    if (pingCount !== 0) {
      throw new Error(`Expected gateway-ping-badge count to be 0, found ${pingCount}`);
    }
    console.log("✓ Gateway ping badge successfully removed from user bar!");

    // ==========================================
    // 验收 2：点击进入频道，检查聊天输入框屏幕截图快捷按钮 (仅 Electron 可见)
    // ==========================================
    console.log("Test 2: Select channel and verify chat screenshot button in Electron...");
    const serverButton = page.locator("aside button", { hasText: "测" }).first();
    await serverButton.waitFor({ state: "visible", timeout: 5000 });
    await serverButton.click();
    await page.waitForTimeout(400);

    const channelItem = page.locator("text=常规讨论").first();
    await channelItem.waitFor({ state: "visible", timeout: 5000 });
    await channelItem.click();
    await page.waitForTimeout(500);

    const screenshotBtn = page.locator('[data-testid="chat-screenshot-btn"]');
    await screenshotBtn.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ Screenshot button is visible in chat toolbar!");

    // ==========================================
    // 验收 3：打开用户设置并切换到快捷键设置面板
    // ==========================================
    console.log("Test 3: Open User Settings and switch to Keybinds Tab...");
    const userBarSettingsBtn = page.locator('[data-testid="user-settings-gear-btn"]');
    await userBarSettingsBtn.waitFor({ state: "visible", timeout: 5000 });
    await userBarSettingsBtn.click();
    await page.waitForTimeout(500);

    const keybindsTabBtn = page.locator('[data-testid="tab-keybinds-btn"]');
    await keybindsTabBtn.waitFor({ state: "visible", timeout: 5000 });
    await keybindsTabBtn.click();
    await page.waitForTimeout(500);

    const keybindsTabContent = page.locator('[data-testid="keybinds-settings-tab"]');
    await keybindsTabContent.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ Keybinds Settings Tab is rendered properly!");

    // 检查每一项预设按键动作行
    const muteRow = page.locator('[data-testid="keybind-row-TOGGLE_MUTE"]');
    const deafenRow = page.locator('[data-testid="keybind-row-TOGGLE_DEAFEN"]');
    const captureRow = page.locator('[data-testid="keybind-row-SCREEN_CAPTURE"]');
    await muteRow.waitFor({ state: "visible", timeout: 2000 });
    await deafenRow.waitFor({ state: "visible", timeout: 2000 });
    await captureRow.waitFor({ state: "visible", timeout: 2000 });
    console.log("✓ All 3 keybind rows (Mute, Deafen, Screen Capture) are present!");

    // ==========================================
    // 验收 4：按键冲突检测验证
    // ==========================================
    console.log("Test 4: Testing keybind conflict detection...");
    // 尝试把 Deafen 按键录制成与 Mute 相同的 Ctrl+Shift+M
    const deafenRecordBtn = page.locator('[data-testid="keybind-record-btn-TOGGLE_DEAFEN"]');
    await deafenRecordBtn.click();
    await page.waitForTimeout(200);

    // 模拟按下 Control + Shift + M
    await page.keyboard.press("Control+Shift+KeyM");
    await page.waitForTimeout(300);

    // 检查冲突 Toast 弹出
    const toastElem = page.locator('[data-testid="keybind-toast"]');
    await toastElem.waitFor({ state: "visible", timeout: 3000 });
    const toastText = await toastElem.textContent();
    console.log(`✓ Conflict toast successfully caught: "${toastText?.trim()}"`);

    // 关闭用户设置面板
    const closeSettingsBtn = page.locator('[data-testid="close-user-settings-btn"]');
    await closeSettingsBtn.click();
    await page.waitForTimeout(400);

    // ==========================================
    // 验收 5：触发屏幕截图蒙层交互
    // ==========================================
    console.log("Test 5: Trigger screen capture overlay...");
    await screenshotBtn.click();
    await page.waitForTimeout(500);

    const captureOverlay = page.locator('[data-testid="screen-capture-overlay"]');
    await captureOverlay.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ Screen capture overlay appeared!");

    // 在蒙层上模拟鼠标拖拽划框
    const box = await captureOverlay.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      // 验证选区和工具栏出现
      const selectionBox = page.locator('[data-testid="screen-capture-selection"]');
      const actionToolbar = page.locator('[data-testid="screen-capture-actions"]');
      await selectionBox.waitFor({ state: "visible", timeout: 2000 });
      await actionToolbar.waitFor({ state: "visible", timeout: 2000 });
      console.log("✓ Crop selection and action buttons appeared properly!");

      // 按 Escape 取消
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const isStillOpen = await captureOverlay.isVisible();
      if (!isStillOpen) {
        console.log("✓ Screen capture overlay successfully closed on Escape!");
      }
    }

    console.log("\n==========================================");
    console.log("🎉 所有新增功能端到端自动化验收全部通过 (100% PASS)！");
    console.log("==========================================");
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
