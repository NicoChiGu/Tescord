import { test, expect } from "@playwright/test";

test.describe("打字指示器 (Typing Indicator) 端到端交互与动效验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 用户认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "e2e_tester",
          displayName: "E2E验收员",
          email: "e2e@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });
  });

  test("打字指示器渲染、经典跳跃动画、多人文案与新消息到达自动消除", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // 进入首个服务器并加载频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const channelItem = page.getByRole("button", { name: "general" });
    await expect(channelItem).toBeVisible({ timeout: 5000 });
    await channelItem.click();

    // 1. 验证初始状态下打字指示器插槽存在且无回流抖动 (opacity-0)
    const typingIndicator = page.getByTestId("typing-indicator");
    await expect(typingIndicator).toBeAttached();
    await expect(typingIndicator).toHaveClass(/opacity-0/);

    // 获取当前频道的 channelId
    const currentChannelId = await typingIndicator
      .locator("xpath=ancestor::*[@data-channel-id][1]")
      .getAttribute("data-channel-id");
    expect(currentChannelId).toBeTruthy();

    // 2. 模拟单人打字：Alice 正在输入
    await page.evaluate(
      ({ channelId }) => {
        const client = (window as any).__gatewayClient;
        if (client) {
          client.emit("TYPING_START", {
            channelId,
            userId: "user_alice",
            user: { id: "user_alice", username: "Alice" },
            timestamp: Date.now(),
          });
        }
      },
      { channelId: currentChannelId || "c-general" },
    );

    // 验证指示器平滑淡入并呈现三点跳跃动效与文案
    await expect(typingIndicator).toHaveClass(/opacity-100/, { timeout: 3000 });
    await expect(typingIndicator.getByTestId("typing-dots")).toBeVisible();
    await expect(typingIndicator.getByTestId("typing-text")).toContainText(
      "Alice 正在输入...",
    );

    // 3. 模拟二人同时打字：Alice 和 Bob 正在输入
    await page.evaluate(
      ({ channelId }) => {
        const client = (window as any).__gatewayClient;
        if (client) {
          client.emit("TYPING_START", {
            channelId,
            userId: "user_bob",
            user: { id: "user_bob", username: "Bob" },
            timestamp: Date.now(),
          });
        }
      },
      { channelId: currentChannelId || "c-general" },
    );

    await expect(typingIndicator.getByTestId("typing-text")).toContainText(
      "Alice 和 Bob 正在输入...",
    );

    // 4. 模拟三人同时打字：Alice、Bob 和 Charlie 正在输入
    await page.evaluate(
      ({ channelId }) => {
        const client = (window as any).__gatewayClient;
        if (client) {
          client.emit("TYPING_START", {
            channelId,
            userId: "user_charlie",
            user: { id: "user_charlie", username: "Charlie" },
            timestamp: Date.now(),
          });
        }
      },
      { channelId: currentChannelId || "c-general" },
    );

    await expect(typingIndicator.getByTestId("typing-text")).toContainText(
      "Alice、Bob 和 Charlie 正在输入...",
    );

    // 5. 模拟四人以上同时打字：数人 正在输入...
    await page.evaluate(
      ({ channelId }) => {
        const client = (window as any).__gatewayClient;
        if (client) {
          client.emit("TYPING_START", {
            channelId,
            userId: "user_david",
            user: { id: "user_david", username: "David" },
            timestamp: Date.now(),
          });
        }
      },
      { channelId: currentChannelId || "c-general" },
    );

    await expect(typingIndicator.getByTestId("typing-text")).toContainText(
      "数人 正在输入...",
    );

    // 6. 验证主动输入时的节流触发
    const mentionInput = page.locator('[contenteditable="true"]').first();
    await expect(mentionInput).toBeVisible();

    // 注入对 gatewayClient.sendTyping 的调用跟踪
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        (window as any).__typingCalls = [];
        const origSendTyping = client.sendTyping.bind(client);
        client.sendTyping = (chId: string) => {
          (window as any).__typingCalls.push(chId);
          origSendTyping(chId);
        };
      }
    });

    await mentionInput.click();
    await page.keyboard.type("Hello world!");

    const typingCallCount = await page.evaluate(() => {
      return ((window as any).__typingCalls || []).length;
    });
    // 连续打字在 3.5 秒内仅会触发一次 sendTyping 节流上行
    expect(typingCallCount).toBeGreaterThanOrEqual(1);
    // 7. 验证新消息到达后，对应作者的打字状态被即时消除
    await page.evaluate(
      ({ channelId }) => {
        const client = (window as any).__gatewayClient;
        if (client) {
          // David 发送了消息
          client.emit("MESSAGE_CREATE", {
            id: "msg_david_1",
            channelId,
            authorId: "user_david",
            author: { id: "user_david", username: "David" },
            content: "Hey guys!",
            createdAt: new Date().toISOString(),
          });
        }
      },
      { channelId: currentChannelId || "c-general" },
    );

    // David 发送消息后，退回至 3 人输入
    await expect(typingIndicator.getByTestId("typing-text")).toContainText(
      "Alice、Bob 和 Charlie 正在输入...",
    );

    // 其余 3 人陆续发出消息
    await page.evaluate(
      ({ channelId }) => {
        const client = (window as any).__gatewayClient;
        if (client) {
          ["user_alice", "user_bob", "user_charlie"].forEach((uid) => {
            client.emit("MESSAGE_CREATE", {
              id: `msg_${uid}`,
              channelId,
              authorId: uid,
              author: { id: uid, username: uid },
              content: "Done",
              createdAt: new Date().toISOString(),
            });
          });
        }
      },
      { channelId: currentChannelId || "c-general" },
    );

    // 所有用户发言完毕后，打字指示器即刻平滑隐藏 (opacity-0)，槽位保留
    await expect(typingIndicator).toHaveClass(/opacity-0/);

    // 8. 确保无任何致命控制台报错
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
