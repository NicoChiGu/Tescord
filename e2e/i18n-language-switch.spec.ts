import { test, expect } from "@playwright/test";

test.describe("Tescord 多国语言 (i18n: zh-CN / en-US / ja-JP) 端到端与热切换验收", () => {
  test("1. 未登录状态下通过右上角快捷选择器自由切换 中/英/日 语言", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      localStorage.removeItem("tescord_access_token");
      localStorage.removeItem("tescord_refresh_token");
      if (!localStorage.getItem("tescord_locale")) {
        localStorage.setItem("tescord_locale", "zh-CN");
      }
    });

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 默认回退语言应为简体中文
    const loginHeading = page.getByRole("heading", {
      name: /欢迎回到 Tescord！/i,
    });
    await expect(loginHeading).toBeVisible({ timeout: 10000 });

    // 1.1 展开右上角语言选择菜单
    const langSelector = page.getByTestId("auth-language-selector");
    await expect(langSelector).toBeVisible();
    await langSelector.click();

    // 1.2 切换至 English (US)
    const enOption = page.getByTestId("auth-lang-en-US");
    await expect(enOption).toBeVisible();
    await enOption.click();

    // 验证标题与提交按钮立即变更为英文
    await expect(
      page.getByRole("heading", { name: /Welcome back to Tescord!/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Log In$/i })).toBeVisible();

    // 1.3 切换至 日本語
    await langSelector.click();
    const jaOption = page.getByTestId("auth-lang-ja-JP");
    await expect(jaOption).toBeVisible();
    await jaOption.click();

    // 验证标题与提交按钮立即变更为日文
    await expect(
      page.getByRole("heading", { name: /おかえりなさい！/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^ログイン$/i }),
    ).toBeVisible();

    // 1.4 切换回 简体中文
    await langSelector.click();
    const zhOption = page.getByTestId("auth-lang-zh-CN");
    await expect(zhOption).toBeVisible();
    await zhOption.click();

    await expect(
      page.getByRole("heading", { name: /欢迎回到 Tescord！/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^登 录$/i })).toBeVisible();

    // 确保没有控制台未捕获错误
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("2. 已登录状态下在用户设置中心热切换语言并验证持久化", async ({
    page,
  }) => {
    // 强制设置初始语言为简体中文并注入登录态
    await page.addInitScript(() => {
      if (!localStorage.getItem("tescord_locale")) {
        localStorage.setItem("tescord_locale", "zh-CN");
      }
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
          id: "e2e_i18n_user",
          username: "i18n_tester",
          displayName: "多语言测试员",
          email: "i18n@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/");

    // 2.1 打开用户设置中心
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    // 2.2 验证设置弹窗展示，并点击“界面语言” Tab
    const langTabBtn = page.getByTestId("tab-language-btn");
    await expect(langTabBtn).toBeVisible();
    await langTabBtn.click();

    // 2.3 验证多语言选项卡列表展示
    const langList = page.getByTestId("language-options-list");
    await expect(langList).toBeVisible();
    await expect(page.getByTestId("lang-option-zh-CN")).toBeVisible();
    await expect(page.getByTestId("lang-option-en-US")).toBeVisible();
    await expect(page.getByTestId("lang-option-ja-JP")).toBeVisible();

    // 2.4 点击切换到 English (US)
    await page.getByTestId("lang-option-en-US").click();

    // 验证界面零重载即刻变为英文
    await expect(page.getByText("App Settings")).toBeVisible();
    await expect(page.getByText("Voice & Video")).toBeVisible();
    await expect(page.getByTestId("tab-language-btn")).toContainText(
      "Language",
    );

    // 2.5 点击切换到 日本語
    await page.getByTestId("lang-option-ja-JP").click();

    // 验证界面零重载即刻变为日文
    await expect(page.getByText("アプリの設定")).toBeVisible();
    await expect(page.getByText("音声・ビデオ")).toBeVisible();
    await expect(page.getByTestId("tab-language-btn")).toContainText("言語");

    // 2.6 验证 localStorage 持久化
    const savedLocale = await page.evaluate(() =>
      localStorage.getItem("tescord_locale"),
    );
    expect(savedLocale).toBe("ja-JP");

    // 2.7 刷新页面，验证语言设置持久恢复为日文
    await page.reload();
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();
    await expect(page.getByTestId("tab-language-btn")).toContainText("言語");
  });
});
