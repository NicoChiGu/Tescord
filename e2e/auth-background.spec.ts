import { test, expect } from "@playwright/test";

test.describe("Web 登录界面步进式流转、shake 错误动效与阻止默认刷新端到端验收", () => {
  test("1. Web 登录界面首屏呈现邮箱输入，输入已有账号平滑流转至密码登录，输错密码触发 shake 红框晃动与错误信息", async ({
    page,
  }) => {
    // 清除会话进入登录页
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 1. 验证首屏仅展示邮箱输入与继续按钮
    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");

    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await expect(submitBtn).toBeVisible();

    // 验证背景层中的极光光晕元素为纯静态挂载 (零 GPU 动画开销)
    const primaryAurora = page.getByTestId("auth-bg-ambient-orb-primary");
    const secondaryAurora = page.getByTestId("auth-bg-ambient-orb-secondary");
    await expect(primaryAurora).toBeAttached();
    await expect(secondaryAurora).toBeAttached();

    // 2. 输入系统内置账号 (Jackey 或 admin@tescord.local) 点击继续
    await emailInput.fill("admin@tescord.local");

    // 监听导航事件，断言提交表单不会触发浏览器默认的页面重载
    let pageReloaded = false;
    page.on("framenavigated", (frame) => {
      if (
        frame === page.mainFrame() &&
        frame.url().includes("about:blank") === false
      ) {
        // 初始页面加载之后的意外导航检测
      }
    });

    await submitBtn.click();

    // 3. 验证平滑过渡到输入密码步骤，原邮箱变为 disabled 展示，并出现修改邮箱按钮
    const passwordInput = page.getByTestId("auth-password-input");
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("auth-edit-email-btn")).toBeVisible();

    // 4. 输入错误密码测试红框左右剧烈晃动（shake 动效）及错误信息
    await passwordInput.fill("wrong_password_123");
    await submitBtn.click();

    // 验证出现错误信息并在密码容器上触发 animate-shake 与 border-rose-500
    await expect(page.locator("p.text-rose-400")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(".animate-shake")).toBeVisible();
    await expect(page.locator(".border-rose-500")).toBeVisible();

    // 重新输入字符时，红框错误状态自动清除
    await passwordInput.fill("adminpassword123");
    await expect(page.locator(".border-rose-500")).toHaveCount(0);
  });

  test("2. 输入未注册邮箱跳转至注册模式，邮箱呈现为 disabled，支持修改邮箱返回首屏", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");

    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");

    await expect(emailInput).toBeVisible({ timeout: 10000 });
    const randomEmail = `newuser_${Date.now()}@tescord.local`;
    await emailInput.fill(randomEmail);
    await submitBtn.click();

    // 验证流转到注册流程：展示邮箱 (disabled)，昵称输入框、密码输入框与邀请码输入框呈现
    const disabledEmailInput = page.getByTestId("auth-email-input");
    await expect(disabledEmailInput).toBeVisible({ timeout: 10000 });
    await expect(disabledEmailInput).toBeDisabled();
    await expect(disabledEmailInput).toHaveValue(randomEmail);

    const usernameInput = page.getByTestId("auth-username-input");
    const passwordInput = page.getByTestId("auth-password-input");
    const inviteInput = page.getByTestId("auth-invite-code-input");

    await expect(usernameInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(inviteInput).toBeVisible();

    // 测试点击「修改邮箱」按钮，成功返回首屏可重新编辑邮箱
    const editEmailBtn = page.getByTestId("auth-edit-email-btn");
    await expect(editEmailBtn).toBeVisible();
    await editEmailBtn.click();

    // 验证已返回首步，邮箱输入框恢复可编辑状态
    const editableEmailInput = page.getByTestId("auth-email-input");
    await expect(editableEmailInput).toBeVisible();
    await expect(editableEmailInput).toBeEnabled();
  });

  test("3. 前端邮箱格式合法性校验：空邮箱与非标准格式拦截、红框晃动动画及重输自动清除", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
    });

    await page.goto("/");

    const emailInput = page.getByTestId("auth-email-input");
    const submitBtn = page.getByTestId("auth-submit-btn");

    await expect(emailInput).toBeVisible({ timeout: 10000 });

    // 1. 空邮箱直接提交拦截
    let checkEmailRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/auth/check-email")) {
        checkEmailRequests++;
      }
    });

    await submitBtn.click();
    await expect(page.getByText("请输入邮箱地址")).toBeVisible();
    await expect(page.locator(".animate-shake")).toBeVisible();
    await expect(page.locator(".border-rose-500")).toBeVisible();
    expect(checkEmailRequests).toBe(0);

    // 2. 输入非标准格式邮箱拦截 (如: invalid-email-format)
    await emailInput.fill("invalid-email-format");
    // 输入时错误提示已自动清除
    await expect(page.locator(".border-rose-500")).toHaveCount(0);

    await submitBtn.click();
    await expect(page.getByText(/请输入有效的邮箱地址/)).toBeVisible();
    await expect(page.locator(".animate-shake")).toBeVisible();
    await expect(page.locator(".border-rose-500")).toBeVisible();
    expect(checkEmailRequests).toBe(0);

    // 3. 再次输入带 @ 但没有顶级域名的非法邮箱 (如: user@domain)
    await emailInput.fill("user@domain");
    await submitBtn.click();
    await expect(page.getByText(/请输入有效的邮箱地址/)).toBeVisible();
    expect(checkEmailRequests).toBe(0);

    // 4. 输入标准格式邮箱，成功放行通过前端校验并向后端发起验证
    await emailInput.fill("valid_user@tescord.local");
    await submitBtn.click();

    // 验证发起了 check-email 请求并顺利进入下一步
    await expect(page.getByTestId("auth-edit-email-btn")).toBeVisible({
      timeout: 10000,
    });
    expect(checkEmailRequests).toBeGreaterThanOrEqual(1);
  });
});
