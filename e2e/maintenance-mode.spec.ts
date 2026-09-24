import { test, expect } from "@playwright/test";

test.describe("管理员维护模式（Maintenance Mode）全链路与 WebSocket 响应端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/e2ee/devices", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.route("**/api/e2ee/keys/prekey", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.route("**/api/channels/*/read", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lastReadSequence: 0 }),
      }),
    );
    await page.route("**/api/discovery/guilds", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"status":"ok"}',
      }),
    );
  });

  test("用例 1：普通用户在维护开启时即时呈现全屏维护页，长连接保持，维护解除后秒级恢复", async ({
    page,
  }) => {
    // 预置普通用户登录凭据
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "normal_user_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 普通用户信息
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "normal_user_id",
          username: "NormalUser",
          displayName: "普通成员",
          email: "user@tescord.local",
          role: "USER",
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
            name: "测试社区",
            ownerId: "owner_1",
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
            members: [],
            roles: [],
          },
        ]),
      });
    });

    await page.route("**/api/channels/ch_general/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me/dm-channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/");

    // 初始状态下正常加载并显示主界面，维护覆盖层不可见
    await expect(page.locator("body")).toBeVisible();
    await expect(
      page.locator('[data-testid="maintenance-screen"]'),
    ).not.toBeVisible();

    // 模拟服务端通过网关广播推送维护模式开启
    await page.evaluate(() => {
      const anyWindow = window as any;
      if (anyWindow.__TESCORD_MAINTENANCE_STORE__) {
        anyWindow.__TESCORD_MAINTENANCE_STORE__.getState().setMaintenance({
          enabled: true,
          announcement: "平台正在进行数据库架构演练，预计 10 分钟后恢复",
          triggeredAt: new Date().toISOString(),
        });
      }
    });

    // 验证全屏维护页面立即浮现
    const maintenanceScreen = page.locator(
      '[data-testid="maintenance-screen"]',
    );
    await expect(maintenanceScreen).toBeVisible({ timeout: 5000 });

    // 验证维护公告与长连接提示
    await expect(maintenanceScreen).toContainText("系统正在维护升级");
    await expect(maintenanceScreen).toContainText("平台正在进行数据库架构演练");
    await expect(maintenanceScreen).toContainText(
      "实时长连接通道已建立，维护结束后将自动秒级恢复",
    );

    // 验证点击“检查系统状态”按钮有反应
    const checkBtn = maintenanceScreen.locator(
      "button:has-text('检查系统状态')",
    );
    await expect(checkBtn).toBeVisible();
    await checkBtn.click();

    // 模拟管理员关闭维护模式（网关广播解除事件）
    await page.evaluate(() => {
      const anyWindow = window as any;
      if (anyWindow.__TESCORD_MAINTENANCE_STORE__) {
        anyWindow.__TESCORD_MAINTENANCE_STORE__.getState().clearMaintenance();
      }
    });

    // 验证维护全屏遮罩即刻秒级恢复并消失
    await expect(maintenanceScreen).not.toBeVisible({ timeout: 5000 });
  });

  test("用例 2：超级管理员登录不受维护页阻断，顶部常驻运维警示条，支持一键解除维护", async ({
    page,
  }) => {
    page.on("console", (msg) => {
      console.log(`[Browser Console ${msg.type()}]:`, msg.text());
    });

    await page.addInitScript(() => {
      const realToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (realToken) {
        localStorage.setItem("tescord_access_token", realToken);
      }
      const realRefresh =
        localStorage.getItem("tescord_e2e_refresh_token") ||
        localStorage.getItem("tescord_refresh_token");
      if (realRefresh) {
        localStorage.setItem("tescord_refresh_token", realRefresh);
      }
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "admin_user_id",
          username: "SuperAdmin",
          displayName: "超级管理员",
          email: "admin@tescord.local",
          role: "SUPER_ADMIN",
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

    await page.route("**/api/users/@me/dm-channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    let patchCalled = false;
    await page.route("**/api/admin/settings", (route) => {
      if (route.request().method() === "PATCH") {
        patchCalled = true;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            allowRegistration: true,
            maintenanceMode: false,
            systemAnnouncement: "",
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            allowRegistration: true,
            maintenanceMode: true,
            systemAnnouncement: "机房核心演练中",
          }),
        });
      }
    });

    await page.goto("/");

    // 激活维护模式
    await page.evaluate(() => {
      const anyWindow = window as any;
      if (anyWindow.__TESCORD_MAINTENANCE_STORE__) {
        anyWindow.__TESCORD_MAINTENANCE_STORE__.getState().setMaintenance({
          enabled: true,
          announcement: "超级管理员维护中",
          triggeredAt: new Date().toISOString(),
        });
      }
    });

    // 验证超级管理员不会看到全屏维护页面
    await expect(
      page.locator('[data-testid="maintenance-screen"]'),
    ).not.toBeVisible();

    // 验证顶部出现超级管理员专属运维警示横幅
    const adminBanner = page.locator(
      '[data-testid="maintenance-admin-banner"]',
    );
    await expect(adminBanner).toBeVisible({ timeout: 5000 });
    await expect(adminBanner).toContainText("[运维模式进行中]");

    // 点击一键解除维护
    await page.evaluate(() => {
      const anyWin = window as any;
      if (anyWin.useAuthStore)
        anyWin.useAuthStore.getState().closeReauthModal();
    });
    const disableBtn = adminBanner.locator("button:has-text('一键解除维护')");
    await expect(disableBtn).toBeVisible();
    await disableBtn.click({ force: true });

    // 验证横幅消失且发送了 PATCH 请求
    await expect(adminBanner).not.toBeVisible({ timeout: 5000 });
    expect(patchCalled).toBe(true);
  });
});
