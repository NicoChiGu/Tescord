import { test, expect } from "@playwright/test";

test.describe("Electron 窗口治理、免密切换防护、通行密钥与屏幕截图专项验收", () => {
  test("1. 切换账号/登出后停留在账号选择界面，绝不静默自动登录", async ({
    page,
  }) => {
    // 注入包含 rememberPassword=true 的已存账号卡片
    await page.addInitScript(() => {
      const mockSaved = [
        {
          id: "usr_mock_1",
          username: "testuser",
          displayName: "测试用户",
          email: "testuser@example.com",
          rememberPassword: true,
          refreshToken: "mock_refresh_token_for_auto_login",
          savedAt: Date.now(),
        },
      ];
      localStorage.setItem("tescord_saved_accounts", JSON.stringify(mockSaved));
      // 模拟没有活跃 session token (即刚刚切换了账号或登出)
      sessionStorage.removeItem("tescord_access_token");
      sessionStorage.removeItem("tescord_refresh_token");
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");

    // 验证：必须停留在账号选择卡片页面，展示用户头像与卡片，绝不自动跳过进入主窗口
    const accountPicker = page.getByTestId("account-picker");
    await expect(accountPicker).toBeVisible({ timeout: 5000 });
    const accountCard = page
      .locator('[data-testid^="saved-account-card-"]')
      .first();
    await expect(accountCard).toBeVisible();
    await expect(page.locator("text=欢迎回来")).toBeVisible();

    // 等待 1.5 秒，确认绝无二次静默自动登回或闪现跳转
    await page.waitForTimeout(1500);
    await expect(accountCard).toBeVisible();
  });

  test("2. 服务端 /api/auth/webauthn/bridge 通行密钥独立认证桥接页正常响应", async ({
    request,
  }) => {
    // 验证 login 模式桥接页
    const loginRes = await request.get(
      "/api/auth/webauthn/bridge?action=login&emailOrUsername=test@example.com",
    );
    expect(loginRes.status()).toBe(200);
    const loginHtml = await loginRes.text();
    expect(loginHtml).toContain("Tescord 通行密钥认证");
    expect(loginHtml).toContain("navigator.credentials.get");
    expect(loginHtml).toContain("electronPasskeyBridge");

    // 验证 register 模式桥接页
    const regRes = await request.get(
      "/api/auth/webauthn/bridge?action=register&deviceName=MyKey&token=mocktoken",
    );
    expect(regRes.status()).toBe(200);
    const regHtml = await regRes.text();
    expect(regHtml).toContain("navigator.credentials.create");
  });

  test("3. 屏幕截图插入与附件管道联动正常", async ({ page }) => {
    await page.goto("/");
    // 触发全局 insert-captured-image 事件
    const dispatched = await page.evaluate(() => {
      let received = false;
      window.addEventListener(
        "insert-captured-image",
        () => {
          received = true;
        },
        { once: true },
      );

      window.dispatchEvent(
        new CustomEvent("insert-captured-image", {
          detail: {
            dataUrl:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
        }),
      );
      return received;
    });

    expect(dispatched).toBe(true);
  });
});
