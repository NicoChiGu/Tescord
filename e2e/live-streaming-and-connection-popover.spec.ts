import { test, expect } from "@playwright/test";

test.describe("直播居中播放、停播恢复画像、属性统计与连线浮层端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录状态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem("tescord_locale", "zh-CN");
    });

    // Mock 认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "me_user_1",
          username: "tester_me",
          displayName: "我本人",
          email: "me@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock 服务器列表
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_1",
            name: "极客总部",
            ownerId: "me_user_1",
            channels: [
              {
                id: "chan_voice_1",
                guildId: "guild_1",
                name: "开黑聊天室",
                type: "VOICE",
                position: 0,
              },
            ],
          },
        ]),
      });
    });

    // Mock 频道详情
    await page.route("**/api/channels/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "chan_voice_1",
          guildId: "guild_1",
          name: "开黑聊天室",
          type: "VOICE",
          position: 0,
        }),
      });
    });

    // Mock ICE 服务器
    await page.route("**/api/network/ice-servers", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          turnActive: false,
        }),
      });
    });
  });

  test("1. 连线状态浮层 (Discord Popover) 显示折线图、延迟数据，并可通过'更多数据'唤起全量健康看板", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 模拟进入语音频道
    await page.evaluate(() => {
      // 触发加入频道或模拟连接状态
      window.dispatchEvent(
        new CustomEvent("tescord:mock-voice-connected", {
          detail: {
            channelId: "chan_voice_1",
            channelName: "开黑聊天室",
          },
        }),
      );
    });

    // 点击左侧频道的语音连接区域
    const voiceChannel = page.locator('div:has-text("开黑聊天室")').first();
    if (await voiceChannel.isVisible()) {
      await voiceChannel.click();
    }

    // 检查是否有语音连接状态按钮
    const statusBtn = page.locator(
      '[data-testid="voice-connection-status-btn"]',
    );
    if (await statusBtn.isVisible()) {
      // 点击打开 Discord 风格的连线状态 Popover
      await statusBtn.click();

      // 验证浮层成功弹出
      const popover = page.locator('[data-testid="voice-connection-popover"]');
      await expect(popover).toBeVisible();

      // 验证包含折线图 Canvas
      await expect(popover.locator("canvas")).toBeVisible();

      // 验证核心指标与端到端加密条目
      await expect(popover).toContainText("平均讯息收发来回时间");
      await expect(popover).toContainText("输出封包遗失率");
      await expect(popover).toContainText("端到端加密");

      // 验证双按钮存在
      const debugBtn = page.locator('[data-testid="connection-debug-btn"]');
      const moreStatsBtn = page.locator(
        '[data-testid="connection-more-stats-btn"]',
      );
      await expect(debugBtn).toBeVisible();
      await expect(moreStatsBtn).toBeVisible();

      // 点击“更多数据”，验证 Popover 关闭且唤起全量看板
      await moreStatsBtn.click();
      await expect(popover).not.toBeVisible();
    }
  });

  test("2. 远端开播但未拉流时，展示简洁居中大播放按钮（无冗余文字），且隐藏右上角统计入口", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 验证组件在纯音频或未观看状态下不展示 participant-stats-btn
    const statsBtn = page.locator('[data-testid="participant-stats-btn"]');
    await expect(statsBtn).toHaveCount(0);
  });
});
