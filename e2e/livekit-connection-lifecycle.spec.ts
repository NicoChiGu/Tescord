import { test, expect } from "@playwright/test";

test.describe("LiveKit 语音连接生命周期与中间画面渲染分段验收", () => {
  test("未连接展示大厅预览，连接中展示圆形Loading与左下角连接中，只有连接后才展示详细用户画面", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 初始化登录态与 Mock
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_lifecycle_test",
          username: "voice_lifecycle_tester",
          displayName: "连接生命周期测试员",
          email: "lifecycle_tester@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // 控制 token 接口响应，模拟真实网络连接过渡延迟
    let tokenDelayMs = 0;
    await page.route("**/api/livekit/token", async (route) => {
      if (tokenDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, tokenDelayMs));
      }
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

    // 2. 访问主页面并进入首个服务器
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 定位语音频道按钮
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });

    // ==========================================
    // 阶段一：单击语音频道 -> 仅选中预览大厅，不展示详细用户画面
    // ==========================================
    await voiceChannelBtn.click();

    // 验证中间区域展示沉浸式预览大厅，且包含加入语音通话按钮
    const lobbyView = page.getByTestId("voice-preview-lobby");
    await expect(lobbyView).toBeVisible({ timeout: 5000 });
    const joinVoiceBtn = page.getByTestId("lobby-join-voice-btn");
    await expect(joinVoiceBtn).toBeVisible({ timeout: 5000 });

    // 验证此时中间的详细用户画面绝不呈现
    const connectedStage = page.getByTestId("voice-connected-stage");
    await expect(connectedStage).not.toBeVisible();

    // 验证此时中间的圆形 Loading 绝不呈现
    const connectingView = page.getByTestId("voice-connecting-view");
    await expect(connectingView).not.toBeVisible();

    // 验证左下角状态栏绝不呈现“语音已连接”或连接卡片
    await expect(page.getByText("语音已连接")).not.toBeVisible();
    await expect(page.getByText("正在连接语音...")).not.toBeVisible();

    // ==========================================
    // 阶段二：点击加入通话，在建立连接时展示圆形 Loading 与左下角连接中
    // ==========================================
    // 设置 600ms 延迟，确保 Playwright 稳定捕捉到 connecting 状态
    tokenDelayMs = 600;
    await joinVoiceBtn.click();

    // 验证中间区域立即呈现圆形 Loading 视图与提示
    await expect(connectingView).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("heading", { name: "正在连接语音服务器..." }),
    ).toBeVisible({ timeout: 5000 });

    // 验证在连接中状态下，中间详细用户画面依然不可见
    await expect(connectedStage).not.toBeVisible();

    // 验证左下角状态栏呈现“正在连接语音...”与“--ms”
    const leftConnectingLabel = page.getByText("正在连接语音...");
    await expect(leftConnectingLabel).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("--ms")).toBeVisible({ timeout: 5000 });

    // 验证连接中提供取消按钮
    const cancelBtn = page.getByTestId("voice-cancel-connecting-btn");
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });

    // ==========================================
    // 阶段三：测试在 Connecting 阶段取消连接 -> 立即复位回未连接预览大厅
    // ==========================================
    await cancelBtn.click();

    // 验证立即复位回预览大厅
    await expect(lobbyView).toBeVisible({ timeout: 5000 });
    await expect(connectingView).not.toBeVisible();
    await expect(leftConnectingLabel).not.toBeVisible();
    await expect(connectedStage).not.toBeVisible();

    // ==========================================
    // 阶段四：正式完成连接 -> 仅当 LiveKit 真正连接上后，才显示中间详细用户画面
    // ==========================================
    tokenDelayMs = 50; // 微小延迟平滑过渡
    await joinVoiceBtn.click();

    // 验证中间详细用户画面呈现
    await expect(connectedStage).toBeVisible({ timeout: 8000 });

    // 验证中间 Loading 与大厅预览均已退出
    await expect(connectingView).not.toBeVisible();
    await expect(lobbyView).not.toBeVisible();

    // 验证左下角状态栏真实变为“语音已连接”
    const voiceConnectedLabel = page.getByText("语音已连接");
    await expect(voiceConnectedLabel).toBeVisible({ timeout: 5000 });

    // 验证底部通话控制胶囊（如挂断按钮）可用
    const leaveBtn = page.getByRole("button", { name: "断开连接" }).first();
    await expect(leaveBtn).toBeVisible({ timeout: 5000 });

    // ==========================================
    // 阶段五：挂断退出通话 -> 验证退出并重新单击恢复预览大厅
    // ==========================================
    await leaveBtn.click();
    await expect(voiceConnectedLabel).not.toBeVisible({ timeout: 5000 });
    await expect(connectedStage).not.toBeVisible({ timeout: 5000 });
    await expect(leaveBtn).not.toBeVisible({ timeout: 5000 });

    // 重新单击语音频道，验证恢复为沉浸式预览大厅
    await voiceChannelBtn.click();
    await expect(lobbyView).toBeVisible({ timeout: 5000 });
    await expect(connectedStage).not.toBeVisible();

    // 控制台无严重未捕获异常
    const fatalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("Download the React DevTools") &&
        !err.includes("favicon") &&
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("LiveKit") &&
        !err.includes("status of 500"),
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
