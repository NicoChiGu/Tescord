import { test, expect } from "@playwright/test";

test.describe("聊天与个人信息卡片名称主显示调整为 displayName 验收", () => {
  test.beforeEach(async ({ page }) => {
    // 监听与拦截当前用户信息，注入 displayName
    await page.route("**/api/auth/me", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...json,
          displayName: "杰奇传奇工程师",
        }),
      });
    });
  });

  test("验证左下角状态条与个人信息卡片主显示 displayName 且副显示 @username", async ({
    page,
  }) => {
    const uncaughtErrors: string[] = [];
    page.on("pageerror", (err) => uncaughtErrors.push(err.message));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 验证左下角当前用户常驻条主显示 displayName
    const userPanelBtn = page.getByTestId("current-user-panel-btn");
    await expect(userPanelBtn).toBeVisible({ timeout: 10000 });
    await expect(userPanelBtn).toContainText("杰奇传奇工程师");

    // 2. 点击左下角当前用户呼出 CurrentUserPopout
    await userPanelBtn.click();
    const currentUserPopout = page.getByTestId("current-user-popout");
    await expect(currentUserPopout).toBeVisible({ timeout: 5000 });

    // 验证 CurrentUserPopout 主显示为 displayName，副显示为 @username
    await expect(
      currentUserPopout.getByText("杰奇传奇工程师", { exact: true }),
    ).toBeVisible();
    await expect(currentUserPopout.getByText(/@Jackey/)).toBeVisible();

    // 关闭 CurrentUserPopout
    await page.keyboard.press("Escape");
    await expect(currentUserPopout).toHaveCount(0);

    // 3. 点击进入极客总部公会
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    if (await serverButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await serverButton.click();
    }

    // 4. 验证右侧成员列表中当前用户的名称显示，并呼出 UserProfilePopout
    const memberItem = page
      .locator("[data-member-item]")
      .filter({ hasText: /杰奇传奇工程师/i })
      .first();
    if (await memberItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await memberItem.click();
      const userProfilePopout = page.locator(
        '[data-testid="user-profile-popout"]',
      );
      await expect(userProfilePopout).toBeVisible({ timeout: 5000 });
      // 验证 UserProfilePopout 主标题为 displayName，副标题为 @username
      await expect(
        userProfilePopout.getByText("杰奇传奇工程师", { exact: true }),
      ).toBeVisible();
      await expect(userProfilePopout.getByText(/@Jackey/)).toBeVisible();
    }

    expect(uncaughtErrors).toHaveLength(0);
  });
});
