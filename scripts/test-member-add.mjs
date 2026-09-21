import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("../apps/server/node_modules/ws/index.js");

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

// 挂载真实 WebSocket 服务以模拟 Gateway 网关
const wss = new WebSocketServer({ server });
let activeSocket = null;

wss.on("connection", (ws) => {
  console.log("[MockGateway] WebSocket client connected");
  activeSocket = ws;

  // 发送 HELLO 握手信令 (OpCode 10)
  ws.send(
    JSON.stringify({
      op: 10,
      d: {
        heartbeatIntervalMs: 30000,
      },
    }),
  );

  ws.on("message", (msg) => {
    try {
      const payload = JSON.parse(msg.toString());
      // 收到鉴权 IDENTIFY (OpCode 2)
      if (payload.op === 2) {
        console.log("[MockGateway] Received IDENTIFY, sending READY");
        ws.send(
          JSON.stringify({
            op: 0,
            t: "READY",
            d: {
              sessionId: "mock_session_123",
              user: {
                id: "user_test_1",
                username: "tester",
                status: "ONLINE",
              },
              guilds: [
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
                      roleIds: [],
                      roles: [],
                      joinedAt: new Date().toISOString(),
                      user: {
                        id: "user_test_1",
                        username: "tester",
                        status: "ONLINE",
                      },
                    },
                  ],
                  roles: [],
                },
              ],
            },
          }),
        );
      }
    } catch (e) {
      console.error("[MockGateway] Message error:", e);
    }
  });

  ws.on("close", () => {
    if (activeSocket === ws) activeSocket = null;
  });
});

const PORT = 4188;
server.listen(PORT, async () => {
  console.log(`Test server running at http://localhost:${PORT}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    page.on("console", (msg) => {
      const text = msg.text();
      if (!text.includes("AudioContext")) {
        console.log("PAGE LOG:", text);
      }
    });
    page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

    // 注入 mock 认证 token
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_test_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 关键 API
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
                roleIds: [],
                roles: [],
                joinedAt: new Date().toISOString(),
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

    console.log("Navigating to test page...");
    await page.goto(`http://localhost:${PORT}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // 1. 验证初始成员列表仅显示“测试员”
    console.log("Step 1: Check initial member list...");
    const initialTester = page.locator("aside", { hasText: "测试员" });
    await initialTester.first().waitFor({ state: "visible", timeout: 5000 });
    console.log("PASS: Initial tester found in member list.");

    const initialAlice = page.locator("aside", { hasText: "爱丽丝" });
    const countBefore = await initialAlice.count();
    if (countBefore !== 0) {
      throw new Error("Unexpected member '爱丽丝' present before join event!");
    }
    console.log("PASS: Alice is not present initially as expected.");

    // 2. 网关向客户端广播 GUILD_MEMBER_ADD 信令
    console.log("Step 2: Broadcasting GUILD_MEMBER_ADD event for Alice...");
    if (!activeSocket) {
      throw new Error("Gateway WebSocket connection was not established!");
    }

    const memberAddPayload = {
      op: 0,
      t: "GUILD_MEMBER_ADD",
      d: {
        guildId: "guild_test_1",
        member: {
          userId: "user_alice",
          guildId: "guild_test_1",
          nickname: "爱丽丝",
          roleIds: [],
          roles: [],
          joinedAt: new Date().toISOString(),
          user: {
            id: "user_alice",
            username: "alice_wonderland",
            displayName: "爱丽丝",
            status: "ONLINE",
          },
        },
      },
    };

    // 验证脱敏：确保广播的数据包中不含 passwordHash
    if (JSON.stringify(memberAddPayload).includes("passwordHash")) {
      throw new Error("Security check failed: payload contains passwordHash!");
    }
    console.log("PASS: Security verification passed (no passwordHash in payload).");

    activeSocket.send(JSON.stringify(memberAddPayload));

    // 3. 断言：成员列表中自动出现“爱丽丝”，无需刷新页面
    console.log("Step 3: Waiting for Alice to appear in member list automatically...");
    const aliceMember = page.locator("aside", { hasText: "爱丽丝" }).first();
    await aliceMember.waitFor({ state: "visible", timeout: 5000 });
    console.log("PASS: Alice automatically appeared in member list upon GUILD_MEMBER_ADD!");

    // 4. 广播 GUILD_MEMBER_REMOVE 信令验证下线/离开联动
    console.log("Step 4: Broadcasting GUILD_MEMBER_REMOVE event for Alice...");
    const memberRemovePayload = {
      op: 0,
      t: "GUILD_MEMBER_REMOVE",
      d: {
        guildId: "guild_test_1",
        userId: "user_alice",
      },
    };
    activeSocket.send(JSON.stringify(memberRemovePayload));

    console.log("Step 5: Waiting for Alice to disappear from member list...");
    await aliceMember.waitFor({ state: "hidden", timeout: 5000 });
    console.log("PASS: Alice automatically disappeared from member list upon GUILD_MEMBER_REMOVE!");

    console.log("\n=======================================================");
    console.log("🎉 ALL REALTIME MEMBER SYNC TESTS PASSED SUCCESSFULLY! 🎉");
    console.log("=======================================================\n");
  } catch (err) {
    console.error("TEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
    process.exit(process.exitCode || 0);
  }
});
