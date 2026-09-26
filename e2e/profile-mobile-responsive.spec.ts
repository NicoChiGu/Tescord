import { test, expect } from "@playwright/test";

test.describe("移动端 Web 与较小视口“编辑个人资料 / 用户设置”响应式交互验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录 Token 与本地存储
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 当前登录用户信息
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_mock_mobile_profile_tester",
          username: "MobileTester",
          email: "mobile@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          customStatus: "移动端适配体验 📱",
          bio: "跨端即时通讯与音视频探索者",
          bannerColor: "#5865f2",
          bannerUrl: null,
          themeColor: "#23a55a",
          showActivity: true,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    // Mock 用户资料与状态更新接口
    await page.route("**/api/users/@me", (route) => {
      const data = route.request().postDataJSON() || {};
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_mock_mobile_profile_tester",
          username: "MobileTester",
          displayName: data.displayName || "MobileTester",
          status: data.status || "ONLINE",
          customStatus:
            data.customStatus !== undefined
              ? data.customStatus
              : "移动端适配体验 📱",
          bio: data.bio !== undefined ? data.bio : "跨端即时通讯与音视频探索者",
          bannerColor:
            data.bannerColor !== undefined ? data.bannerColor : "#5865f2",
          bannerUrl: data.bannerUrl !== undefined ? data.bannerUrl : null,
          themeColor:
            data.themeColor !== undefined ? data.themeColor : "#23a55a",
          showActivity:
            data.showActivity !== undefined ? data.showActivity : true,
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        }),
      });
    });
  });

  test("移动端小视口 (375x667)：目录与详情切换、全屏Modal、悬浮预览及无溢出保存条", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // 1. 设置移动端经典 iPhone 视口
    const viewportWidth = 375;
    const viewportHeight = 667;
    await page.setViewportSize({
      width: viewportWidth,
      height: viewportHeight,
    });
    await page.goto("/");

    // 2. 移动端抽屉中打开左下角用户设置 / 资料弹窗
    // 若在登录界面则一键跳过
    const quickLoginBtn = page.getByRole("button", {
      name: /Jackey 系统管理员/i,
    });
    if (
      (await quickLoginBtn.count()) > 0 &&
      (await quickLoginBtn.isVisible())
    ) {
      await quickLoginBtn.click();
    }

    // 移动端首先打开左侧抽屉（点击“打开频道与服务器抽屉”或“打开频道列表”按钮）
    const openDrawerBtn = page
      .getByTitle("打开频道与服务器抽屉")
      .or(page.getByTestId("toggle-mobile-drawer-btn"))
      .or(page.getByTestId("mobile-open-drawer-btn"))
      .first();
    await expect(openDrawerBtn).toBeVisible({ timeout: 15000 });
    await openDrawerBtn.click();

    // 点击左侧边栏底部的设置齿轮打开用户设置中心
    const settingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(settingsBtn).toBeVisible({ timeout: 10000 });
    await settingsBtn.click();

    // 3. 验证 UserSettingsModal 在移动端正确展示
    const modal = page.getByTestId("user-settings-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });

    // 4. 验证移动端顶部统一关闭按钮位于顶部易于触控的位置
    const closeBtn = page.getByTestId("close-user-settings-mobile-btn");
    await expect(closeBtn).toBeVisible();
    const closeBtnBox = await closeBtn.boundingBox();
    expect(closeBtnBox).not.toBeNull();
    // 确保位于页面上方 (Y < 60) 且靠右 (X > 280)
    expect(closeBtnBox!.y).toBeLessThan(60);
    expect(closeBtnBox!.x).toBeGreaterThan(280);

    // 5. 验证移动端目录与全宽详情页切换
    const profileTab = page.getByTestId("tab-profile-btn");
    const audioTab = page.getByTestId("tab-audio-btn");
    const languageTab = page.getByTestId("tab-language-btn");
    const updatesTab = page.getByTestId("tab-updates-btn");

    // 齿轮快捷入口直接打开语音详情，先返回设置目录。
    await expect(page.getByTestId("user-settings-detail")).toBeVisible();
    await page.getByTestId("user-settings-back").click();
    await expect(profileTab).toBeVisible();
    await expect(audioTab).toBeVisible();
    await expect(page.getByTestId("user-settings-detail")).toBeHidden();

    // 点击语言 Tab 验证切换顺畅
    await languageTab.click();
    await expect(page.getByTestId("user-settings-menu")).toBeHidden();
    await expect(page.getByTestId("language-options-list")).toBeVisible({
      timeout: 3000,
    });

    // 返回目录后进入个人资料
    await page.getByTestId("user-settings-back").click();
    await profileTab.click();
    await expect(page.getByTestId("profile-display-name-input")).toBeVisible();

    // 6. 验证移动端悬浮预览资料卡按钮 (FAB)
    const previewFab = page.getByTestId("open-profile-preview-fab");
    await expect(previewFab).toBeVisible();
    const fabBox = await previewFab.boundingBox();
    expect(fabBox).not.toBeNull();
    // 悬浮按钮位于视口下半部分靠右
    expect(fabBox!.y).toBeGreaterThan(400);
    expect(fabBox!.x).toBeGreaterThan(150);

    // 点击 FAB 弹出移动端半模态卡片预览
    await previewFab.click();
    const previewModal = page.getByTestId("mobile-profile-preview-modal");
    await expect(previewModal).toBeVisible();
    await expect(previewModal.getByText("实时卡片预览")).toBeVisible();

    // 点击半模态关闭按钮
    const closePreviewBtn = page.getByTestId("close-mobile-preview-btn");
    await expect(closePreviewBtn).toBeVisible();
    await closePreviewBtn.click();
    await expect(previewModal).not.toBeVisible();

    // 7. 验证在小屏修改个人资料时的未保存更改提示条 (Notice Bar) 物理尺寸适配
    const displayNameInput = page.getByTestId("profile-display-name-input");
    await displayNameInput.fill("MobileChampion");

    // 提示条滑出
    const noticeBar = page.getByTestId("unsaved-changes-notice-bar");
    await expect(noticeBar).toBeVisible();

    // 关键物理无溢出断言：提示条必须完全居于视口之内
    const noticeBox = await noticeBar.boundingBox();
    expect(noticeBox).not.toBeNull();
    expect(noticeBox!.x).toBeGreaterThanOrEqual(0);
    expect(noticeBox!.x + noticeBox!.width).toBeLessThanOrEqual(
      viewportWidth + 2,
    );

    // 验证重置按钮有效
    const resetBtn = page.getByTestId("reset-profile-changes-btn");
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    await expect(noticeBar).not.toBeVisible();

    // 再次修改并保存
    await displayNameInput.fill("SuperMobileTester");
    await expect(noticeBar).toBeVisible();
    const saveBtn = page.getByTestId("save-profile-changes-btn");
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // 验证保存成功提示
    await expect(
      page.getByText("展示卡个性化设置已成功保存并全网同步！"),
    ).toBeVisible();

    // 8. 验证顶部统一关闭按钮一键退出设置
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    // 控制台无严重异常
    expect(consoleErrors.filter((e) => !e.includes("ResizeObserver"))).toEqual(
      [],
    );
  });

  test("超窄屏移动端 (360x740)：验证无横向溢出与表单输入无缩放冲突", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    const viewportWidth = 360;
    const viewportHeight = 740;
    await page.setViewportSize({
      width: viewportWidth,
      height: viewportHeight,
    });
    await page.goto("/");

    // 若在登录界面则一键跳过
    const quickLoginBtn = page.getByRole("button", {
      name: /Jackey 系统管理员/i,
    });
    if (
      (await quickLoginBtn.count()) > 0 &&
      (await quickLoginBtn.isVisible())
    ) {
      await quickLoginBtn.click();
    }

    // 打开抽屉与设置
    const openDrawerBtn = page
      .getByTitle("打开频道与服务器抽屉")
      .or(page.getByTestId("toggle-mobile-drawer-btn"))
      .or(page.getByTestId("mobile-open-drawer-btn"))
      .first();
    await expect(openDrawerBtn).toBeVisible({ timeout: 15000 });
    await openDrawerBtn.click();

    const settingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(settingsBtn).toBeVisible({ timeout: 10000 });
    await settingsBtn.click();

    const modal = page.getByTestId("user-settings-modal");
    await expect(modal).toBeVisible();

    // 切换至个人资料与展示卡 Tab
    const profileTab = page.getByTestId("tab-profile-btn");
    await page.getByTestId("user-settings-back").click();
    await expect(profileTab).toBeVisible();
    await profileTab.click();

    // 验证页面整体无横向溢出滚动
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 2);

    // 验证在线状态单选项在 360px 下全部可见且正常排布
    const onlineOption = page.getByRole("button", { name: /在线/i }).first();
    await expect(onlineOption).toBeVisible();

    // 验证游戏模拟测试卡片在 360px 下垂直/水平弹性自适应
    const simulateBtn = page.getByRole("button", { name: /模拟测试游戏/i });
    await expect(simulateBtn).toBeVisible();

    // 关闭 Modal
    const closeBtn = page.getByTestId("close-user-settings-mobile-btn");
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    expect(consoleErrors.filter((e) => !e.includes("ResizeObserver"))).toEqual(
      [],
    );
  });
});
