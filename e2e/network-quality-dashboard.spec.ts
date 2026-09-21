import { test, expect } from "@playwright/test";

test.describe("WebRTC 网络延迟迁移与网络健康看板端到端验收", () => {
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
          id: "e2e_user_1",
          username: "e2e_tester",
          displayName: "E2E验收员",
          email: "e2e@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });
  });

  test("加入语音后，右上角不再有网络看板，左下角语音已连接右侧展示延迟，点击呼出网络看板，切换文字频道依然可用", async ({
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

    // 确认文字频道 general 存在
    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });

    // 2. 找到首个语音频道并点击加入
    // 语音频道包含 lucide-volume-2 图标
    const voiceChannelBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-volume-2") })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.click();

    // 3. 验证语音房间右上角：存在“伴音混音器”，且绝不存在“网络看板”
    const mixerBtn = page.getByRole("button", { name: /伴音混音器|混音/i });
    await expect(mixerBtn).toBeVisible({ timeout: 5000 });

    const oldDashboardBtn = page.getByRole("button", { name: /网络看板/i });
    await expect(oldDashboardBtn).not.toBeVisible();

    // 4. 验证左下角“语音已连接”面板渲染
    const voiceConnectedLabel = page.getByText("语音已连接");
    await expect(voiceConnectedLabel).toBeVisible({ timeout: 5000 });

    // 验证左下角在“语音已连接”右侧展示了网络延迟数字徽标 (如 18ms)
    const latencyBadge = page.locator("button", {
      hasText: "语音已连接",
    }).locator("span", { hasText: /ms$/ });
    await expect(latencyBadge).toBeVisible();
    const latencyText = await latencyBadge.innerText();
    expect(latencyText).toMatch(/\d+ms/);

    // 5. 点击左下角“语音已连接”区域呼出网络看板
    const voiceCardTrigger = page.locator("button", {
      hasText: "语音已连接",
    });
    await voiceCardTrigger.click();

    // 验证 WebRTC 网络健康看板模态框弹出
    const modalHeading = page.getByRole("heading", {
      name: /WebRTC 媒体引擎与网络健康看板/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 验证核心网络指标展示
    await expect(page.getByText("本地上行网络指标")).toBeVisible();
    await expect(page.getByText("往返延迟 RTT")).toBeVisible();
    await expect(page.getByText("丢包率 Loss")).toBeVisible();
    await expect(page.getByText("抖动 Jitter")).toBeVisible();
    await expect(page.getByText("推流码率")).toBeVisible();
    await expect(page.getByText("媒体会话属性与编解码器")).toBeVisible();

    // 6. 点击“关闭”按钮测试模态框关闭
    const closeBtn = page.getByRole("button", { name: "关闭", exact: true });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();

    // 7. 再次点击左下角呼出，验证按 Escape 键关闭
    await voiceCardTrigger.click();
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(modalHeading).not.toBeVisible();

    // 8. 切换回文字频道 general，验证左下角常驻性与跨频道可用性
    await generalChannel.click();
    await expect(page.getByText(/发送消息到 #general/i)).toBeVisible({
      timeout: 5000,
    });

    // 验证在文字频道时，左下角“语音已连接”和延迟仍然显示
    await expect(voiceConnectedLabel).toBeVisible();
    await expect(latencyBadge).toBeVisible();

    // 验证在文字频道下点击依然可以呼出网络看板
    await voiceCardTrigger.click();
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(modalHeading).not.toBeVisible();

    // 9. 点击断开连接按钮，验证退出语音频道后左下角卡片自动销毁
    const disconnectBtn = page.getByRole("button", { name: "断开连接" });
    await expect(disconnectBtn).toBeVisible();
    await disconnectBtn.click();
    await expect(voiceConnectedLabel).not.toBeVisible();
  });
});
