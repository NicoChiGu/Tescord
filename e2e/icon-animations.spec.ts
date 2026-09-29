import { test, expect } from "@playwright/test";

test.describe("Discord 风格图标微动效与手风琴交互专项验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 登录用户详情接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "Jackey",
          displayName: "测试管理员",
          email: "admin@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });
  });

  test("1. 频道分类手风琴折叠展开与单一 ChevronDown 旋转动效", async ({
    page,
  }) => {
    await page.goto("/");

    // 选择服务器
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 定位文字频道分类
    const textCatHeader = page
      .locator('[data-testid^="category-header-"]')
      .first();
    await expect(textCatHeader).toBeVisible({ timeout: 5000 });

    // 检查 ChevronDown 图标存在且初始为展开状态 (rotate-0)
    const chevronIcon = textCatHeader.locator("svg").first();
    await expect(chevronIcon).toBeVisible();
    await expect(chevronIcon).toHaveClass(/rotate-0/);

    // 检查分类内容处于展开的 accordion
    const accordionContainer = textCatHeader.locator(
      "xpath=following-sibling::div[contains(@class, 'discord-accordion')][1]",
    );
    await expect(accordionContainer).toBeVisible();
    await expect(accordionContainer).not.toHaveClass(/collapsed/);

    // 点击折叠
    await textCatHeader.click();

    // 折叠后 ChevronDown 拥有 -rotate-90 类名，手风琴具有 collapsed 类名
    await expect(chevronIcon).toHaveClass(/-rotate-90/);
    await expect(accordionContainer).toHaveClass(/collapsed/);

    // 再次点击展开
    await textCatHeader.click();
    await expect(chevronIcon).toHaveClass(/rotate-0/);
    await expect(accordionContainer).not.toHaveClass(/collapsed/);
  });

  test("2. 底部控制栏：静音麦克风、闭麦耳机划线与设置齿轮旋转", async ({
    page,
  }) => {
    await page.goto("/");

    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 个人设置齿轮按钮拥有 group-hover:rotate-45
    const gearBtn = page.locator('[data-testid="user-settings-gear-btn"]');
    await expect(gearBtn).toBeVisible();
    const gearIcon = gearBtn.locator("svg");
    await expect(gearIcon).toHaveClass(/group-hover\/gear:rotate-45/);

    // 静音按钮具备 active:scale-90
    const micBtn = page.locator('[data-testid="user-bar-mic-btn"]');
    await expect(micBtn).toBeVisible();
    await expect(micBtn).toHaveClass(/active:scale-90/);

    // 耳机按钮具备 active:scale-90，点击后切换为禁用态
    const deafenBtn = page.locator('[data-testid="user-bar-deafen-btn"]');
    await expect(deafenBtn).toBeVisible();
    await expect(deafenBtn).toHaveClass(/active:scale-90/);

    // 点击耳机静音
    await deafenBtn.click();
    // 验证出现红色斜线指示条
    const strikeLine = deafenBtn.locator("span.bg-discord-danger.rotate-45");
    await expect(strikeLine).toBeVisible();

    // 再次点击恢复
    await deafenBtn.click();
    await expect(strikeLine).not.toBeVisible();
  });

  test("3. 最左侧服务器列表添加按钮与探索按钮的悬停旋转动效类", async ({
    page,
  }) => {
    await page.goto("/");

    // 添加服务器按钮拥有 Plus 旋转 90 度类
    const addServerBtn = page.locator('button[title*="添加服务器"]');
    await expect(addServerBtn).toBeVisible();
    const plusIcon = addServerBtn.locator("svg");
    await expect(plusIcon).toHaveClass(/group-hover:rotate-90/);

    // 探索公开服务器按钮拥有 Compass 旋转 45 度类
    const exploreBtn = page.locator('[data-testid="open-discovery-btn"]');
    await expect(exploreBtn).toBeVisible();
    const compassIcon = exploreBtn.locator("svg");
    await expect(compassIcon).toHaveClass(/group-hover:rotate-45/);
  });
});
