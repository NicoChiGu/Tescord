import { test, expect } from "@playwright/test";

test.describe("邮箱记忆与 Discord 快捷多账号登录及7天免密端到端验收测试", () => {
  test.beforeEach(async ({ context }) => {
    // 隔离会话存储
    await context.clearCookies();
  });

  test("1. 首次登录成功后自动记忆账号资料，登出后优先呈现类似 Discord 的快捷账号卡片", async ({
    page,
  }) => {
    // 注入全新无会话环境
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 初始无已存账号，首屏为常规邮箱输入
    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");
    await expect(emailInput).toBeVisible({ timeout: 10000 });

    // 1. 输入已有账号邮箱进行探测
    await emailInput.fill("admin@tescord.local");
    await submitBtn.click();

    // 2. 流转至密码输入阶段
    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 10000 });

    // 3. 验证“7天内保持登录状态（记住密码）”复选框存在且默认勾选
    const rememberMeCheckbox = page.getByTestId("auth-remember-me-checkbox");
    await expect(rememberMeCheckbox).toBeVisible();
    await expect(rememberMeCheckbox).toBeChecked();

    // 4. 输入管理员密码完成登录
    await passwordInput.fill("adminpassword123");
    await submitBtn.click();

    // 5. 验证成功进入主界面
    const userPanelBtn = page.getByTestId("current-user-panel-btn");
    await expect(userPanelBtn).toBeVisible({ timeout: 15000 });

    // 6. 验证 localStorage 中已正确写入 tescord_saved_accounts
    const savedAccountsJson = await page.evaluate(() => {
      return localStorage.getItem("tescord_saved_accounts");
    });
    expect(savedAccountsJson).toBeTruthy();
    const savedAccounts = JSON.parse(savedAccountsJson || "[]");
    expect(savedAccounts.length).toBeGreaterThan(0);
    expect(savedAccounts[0].email).toBe("admin@tescord.local");
    expect(savedAccounts[0].rememberPassword).toBe(true);

    // 7. 点击左下角用户面板 -> 弹出卡片中点击“切换账号”
    await userPanelBtn.click();
    const switchAccountBtn = page.getByTestId("popout-switch-account-btn");
    await expect(switchAccountBtn).toBeVisible();
    await switchAccountBtn.click();

    // 8. 验证登出后立即呈现类似 Discord 的快捷账号选择组件 AccountPicker
    const accountPicker = page.getByTestId("account-picker");
    await expect(accountPicker).toBeVisible({ timeout: 10000 });

    // 验证账号卡片存在，展示头像、用户名和邮箱
    const accountCard = page.locator("[data-testid^='saved-account-card-']").first();
    await expect(accountCard).toBeVisible();
    await expect(accountCard).toContainText("admin@tescord.local");
  });

  test("2. 点击快捷账号卡片平滑切入密码输入，展示选中账号信息并支持一键返回", async ({
    page,
  }) => {
    // 预置已保存的历史账号数据（模拟已登出、需输密码状态）
    await page.addInitScript(() => {
      localStorage.clear();
      const mockSaved = [
        {
          id: "mock-user-1",
          email: "admin@tescord.local",
          username: "Administrator#0001",
          displayName: "系统管理员",
          discriminator: "0001",
          avatarUrl: null,
          lastActiveAt: Date.now(),
          rememberPassword: true,
          refreshToken: undefined, // 无自动登录凭据，需输密码
        },
      ];
      localStorage.setItem("tescord_saved_accounts", JSON.stringify(mockSaved));
    });

    await page.goto("/");

    // 1. 首屏直接展示账号选择卡片
    const accountPicker = page.getByTestId("account-picker");
    await expect(accountPicker).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("系统管理员")).toBeVisible();
    await expect(page.getByText("admin@tescord.local")).toBeVisible();

    // 2. 点击该账号卡片
    const accountCard = page.getByTestId("saved-account-card-mock-user-1");
    await accountCard.click();

    // 3. 验证平滑进入密码输入界面，展示该账号大卡片与邮箱
    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("系统管理员")).toBeVisible();
    await expect(page.getByText("admin@tescord.local")).toBeVisible();

    // 验证“7天内保持登录状态（记住密码）”复选框存在
    const rememberMeCheckbox = page.getByTestId("auth-remember-me-checkbox");
    await expect(rememberMeCheckbox).toBeVisible();

    // 4. 点击底部“切换其他账号”按钮，验证可顺利返回账号列表
    const switchModeBtn = page.getByTestId("auth-switch-mode-btn");
    await expect(switchModeBtn).toBeVisible();
    await switchModeBtn.click();

    await expect(accountPicker).toBeVisible();
    await expect(page.getByText("系统管理员")).toBeVisible();

    // 5. 再次点击卡片输入密码完成快捷登录
    await accountCard.click();
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill("adminpassword123");
    await page.getByTestId("auth-submit-btn").click();

    // 6. 验证成功登入主应用
    const userPanelBtn = page.getByTestId("current-user-panel-btn");
    await expect(userPanelBtn).toBeVisible({ timeout: 15000 });
  });

  test("3. 支持从设备快捷移除已记忆账号，清空后自动回退至常规邮箱输入页", async ({
    page,
  }) => {
    // 预置已保存的历史账号
    await page.addInitScript(() => {
      localStorage.clear();
      const mockSaved = [
        {
          id: "remove-test-user",
          email: "removeme@tescord.local",
          username: "TempUser#1234",
          displayName: "临时用户",
          discriminator: "1234",
          avatarUrl: null,
          lastActiveAt: Date.now(),
          rememberPassword: false,
        },
      ];
      localStorage.setItem("tescord_saved_accounts", JSON.stringify(mockSaved));
    });

    await page.goto("/");

    // 1. 验证首屏展示该账号卡片
    await expect(page.getByTestId("account-picker")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("临时用户")).toBeVisible();

    // 2. 点击该卡片右上角 ✕ 移除按钮
    const removeBtn = page.getByTestId("remove-account-remove-test-user");
    await expect(removeBtn).toBeAttached();
    await removeBtn.click({ force: true });

    // 3. 验证卡片消失，由于列表为空，自动平滑回退至常规邮箱输入页
    const emailInput = page.getByTestId("auth-email-input");
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("account-picker")).not.toBeVisible();

    // 验证 localStorage 已同步清空
    const stored = await page.evaluate(() => localStorage.getItem("tescord_saved_accounts"));
    expect(stored ? JSON.parse(stored).length : 0).toBe(0);
  });

  test("4. 在账号选择页支持‘使用其他账号登录’与‘返回账号列表’双向切换", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      const mockSaved = [
        {
          id: "other-user-test",
          email: "saved@tescord.local",
          username: "SavedUser#5555",
          displayName: "已存用户",
          discriminator: "5555",
          avatarUrl: null,
          lastActiveAt: Date.now(),
          rememberPassword: false,
        },
      ];
      localStorage.setItem("tescord_saved_accounts", JSON.stringify(mockSaved));
    });

    await page.goto("/");

    // 1. 处于账号选择界面
    await expect(page.getByTestId("account-picker")).toBeVisible({ timeout: 10000 });

    // 2. 点击“使用其他账号登录”
    const useOtherBtn = page.getByTestId("use-other-account-btn");
    await expect(useOtherBtn).toBeVisible();
    await useOtherBtn.click();

    // 3. 验证切换到邮箱输入阶段，并出现“返回账号列表”按钮
    const emailInput = page.getByTestId("auth-email-input");
    await expect(emailInput).toBeVisible();
    const backToPickerBtn = page.getByTestId("auth-back-to-picker-btn");
    await expect(backToPickerBtn).toBeVisible();

    // 4. 点击“返回账号列表”，验证切回 AccountPicker
    await backToPickerBtn.click();
    await expect(page.getByTestId("account-picker")).toBeVisible();
  });
});
