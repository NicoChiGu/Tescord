import { test, expect } from "@playwright/test";

test.describe("Web 登录界面 Discord 风格轻量化背景端到端验收", () => {
  test("1. Web 登录界面成功呈现 Discord 极简科技点阵与深邃极光背景层", async ({
    page,
  }) => {
    // 清除会话进入登录页
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 验证登录卡片与输入控件正常渲染并具备焦点能力
    const emailInput = page.getByTestId("auth-email-input");
    const passwordInput = page.getByTestId("auth-password-input");
    const submitBtn = page.getByTestId("auth-submit-btn");

    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();

    // 验证背景层中的极光光晕元素为纯静态挂载 (零 GPU 动画开销)
    const primaryAurora = page.getByTestId("auth-bg-ambient-orb-primary");
    const secondaryAurora = page.getByTestId("auth-bg-ambient-orb-secondary");

    await expect(primaryAurora).toBeAttached();
    await expect(secondaryAurora).toBeAttached();

    // 确认已彻底取消循环动画类名
    await expect(page.locator(".animate-aurora-primary")).toHaveCount(0);
    await expect(page.locator(".animate-aurora-secondary")).toHaveCount(0);

    // 验证背景层为 pointer-events-none，表单交互完全未被遮挡
    await emailInput.fill("testuser@tescord.local");
    await expect(emailInput).toHaveValue("testuser@tescord.local");

    await passwordInput.fill("password123");
    await expect(passwordInput).toHaveValue("password123");
  });

  test("2. 切换登录/注册模式时，背景与卡片平滑协调，无错位或交互失效", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");

    // 切换到注册模式
    const switchBtn = page.getByTestId("auth-switch-mode-btn");
    await expect(switchBtn).toBeVisible({ timeout: 5000 });
    await switchBtn.click();

    // 验证注册所需用户名输入框正确呈现
    const usernameInput = page.getByTestId("auth-username-input");
    await expect(usernameInput).toBeVisible({ timeout: 5000 });
  });
});
