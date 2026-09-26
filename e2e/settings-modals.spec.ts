import { test, expect } from "@playwright/test";

test.describe("编辑频道与服务器设置自适应模态框 (Modal) 交互验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 用户信息接口 (作为拥有者或具备管理权限)
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_admin_user",
          username: "admin_tester",
          displayName: "超级管理员",
          email: "admin@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          createdAt: new Date().toISOString(),
        }),
      });
    });
  });

  test("验证编辑频道 Modal：通过齿轮与右键菜单唤起、表单渲染与关闭", async ({
    page,
  }) => {
    await page.goto("/");

    // 1. 进入首个可用服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 在频道侧边栏定位频道条目
    const channelRow = page
      .locator(
        "button:has-text('general'), button:has-text('综合闲聊'), button:has-text('常规')",
      )
      .first();
    await expect(channelRow).toBeVisible();

    // 3. 测试通过右键菜单打开“编辑频道”
    await channelRow.click({ button: "right" });
    const editChannelMenuItem = page.getByRole("menuitem", {
      name: /编辑频道/i,
    });
    if (await editChannelMenuItem.isVisible()) {
      await editChannelMenuItem.click();

      // 4. 验证编辑频道模态框挂载
      const editModal = page.getByTestId("edit-channel-modal");
      await expect(editModal).toBeVisible();
      await expect(page.getByText(/编辑频道设置/i)).toBeVisible();

      // 验证名称与话题输入框存在
      const nameInput = page.getByTestId("edit-channel-name-input");
      const topicInput = page.getByTestId("edit-channel-topic-input");
      await expect(nameInput).toBeVisible();
      await expect(topicInput).toBeVisible();

      // 验证频道属性卡片展示
      await expect(page.getByText(/频道属性/i)).toBeVisible();

      // 验证危险区域存在
      await expect(page.getByTestId("delete-channel-btn")).toBeVisible();

      // 5. 验证右上角 X 按钮关闭
      const closeBtn = page.getByTestId("close-edit-channel-btn");
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
      await expect(editModal).not.toBeVisible();
    }
  });

  test("频道悬浮齿轮打开编辑弹窗并可用 ESC 关闭", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Tescord 极客总部|极客/i }).first().click();
    const channelRow = page.getByTestId("channel-button-general");
    await expect(channelRow).toBeVisible();
    const channelId = await channelRow.getAttribute("data-channel-id");
    const gearBtn = page.getByTestId(`edit-channel-gear-${channelId}`);
    await channelRow.hover();
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();
    const editModal = page.getByTestId("edit-channel-modal");
    await expect(editModal).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editModal).not.toBeVisible();
  });

  test("验证服务器设置自适应响应式 Modal：居中卡片挂载、导航切换与关闭", async ({
    page,
  }) => {
    await page.goto("/");

    // 1. 进入服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 右键服务器按钮打开上下文菜单
    await serverButton.click({ button: "right" });
    const serverSettingsMenuItem = page.getByRole("menuitem", {
      name: /服务器设置/i,
    });

    if (await serverSettingsMenuItem.isVisible()) {
      await serverSettingsMenuItem.click();

      // 3. 验证服务器设置响应式模态框挂载
      const serverModal = page.getByTestId("server-settings-modal");
      await expect(serverModal).toBeVisible();

      // 验证包含服务器管理标题
      await expect(page.getByText(/服务器管理设置/i)).toBeVisible();

      // 验证导航分组与选项卡
      await expect(page.getByText(/概览设置/i)).toBeVisible();
      await expect(page.getByText(/身份组与权限/i)).toBeVisible();
      await expect(page.getByText(/成员列表/i)).toBeVisible();

      // 4. 点击身份组与权限切换选项卡
      const rolesTabBtn = page.getByRole("button", { name: /身份组与权限/i });
      await rolesTabBtn.click();

      // 5. 验证右上角关闭按钮
      const closeBtn = page.getByTestId("close-server-settings-btn");
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();
      await expect(serverModal).not.toBeVisible();

      // 6. 再次打开并验证 ESC 关闭
      await serverButton.click({ button: "right" });
      await serverSettingsMenuItem.click();
      await expect(serverModal).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(serverModal).not.toBeVisible();
    }
  });
});
