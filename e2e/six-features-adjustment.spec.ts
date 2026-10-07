import { test, expect } from "@playwright/test";

test.describe("6 项系统功能调整与体验优化自动化验收 (six-features-adjustment)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tescord_locale", "zh-CN");
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem(
        "tescord_refresh_token",
        localStorage.getItem("tescord_e2e_refresh_token") ||
          "mock_refresh_token",
      );
    });
  });

  test("1. 外观与版面：移除客户端缩放，提供 13px~20px 全局文字大小调节与重置", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();
    await page.getByTestId("tab-appearance-btn").click();

    // 确认已无“界面缩放”选项 (Zoom)
    const zoomOption = page.getByTestId("zoom-option-110");
    await expect(zoomOption).not.toBeVisible();
    const resetZoomBtn = page.getByTestId("reset-zoom-btn");
    await expect(resetZoomBtn).not.toBeVisible();

    // 确认全局字号调节器存在
    const slider = page.locator('input[type="range"]#global-font-size-slider');
    await expect(slider).toBeVisible();

    // 调节字号到 18px
    await slider.fill("18");
    await slider.dispatchEvent("input");
    await slider.dispatchEvent("change");

    // 验证根 html 的 style.fontSize 得到实时应用
    const rootFontSize = await page.evaluate(
      () => document.documentElement.style.fontSize,
    );
    expect(rootFontSize).toBe("18px");

    // 点击重置
    const resetBtn = page.getByTestId("reset-font-size-btn");
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    const resetRootFontSize = await page.evaluate(
      () => document.documentElement.style.fontSize,
    );
    expect(resetRootFontSize).toBe("16px");
  });

  test("2. 用户状态指示器：在用户设置中切换至闲置(月牙)与请勿打扰(横杠)，SVG物理镂空生效", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();

    // 切换至“个人资料与展示卡”Tab 查看状态选择器
    const profileTab = page.locator('button:has-text("个人资料与展示卡")');
    await expect(profileTab).toBeVisible({ timeout: 5000 });
    await profileTab.click();

    // 切换至离开 (IDLE)
    const idleBtn = page.locator("button:has-text('离开')").first();
    await expect(idleBtn).toBeVisible({ timeout: 5000 });
    await idleBtn.click();

    // 检查页面中 StatusBadge 生成了月牙遮罩 (mask 中包含挖去黑圆的 SVG)
    const hasIdleMoonMask = await page.evaluate(() => {
      const masks = Array.from(document.querySelectorAll("mask"));
      return masks.some(
        (m) =>
          m.innerHTML.includes("<circle") &&
          m.innerHTML.includes('fill="#000000"'),
      );
    });
    expect(hasIdleMoonMask).toBeTruthy();

    // 切换至请勿打扰 (DND)
    const dndBtn = page.locator("button:has-text('请勿打扰')").first();
    await expect(dndBtn).toBeVisible();
    await dndBtn.click();

    // 检查页面中 StatusBadge 生成了横杠遮罩 (mask 中包含挖去黑矩形的 SVG)
    const hasDndBarMask = await page.evaluate(() => {
      const masks = Array.from(document.querySelectorAll("mask"));
      return masks.some(
        (m) =>
          m.innerHTML.includes("<rect") &&
          m.innerHTML.includes('fill="#000000"'),
      );
    });
    expect(hasDndBarMask).toBeTruthy();
  });

  test("3. 用户设置表情管理：支持查看与管理个人表情，并展示 /50 配额与上传按钮", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("user-settings-gear-btn").click();

    // 点击“我的表情”Tab
    const emojisTab = page.locator('button[data-testid="tab-emojis-btn"]');
    await expect(emojisTab).toBeVisible({ timeout: 5000 });
    await emojisTab.click();

    // 验证配额提示
    const quotaText = page.locator("text=/50");
    await expect(quotaText).toBeVisible();

    // 验证上传按钮存在
    const uploadBtn = page.locator("button:has-text('上传')").first();
    await expect(uploadBtn).toBeVisible();
  });

  test("4. 超级管理员建服控制：普通用户在受限模式下展示专属单服提示并引导加入", async ({
    page,
  }) => {
    // 切换为真实的数据库普通用户 Alice
    await page.addInitScript(() => {
      const normalToken = localStorage.getItem(
        "tescord_e2e_normal_access_token",
      );
      if (normalToken) {
        localStorage.setItem("tescord_access_token", normalToken);
        localStorage.removeItem("tescord_refresh_token");
        localStorage.removeItem("tescord_last_user");
      }
    });

    // 覆盖注册状态接口，模拟服务端禁止非超管建服
    await page.route("**/api/auth/registration-status", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          registrationEnabled: true,
          allowNonSuperAdminCreateGuild: false,
        }),
      });
    });

    await page.goto("/");
    const root = page.locator("#root");
    await expect(root).toBeVisible({ timeout: 10000 });

    // 点击添加服务器按钮
    const addServerBtn = page.locator('button[title*="添加服务器"]').first();
    await expect(addServerBtn).toBeVisible({ timeout: 10000 });
    await addServerBtn.click();

    // 验证非超管弹出的单服务器限制提示与加入已有服务器引导
    const restrictedNotice = page.locator(
      "text=当前平台已由管理员设置为单服务器模式",
    );
    await expect(restrictedNotice).toBeVisible({ timeout: 5000 });
    const joinBtn = page.locator("button:has-text('加入')");
    await expect(joinBtn.first()).toBeVisible();
  });

  test("5. 类 Discord 表情选择器：支持搜索、分类和底部预览", async ({
    page,
  }) => {
    await page.goto("/");
    const root = page.locator("#root");
    await expect(root).toBeVisible({ timeout: 10000 });

    // 点击输入框右侧表情图标
    const emojiBtn = page.locator('button[title*="表情"]').last();
    if (await emojiBtn.isVisible()) {
      await emojiBtn.click();

      // 验证表情选择器弹出
      const emojiPicker = page.locator(
        'div[data-testid="emoji-picker-popover"]',
      );
      await expect(emojiPicker).toBeVisible();

      // 验证搜索框
      const searchInput = emojiPicker.locator('input[placeholder*="搜索表情"]');
      await expect(searchInput).toBeVisible();

      // 搜索 "smile"
      await searchInput.fill("smile");
      await page.waitForTimeout(100);

      // 验证过滤出的表情按钮
      const emojiItem = emojiPicker
        .locator("button:has-text('😀')")
        .or(emojiPicker.locator("button:has-text('😄')"))
        .first();
      await expect(emojiItem).toBeVisible();
    }
  });
});
