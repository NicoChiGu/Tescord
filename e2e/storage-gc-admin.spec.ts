import { test, expect } from "@playwright/test";

test.describe("超级管理员控制台 - 存储与维护 (STORAGE) 及垃圾回收 E2E 验收", () => {
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
  });

  test("超管可进入 STORAGE 标签页查看存储指标、策略说明并成功触发垃圾回收", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (
        msg.type() === "error" &&
        !msg.text().includes("net::ERR_") &&
        !msg.text().includes("WebSocket")
      ) {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Mock 超管登录信息
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "super-admin-uuid",
          username: "RootAdmin",
          discriminator: "0001",
          email: "admin@tescord.local",
          role: "SUPER_ADMIN",
          isBanned: false,
          avatarUrl: null,
          bannerUrl: null,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    // 2. Mock 基础数据接口
    await page.route("**/api/guilds", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );
    await page.route("**/api/users/@me/channels", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );
    await page.route("**/api/relationships", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );
    await page.route("**/api/admin/overview", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalUsers: 10,
          onlineUsers: 3,
          totalGuilds: 2,
          totalMessages: 50,
          uptimeSeconds: 3600,
          memoryUsageMb: 85,
        }),
      }),
    );

    let gcTriggered = false;

    // 3. Mock 存储统计与 GC 接口
    await page.route("**/api/admin/storage/stats", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalUsedBytes: 52428800, // 50 MB
          activeAttachmentBytes: 31457280, // 30 MB
          activeAttachmentCount: 15,
          orphanedAttachmentBytes: 15728640, // 15 MB
          orphanedAttachmentCount: 8,
          orphanedDraftBytes: 5242880, // 5 MB
          orphanedDraftCount: 3,
          lastGcTimestamp: Date.now() - 3600_000,
        }),
      }),
    );

    await page.route("**/api/admin/storage/gc", (route) => {
      gcTriggered = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          deletedAttachmentRecords: 8,
          deletedPhysicalFiles: 11,
          freedBytes: 20971520, // 20 MB
          durationMs: 42,
          executedAt: Date.now(),
        }),
      });
    });

    // 4. 访问主页
    await page.goto("/");

    // 5. 点击超管控制台按钮
    const adminBtn = page.locator('[data-testid="admin-dashboard-btn"]');
    await expect(adminBtn).toBeVisible({ timeout: 10000 });
    await adminBtn.click();

    // 6. 验证控制台弹窗打开，并存在 STORAGE 标签页
    const storageTabBtn = page.locator('[data-testid="admin-tab-storage"]');
    await expect(storageTabBtn).toBeVisible({ timeout: 5000 });
    await storageTabBtn.click();

    // 7. 验证 STORAGE 页面关键指标卡片和内容展示
    await expect(page.getByText("50.00 MB", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("30.00 MB", { exact: true })).toBeVisible();
    await expect(page.getByText("15.00 MB", { exact: true })).toBeVisible();
    await expect(page.getByText("5.00 MB", { exact: true })).toBeVisible();

    // 8. 触发一键执行垃圾回收
    const runGcBtn = page.locator('[data-testid="admin-run-gc-btn"]');
    await expect(runGcBtn).toBeVisible();
    await runGcBtn.click();

    // 9. 确认弹窗
    const confirmBtn = page
      .locator(
        'button:has-text("确认清理"), button:has-text("Confirm & Clean")',
      )
      .first();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // 10. 断言 GC 请求已成功触发
    await expect.poll(() => gcTriggered, { timeout: 5000 }).toBe(true);

    // 11. 验证控制台无严重异常
    expect(consoleErrors).toHaveLength(0);
  });
});
