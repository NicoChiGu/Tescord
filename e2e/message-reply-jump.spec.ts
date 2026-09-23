import { test, expect } from "@playwright/test";

test.describe("消息引用跳转原文与高亮交互端到端验收 (Discord-Parity)", () => {
  const originMsgId = "msg_target_origin";
  const replyMsgId = "msg_with_reply";
  const deletedRefMsgId = "msg_with_deleted_ref";

  // 生成一条原消息、25 条中间填充消息、一条引用原消息的消息，以及一条引用了不存在消息的消息
  const mockMessages = [
    {
      id: originMsgId,
      channelId: "c_general",
      authorId: "u_alice",
      author: {
        id: "u_alice",
        username: "Alice",
        avatarUrl: null,
      },
      content: "【原文】这是一条很重要的早前历史讨论内容，需要被引用回复！",
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-20T10:00:00.000Z",
    },
    // 中间填充 25 条消息拉开垂直滚动距离，确保视口能够清晰触发滚动与离开底部状态
    ...Array.from({ length: 25 }).map((_, idx) => ({
      id: `msg_filler_${idx + 1}`,
      channelId: "c_general",
      authorId: "u_filler",
      author: {
        id: "u_filler",
        username: `Member_${idx + 1}`,
        avatarUrl: null,
      },
      content: `这是第 ${idx + 1} 条普通聊天消息，用于撑起聊天列表滚动容器高度。`,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: new Date(1774087200000 + idx * 60000).toISOString(),
    })),
    {
      id: replyMsgId,
      channelId: "c_general",
      authorId: "u_bob",
      author: {
        id: "u_bob",
        username: "Bob",
        avatarUrl: null,
      },
      content: "我非常赞同刚才 Alice 提出的观点，这里做引用回复。",
      replyToId: originMsgId,
      replyTo: {
        id: originMsgId,
        authorName: "Alice",
        content: "【原文】这是一条很重要的早前历史讨论内容...",
      },
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-21T12:00:00.000Z",
    },
    {
      id: deletedRefMsgId,
      channelId: "c_general",
      authorId: "u_carol",
      author: {
        id: "u_carol",
        username: "Carol",
        avatarUrl: null,
      },
      content: "引用一条已被删除的历史消息测试容错防护。",
      replyToId: "non_existent_msg_999",
      replyTo: {
        id: "non_existent_msg_999",
        authorName: "GhostUser",
        content: "这条原消息在数据库里已经物理删除。",
      },
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-21T12:05:00.000Z",
    },
  ];

  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 登录用户详情
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

    // Mock 服务器列表
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
              {
                userId: "u_bob",
                user: { id: "u_bob", username: "Bob" },
              },
            ],
          },
        ]),
      });
    });

    // Mock 频道历史消息列表 (动态绑定请求的 channelId 以确保与端侧倒排索引一致)
    await page.route("**/api/channels/**/messages*", (route) => {
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

  test("验证点击引用条平滑跳转到原文、高亮闪烁动画，离开底部浮现返回最新胶囊", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // 1. 进入首个服务器并等待进入 general 频道
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客研发部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });
    await generalChannel.click();

    // 2. 确认最新消息中的引用回复条可见
    const replyMessageEl = page.locator(`#message-${replyMsgId}`);
    await expect(replyMessageEl).toBeVisible({ timeout: 6000 });

    const replyBar = replyMessageEl.locator('[title="点击跳转至被引用的原文"]');
    await expect(replyBar).toBeVisible();
    await expect(replyBar).toContainText("@Alice");
    await expect(replyBar).toContainText(
      "【原文】这是一条很重要的早前历史讨论内容",
    );

    // 3. 点击引用条，触发平滑跳转至原消息
    await replyBar.click();

    // 4. 验证原消息元素被送入视口，并且被赋予高亮动画样式 animate-message-highlight
    const originMessageEl = page.locator(`#message-${originMsgId}`);
    await expect(originMessageEl).toBeVisible({ timeout: 5000 });
    await expect(originMessageEl).toHaveClass(/animate-message-highlight/, {
      timeout: 3000,
    });

    // 5. 验证因离开底部，输入框上方浮现 Discord 经典的“跳到最新”胶囊按钮
    const jumpToPresentBtn = page.getByTitle("跳到最新消息");
    await expect(jumpToPresentBtn).toBeVisible({ timeout: 5000 });
    await expect(jumpToPresentBtn).toContainText("您正在查看较旧的消息");
    await expect(jumpToPresentBtn).toContainText("跳到最新");

    // 6. 点击“跳到最新”胶囊按钮，视口回到最底部
    await jumpToPresentBtn.click();
    await expect(replyMessageEl).toBeInViewport({ timeout: 5000 });

    // 7. 测试搜索过滤模式下的兼容性：
    // 在右上角搜索框输入特定内容，导致原消息被临时过滤隐藏
    const searchInput = page.getByPlaceholder("搜索...");
    await searchInput.fill("赞同");
    // 原消息在过滤后应当不可见
    await expect(originMessageEl).not.toBeVisible({ timeout: 2000 });

    // 此时在搜索结果中点击 Bob 发送的引用回复条
    const filteredReplyBar = page
      .locator(`#message-${replyMsgId}`)
      .locator('[title="点击跳转至被引用的原文"]');
    await expect(filteredReplyBar).toBeVisible();
    await filteredReplyBar.click();

    // 验证自动清除搜索过滤，并且原消息重新出现并成功获得高亮动画类
    await expect(searchInput).toHaveValue("", { timeout: 3000 });
    await expect(originMessageEl).toBeVisible({ timeout: 5000 });
    await expect(originMessageEl).toHaveClass(/animate-message-highlight/, {
      timeout: 3000,
    });

    // 8. 测试容灾提示：点击引用了已删除消息的引用条
    // 先滚回底部
    await page.locator(`#message-${deletedRefMsgId}`).scrollIntoViewIfNeeded();
    const deletedReplyBar = page
      .locator(`#message-${deletedRefMsgId}`)
      .locator('[title="点击跳转至被引用的原文"]');
    await expect(deletedReplyBar).toBeVisible();
    await deletedReplyBar.click();

    // 验证弹出轻量 Toast 提示
    const toast = page.getByText("未找到被引用的原文，该消息可能已被删除");
    await expect(toast).toBeVisible({ timeout: 3000 });

    // 过滤掉非关键的网络错误与 WebSocket 连接警告
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("net::ERR_") && !err.includes("WebSocket"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
