import { test, expect } from "@playwright/test";

test.describe("远端与本地活跃说话者绿色指示器自动化验收 (Active Speaker Indicator E2E)", () => {
  test("远端用户说话时，在侧边栏成员展开列表与语音大厅卡片均实时展现绿色边框与光圈", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 初始化 Mock 用户鉴权环境
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    const currentUserId = "usr_default_admin";
    const remoteUserId = "remote_speaker_a";

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: currentUserId,
          username: "listener_b",
          displayName: "用户B (收听端)",
          email: "b@example.com",
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
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 定位并双击连入语音频道
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 验证成功连入语音通话
    const leaveVoiceBtn = page.getByRole("button", { name: "断开连接" });
    await expect(leaveVoiceBtn.first()).toBeVisible({ timeout: 8000 });

    // 4. 获取当前语音频道 ID，并模拟注入远端用户 A 的语音状态
    await page.evaluate(
      ({ remoteUserId }) => {
        const gw = (window as any).__gatewayClient;
        const channelId =
          (window as any).__activeVoiceChannelId ||
          (window as any).__selectedChannelId;

        // 发送远端成员加入当前语音频道的事件
        if (gw && channelId) {
          gw.emit("VOICE_STATE_UPDATE", {
            userId: remoteUserId,
            guildId: "mock_guild_id",
            channelId: channelId,
            selfMute: false,
            selfDeaf: false,
            selfVideo: false,
            streaming: false,
            user: {
              id: remoteUserId,
              username: "speaker_a",
              avatarUrl: null,
            },
          });
        }
      },
      { remoteUserId },
    );

    // 验证语音大厅加载完成并呈现远端用户卡片
    const voiceRoomArea = page.locator('[data-testid="voice-room-area"]');
    await expect(voiceRoomArea).toBeVisible({ timeout: 5000 });

    const remoteUserLabel = page.getByText("speaker_a").first();
    await expect(remoteUserLabel).toBeVisible({ timeout: 5000 });

    // 5. 初始状态：远端用户 A 未发声，无 speaking-ring
    const remoteAvatarInSidebar = page
      .locator("div.space-y-1")
      .locator(`div:has-text("speaker_a") img[alt="avatar"]`);
    if ((await remoteAvatarInSidebar.count()) > 0) {
      await expect(remoteAvatarInSidebar.first()).not.toHaveClass(
        /speaking-ring/,
      );
    }

    // 6. 模拟远端用户 A 触发活跃说话 (Active Speakers)
    await page.evaluate((remoteUserId) => {
      const lk = (window as any).__livekitService;
      if (lk) {
        lk.activeSpeakers = new Set([remoteUserId]);
        lk.onActiveSpeakersChangedCallbacks?.forEach((cb: any) =>
          cb([remoteUserId]),
        );
      }
    }, remoteUserId);

    // 验证：语音大厅中远端用户卡片外框实时呈现绿色高亮边框 (border-discord-green)
    const remoteCard = page.locator(
      `[data-testid="participant-card-${remoteUserId}"]`,
    );
    await expect(remoteCard).toBeVisible({ timeout: 5000 });
    await expect(remoteCard).toHaveClass(/border-discord-green/, {
      timeout: 5000,
    });

    // 验证：若侧边栏展开了成员列表，侧边栏头像也呈现绿色呼吸光环 (speaking-ring)
    if ((await remoteAvatarInSidebar.count()) > 0) {
      await expect(remoteAvatarInSidebar.first()).toHaveClass(/speaking-ring/, {
        timeout: 5000,
      });
    }

    // 7. 模拟远端用户 A 停止说话
    await page.evaluate(() => {
      const lk = (window as any).__livekitService;
      if (lk) {
        lk.activeSpeakers = new Set([]);
        lk.onActiveSpeakersChangedCallbacks?.forEach((cb: any) => cb([]));
      }
    });

    // 验证：语音大厅中绿色高亮消失
    await expect(remoteCard).not.toHaveClass(/border-discord-green/, {
      timeout: 5000,
    });

    // 8. 断开语音通话
    await leaveVoiceBtn.first().click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // 验证：控制台无严重未捕获错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("WebSocket") &&
        !err.includes("net::ERR_CONNECTION_REFUSED"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
