import { test, expect } from "@playwright/test";

test.describe("外观与排版设置（Appearance, Chat Font Scaling, Cozy/Compact, Zoom Level）端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 并重置配置
    await page.addInitScript(() => {
      localStorage.setItem("tescord_locale", "zh-CN");
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
          id: "e2e_appearance_user",
          username: "appearance_tester",
          displayName: "排版测试员",
          email: "appearance@tescord.local",
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

    await page.route("**/api/users/@me/settings", (route) => {
      if (route.request().method() === "PATCH") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            chatFontSize: 16,
            messageDisplayMode: "cozy",
          }),
        });
      }
    });
  });

  test("1. 能够通过侧边栏齿轮打开用户设置，并切换至'外观与排版'选项卡", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 点击左下角齿轮打开设置中心
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    // 检查“外观与排版”Tab按钮是否展示
    const appearanceTabBtn = page.getByTestId("tab-appearance-btn");
    await expect(appearanceTabBtn).toBeVisible();
    await appearanceTabBtn.click();

    // 检查外观面板已成功挂载
    const appearanceTab = page.getByTestId("appearance-settings-tab");
    await expect(appearanceTab).toBeVisible();
    await expect(page.getByText("外观与排版设置")).toBeVisible();
  });

  test("2. 实时效果预览卡片正常渲染，并能即时联动切换普通模式 (Cozy) 与紧凑模式 (Compact)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();
    await page.getByTestId("tab-appearance-btn").click();

    // 默认应为普通模式 (Cozy)，展示机器人头像
    const cozyBtn = page.getByTestId("mode-cozy-btn");
    const compactBtn = page.getByTestId("mode-compact-btn");
    await expect(cozyBtn).toBeVisible();
    await expect(compactBtn).toBeVisible();

    // 切换至紧凑模式 (Compact)
    await compactBtn.click();

    // 检查 store 中的 messageDisplayMode 变更
    const currentMode = await page.evaluate(() => {
      return (window as any).useSettingsStore?.getState()?.messageDisplayMode;
    });
    expect(currentMode).toBe("compact");

    // 切换回普通模式 (Cozy)
    await cozyBtn.click();
    const revertedMode = await page.evaluate(() => {
      return (window as any).useSettingsStore?.getState()?.messageDisplayMode;
    });
    expect(revertedMode).toBe("cozy");
  });

  test("3. 能够拖动或点击预设刻度调节聊天字体大小（12px~20px），并驱动 CSS 变量更新", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();
    await page.getByTestId("tab-appearance-btn").click();

    // 点击 18px 预设
    const preset18 = page.getByTestId("preset-font-18");
    await expect(preset18).toBeVisible();
    await preset18.click();

    // 检查根元素 CSS 变量是否生效为 18px
    const fontSizeVar = await page.evaluate(() => {
      return document.documentElement.style.getPropertyValue(
        "--chat-font-size",
      );
    });
    expect(fontSizeVar).toBe("18px");

    // 检查恢复默认按钮是否出现并生效
    const resetBtn = page.getByTestId("reset-font-size-btn");
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // 检查恢复后 CSS 变量重置为 16px
    const resetFontSizeVar = await page.evaluate(() => {
      return document.documentElement.style.getPropertyValue(
        "--chat-font-size",
      );
    });
    expect(resetFontSizeVar).toBe("16px");
  });

  test("4. 能够选择界面缩放比例（80%~150%）并执行重置操作", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();
    await page.getByTestId("tab-appearance-btn").click();

    // 点击 110% 缩放选项
    const zoom110 = page.getByTestId("zoom-option-110");
    await expect(zoom110).toBeVisible();
    await zoom110.click();

    // 检查 store 中的 zoomFactor
    const zoomVal = await page.evaluate(() => {
      return (window as any).useSettingsStore?.getState()?.zoomFactor;
    });
    expect(zoomVal).toBeCloseTo(1.1, 1);

    // 检查重置缩放按钮
    const resetZoomBtn = page.getByTestId("reset-zoom-btn");
    await expect(resetZoomBtn).toBeVisible();
    await resetZoomBtn.click();

    const resetZoomVal = await page.evaluate(() => {
      return (window as any).useSettingsStore?.getState()?.zoomFactor;
    });
    expect(resetZoomVal).toBe(1.0);
  });
});
