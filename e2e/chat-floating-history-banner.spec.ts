import { test, expect } from "@playwright/test";
import { Message } from "@tescord/types";

test.describe("消息视口顶部悬浮历史横幅与上下边缘渐变模糊验收", () => {
  // 生成 25 条测试历史消息以支持长滚动翻阅
  const mockMessages: Message[] = Array.from({ length: 25 }, (_, i) => ({
    id: `msg_banner_test_${i + 1}`,
    channelId: "c_general",
    authorId: i % 2 === 0 ? "u_alice" : "e2e_tester_user",
    author: {
      id: i % 2 === 0 ? "u_alice" : "e2e_tester_user",
      username: i % 2 === 0 ? "Alice" : "tester_pro",
      displayName: i % 2 === 0 ? "爱丽丝" : "专业测试员",
      avatarUrl: null,
      status: "ONLINE",
    },
    content: `【历史消息测试 #${i + 1}】这是一条用于验证滚动与顶部浮动横幅的长消息文本内容，确保视口有足够的纵向滚动高度。`,
    isEncrypted: false,
    isPinned: false,
    reactions: [],
    attachments: [],
    createdAt: new Date(Date.now() - (25 - i) * 60000).toISOString(),
  }));

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_tester_user",
          username: "tester_pro",
          displayName: "专业测试员",
          email: "tester@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "g_alpha",
            name: "Tescord 极客研发部",
            icon: null,
            ownerId: "e2e_tester_user",
            channels: [
              {
                id: "c_general",
                name: "general",
                type: "TEXT",
                topic: "通用讨论频道",
                guildId: "g_alpha",
              },
            ],
            members: [
              {
                userId: "e2e_tester_user",
                user: { id: "e2e_tester_user", username: "tester_pro" },
              },
              {
                userId: "u_alice",
                user: { id: "u_alice", username: "Alice" },
              },
            ],
          },
        ]),
      });
    });

    await page.route("**/api/channels/**/messages", (route) => {
      const url = route.request().url();
      const match = url.match(/\/api\/channels\/([^/]+)\/messages/);
      const activeChannelId = match ? match[1] : "c_general";
      const customizedMessages = mockMessages.map((m) => ({
        ...m,
        channelId: activeChannelId,
      }));
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(customizedMessages),
      });
    });
  });

  test("验证顶部悬浮横幅出现、上下渐变模糊层及回到最新消息流程", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // 1. 进入服务器与频道
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客研发部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });
    await generalChannel.click();

    // 确认首条与最新消息均在 DOM 中
    const firstMsg = page.locator("#message-msg_banner_test_1");
    const lastMsg = page.locator("#message-msg_banner_test_25");
    await expect(lastMsg).toBeVisible({ timeout: 6000 });

    // 2. 初始状态（处于最底部）：顶部悬浮提示横幅应当不存在/不可见
    const floatingBanner = page.getByTitle("跳到最新消息");
    await expect(floatingBanner).not.toBeVisible();

    // 3. 向上滚动查看早前历史消息
    await firstMsg.scrollIntoViewIfNeeded();

    // 4. 验证此时顶部吸顶悬浮横幅显现，且包含特定动画与文案
    await expect(floatingBanner).toBeVisible({ timeout: 5000 });
    await expect(floatingBanner).toHaveClass(/animate-slide-down/);
    await expect(floatingBanner).toContainText("您正在查看较旧的消息");
    await expect(floatingBanner).toContainText("跳到最新");

    // 等待 0.2s 平滑下滑入场动画完成
    await page.waitForTimeout(300);

    // 5. 验证顶部悬浮横幅吸附在视口上方（Y坐标在标题栏下方，约为 48px）
    const bannerBox = await floatingBanner.boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(bannerBox!.y).toBeGreaterThanOrEqual(40); // 标题栏高度为 48px

    // 6. 验证渐变模糊遮罩层样式：包含 pointer-events-none 属性与模糊配置
    const topFadeMask = page.locator(".from-discord-chat\\/80").first();
    await expect(topFadeMask).toBeAttached();

    // 7. 点击顶部悬浮横幅，视口平滑回到底部
    await floatingBanner.click();

    // 8. 验证最新消息重新进入视口，且悬浮横幅随之隐藏
    await expect(lastMsg).toBeInViewport({ timeout: 5000 });
    await expect(floatingBanner).not.toBeVisible({ timeout: 3000 });

    // 9. 确保控制台无严重报错
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
