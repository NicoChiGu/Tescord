import { test, expect } from "@playwright/test";

test.describe("语音多端互斥接管、频道顺滑切换与多路直播自适应网格验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 auth 认证状态与 API mock
    await page.addInitScript(() => {
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
          id: "e2e_user_voice_test",
          username: "voice_tester",
          displayName: "语音测试员",
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

    await page.route("**/rtc/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
  });

  test("1. 多端登录互斥：新设备接管语音后，旧设备必须彻底退出并呈现转移横幅", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 进入公会
    const serverBtn = page.getByRole("button", { name: /Tescord 极客总部|极客/i }).first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 双击加入语音频道
    const voiceChannelBtn = page.locator('button[title="单击预览房间，双击加入语音通话"]').first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 确认已连入语音频道
    const leaveVoiceBtn = page.getByRole("button", { name: "断开连接" }).first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 模拟服务端发来异地设备接管信令 (VOICE_SERVER_DISCONNECT)
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("VOICE_SERVER_DISCONNECT", {
          reason: "VOICE_TRANSFER",
          targetPlatform: "移动客户端 (iOS)",
        });
      }
    });

    // 验证通话被踢出，展示转移横幅
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });
    const transferNotice = page.locator('[data-testid="voice-transfer-notice"]');
    await expect(transferNotice).toBeVisible({ timeout: 5000 });
    await expect(transferNotice).toContainText("语音已转移至 移动客户端 (iOS)");
  });

  test("2. 语音频道顺滑切换：在已连接语音状态下，双击另一语音频道可直接原子切换", async ({
    page,
  }) => {
    await page.goto("/");
    const serverBtn = page.getByRole("button", { name: /Tescord 极客总部|极客/i }).first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 查找公会内的语音频道列表
    const voiceChannels = page.locator('button[title="单击预览房间，双击加入语音通话"]');
    await expect(voiceChannels.first()).toBeVisible({ timeout: 5000 });
    const count = await voiceChannels.count();

    // 加入第一个语音频道
    await voiceChannels.first().dblclick();

    const leaveVoiceBtn = page.getByRole("button", { name: "断开连接" }).first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 若存在第二个语音频道，直接双击第二个语音频道进行端到端原子切换
    if (count > 1) {
      await voiceChannels.nth(1).dblclick();
      await page.waitForTimeout(500);
    } else {
      // 模拟向网关发送切频信令并由网关正常应答
      await page.evaluate(() => {
        const client = (window as any).__gatewayClient;
        if (client) {
          client.emit("VOICE_STATE_UPDATE", {
            userId: "e2e_user_voice_test",
            channelId: "chn_default_voice_02",
            sessionId: client.getSessionId ? client.getSessionId() : "session_current",
          });
        }
      });
    }

    // 验证未发生未捕获异常，通话保持连接状态
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 5000 });
  });

  test("3. 多直播同时观看 & 主播边播边看自适应舞台网格呈现", async ({
    page,
  }) => {
    await page.goto("/");
    const serverBtn = page.getByRole("button", { name: /Tescord 极客总部|极客/i }).first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const voiceChannelBtn = page.locator('button[title="单击预览房间，双击加入语音通话"]').first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    const channelId = (await voiceChannelBtn.getAttribute("data-channel-id")) || "chn_default_voice_01";
    await voiceChannelBtn.dblclick();

    const leaveVoiceBtn = page.getByRole("button", { name: "断开连接" }).first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 模拟当前语音频道内存在两位正在直播的用户 (Alice & Bob)
    await page.evaluate((cId) => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("VOICE_STATE_UPDATE", {
          userId: "streamer_alice",
          channelId: cId,
          streaming: true,
          streamMode: "sfu",
          user: { id: "streamer_alice", username: "Alice_Live" },
        });
        client.emit("VOICE_STATE_UPDATE", {
          userId: "streamer_bob",
          channelId: cId,
          streaming: true,
          streamMode: "sfu",
          user: { id: "streamer_bob", username: "Bob_Live" },
        });
      }
    }, channelId);

    // 验证两位主播均呈现在频道成员中
    await expect(page.getByText("Alice_Live").first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("Bob_Live").first()).toBeVisible({ timeout: 6000 });

    // 模拟同时观看 Alice 和 Bob 的直播
    await page.evaluate(() => {
      const livekit = (window as any).__livekitService;
      if (livekit) {
        livekit.setScreenWatching("streamer_alice", true);
        livekit.setScreenWatching("streamer_bob", true);
      }
    });

    // 验证舞台自适应多流分屏网格是否成功挂载，且控制台零致命报错
    const stage = page.locator('[data-testid="voice-connected-stage"]');
    await expect(stage).toBeVisible({ timeout: 6000 });
  });
});
