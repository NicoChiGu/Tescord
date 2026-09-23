import { test, expect } from "@playwright/test";

test.describe("生产环境化治理与全站注册邀请码端到端验收", () => {
  test("1. 登录界面净化：彻底取消快速联调预设账号，无任何测试凭据暴露", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 确认登录提交按钮已呈现
    const loginBtn = page.getByTestId("auth-submit-btn");
    await expect(loginBtn).toBeVisible({ timeout: 10000 });

    // 严密断言：页面上绝无预设测试账号模块与文字
    await expect(page.getByText("快速填入测试账号")).toHaveCount(0);
    await expect(page.getByText("admin@tescord.local")).toHaveCount(0);
    await expect(page.getByText("纯净测试")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Jackey/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Alice/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Bob/i })).toHaveCount(0);
  });

  test("2. 注册表单支持邀请码输入，且通过 URL 参数 ?invite= 自动打开并预填", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    // 访问带 ?invite=PROD-CODE-8888 的 URL
    await page.goto("/?invite=PROD-CODE-8888");

    // 验证邀请码输入框已存在并自动预填为 PROD-CODE-8888
    const inviteInput = page.getByTestId("auth-invite-code-input");
    await expect(inviteInput).toBeVisible({ timeout: 10000 });
    await expect(inviteInput).toHaveValue("PROD-CODE-8888");

    // 验证按钮可交互
    const submitBtn = page.getByTestId("auth-submit-btn");
    await expect(submitBtn).toBeVisible();
  });

  test("3. 超级管理员控制台：包含独立的「注册邀请码」Tab，可创建并展示邀请码", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");

    // 使用系统内置的超级管理员账号直接通过真实表单登录 (先验证账号邮箱，再输入密码)
    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await emailInput.fill("admin@tescord.local");
    await submitBtn.click();

    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await passwordInput.fill("adminpassword123");
    await submitBtn.click();

    // 验证成功进入主界面，超管控制台金色盾牌按钮呈现
    const adminBtn = page.getByTestId("admin-dashboard-btn");
    await expect(adminBtn).toBeVisible({ timeout: 15000 });
    await adminBtn.click();

    // 验证控制台弹窗已打开
    const modal = page.getByTestId("admin-dashboard-modal");
    await expect(modal).toBeVisible();

    // 验证存在「注册邀请码」Tab，并点击切换
    const invitesTab = page.getByTestId("admin-tab-invites");
    await expect(invitesTab).toBeVisible();
    await invitesTab.click();

    // 点击生成新邀请码按钮
    const createBtn = page.getByTestId("create-invite-btn");
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // 在弹窗中输入自定义邀请码并提交
    const customCode = `VIP-${Date.now().toString().slice(-6)}`;
    const customCodeInput = page.getByPlaceholder("留空则系统自动随机生成");
    await expect(customCodeInput).toBeVisible();
    await customCodeInput.fill(customCode);

    const note = `E2E备注-${customCode}`;
    const noteInput = page.getByPlaceholder("例如: 2026 第一期内部测试邀请");
    await noteInput.fill(note);

    const confirmCreateBtn = page.getByRole("button", { name: "确认生成" });
    await confirmCreateBtn.click();

    // 验证列表刷新展示了新生成的邀请码
    await expect(page.getByText(customCode)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(note)).toBeVisible();
    await expect(confirmCreateBtn).toBeHidden({ timeout: 5000 });

    // 切换到「广播与维护」Tab 验证邀请码准入开关呈现
    const systemTab = page.getByTestId("admin-tab-system");
    await systemTab.click();
    await expect(page.getByText("强制邀请码准入 (Invite-Only)")).toBeVisible();
  });
});
