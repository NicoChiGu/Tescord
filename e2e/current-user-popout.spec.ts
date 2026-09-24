import { test, expect } from "@playwright/test";

test.describe("Discord 风格左下角当前用户弹窗卡片 (CurrentUserPopout) E2E 验收", () => {
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
          id: "usr_mock_jackey_id_12345",
          username: "JackeyTERA",
          email: "jackey@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          customStatus: "最佳的冷笑话？",
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
          id: "usr_mock_jackey_id_12345",
          username: "JackeyTERA",
          status: data.status || "ONLINE",
          customStatus:
            data.customStatus !== undefined
              ? data.customStatus
              : "最佳的冷笑话？",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        }),
      });
    });
  });

  test("验证点击左下角用户条目展示卡片、卡片外部点击关闭、ESC 关闭与交互", async ({
    page,
  }) => {
    // 监听全局未捕获异常
    const uncaughtErrors: string[] = [];
    page.on("pageerror", (err) => uncaughtErrors.push(err.message));

    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 定位左下角当前用户触发按钮
    const userPanelBtn = page.getByTestId("current-user-panel-btn");
    await expect(userPanelBtn).toBeVisible({ timeout: 10000 });

    const popoutCard = page.getByTestId("current-user-popout");
    // 初始状态下不应存在卡片
    await expect(popoutCard).toHaveCount(0);

    // ===============================================================
    // 场景 1：点击左下角用户条目呼出卡片并校验结构
    // ===============================================================
    await userPanelBtn.click();
    await expect(popoutCard).toBeVisible({ timeout: 5000 });
    await expect(popoutCard).toHaveCount(1);

    // 校验卡片内的用户名与个性状态气泡
    await expect(
      popoutCard.getByText("JackeyTERA", { exact: true }),
    ).toBeVisible();
    await expect(popoutCard.getByText("@JackeyTERA")).toBeVisible();
    await expect(
      page.getByTestId("user-popout-custom-status-bubble"),
    ).toBeVisible();

    // 校验核心操作菜单项存在
    await expect(page.getByTestId("popout-edit-profile-btn")).toBeVisible();
    await expect(page.getByTestId("popout-badge-new")).toBeVisible();
    await expect(page.getByTestId("popout-badge-new")).toHaveText(/新的|NEW/);
    await expect(page.getByTestId("popout-status-menu-btn")).toBeVisible();
    await expect(page.getByTestId("popout-switch-account-btn")).toBeVisible();
    await expect(page.getByTestId("popout-copy-id-btn")).toBeVisible();

    // ===============================================================
    // 场景 2：在卡片外部操作则关闭（点击外部区域）
    // ===============================================================
    // 点击顶部常驻区域或频道列表空白处（在卡片外部）
    await page.mouse.click(600, 200);
    await expect(popoutCard).toHaveCount(0);

    // ===============================================================
    // 场景 3：再次呼出卡片并通过 ESC 键关闭
    // ===============================================================
    await userPanelBtn.click();
    await expect(popoutCard).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(popoutCard).toHaveCount(0);

    // ===============================================================
    // 场景 4：重复点击左下角触发器按钮自身，平滑折叠关闭
    // ===============================================================
    await userPanelBtn.click();
    await expect(popoutCard).toBeVisible({ timeout: 5000 });

    await userPanelBtn.click();
    await expect(popoutCard).toHaveCount(0);

    // ===============================================================
    // 场景 5：测试复制使用者 ID 反馈
    // ===============================================================
    await userPanelBtn.click();
    await expect(popoutCard).toBeVisible({ timeout: 5000 });

    const copyBtn = page.getByTestId("popout-copy-id-btn");
    await copyBtn.click();
    const copyFeedback = page.getByTestId("popout-copy-feedback");
    await expect(copyFeedback).toBeVisible({ timeout: 3000 });
    await expect(copyFeedback).toHaveText(/已[复制複製]|Copied|コピー完了/);

    // ===============================================================
    // 场景 6：测试展开在线状态切换子菜单
    // ===============================================================
    const statusMenuBtn = page.getByTestId("popout-status-menu-btn");
    await statusMenuBtn.click();

    // 验证状态选项展开
    const dndItem = page.getByTestId("popout-status-item-DND");
    await expect(dndItem).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("popout-status-item-IDLE")).toBeVisible();
    await expect(
      page.getByTestId("popout-status-item-INVISIBLE"),
    ).toBeVisible();

    // 选择“请勿打扰”
    await dndItem.click();

    // ===============================================================
    // 场景 7：点击“編輯個人資料”，卡片关闭并打开个人设置弹窗
    // ===============================================================
    // 如果卡片在切换状态后折叠，重新呼出卡片
    if (!(await popoutCard.isVisible())) {
      await userPanelBtn.click();
      await expect(popoutCard).toBeVisible({ timeout: 5000 });
    }

    const editProfileBtn = page.getByTestId("popout-edit-profile-btn");
    await editProfileBtn.click();

    // 卡片应关闭
    await expect(popoutCard).toHaveCount(0);
    // 用户设置弹窗应打开
    await expect(page.getByTestId("user-settings-modal")).toBeVisible({
      timeout: 5000,
    });

    // ===============================================================
    // 场景 8：国际化 (i18n) 动态响应验证 —— 热切换至 English (US) 并验证卡片文案
    // ===============================================================
    // 在已打开的用户设置弹窗中，切换至“界面语言” Tab 并选择 English (US)
    const langTabBtn = page.getByTestId("tab-language-btn");
    await expect(langTabBtn).toBeVisible({ timeout: 3000 });
    await langTabBtn.click();

    const enOption = page.getByTestId("lang-option-en-US");
    await expect(enOption).toBeVisible({ timeout: 3000 });
    await enOption.click();

    // 关闭用户设置弹窗
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-settings-modal")).toHaveCount(0);

    // 重新呼出左下角卡片
    await userPanelBtn.click();
    await expect(popoutCard).toBeVisible({ timeout: 5000 });

    // 校验英文模式下的关键文案渲染
    await expect(page.getByTestId("popout-badge-new")).toHaveText("NEW");
    await expect(popoutCard.getByText("Edit Profile")).toBeVisible();
    await expect(popoutCard.getByText("Switch Account")).toBeVisible();
    await expect(popoutCard.getByText("Copy User ID")).toBeVisible();

    // 校验个性签名 Tooltip 与清除状态后的空状态英文文案
    const statusBubble = page.getByTestId("user-popout-custom-status-bubble");
    await expect(statusBubble).toHaveAttribute(
      "title",
      /Custom status: .* \(Click to edit\)/,
    );
    await statusBubble.hover();
    const clearBtn = page.getByTitle("Clear status");
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(popoutCard.getByText("Share your thoughts...")).toBeVisible();

    // 展开状态子菜单验证英文状态描述
    await page.getByTestId("popout-status-menu-btn").click();
    await expect(popoutCard.getByText("Do Not Disturb")).toBeVisible();
    await expect(popoutCard.getByText("Invisible")).toBeVisible();

    // 确认控制台无严重异常
    expect(uncaughtErrors).toEqual([]);
  });
});
