import { test, expect } from "@playwright/test";

test.describe("媒体属性面板、传输速率与网络连接架构端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录状态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_1",
          username: "e2e_tester",
          displayName: "E2E测试员",
          email: "e2e@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock 双栈 ICE 服务器接口
    await page.route("**/api/network/ice-servers", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          iceServers: [
            { urls: "stun:stun.cloudflare.com:3478" },
            { urls: "stun:stun.qq.com:3478" },
            {
              urls: ["turn:127.0.0.1:3478?transport=udp"],
              username: "tescorduser",
              credential: "tescordpass",
            },
          ],
          turnActive: true,
        }),
      });
    });
  });

  test("纯语音通话下全场景支持媒体属性查看，正确显示 SFU 架构与瞬时码率，绝无 P2P 误判", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 加入语音频道
    const voiceChannelBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-volume-2") })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 3. 确认已成功进入语音频道
    await expect(page.getByText("语音已连接")).toBeVisible({ timeout: 5000 });

    // 4. 纯语音卡片右上角应常驻媒体属性按钮 (data-testid="participant-stats-btn")
    const statsBtn = page
      .locator('[data-testid="participant-stats-btn"]')
      .first();
    await expect(statsBtn).toBeAttached({ timeout: 5000 });

    // 点击媒体属性按钮打开 HUD 面板
    await statsBtn.click({ force: true });

    // 5. 验证媒体属性 HUD 面板内容
    const hudTitle = page.getByText("媒体属性与实时统计");
    await expect(hudTitle).toBeVisible({ timeout: 5000 });

    // 验证网络拓扑与架构正确显示为 SFU，不再被误标为 P2P Direct
    const topologyItem = page.getByText("网络拓扑:");
    await expect(topologyItem).toBeVisible();
    const topologyVal = page.getByText(/LiveKit SFU|SFU/);
    await expect(topologyVal.first()).toBeVisible();

    const connectionModeItem = page.getByText("连接架构:");
    await expect(connectionModeItem).toBeVisible();
    const connectionModeVal = page.getByText(/SFU Direct|SFU Relay/);
    await expect(connectionModeVal.first()).toBeVisible();

    // 确保绝对没有误判为 P2P Direct
    const p2pDirectBug = page.getByText(/P2P Direct \(UDP \/ Host\)/);
    await expect(p2pDirectBug).not.toBeVisible();

    // 验证 IP 协议栈徽章
    const ipStackItem = page.getByText("IP 协议栈:");
    await expect(ipStackItem).toBeVisible();
    await expect(page.getByText(/IPv4|IPv6/).first()).toBeVisible();

    // 验证实时传输速率与流量
    const bitrateItem = page.getByText("下行/下载码率:");
    await expect(bitrateItem).toBeVisible();
    const bitrateVal = page.getByText(/Kbps|Mbps/).first();
    await expect(bitrateVal).toBeVisible();

    // 验证复制全部属性与统计按钮可用
    const copyBtn = page.getByTitle("复制全部属性与统计");
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // 6. 关闭 HUD 面板
    const closeBtn = page.getByTitle("关闭面板");
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(hudTitle).not.toBeVisible();

    // 7. 验证右键菜单亦可调出媒体属性
    const userCard = page
      .locator('[data-testid="voice-grid"]')
      .locator("> div")
      .first();
    if (await userCard.isVisible()) {
      await userCard.click({ button: "right" });
      const contextMenuItem = page.getByText("媒体属性与详细统计 (Stats)");
      await expect(contextMenuItem).toBeVisible({ timeout: 3000 });
      await contextMenuItem.click();
      await expect(hudTitle).toBeVisible();
    }
  });
});
