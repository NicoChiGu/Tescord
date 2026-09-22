import { test, expect } from "@playwright/test";

test.describe("右侧成员列表展开/隐藏动画端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 用户认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_1",
          username: "e2e_tester",
          displayName: "E2E验收员",
          email: "e2e@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });
  });

  test("桌面端 (≥1024px)：成员列表支持平滑宽度展开与收起动画 (0px <-> 240px)", async ({
    page,
  }) => {
    // 1. 设置桌面端宽屏视口 (1280x800)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 进入首个服务器并切换至文本频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const channelItem = page.getByRole("button", { name: "general" });
    await expect(channelItem).toBeVisible({ timeout: 5000 });
    await channelItem.click();

    // 2. 验证桌面端常驻成员列表 aside 初始展开状态
    const memberAside = page.getByTestId("member-list-aside");
    await expect(memberAside).toBeVisible({ timeout: 5000 });
    await expect(memberAside).toHaveClass(/w-60/);
    await expect(memberAside).toHaveClass(/transition-\[width\]/);

    const toggleBtn = page.getByRole("button", { name: "成员列表" });
    await expect(toggleBtn).toBeVisible();

    // 3. 点击成员列表按钮 -> 收起列表
    await toggleBtn.click();
    await expect(memberAside).toHaveClass(/w-0/);
    await expect(memberAside).toHaveAttribute("aria-hidden", "true");

    // 4. 再次点击成员列表按钮 -> 展开列表
    await toggleBtn.click();
    await expect(memberAside).toHaveClass(/w-60/);
    await expect(memberAside).toHaveAttribute("aria-hidden", "false");
  });

  test("平板与移动端 (<1024px)：成员列表以浮层抽屉平滑滑入滑出，遮罩双向淡入淡出", async ({
    page,
  }) => {
    // 1. 设置 iPad 平板端视口 (820x1180)
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/");

    // 进入首个服务器并切换至文本频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const channelItem = page.getByRole("button", { name: "general" });
    await expect(channelItem).toBeVisible({ timeout: 5000 });
    await channelItem.click();

    // 2. 验证在平板视口下，桌面端常驻 aside 不渲染
    const desktopAside = page.getByTestId("member-list-aside");
    await expect(desktopAside).toHaveCount(0);

    // 3. 定位抽屉外层、遮罩与抽屉面板
    const toggleBtn = page.getByRole("button", { name: "成员列表" });
    await expect(toggleBtn).toBeVisible();

    const drawerBackdrop = page.getByTestId("member-list-backdrop");
    const drawerPanel = page.getByTestId("member-list-drawer-panel");

    // 初始状态下抽屉收起：面板包含 translate-x-full，遮罩包含 opacity-0
    await expect(drawerPanel).toHaveClass(/translate-x-full/);
    await expect(drawerBackdrop).toHaveClass(/opacity-0/);

    // 4. 点击顶部按钮呼出抽屉
    await toggleBtn.click();

    // 展开状态：面板平滑滑入 translate-x-0，遮罩淡入 opacity-100
    await expect(drawerPanel).toHaveClass(/translate-x-0/);
    await expect(drawerBackdrop).toHaveClass(/opacity-100/);

    // 5. 点击背景毛玻璃遮罩关闭抽屉 (坐标取抽屉左侧遮罩区域 x: 400, y: 300)
    await drawerBackdrop.click({ position: { x: 400, y: 300 } });

    // 退出状态：面板平滑滑出 translate-x-full，遮罩淡出 opacity-0
    await expect(drawerPanel).toHaveClass(/translate-x-full/);
    await expect(drawerBackdrop).toHaveClass(/opacity-0/);

    // 6. 再次点击顶部按钮呼出，并通过抽屉内部右上角关闭按钮 (X) 关闭抽屉
    await toggleBtn.click();
    await expect(drawerPanel).toHaveClass(/translate-x-0/);
    await expect(drawerBackdrop).toHaveClass(/opacity-100/);

    const closeDrawerBtn = page.getByTestId("close-member-drawer-btn");
    await expect(closeDrawerBtn).toBeVisible();
    await closeDrawerBtn.click();

    await expect(drawerPanel).toHaveClass(/translate-x-full/);
    await expect(drawerBackdrop).toHaveClass(/opacity-0/);
  });
});
