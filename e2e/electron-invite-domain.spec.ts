import { test, expect } from "@playwright/test";

test.describe("公会邀请弹窗与邀请链接生成真实渲染验收", () => {
  const mockGuild = {
    id: "guild_electron_ui_test",
    name: "测试专属公会",
    iconUrl: null,
    ownerId: "mock_user_1",
    channels: [
      {
        id: "ch_general_1",
        guildId: "guild_electron_ui_test",
        name: "综合讨论",
        type: "TEXT",
        position: 0,
      },
    ],
    members: [],
  };

  test("1. 打开邀请好友模态框：生成并渲染完整邀请链接，绝不能出现 file:// 协议", async ({
    page,
    context,
  }) => {
    // 授予剪贴板权限
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // 禁用网关
    await page.routeWebSocket("**/gateway", (socket) => socket.close());

    // Mock 认证（保持在线）
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "mock_user_1",
          username: "Tester",
          email: "tester@tescord.local",
          status: "ONLINE",
        }),
      });
    });

    // Mock 公会列表
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockGuild]),
      });
    });

    await page.route("**/api/users/@me/dm-channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me/relationships", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route(
      "**/api/guilds/guild_electron_ui_test/channels",
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockGuild.channels),
        });
      },
    );

    await page.route("**/api/channels/ch_general_1/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [], hasMore: false }),
      });
    });

    // Mock 活跃邀请码返回标准结构
    const testCode = "quantum_inv_999";
    await page.route(
      "**/api/guilds/guild_electron_ui_test/invites/active",
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            invite: {
              code: testCode,
              inviterId: "mock_user_1",
              expiresAt: null,
              maxUses: 0,
              uses: 0,
            },
          }),
        });
      },
    );

    await page.route(
      "**/api/guilds/guild_electron_ui_test/invites",
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            code: testCode,
            inviterId: "mock_user_1",
            expiresAt: null,
            maxUses: 0,
            uses: 0,
          }),
        });
      },
    );

    await page.goto("/");

    // 确保主界面渲染就绪
    await expect(page.locator("body")).toBeVisible();

    // 触发全局事件打开邀请好友弹窗
    await page.evaluate((guild) => {
      window.dispatchEvent(
        new CustomEvent("tescord:open-invite-modal", { detail: { guild } }),
      );
    }, mockGuild);

    // 找到模态框底部的链接输入框
    const linkInput = page.locator('input[readonly][type="text"]').last();
    await expect(linkInput).toBeVisible({ timeout: 5000 });

    // 等待输入框加载出邀请码（非 loading 状态）
    await expect(linkInput).not.toHaveValue(/正在生成/, { timeout: 5000 });

    const inviteUrlVal = await linkInput.inputValue();
    console.log("Rendered Invite URL in Modal:", inviteUrlVal);

    // 严格断言：
    // 1. 绝不能是本地文件协议
    expect(inviteUrlVal).not.toMatch(/^file:\/\//);
    expect(inviteUrlVal).not.toContain("file://");
    // 2. 必须是合法 HTTP/HTTPS 路径并包含当前邀请码
    expect(inviteUrlVal).toMatch(/^https?:\/\/.+\/invite\/quantum_inv_999$/);

    // 测试点击复制按钮
    const copyButton = page
      .locator("button", { hasText: /複製|复制|Copy/i })
      .last();
    await copyButton.click();

    // 验证按钮变为已复制状态
    await expect(
      page.locator("button", { hasText: /已複製|已复制|Copied/i }),
    ).toBeVisible({
      timeout: 3000,
    });
  });
});
