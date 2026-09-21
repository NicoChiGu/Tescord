import { test, expect } from "@playwright/test";

test.describe("真实延迟状态与网关连接指示端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 用户认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_latency",
          username: "tester_pro",
          displayName: "延迟测试员",
          email: "tester@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });
  });

  test("验证 WebSocket 网关 Ping 实时测量与用户栏延迟徽标展示", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 进入首个服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 模拟网关返回心跳响应并计算真实 Ping
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        // 触发一次心跳回应
        (client as any).handlePayload({
          op: 11, // HEARTBEAT_ACK
          d: {
            clientTimestamp: Date.now() - 24, // 模拟 24ms 真实网关延迟
            serverTimestamp: Date.now(),
          },
        });
      }
    });

    // 验证左下角用户栏展示网关延迟徽标
    const pingBadge = page.locator('[data-testid="gateway-ping-badge"]');
    await expect(pingBadge).toBeVisible({ timeout: 5000 });
    const pingText = await pingBadge.innerText();
    expect(pingText).toMatch(/•\s*\d+ms/);
  });

  test("验证进入语音频道后真实 WebRTC RTT 延迟状态与健康看板", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入首个服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 双击语音频道加入
    const voiceChannelBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-volume-2") })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 3. 验证左下角语音连接状态与实时 WebRTC RTT 呈现
    const voiceConnected = page.getByText("语音已连接");
    await expect(voiceConnected).toBeVisible({ timeout: 5000 });

    const voiceCardTrigger = page.locator("button", {
      hasText: "语音已连接",
    });
    const latencyBadge = voiceCardTrigger.locator("span", { hasText: /ms$/ });
    await expect(latencyBadge).toBeVisible();
    const rttText = await latencyBadge.innerText();
    expect(rttText).toMatch(/\d+ms/);

    // 4. 点击呼出 WebRTC 媒体引擎与网络健康看板
    await voiceCardTrigger.click();
    const modalHeading = page.getByRole("heading", {
      name: /WebRTC 媒体引擎与网络健康看板/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 验证指标包含往返延迟 RTT
    await expect(page.getByText("往返延迟 RTT")).toBeVisible();
    await expect(page.getByText("丢包率 Loss")).toBeVisible();
    await expect(page.getByText("抖动 Jitter")).toBeVisible();

    // 关闭看板
    await page.keyboard.press("Escape");
    await expect(modalHeading).not.toBeVisible();
  });

  test("验证网关断线重连状态条展示 (Discord 风格 Connection Banner)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 确保应用主视图已就绪
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });

    // 模拟触发网关重连状态
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        (client as any).setConnectionState("reconnecting");
      }
    });

    // 验证 Discord 风格顶部重连指示横幅渲染
    const banner = page.locator('[data-testid="gateway-connection-banner"]');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText("网络连接已中断，正在尝试重新连接");

    // 模拟重连成功，横幅自动平滑消失
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        (client as any).setConnectionState("connected");
      }
    });
    await expect(banner).not.toBeVisible({ timeout: 5000 });
  });
});
