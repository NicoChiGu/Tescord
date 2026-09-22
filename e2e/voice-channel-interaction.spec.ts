import { test, expect } from "@playwright/test";

test.describe("语音频道进入交互自动化验收 (Voice Channel Click & Double-Click)", () => {
  test("单击仅预览语音房间，双击直接连入通话，且右键菜单支持快捷连入", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 初始化登录状态与 API Mock
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_voice_test",
          username: "voice_tester",
          displayName: "语音交互测试员",
          email: "voice_tester@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/livekit/token", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "mock_livekit_token",
          url: "wss://localhost:7880",
        }),
      });
    });

    await page.route("**/rtc/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    // 2. 访问主页面并进入首个公会
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 定位语音频道按钮
    const voiceChannelBtn = page
      .locator('button[title="单击预览房间，双击加入语音通话"]')
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });

    // 验证按钮具有提示属性 (title)
    await expect(voiceChannelBtn).toHaveAttribute(
      "title",
      "单击预览房间，双击加入语音通话",
    );

    // ==========================================
    // 场景一：单击语音频道 -> 仅选中预览，不连入语音
    // ==========================================
    await voiceChannelBtn.click();

    // 验证中央区域切换至语音房间预览
    const unjoinedNotice = page.getByText("您当前未连入此语音频道");
    await expect(unjoinedNotice).toBeVisible({ timeout: 5000 });

    const joinVoiceBtn = page.getByRole("button", { name: "加入语音通话" });
    await expect(joinVoiceBtn).toBeVisible({ timeout: 5000 });

    // 验证左下角状态栏绝不呈现“语音已连接”，底栏绝不呈现“断开连接”
    const voiceConnectedLabel = page.getByText("语音已连接");
    await expect(voiceConnectedLabel).not.toBeVisible();

    const leaveVoiceBtn = page.getByRole("button", { name: "断开连接" });
    await expect(leaveVoiceBtn).not.toBeVisible();

    // ==========================================
    // 场景二：在预览状态下，点击“加入语音通话”大按钮 -> 连入语音
    // ==========================================
    await joinVoiceBtn.click();

    // 验证成功连入语音通话
    await expect(leaveVoiceBtn.first()).toBeVisible({ timeout: 8000 });
    await expect(voiceConnectedLabel).toBeVisible({ timeout: 5000 });

    // 断开连接以复位状态
    await leaveVoiceBtn.first().click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // ==========================================
    // 场景三：双击语音频道 -> 直接连入语音通话
    // ==========================================
    // 先切回文字频道以重置视图状态
    const textChannelBtn = page
      .getByRole("button", { name: /日常闲聊|general|综合/i })
      .first();
    if (await textChannelBtn.isVisible()) {
      await textChannelBtn.click();
      await page.waitForTimeout(300);
    }

    // 双击语音频道
    await voiceChannelBtn.dblclick();

    // 验证直接连入语音通话
    await expect(leaveVoiceBtn.first()).toBeVisible({ timeout: 8000 });
    await expect(voiceConnectedLabel).toBeVisible({ timeout: 5000 });

    // 断开连接
    await leaveVoiceBtn.first().click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // ==========================================
    // 场景四：右键上下文菜单 -> 保留“连接语音频道”快捷入口
    // ==========================================
    await voiceChannelBtn.click({ button: "right" });
    const contextMenuItem = page.getByRole("menuitem", {
      name: "连接语音频道",
    });
    await expect(contextMenuItem).toBeVisible({ timeout: 5000 });
    await contextMenuItem.click();

    // 验证通过右键菜单成功连入语音通话
    await expect(leaveVoiceBtn.first()).toBeVisible({ timeout: 8000 });
    await expect(voiceConnectedLabel).toBeVisible({ timeout: 5000 });

    // 清理断开
    await leaveVoiceBtn.first().click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // 检查控制台无未捕获严重异常
    const fatalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("Download the React DevTools") &&
        !err.includes("favicon") &&
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("LiveKit") &&
        !err.includes("status of 401") &&
        !err.includes("status of 500"),
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
