import { test, expect } from "@playwright/test";

test.describe("游戏状态自动侦测与全维度展示卡个性化 (Profiles & Game Activity) E2E 验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录 Token 会话与本地 Mock 存储
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
          id: "usr_mock_profile_tester",
          username: "TescordGamer",
          email: "gamer@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          customStatus: "探索未来 🚀",
          bio: "热爱全栈与游戏开发",
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
          id: "usr_mock_profile_tester",
          username: "TescordGamer",
          status: data.status || "ONLINE",
          customStatus:
            data.customStatus !== undefined ? data.customStatus : "探索未来 🚀",
          bio: data.bio !== undefined ? data.bio : "热爱全栈与游戏开发",
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

  test("验证展示卡个性化设置页双栏结构、1:1 动态实时预览及游戏状态交互", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1366, height: 850 });
    await page.goto("/");

    // 1. 点击左下角用户条设置齿轮按钮打开设置模态框
    const settingsBtn = page.getByTestId("user-settings-gear-btn");
    const modal = page.getByTestId("user-settings-modal");
    await expect(settingsBtn).toBeVisible({ timeout: 10000 });

    // 采用弹性重试机制触发点击，避免首屏初始加载与渲染水合丢弃点击事件
    await expect(async () => {
      if (!(await modal.isVisible())) {
        await settingsBtn.click();
      }
      await expect(modal).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });

    // 3. 切换至“个人资料与展示卡 (Profiles)”选项卡
    const profileTabBtn = page.getByTestId("tab-profile-btn");
    await expect(profileTabBtn).toBeVisible();
    await profileTabBtn.click();

    // 4. 验证左侧配置表单核心元素均渲染
    await expect(page.getByText("展示卡与个人资料 (Profiles)")).toBeVisible();
    await expect(page.getByText("展示卡横幅 (Profile Banner)")).toBeVisible();
    await expect(page.getByTestId("input-banner-url")).toBeVisible();
    await expect(
      page.getByTestId("game-activity-settings-section"),
    ).toBeVisible();

    // 5. 验证右侧 1:1 动态实时卡片预览区挂载
    await expect(page.getByText("预览效果 (PREVIEW)")).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: "TescordGamer" }).first(),
    ).toBeVisible();
    await expect(modal.getByText("@TescordGamer").first()).toBeVisible();

    // 6. 验证游戏状态侦测与模拟交互
    const simulateGameBtn = page.getByRole("button", { name: /模拟测试游戏/i });
    await expect(simulateGameBtn).toBeVisible();
    await simulateGameBtn.click();

    // 验证右侧预览卡片中实时渲染“正在游玩 (PLAYING A GAME)”面板
    const playingGamePanel = page.getByTestId("preview-playing-game-panel");
    await expect(playingGamePanel).toBeVisible();
    await expect(playingGamePanel.getByText(/英雄联盟/i)).toBeVisible();

    // 7. 验证切换游戏展示开关对卡片的影响
    const showActivityToggle = page.getByTestId("toggle-show-activity");
    await expect(showActivityToggle).toBeChecked();
    await showActivityToggle.uncheck();

    // 验证关闭后游戏面板隐藏，并显示“游戏状态已设置为隐藏”
    await expect(playingGamePanel).not.toBeVisible();
    await expect(page.getByText("游戏状态已设置为隐藏")).toBeVisible();

    // 8. 验证底部“未保存更改提示条”滑出
    const noticeBar = page.getByTestId("unsaved-changes-notice-bar");
    await expect(noticeBar).toBeVisible();
    await expect(
      noticeBar.getByText("注意 — 您有未保存的更改！"),
    ).toBeVisible();

    // 9. 验证重置按钮功能
    const resetBtn = page.getByTestId("reset-profile-changes-btn");
    await resetBtn.click();
    await expect(noticeBar).not.toBeVisible();
    await expect(showActivityToggle).toBeChecked();

    // 10. 验证修改横幅图片与保存流程
    const bannerUrlInput = page.getByTestId("input-banner-url");
    await bannerUrlInput.fill(
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f",
    );

    // 提示条再次出现
    await expect(noticeBar).toBeVisible();
    const saveBtn = page.getByTestId("save-profile-changes-btn");
    await saveBtn.click();

    // 验证保存成功提示
    await expect(
      page.getByText("展示卡个性化设置已成功保存并全网同步！"),
    ).toBeVisible();

    // 11. 验证 ESC 键或右上角 X 键正常关闭设置中心
    const closeBtn = page.getByTestId("close-user-settings-btn");
    await closeBtn.click();
    await expect(modal).not.toBeVisible();

    expect(consoleErrors.filter((e) => !e.includes("ResizeObserver"))).toEqual(
      [],
    );
  });
});
