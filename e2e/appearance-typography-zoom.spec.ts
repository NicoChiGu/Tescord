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

  test("4. 界面缩放功能已按要求移除，且支持全局文字大小 (13px~20px) 自由调节与重置", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();
    await page.getByTestId("tab-appearance-btn").click();

    // 确认界面缩放选项（Zoom）已彻底移除
    const zoomOption = page.getByTestId("zoom-option-110");
    await expect(zoomOption).not.toBeVisible();
    const resetZoomBtn = page.getByTestId("reset-zoom-btn");
    await expect(resetZoomBtn).not.toBeVisible();

    // 确认全局字号调节器存在
    const slider = page.locator('input[type="range"]#global-font-size-slider');
    await expect(slider).toBeVisible();

    // 拖动滑块至 18px
    await slider.fill("18");
    await slider.dispatchEvent("input");
    await slider.dispatchEvent("change");

    // 验证根字体大小与 CSS 变量实时联动
    const rootFontSize = await page.evaluate(
      () => document.documentElement.style.fontSize,
    );
    expect(rootFontSize).toBe("18px");

    // 重置字号
    const resetBtn = page.getByTestId("reset-font-size-btn");
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    const resetRootFontSize = await page.evaluate(
      () => document.documentElement.style.fontSize,
    );
    expect(resetRootFontSize).toBe("16px");
  });
});
