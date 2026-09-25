import { test, expect } from "@playwright/test";

test.describe("全局决策模态框与4位安全验证码验收 (Security Code & Dialog Modal E2E)", () => {
  test("验证自定义确认模态框正常唤起并响应取消操作（平替 window.confirm）", async ({
    page,
    request,
  }) => {
    // 1. 使用管理员凭证登录
    const loginRes = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "Jackey",
        password: "adminpassword123",
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();

    // 2. 注入登录凭证并进入页面
    await page.addInitScript(
      ({ token, refreshToken }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", refreshToken);
      },
      { token: loginData.accessToken, refreshToken: loginData.refreshToken },
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 3. 打开用户设置并验证自定义登出确认模态框
    const settingsBtn = page.locator('[data-testid="user-settings-gear-btn"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    const logoutBtn = page.locator('[data-testid="user-logout-btn"]');
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    // 验证自定义模态框正常唤起
    const dialogConfirmBtn = page.locator('[data-testid="dialog-confirm-btn"]');
    const dialogCancelBtn = page.locator('[data-testid="dialog-cancel-btn"]');
    await expect(dialogConfirmBtn).toBeVisible({ timeout: 5000 });
    await expect(dialogCancelBtn).toBeVisible({ timeout: 5000 });

    // 点击取消并关闭模态框
    await dialogCancelBtn.click();
    await expect(dialogConfirmBtn).not.toBeVisible();
  });

  test("验证解散服务器弹窗展示4位随机安全码：错误输入时禁用，正确输入后激活", async ({
    page,
    request,
  }) => {
    // 1. 获取管理员凭证
    const loginRes = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "Jackey",
        password: "adminpassword123",
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    const token = loginData.accessToken;

    // 2. 创建一个用于测试解散的专用临时服务器
    const createGuildRes = await request.post("/api/guilds", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "临时验证码测试服" },
    });
    expect(createGuildRes.ok()).toBeTruthy();
    const testGuild = await createGuildRes.json();

    try {
      await page.addInitScript(
        ({ token, refreshToken }) => {
          localStorage.setItem("tescord_access_token", token);
          localStorage.setItem("tescord_refresh_token", refreshToken);
        },
        { token, refreshToken: loginData.refreshToken },
      );

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // 右键点击进入该新建的临时服务器的上下文菜单
      const guildIcon = page.locator(`[title="${testGuild.name}"]`);
      await expect(guildIcon).toBeVisible({ timeout: 5000 });
      await guildIcon.click({ button: "right" });

      const serverSettingsItem = page.getByRole("menuitem", {
        name: "服务器管理设置",
      });
      await expect(serverSettingsItem).toBeVisible({ timeout: 5000 });
      await serverSettingsItem.click();

      // 点击左侧底部的“删除服务器”红字选项
      const deleteGuildTabBtn = page.getByRole("button", {
        name: "解散服务器",
      });
      await expect(deleteGuildTabBtn).toBeVisible({ timeout: 5000 });
      await deleteGuildTabBtn.click();

      // 验证解散弹窗弹出
      const codeInput = page.locator('[data-testid="delete-guild-code-input"]');
      const confirmDeleteBtn = page.locator(
        '[data-testid="delete-guild-confirm-btn"]',
      );
      await expect(codeInput).toBeVisible({ timeout: 5000 });
      await expect(confirmDeleteBtn).toBeVisible({ timeout: 5000 });

      // 断言：初始状态未输入，确认按钮必须处于 disabled 状态
      await expect(confirmDeleteBtn).toBeDisabled();

      // 输入错误的 4 位验证码，仍然处于 disabled
      await codeInput.fill("0000");
      await expect(confirmDeleteBtn).toBeDisabled();

      // 获取当前弹窗中显示的 4 位真实安全码
      const securityCodeEl = page.locator(".tracking-\\[0\\.35em\\]");
      const expectedCode = (await securityCodeEl.innerText()).trim();
      expect(expectedCode).toMatch(/^\d{4}$/);

      // 输入正确的 4 位验证码
      await codeInput.fill(expectedCode);
      // 核心断言：完全匹配后，确认删除按钮必须成功激活
      await expect(confirmDeleteBtn).toBeEnabled();

      // 点击取消
      const cancelBtn = page.locator('button:has-text("取消")').last();
      await cancelBtn.click();
      await expect(codeInput).not.toBeVisible();
    } finally {
      // 清理临时测试服务器
      await request.delete(`/api/guilds/${testGuild.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { nameConfirmation: testGuild.name },
      });
    }
  });
});
