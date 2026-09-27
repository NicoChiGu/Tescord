import { test, expect } from "@playwright/test";

test.describe("聊天文本 URL 链接识别与括号/标点截断修复端到端验收", () => {
  const tarkovUrl =
    "https://escapefromtarkov.fandom.com/wiki/Spiritus_Systems_LV-119_Plate_Carrier_(Black_Division_V1)";

  const mockMessages = [
    {
      id: "msg_tarkov_raw",
      channelId: "c_general",
      authorId: "u_alice",
      author: {
        id: "u_alice",
        username: "Alice",
        avatarUrl: null,
      },
      content: tarkovUrl,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-27T10:00:00.000Z",
    },
    {
      id: "msg_tarkov_brackets",
      channelId: "c_general",
      authorId: "u_bob",
      author: {
        id: "u_bob",
        username: "Bob",
        avatarUrl: null,
      },
      content: `【${tarkovUrl}】`,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-27T10:01:00.000Z",
    },
    {
      id: "msg_outer_parens",
      channelId: "c_general",
      authorId: "u_carol",
      author: {
        id: "u_carol",
        username: "Carol",
        avatarUrl: null,
      },
      content: "请参考文档 (https://example.com/docs_(v1)) 获取更多信息。",
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-27T10:02:00.000Z",
    },
    {
      id: "msg_markdown_link",
      channelId: "c_general",
      authorId: "u_david",
      author: {
        id: "u_david",
        username: "David",
        avatarUrl: null,
      },
      content: `查看装备：[防弹插板背心](${tarkovUrl}) 点击前往。`,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-27T10:03:00.000Z",
    },
    {
      id: "msg_chinese_period",
      channelId: "c_general",
      authorId: "u_eve",
      author: {
        id: "u_eve",
        username: "Eve",
        avatarUrl: null,
      },
      content: "访问百科 https://example.com/item/456。",
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-09-27T10:04:00.000Z",
    },
  ];

  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 当前登录用户
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_e2e_tester",
          username: "tester_pro",
          displayName: "专业测试员",
          email: "tester@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock 所在服务器
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "g_alpha",
            name: "Tescord 极客研发部",
            icon: null,
            ownerId: "usr_e2e_tester",
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
                userId: "usr_e2e_tester",
                user: { id: "usr_e2e_tester", username: "tester_pro" },
              },
            ],
          },
        ]),
      });
    });

    // Mock 频道历史消息
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

  test("验证带括号 URL、中文括号包裹与 Markdown 链接在真实 DOM 中正确渲染", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // 1. 进入服务器并等待进入 general 频道
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客研发部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });
    await generalChannel.click();

    // 2. 验证裸 URL：Tarkov Wiki 自带末尾闭括号完整保留在 href 与文本中
    const tarkovMsgEl = page.locator("#message-msg_tarkov_raw");
    await expect(tarkovMsgEl).toBeVisible({ timeout: 6000 });
    const tarkovLink = tarkovMsgEl.locator("a");
    await expect(tarkovLink).toHaveAttribute("href", tarkovUrl);
    await expect(tarkovLink).toHaveText(tarkovUrl);
    await expect(tarkovLink).toHaveAttribute("target", "_blank");
    await expect(tarkovLink).toHaveAttribute("rel", "noopener noreferrer");

    // 3. 验证中文方头括号【】包裹：剥离【】保留完整 URL，外层【】作为纯文本渲染
    const bracketsMsgEl = page.locator("#message-msg_tarkov_brackets");
    await expect(bracketsMsgEl).toBeVisible({ timeout: 5000 });
    const bracketsLink = bracketsMsgEl.locator("a");
    await expect(bracketsLink).toHaveAttribute("href", tarkovUrl);
    await expect(bracketsLink).toHaveText(tarkovUrl);
    // 检查消息外层包含【和】
    await expect(bracketsMsgEl).toContainText(`【${tarkovUrl}】`);

    // 4. 验证英文圆括号包裹：外层闭括号被成功剥离，保留内部标签括号
    const parensMsgEl = page.locator("#message-msg_outer_parens");
    await expect(parensMsgEl).toBeVisible({ timeout: 5000 });
    const parensLink = parensMsgEl.locator("a");
    await expect(parensLink).toHaveAttribute(
      "href",
      "https://example.com/docs_(v1)",
    );
    await expect(parensLink).toHaveText("https://example.com/docs_(v1)");
    await expect(parensMsgEl).toContainText("(https://example.com/docs_(v1))");

    // 5. 验证 Markdown 格式链接：[防弹插板背心](tarkovUrl)
    const mdMsgEl = page.locator("#message-msg_markdown_link");
    await expect(mdMsgEl).toBeVisible({ timeout: 5000 });
    const mdLink = mdMsgEl.locator("a");
    await expect(mdLink).toHaveAttribute("href", tarkovUrl);
    await expect(mdLink).toHaveText("防弹插板背心");

    // 6. 验证中文句号结尾：句号不被吸入 URL
    const periodMsgEl = page.locator("#message-msg_chinese_period");
    await expect(periodMsgEl).toBeVisible({ timeout: 5000 });
    const periodLink = periodMsgEl.locator("a");
    await expect(periodLink).toHaveAttribute(
      "href",
      "https://example.com/item/456",
    );
    await expect(periodLink).toHaveText("https://example.com/item/456");

    // 控制台无严重未捕获错误
    expect(consoleErrors).toEqual([]);
  });
});
