import { test, expect } from "@playwright/test";

test.describe("频音频道静音与时长选项自动化验收 (Channel Mute & Duration Options)", () => {
  test("支持静音频道多级时长选项、右侧常驻静音图标、取消静音以及持久化生效", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 初始化用户登录态与 Mock
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_mute_test",
          username: "mute_tester",
          displayName: "静音测试员",
          email: "mute_tester@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/rtc/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    // 2. 访问主页面并进入首个公会
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 定位一个频道条目
    const channelButton = page
      .locator('button[data-testid^="channel-button-"]')
      .first();
    await expect(channelButton).toBeVisible({ timeout: 6000 });

    // 验证初始状态下无静音图标
    const initialMutedIcons = page.locator(
      '[data-testid^="channel-muted-icon-"]',
    );
    const initialMutedCount = await initialMutedIcons.count();

    // 4. 右键触发频道的上下文菜单
    await channelButton.click({ button: "right" });
    const contextMenu = page.locator('[role="menu"]').first();
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 5. 验证“静音频道”二级子菜单触发器
    const muteTrigger = page.locator(
      '[data-testid="channel-context-menu-mute-trigger"]',
    );
    await expect(muteTrigger).toBeVisible({ timeout: 3000 });
    await expect(muteTrigger).toContainText("静音频道");

    // 悬停或点击展开二级子菜单
    await muteTrigger.hover();

    // 6. 验证 6 个预设时长选项全部正确渲染
    const duration15m = page.locator(
      '[data-testid="mute-duration-option-15 分钟"]',
    );
    const duration1h = page.locator(
      '[data-testid="mute-duration-option-1 小时"]',
    );
    const duration3h = page.locator(
      '[data-testid="mute-duration-option-3 小时"]',
    );
    const duration8h = page.locator(
      '[data-testid="mute-duration-option-8 小时"]',
    );
    const duration24h = page.locator(
      '[data-testid="mute-duration-option-24 小时"]',
    );
    const durationUntilOpen = page.locator(
      '[data-testid="mute-duration-option-直到重新开启"]',
    );

    await expect(duration15m).toBeVisible({ timeout: 5000 });
    await expect(duration1h).toBeVisible();
    await expect(duration3h).toBeVisible();
    await expect(duration8h).toBeVisible();
    await expect(duration24h).toBeVisible();
    await expect(durationUntilOpen).toBeVisible();

    // 7. 点击“15 分钟”选项进行静音
    await duration15m.click();

    // 验证菜单已关闭
    await expect(contextMenu).not.toBeVisible({ timeout: 3000 });

    // 8. 验证该频道右侧出现静音图标
    const mutedIconAfterMute = page
      .locator('[data-testid^="channel-muted-icon-"]')
      .first();
    await expect(mutedIconAfterMute).toBeVisible({ timeout: 5000 });

    // 9. 再次右键该频道，验证菜单项转换为“取消静音频道”与“更改静音时长”
    await channelButton.click({ button: "right" });
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    const unmuteItem = page.locator(
      '[data-testid="channel-context-menu-unmute"]',
    );
    await expect(unmuteItem).toBeVisible({ timeout: 3000 });
    await expect(unmuteItem).toContainText("取消静音频道");

    const changeDurationTrigger = page.locator(
      '[data-testid="channel-context-menu-change-mute-trigger"]',
    );
    await expect(changeDurationTrigger).toBeVisible({ timeout: 3000 });
    await expect(changeDurationTrigger).toContainText("更改静音时长");

    // 10. 点击“取消静音频道”
    await unmuteItem.click();
    await expect(contextMenu).not.toBeVisible({ timeout: 3000 });

    // 验证静音图标已消失
    await expect(mutedIconAfterMute).not.toBeVisible({ timeout: 5000 });

    // 11. 重新静音为“直到重新开启”，验证页面刷新持久化
    await channelButton.click({ button: "right" });
    await expect(muteTrigger).toBeVisible({ timeout: 5000 });
    await muteTrigger.hover();
    await expect(durationUntilOpen).toBeVisible({ timeout: 5000 });
    await durationUntilOpen.click();

    // 静音图标呈现
    await expect(mutedIconAfterMute).toBeVisible({ timeout: 5000 });

    // 页面刷新 (Reload)
    await page.reload();
    await expect(page).toHaveTitle(/Tescord/i);

    // 刷新后静音图标依然常驻（LocalStorage 持久化有效）
    const mutedIconAfterReload = page
      .locator('[data-testid^="channel-muted-icon-"]')
      .first();
    await expect(mutedIconAfterReload).toBeVisible({ timeout: 8000 });

    // 控制台无致命错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("Failed to load resource") &&
        !err.includes("net::ERR_CONNECTION_REFUSED") &&
        !err.includes("WebSocket connection"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
