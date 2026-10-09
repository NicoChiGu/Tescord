import { test, expect } from "@playwright/test";

test.describe("Tescord Web 端到端冒烟与核心交互验收", () => {
  test("未登录状态下能够正常加载并呈现登录/注册引导", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 页面主容器挂载
    const root = page.locator("#root");
    await expect(root).toBeVisible();

    // 验证未登录时弹出的登录认证引导
    const loginHeading = page.getByRole("heading", {
      name: /欢迎使用 Tescord|欢迎回到 Tescord|登录/i,
    });
    await expect(loginHeading).toBeVisible({ timeout: 10000 });

    const continueButton = page.getByTestId("auth-submit-btn");
    await expect(continueButton).toBeVisible();

    // 验证邮箱输入表单正常挂载
    const emailInput = page
      .locator('input[type="email"], input[type="text"]')
      .first();
    await expect(emailInput).toBeVisible();

    // 生产构建环境下，验证快捷预设账号已被彻底隐藏/剔除，确保生产安全
    const quickAccountBtn = page
      .getByRole("button", { name: /Jackey 系统管理员|纯净测试/i })
      .first();
    await expect(quickAccountBtn).toHaveCount(0);

    // 确保没有致命控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("已登录状态下验证三栏布局、服务器切换、右键菜单与音频降噪控制中心全生命周期", async ({
    page,
  }) => {
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
          id: "e2e_user_1",
          username: "e2e_tester",
          displayName: "E2E验收员",
          email: "e2e@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.goto("/");

    // 1. 确认服务器列表渲染并点击进入首个可用服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord|极客|Jackey|私密/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 确认频道列表加载并展示默认文字频道 (如 常规 / general)
    const generalChannel = page.getByRole("button", {
      name: /general|常规|综合闲聊/i,
    });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });

    // 3. 确认底部用户控制栏与语音状态按钮
    const micButton = page.getByTestId("user-bar-mic-btn");
    const deafenButton = page.getByTestId("user-bar-deafen-btn");
    await expect(micButton).toBeVisible();
    await micButton.hover();
    await expect(page.getByTestId("tooltip-bubble")).toHaveText("静音");
    await expect(deafenButton).toBeVisible();
    await deafenButton.hover();
    await expect(page.getByTestId("tooltip-bubble")).toHaveText("闭麦拒听");
    const audioSettingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(audioSettingsBtn).toBeVisible();

    // 4. 验证 Radix UI 右键菜单唤起与关闭 (ServerContextMenu)，并严格断言防初始锚点 (0, 0) 闪烁
    const serverRect = await serverButton.boundingBox();
    await serverButton.click({ button: "right" });
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 防闪烁检测：获取菜单首帧物理坐标，断言其绝不在 (0, 0) 初始锚点（且位于目标按钮附近）
    const menuRect = await contextMenu.boundingBox();
    expect(menuRect).not.toBeNull();
    if (menuRect) {
      expect(menuRect.x).toBeGreaterThan(20);
      expect(menuRect.y).toBeGreaterThan(20);
      if (serverRect) {
        expect(menuRect.x).toBeGreaterThanOrEqual(serverRect.x);
      }
    }

    // 按 Escape 正常关闭上下文菜单
    await page.keyboard.press("Escape");
    await expect(contextMenu).not.toBeVisible();

    // 4.1 再次唤起右键菜单，验证菜单项可以正常按下触发并关闭菜单
    await serverButton.click({ button: "right" });
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const markAsReadMenuItem = page.locator('[role="menuitem"]', {
      hasText: "标记为已读",
    });
    await expect(markAsReadMenuItem).toBeVisible();
    await markAsReadMenuItem.click();
    await expect(contextMenu).not.toBeVisible();

    // 5. 验证音频与智能降噪控制中心模态框呼出与关闭
    await audioSettingsBtn.click();
    const modalHeading = page.getByRole("heading", {
      name: /语音引擎与 RNNoise|降噪控制中心/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("RNNoise 标准轻量")).toBeVisible();

    // 点击右上角关闭按钮
    const closeBtn = page.getByTestId("close-user-settings-btn");
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();

    // 再次唤起音频设置并通过 Escape 快捷键关闭 (验证 Hook 顺序与 Escape 监听正常)
    await audioSettingsBtn.click();
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(modalHeading).not.toBeVisible();
  });
});
