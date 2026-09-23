import { test, expect } from "@playwright/test";

test.describe("超级管理员控制台与私信列表全链路端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/e2ee/devices", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/api/e2ee/keys/prekey", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.route("**/api/channels/*/read", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lastReadSequence: 0 }) }));
  });
  test("超级管理员登录后：具备管理入口、可开启看板模态框、切换四大标签页与发布全网广播", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 预置超级管理员身份凭据与 mock 接口
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "super_admin_mock_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 当前用户信息为 SUPER_ADMIN
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "admin_user_id",
          username: "Jackey",
          displayName: "Jackey 超级管理员",
          email: "admin@tescord.local",
          role: "SUPER_ADMIN",
          isBanned: false,
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock 公会列表
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_1",
            name: "Tescord 开发者大本营",
            ownerId: "admin_user_id",
            iconUrl: null,
            channels: [
              {
                id: "ch_general",
                name: "常规讨论",
                type: "TEXT",
                guildId: "guild_1",
                position: 0,
              },
            ],
            categories: [],
            members: [
              {
                id: "gm_1",
                guildId: "guild_1",
                userId: "admin_user_id",
                roles: [],
                user: {
                  id: "admin_user_id",
                  username: "Jackey",
                  role: "SUPER_ADMIN",
                  status: "ONLINE",
                },
              },
            ],
          },
        ]),
      });
    });

    // Mock 私信列表
    await page.route("**/api/users/@me/channels", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "dm_ch_1",
              name: "Bob",
              type: "DM",
              guildId: null,
              recipients: [
                {
                  id: "user_bob",
                  username: "Bob",
                  avatarUrl: null,
                  status: "ONLINE",
                },
              ],
              unreadCount: 2,
              lastMessage: {
                id: "m_1",
                channelId: "dm_ch_1",
                authorId: "user_bob",
                content: "嗨，下午有空排查一下 SFU 连接吗？",
                createdAt: new Date().toISOString(),
              },
            },
          ]),
        });
      } else {
        route.continue();
      }
    });

    // Mock 频道消息
    await page.route("**/api/channels/*/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock 云端偏好设置
    await page.route("**/api/users/@me/settings", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          noiseSuppression: true,
          noiseSuppressionMode: "rnnoise",
          autoGainControl: true,
          echoCancellation: true,
          inputVolume: 100,
          outputVolume: 100,
        }),
      });
    });

    // Mock 超管各项 API
    await page.route("**/api/admin/overview*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalUsers: 128,
          onlineUsers: 42,
          bannedUsers: 3,
          totalGuilds: 16,
          totalChannels: 64,
          totalMessages: 5820,
          memoryUsage: {
            rss: "128 MB",
            heapUsed: "64 MB",
            heapTotal: "96 MB",
          },
          uptimeSeconds: 86400,
        }),
      });
    });

    await page.route("**/api/admin/users*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "user_bob",
            username: "Bob",
            email: "bob@example.com",
            role: "USER",
            isBanned: false,
            createdAt: new Date().toISOString(),
          },
          {
            id: "user_spammer",
            username: "BadActor",
            email: "bad@example.com",
            role: "USER",
            isBanned: true,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route("**/api/admin/guilds*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_1",
            name: "Tescord 开发者大本营",
            owner: { id: "admin_user_id", username: "Jackey" },
            memberCount: 25,
            channelCount: 8,
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.route("**/api/admin/settings*", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            allowRegistration: true,
            activeBroadcast: null,
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.route("**/api/admin/system/broadcast", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          broadcast: {
            id: "bc_1",
            content: "系统将在今晚 22:00 进行例行网络拓扑维护",
            level: "warning",
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. 验证左侧导航栏中呈现超级管理员专属盾牌入口
    const adminBtn = page.locator("[data-testid='admin-dashboard-btn']");
    await expect(adminBtn).toBeVisible({ timeout: 10000 });

    // 2. 点击盾牌图标，弹出超级管理员控制台模态框
    await adminBtn.click();
    const adminModal = page.locator("[data-testid='admin-dashboard-modal']");
    await expect(adminModal).toBeVisible();
    await expect(adminModal).toContainText("超级管理员系统控制台");

    // 3. 验证“指标大屏”标签页
    await expect(adminModal).toContainText("128"); // 总注册用户数
    await expect(adminModal).toContainText("42"); // 实时在线用户
    await expect(adminModal).toContainText("16"); // 服务器活跃数
    await expect(adminModal).toContainText("5820"); // 历史消息总量

    // 4. 切换到“用户管理”标签页
    const usersTabBtn = page.locator("[data-testid='admin-tab-users']");
    await usersTabBtn.click();
    await expect(adminModal).toContainText("Bob");
    await expect(adminModal).toContainText("BadActor");
    await expect(adminModal).toContainText("已封禁");

    // 5. 切换到“公会监管”标签页
    const guildsTabBtn = page.locator("[data-testid='admin-tab-guilds']");
    await guildsTabBtn.click();
    await expect(adminModal).toContainText("Tescord 开发者大本营");
    await expect(adminModal).toContainText("强制解散");

    // 6. 切换到“系统设置与广播”标签页
    const systemTabBtn = page.locator("[data-testid='admin-tab-system']");
    await systemTabBtn.click();
    await expect(adminModal).toContainText("开放新用户注册");
    await expect(adminModal).toContainText("向全平台在线用户推送置顶广播");

    // 7. 关闭管理面板
    const closeBtn = page.locator("[data-testid='close-admin-modal-btn']");
    await closeBtn.click();
    await expect(adminModal).not.toBeVisible();

    // 确保没有致命控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("普通用户登录：无管理员盾牌，可切换私信列表并查看会话与呼叫按钮", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "normal_user_mock_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 普通用户 (role: USER)
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "normal_user_id",
          username: "Alice",
          displayName: "Alice",
          email: "alice@tescord.local",
          role: "USER",
          isBanned: false,
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "dm_ch_bob",
            name: "Bob",
            type: "DM",
            guildId: null,
            recipients: [
              {
                id: "user_bob",
                username: "Bob",
                avatarUrl: null,
                status: "ONLINE",
              },
            ],
            unreadCount: 1,
            lastMessage: {
              id: "msg_dm_1",
              channelId: "dm_ch_bob",
              authorId: "user_bob",
              content: "我们开始音视频通话测试吧！",
              createdAt: new Date().toISOString(),
            },
          },
        ]),
      });
    });

    await page.route("**/api/channels/*/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg_dm_1",
            channelId: "dm_ch_bob",
            authorId: "user_bob",
            content: "我们开始音视频通话测试吧！",
            createdAt: new Date().toISOString(),
            author: {
              id: "user_bob",
              username: "Bob",
              avatarUrl: null,
            },
          },
        ]),
      });
    });

    await page.route("**/api/users/@me/settings", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. 验证普通用户端没有管理员盾牌按钮
    const adminBtn = page.locator("[data-testid='admin-dashboard-btn']");
    await expect(adminBtn).not.toBeVisible();

    // 2. 验证左侧呈现私信列表，且包含与 Bob 的私信项与未读气泡
    const dmItem = page.locator("[data-testid='dm-item-dm_ch_bob']");
    await expect(dmItem).toBeVisible({ timeout: 10000 });
    await expect(dmItem).toContainText("Bob");
    await expect(dmItem).toContainText("我们开始音视频通话测试吧！");

    // 3. 点击进入与 Bob 的私信聊天区
    await dmItem.click();

    // 4. 验证聊天主区域头部呈现 "@Bob" 专属私信标题及语音/视频呼叫按钮
    const voiceCallBtn = page.locator("[data-testid='dm-start-voice-call-btn']");
    const videoCallBtn = page.locator("[data-testid='dm-start-video-call-btn']");
    await expect(voiceCallBtn).toBeVisible();
    await expect(videoCallBtn).toBeVisible();

    // 5. 验证发起私信按钮 "+" 能够呼出发起私信模态框
    const createDmBtn = page.locator("[data-testid='create-dm-btn']");
    await expect(createDmBtn).toBeVisible();
    await createDmBtn.click();
    const createDmInput = page.locator("[data-testid='create-dm-input']");
    await expect(createDmInput).toBeVisible();

    // 确保没有致命控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
