import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../apps/web/dist");

// 简易静态服务器加载打包产物
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

const PORT = 4179;
server.listen(PORT, async () => {
  console.log(`Test static server running at http://localhost:${PORT}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

    // 注入 mock 认证 token 和基础状态，模拟已登录用户
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_test_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem("tescord_last_seen_changelog_version", "99.0.0");
    });

    // Mock 后端关键 API
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
        body: JSON.stringify([
          {
            id: "msg_test_1",
            content: "这是一条测试消息",
            channelId: "chan_test_1",
            authorId: "user_test_1",
            createdAt: new Date().toISOString(),
            author: {
              id: "user_test_1",
              username: "tester",
              displayName: "测试员",
            },
          },
        ]),
      });
    });

    console.log("Navigating to test page...");
    await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // 1. 测试服务器图标右键菜单 (ServerContextMenu)
    console.log("Test 1: Right click on server icon...");
    const serverButton = page.locator("aside button", { hasText: "测" }).first();
    await serverButton.waitFor({ state: "visible", timeout: 5000 });
    await serverButton.click({ button: "right" });
    await page.waitForTimeout(400);

    // 检查 ContextMenuContent 是否弹出并且可见
    const menuContent = page.locator('[role="menu"]');
    const isMenuVisible = await menuContent.isVisible();
    console.log("Server ContextMenu visible:", isMenuVisible);

    if (isMenuVisible) {
      const menuText = await menuContent.innerText();
      console.log("Server ContextMenu items found:\n", menuText.trim());
      const boundingBox = await menuContent.boundingBox();
      console.log("Server ContextMenu coordinates:", boundingBox);

      // 严格防闪烁断言：菜单绝不能落在屏幕左上角 (0, 0) 错误初始锚点
      if (!boundingBox || (boundingBox.x < 10 && boundingBox.y < 10)) {
        throw new Error("ContextMenu positioned at (0, 0) flicker anchor!");
      }
    }

    if (!isMenuVisible) {
      throw new Error("Server ContextMenu failed to show!");
    }

    // 测试点击菜单项能够正常按下触发并关闭
    console.log("Testing click on menu item '标记为已读'...");
    const markAsReadItem = page.locator('[role="menuitem"]', { hasText: "标记为已读" });
    await markAsReadItem.click();
    await page.waitForTimeout(300);
    const isMenuStillVisible = await menuContent.isVisible();
    console.log("Menu dismissed after item click:", !isMenuStillVisible);
    if (isMenuStillVisible) {
      throw new Error("Menu failed to trigger and dismiss after clicking item!");
    }

    // 2. 测试频道条目右键菜单 (ChannelContextMenu)，并验证防前一个 Menu 坐标闪烁
    console.log("Test 2: Right click on channel item and verify no flicker of previous coordinates...");
    const channelItem = page.locator("text=常规讨论").first();
    await channelItem.waitFor({ state: "visible", timeout: 5000 });
    const channelItemBox = await channelItem.boundingBox();
    console.log("channelItem coordinates:", channelItemBox);

    await channelItem.click({ button: "right" });
    await page.waitForTimeout(400);

    const channelMenuVisible = await menuContent.isVisible();
    console.log("Channel ContextMenu visible:", channelMenuVisible);
    if (channelMenuVisible) {
      const channelMenuText = await menuContent.innerText();
      console.log("Channel ContextMenu items found:\n", channelMenuText.trim());
      const channelMenuBox = await menuContent.boundingBox();
      console.log("Channel ContextMenu coordinates:", channelMenuBox);

      // 防前一坐标残留断言：频道菜单绝不能闪烁在服务器菜单的旧坐标 (38, 102)
      if (channelMenuBox && channelItemBox) {
        if (Math.abs(channelMenuBox.x - 38) < 10 && Math.abs(channelMenuBox.y - 102) < 10) {
          throw new Error("Flicker detected: Channel Menu rendered at previous Server Menu coordinates!");
        }
        // 且频道菜单必须在频道条目附近展开
        if (channelMenuBox.x < 100) {
          throw new Error("Channel Menu position is not aligned with target channel item!");
        }
      }
    }
    if (!channelMenuVisible) {
      throw new Error("Channel ContextMenu failed to show!");
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // 3. 测试消息行右键菜单 (MessageContextMenu)
    console.log("Test 3: Right click on message...");
    const messageItem = page.locator("text=这是一条测试消息").first();
    if (await messageItem.isVisible()) {
      await messageItem.click({ button: "right" });
      await page.waitForTimeout(400);
      const msgMenuVisible = await menuContent.isVisible();
      console.log("Message ContextMenu visible:", msgMenuVisible);
      if (msgMenuVisible) {
        const msgMenuText = await menuContent.innerText();
        console.log("Message ContextMenu items found:\n", msgMenuText.trim());
      }
      if (!msgMenuVisible) {
        throw new Error("Message ContextMenu failed to show!");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    // 4. 测试聊天输入框右键菜单 (InputContextMenu)
    console.log("Test 4: Right click on chat input...");
    const chatInput = page.locator('input[placeholder*="发送消息"]').first();
    if (await chatInput.isVisible()) {
      await chatInput.click({ button: "right" });
      await page.waitForTimeout(400);
      const inputMenuVisible = await menuContent.isVisible();
      console.log("Input ContextMenu visible:", inputMenuVisible);
      if (inputMenuVisible) {
        const inputMenuText = await menuContent.innerText();
        console.log("Input ContextMenu items found:\n", inputMenuText.trim());
      }
      if (!inputMenuVisible) {
        throw new Error("Input ContextMenu failed to show!");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    console.log("\n🎉 所有 Radix UI 右键菜单测试全部通过并确认物理可见！");
  } catch (err) {
    console.error("Test failed:", err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
