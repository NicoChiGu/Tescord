import { test, expect } from "@playwright/test";

test.describe("WebAuthn (Passkey) 身份认证与凭据管理端到端自动化验收", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("1. 登录模态框 (AuthModal) 首屏与密码阶段显式展示通行密钥登录入口", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 1. 首屏邮箱输入阶段：验证「使用通行密钥登录」显式按钮存在
    const passkeyBtn = page.getByTestId("auth-passkey-login-btn");
    await expect(passkeyBtn).toBeVisible({ timeout: 10000 });
    await expect(passkeyBtn).toContainText("使用通行密钥登录");

    // 2. 输入已有账号邮箱推进至密码阶段
    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");
    await emailInput.fill("admin@tescord.local");
    await submitBtn.click();

    // 3. 密码阶段：验证仍保留「使用通行密钥登录」显式入口
    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("auth-passkey-login-btn")).toBeVisible();
  });

  test("2. 多账号选择器 (AccountPicker) 阶段显式展示通行密钥登录按钮", async ({
    page,
  }) => {
    // 清除会话令牌，仅注入已保存账号
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(
        "tescord_saved_accounts",
        JSON.stringify([
          {
            id: "user_test_mock",
            email: "tester@tescord.local",
            username: "PasskeyTester",
            displayName: "Passkey测试员",
            lastActiveAt: Date.now(),
            rememberPassword: true,
          },
        ]),
      );
    });

    await page.goto("/");
    const accountPicker = page.getByTestId("account-picker");
    await expect(accountPicker).toBeVisible({ timeout: 10000 });

    // 验证账号卡片列表下方存在「使用通行密钥登录」按钮
    const passkeyBtn = page.getByTestId("account-picker-passkey-btn");
    await expect(passkeyBtn).toBeVisible();
    await expect(passkeyBtn).toContainText("使用通行密钥登录");
  });

  test("2.1 多账号选择器下通行密钥校验失败时显式展示错误横幅 (account-picker-error)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(
        "tescord_saved_accounts",
        JSON.stringify([
          {
            id: "user_test_mock",
            email: "tester@tescord.local",
            username: "PasskeyTester",
            displayName: "Passkey测试员",
            lastActiveAt: Date.now(),
            rememberPassword: true,
          },
        ]),
      );
    });

    // 拦截 login-options 模拟失败，验证错误横幅出现且不被吞没
    await page.route("**/api/auth/webauthn/login-options", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          code: "WEBAUTHN_VERIFICATION_FAILED",
          error: "WEBAUTHN_VERIFICATION_FAILED",
        }),
      });
    });

    await page.goto("/");
    const accountPicker = page.getByTestId("account-picker");
    await expect(accountPicker).toBeVisible({ timeout: 10000 });

    const passkeyBtn = page.getByTestId("account-picker-passkey-btn");
    await expect(passkeyBtn).toBeVisible();
    await passkeyBtn.click();

    // 验证 account-picker-error 正常显示，不再被静默吞没
    const errorBanner = page.getByTestId("account-picker-error");
    await expect(errorBanner).toBeVisible({ timeout: 5000 });
    await expect(errorBanner).toContainText("通行密钥签名验证失败");
  });

  test("3. 用户设置中心新增「账号安全与通行密钥」标签页及设备管理", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/");
    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");
    await emailInput.fill("admin@tescord.local");
    await submitBtn.click();

    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill("adminpassword123");
    await submitBtn.click();

    // 成功登录进入主界面
    const userSettingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(userSettingsBtn).toBeVisible({ timeout: 15000 });
    await userSettingsBtn.click();

    // 验证用户设置侧边栏存在“账号安全与通行密钥”标签
    const securityTabBtn = page.getByTestId("tab-security-btn");
    await expect(securityTabBtn).toBeVisible({ timeout: 5000 });
    await expect(securityTabBtn).toContainText("账号安全与通行密钥");
    await securityTabBtn.click();

    // 验证安全设置详情页面已激活
    const securityTab = page.getByTestId("security-settings-tab");
    await expect(securityTab).toBeVisible();

    const addPasskeyBtn = page.getByTestId("add-passkey-btn");
    await expect(addPasskeyBtn).toBeVisible();
    await expect(addPasskeyBtn).toContainText("添加通行密钥");
  });

  test("4. 完整 WebAuthn 凭证登记、免密登录、重命名闭环验证 (CDP Virtual Authenticator)", async ({
    page,
  }) => {
    // 启用 Chrome DevTools Protocol 虚拟认证器
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    page.on("console", (msg) => {
      console.log(`[PAGE LOG ${msg.type()}]:`, msg.text());
    });
    page.on("response", (res) => {
      if (res.url().includes("webauthn")) {
        // 登录响应含访问令牌和刷新令牌，测试日志只记录状态与接口。
        console.log(`[WEBAUTHN RES ${res.status()}]:`, res.url());
      }
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/");
    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");
    await emailInput.fill("admin@tescord.local");
    await submitBtn.click();

    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill("adminpassword123");
    await submitBtn.click();

    const userSettingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(userSettingsBtn).toBeVisible({ timeout: 15000 });

    // 1. 进入用户设置 -> 账号安全与通行密钥
    await userSettingsBtn.click();
    await page.getByTestId("tab-security-btn").click();
    await expect(page.getByTestId("security-settings-tab")).toBeVisible();
    const whatsNewModal = page.getByTestId("whats-new-modal");
    // 登录后的自动公告延迟 800ms；进入设置后不能再覆盖通行密钥操作。
    await page.waitForTimeout(1000);
    await expect(whatsNewModal).not.toBeVisible();

    // 2. 点击「添加通行密钥」
    const addBtn = page.getByTestId("add-passkey-btn");
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // 3. 弹窗确认设备别名
    const promptSubmit = page.getByTestId("dialog-prompt-submit-btn");
    await expect(promptSubmit).toBeVisible({ timeout: 5000 });
    await promptSubmit.click();

    // 4. 验证虚拟凭证成功创建并展示在设备列表中
    const passkeyItem = page.locator("[data-testid^='passkey-item-']").first();
    await expect(passkeyItem).toBeVisible({ timeout: 12000 });

    // 5. 测试重命名设备
    const renameBtn = page.locator("[data-testid^='rename-passkey-']").first();
    await renameBtn.click();
    const promptInput = page.getByTestId("dialog-prompt-input");
    await promptInput.fill("我的专属安全硬件 (CDP)");
    await page.getByTestId("dialog-prompt-submit-btn").click();
    await expect(passkeyItem).toContainText("我的专属安全硬件 (CDP)");
    await expect(whatsNewModal).not.toBeVisible();

    // 6. 关闭设置弹窗并登出
    const closeSettingsBtn = page.getByTestId("close-user-settings-btn");
    await closeSettingsBtn.click();
    await page.waitForTimeout(900);
    await expect(whatsNewModal).not.toBeVisible();

    // 点击退出登录
    await userSettingsBtn.click();
    const logoutBtn = page.getByTestId("user-logout-btn");
    await logoutBtn.click();
    const confirmLogoutBtn = page.getByTestId("dialog-confirm-btn");
    await expect(confirmLogoutBtn).toBeVisible({ timeout: 5000 });
    await confirmLogoutBtn.click();

    // 7. 退出到登录界面，测试通行密钥免密一键登录
    const passkeyLoginBtn = page
      .locator(
        "[data-testid='account-picker-passkey-btn'], [data-testid='auth-passkey-login-btn']",
      )
      .first();
    await expect(passkeyLoginBtn).toBeVisible({ timeout: 10000 });
    await passkeyLoginBtn.click();

    // 8. 验证通过 Passkey 一键成功登录回到主面板
    await expect(page.getByTestId("user-settings-gear-btn")).toBeVisible({
      timeout: 15000,
    });
  });
});
