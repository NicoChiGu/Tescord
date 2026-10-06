import { test, expect } from "@playwright/test";

test.describe("类 Telegram / Discord 剧透马赛克迷彩标签端到端验收", () => {
  const mockMessages = [
    {
      id: "msg_spoiler_test",
      channelId: "c_general",
      authorId: "u_alice",
      author: {
        id: "u_alice",
        username: "Alice",
        avatarUrl: null,
      },
      content: "注意以下是关键剧情：||黑幕是终极人工智能泰斯科特||，请勿外传！",
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: "2026-10-06T12:00:00.000Z",
    },
  ];

  test.beforeEach(async ({ page }) => {
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
          id: "usr_e2e_tester",
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
            name: "Tescord 极客总部",
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

    await page.route("**/api/channels/**/read", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ channelId: "c_general", lastReadSequence: 1 }),
      });
    });

    await page.route("**/api/channels/**/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockMessages),
      });
    });
  });

  test("验证剧透标签以类 Telegram / Discord 马赛克迷彩渲染，并支持点击显现与再次隐藏", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");

    // 1. 进入服务器与频道
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const channelBtn = page.getByRole("button", { name: "general" }).first();
    await expect(channelBtn).toBeVisible({ timeout: 5000 });
    await channelBtn.click();

    // 2. 检查消息中的剧透胶囊
    const spoilerButton = page.getByTestId("chat-spoiler").first();
    await expect(spoilerButton).toBeVisible({ timeout: 10000 });

    // 3. 验证未揭开态特征：包含马赛克迷彩样式类、aria-expanded 为 false、正确的 tooltip
    await expect(spoilerButton).toHaveClass(/spoiler-mosaic-mask/);
    await expect(spoilerButton).toHaveAttribute("aria-expanded", "false");
    await expect(spoilerButton).toHaveAttribute("title", "剧透警告：点击显现");

    // 内部文本在遮蔽态下包含模糊/隐藏样式类
    const innerTextSpan = spoilerButton.locator("span").first();
    await expect(innerTextSpan).toHaveClass(/blur-\[7px\]/);
    await expect(innerTextSpan).toHaveClass(/opacity-0/);

    // 4. 点击剧透胶囊解密显现
    await spoilerButton.click();

    // 5. 验证揭开态特征：马赛克遮罩类被替换、半透明卡片呈现、文本恢复清晰可见
    await expect(spoilerButton).not.toHaveClass(/spoiler-mosaic-mask/);
    await expect(spoilerButton).toHaveAttribute("aria-expanded", "true");
    await expect(spoilerButton).toHaveAttribute("title", "点击重新隐藏剧透");
    await expect(innerTextSpan).toHaveClass(/filter-none/);
    await expect(innerTextSpan).toHaveClass(/opacity-100/);
    await expect(spoilerButton).toContainText("黑幕是终极人工智能泰斯科特");

    // 6. 再次点击剧透胶囊重新遮蔽
    await spoilerButton.click();

    // 7. 验证重新恢复为马赛克迷彩遮蔽态
    await expect(spoilerButton).toHaveClass(/spoiler-mosaic-mask/);
    await expect(spoilerButton).toHaveAttribute("aria-expanded", "false");
    await expect(spoilerButton).toHaveAttribute("title", "剧透警告：点击显现");
    await expect(innerTextSpan).toHaveClass(/blur-\[7px\]/);
    await expect(innerTextSpan).toHaveClass(/opacity-0/);

    expect(consoleErrors.length).toBe(0);
  });
});
