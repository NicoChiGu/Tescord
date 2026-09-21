import { test, expect } from "@playwright/test";

test.describe("多设备语音互斥接管与会话状态自动化验收 (Multi-device Voice Exclusivity)", () => {
  test("当语音被其他设备接管时，旧设备能够优雅退出、释放麦克风并呈现转移横幅与一键拉回", async ({
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
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_device_test",
          username: "device_tester",
          displayName: "多设备测试员",
          email: "tester@example.com",
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

    // 拦截 LiveKit 客户端离线网络探测
    await page.route("**/rtc/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    // 2. 访问主界面
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 3. 进入第一个公会
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 4. 点击加入语音频道 (例如 "语音闲聊" 或带有 VOICE 类型的频道)
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.click();

    // 5. 确认已成功进入语音频道（底部呈现断开连接按钮或语音状态卡片）
    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 6. 模拟从网关收到 VOICE_SERVER_DISCONNECT 消息（代表新设备在其他端加入了语音频道）
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("VOICE_SERVER_DISCONNECT", {
          reason: "VOICE_TRANSFER",
          targetPlatform: "桌面客户端",
        });
      }
    });

    // 7. 验证断开连接按钮消失，原语音面板退出，转而呈现语音转移提示横幅
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });
    const transferNotice = page.locator('[data-testid="voice-transfer-notice"]');
    await expect(transferNotice).toBeVisible({ timeout: 5000 });
    await expect(transferNotice).toContainText("语音已转移至【桌面客户端】");

    // 8. 验证横幅中提供一键“在此设备重新连接”按钮
    const reclaimBtn = page.locator('[data-testid="reclaim-voice-btn"]');
    await expect(reclaimBtn).toBeVisible();

    // 9. 点击“在此设备重新连接”，测试重新抢回语音控制权
    await reclaimBtn.click();

    // 10. 验证重新接管成功：转移横幅自动消除，底部断开连接按钮重新呈现
    await expect(transferNotice).not.toBeVisible({ timeout: 5000 });
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 11. 再次模拟新设备接管，测试“忽略提示”功能
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("VOICE_SERVER_DISCONNECT", {
          reason: "VOICE_TRANSFER",
          targetPlatform: "Web 浏览器",
        });
      }
    });

    await expect(transferNotice).toBeVisible({ timeout: 5000 });
    await expect(transferNotice).toContainText("语音已转移至【Web 浏览器】");

    const dismissBtn = page.locator('[data-testid="dismiss-transfer-notice-btn"]');
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();

    // 验证提示被关闭
    await expect(transferNotice).not.toBeVisible({ timeout: 3000 });

    // 检查控制台无未捕获异常
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("LiveKit") &&
        !err.includes("status of 500"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
