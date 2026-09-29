import { test, expect } from "@playwright/test";

test.describe("文字频道左侧未读白色指示条 (Discord 风格) 交互与闭环验证", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const realToken = localStorage.getItem("tescord_e2e_access_token");
      if (realToken) {
        localStorage.setItem("tescord_access_token", realToken);
      }
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({ id: "user_test_me", username: "jackey_tester" }),
      );
      (window as any).WebSocket = class MockWebSocket extends EventTarget {
        readyState = 3;
        close() {}
        send() {}
      };
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user_test_me",
          username: "jackey_tester",
          displayName: "测试大师",
          email: "tester@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/api/users/@me/settings", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          language: "zh-CN",
          outputVolume: 100,
        }),
      });
    });

    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    });

    await page.route("**/api/relationships", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/channels/*/read", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          channelId: "channel_text_unread",
          lastReadSequence: 10,
        }),
      });
    });

    await page.route("**/api/guilds/*/ack", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          guildId: "guild_e2e_test",
          updatedChannels: [],
        }),
      });
    });

    await page.route("**/api/channels/*/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_e2e_test",
            name: "未读测试公会",
            iconUrl: null,
            description: "用于验证未读指示条的公会",
            isPublic: false,
            ownerId: "user_test_me",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            categories: [],
            channels: [
              {
                id: "channel_text_active",
                guildId: "guild_e2e_test",
                name: "日常闲聊",
                type: "TEXT",
                topic: null,
                parentId: null,
                position: 0,
                isE2EE: false,
                bitrate: 64000,
                voiceMode: "sfu",
                streamMode: "sfu",
                lastReadSequence: 5,
                unreadCount: 0,
                createdAt: new Date().toISOString(),
              },
              {
                id: "channel_text_unread",
                guildId: "guild_e2e_test",
                name: "公告通知",
                type: "TEXT",
                topic: null,
                parentId: null,
                position: 1,
                isE2EE: false,
                bitrate: 64000,
                voiceMode: "sfu",
                streamMode: "sfu",
                lastReadSequence: 5,
                unreadCount: 3,
                createdAt: new Date().toISOString(),
              },
            ],
            roles: [],
            members: [
              {
                userId: "user_test_me",
                guildId: "guild_e2e_test",
                roleIds: [],
                joinedAt: new Date().toISOString(),
              },
            ],
          },
        ]),
      });
    });
  });

  test("验证文字频道未读时出现左边缘白色胶囊 pill 与高亮白字，点击后消除", async ({
    page,
  }) => {
    await page.goto("/");

    // 点击该服务器
    const guildIcon = page.getByRole("button", { name: "未读测试公会" });
    await expect(guildIcon).toBeVisible({ timeout: 10000 });
    await guildIcon.click();

    // 默认进入日常闲聊频道
    const activeChannelBtn = page.getByTestId("channel-button-日常闲聊");
    await expect(activeChannelBtn).toBeVisible({ timeout: 10000 });

    // 公告通知频道有 3 条未读，验证其左侧白色指示胶囊存在
    const unreadChannelContainer = page.locator(
      'div[data-channel-id="channel_text_unread"]',
    );
    await expect(unreadChannelContainer).toBeVisible();

    const pill = unreadChannelContainer.locator(
      '[data-testid="channel-unread-pill"]',
    );
    await expect(pill).toBeVisible();
    await expect(pill).toHaveClass(/bg-white/);
    await expect(pill).toHaveClass(/rounded-r-full/);
    await expect(pill).toHaveClass(/h-2/);

    // 验证文字高亮：未读频道按钮包含 text-white 和 font-semibold
    const unreadButton = page.getByTestId("channel-button-公告通知");
    await expect(unreadButton).toHaveClass(/text-white/);
    await expect(unreadButton).toHaveClass(/font-semibold/);

    // 悬停在未读频道上，验证具有 group-hover:h-5 类
    await unreadChannelContainer.hover();
    await expect(pill).toHaveClass(/group-hover:h-5/);

    // 点击进入该未读频道
    await unreadButton.click();

    // 进入后未读状态立即核销，白条消失
    await expect(pill).toHaveCount(0);
  });

  test("验证通过右键菜单‘标记为已读’可直接核销未读白色条", async ({
    page,
  }) => {
    await page.goto("/");

    const guildIcon = page.getByRole("button", { name: "未读测试公会" });
    await expect(guildIcon).toBeVisible({ timeout: 10000 });
    await guildIcon.click();

    const unreadChannelContainer = page.locator(
      'div[data-channel-id="channel_text_unread"]',
    );
    await expect(unreadChannelContainer).toBeVisible();

    const pill = unreadChannelContainer.locator(
      '[data-testid="channel-unread-pill"]',
    );
    await expect(pill).toBeVisible();

    // 右键呼出频道上下文菜单
    await unreadChannelContainer.click({ button: "right" });

    // 找到并点击“标记为已读”
    const markAsReadItem = page.getByTestId(
      "channel-context-menu-mark-as-read",
    );
    await expect(markAsReadItem).toBeVisible();
    await markAsReadItem.click();

    // 验证右键标记已读后，左边缘白条消失
    await expect(pill).toHaveCount(0);
  });

  test("验证服务器右键菜单‘标记为已读’可批量消除该公会内所有频道的未读白色条", async ({
    page,
  }) => {
    await page.goto("/");

    const guildIcon = page.getByRole("button", { name: "未读测试公会" });
    await expect(guildIcon).toBeVisible({ timeout: 10000 });
    await guildIcon.click();

    const unreadChannelContainer = page.locator(
      'div[data-channel-id="channel_text_unread"]',
    );
    await expect(unreadChannelContainer).toBeVisible();

    const pill = unreadChannelContainer.locator(
      '[data-testid="channel-unread-pill"]',
    );
    await expect(pill).toBeVisible();

    // 在服务器图标上点击右键呼出服务器上下文菜单
    await guildIcon.click({ button: "right" });

    // 点击“标记为已读”
    const markGuildAsRead = page.getByTestId(
      "server-context-menu-mark-as-read",
    );
    await expect(markGuildAsRead).toBeVisible();
    await markGuildAsRead.click();

    // 验证所有频道的未读白条被一键核销
    await expect(pill).toHaveCount(0);
  });
});
