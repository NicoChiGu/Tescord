import { test, expect } from "@playwright/test";

test.describe("服务器邀请卡片 (Server Invite Card) 视觉呈现与第一频道跳转验收", () => {
  const mockGuild = {
    id: "guild_party_animals_99",
    name: "Party Animals",
    iconUrl: "/uploads/avatars/party_animals.png",
    description:
      "The official Discord server for Party Animals. Find game news, submit suggestions and chat with our wonderful community!",
    createdAt: "2019-11-15T08:00:00.000Z",
    approximateMemberCount: 74738,
    approximatePresenceCount: 15401,
  };

  const mockFirstChannel = {
    id: "channel_party_general",
    guildId: "guild_party_animals_99",
    name: "general-chat",
    type: "TEXT",
    position: 0,
  };

  const mockSecondChannel = {
    id: "channel_party_voice",
    guildId: "guild_party_animals_99",
    name: "Party Room",
    type: "VOICE",
    position: 1,
  };

  const defaultGuild = {
    id: "guild_initial_1",
    name: "Initial Guild",
    iconUrl: null,
    channels: [
      {
        id: "channel_init_main",
        guildId: "guild_initial_1",
        name: "main",
        type: "TEXT",
        position: 0,
      },
    ],
  };

  const inviteCode = "party-animals";

  test("1. 未加入状态：卡片呈现完整元素与'加入'按钮，点击后加入服务器并直接跳转至第一频道", async ({
    page,
  }) => {
    let joined = false;

    // 禁用网关避免长连干扰
    await page.routeWebSocket("**/gateway", (socket) => socket.close());

    // 登录鉴权
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test_user_rich_1",
          username: "PartyFan",
          displayName: "PartyFan",
          email: "party@tescord.local",
        }),
      });
    });

    // 公会列表
    await page.route("**/api/guilds", (route) => {
      const guilds = [defaultGuild];
      if (joined) {
        guilds.push({
          ...mockGuild,
          channels: [mockFirstChannel, mockSecondChannel],
        });
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(guilds),
      });
    });

    // 消息列表（初始公会频道消息中包含一条服务器邀请链接）
    await page.route(
      `**/api/channels/${defaultGuild.channels[0].id}/messages*`,
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            messages: [
              {
                id: "msg_with_invite_1",
                channelId: defaultGuild.channels[0].id,
                content: `快来我们的服务器一起玩！ https://tescord.app/invite/${inviteCode}`,
                authorId: "test_author_1",
                author: {
                  id: "test_author_1",
                  username: "PartyLeader",
                  avatarUrl: null,
                },
                createdAt: new Date().toISOString(),
                attachments: [],
                reactions: [],
              },
            ],
            hasMoreOlder: false,
            hasMoreNewer: false,
          }),
        });
      },
    );

    // 目标公会第一频道消息列表
    await page.route(
      `**/api/channels/${mockFirstChannel.id}/messages*`,
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            messages: [
              {
                id: "msg_party_first_1",
                channelId: mockFirstChannel.id,
                content: "欢迎来到 Party Animals 官方服务器！",
                authorId: "test_author_1",
                author: {
                  id: "test_author_1",
                  username: "PartyLeader",
                  avatarUrl: null,
                },
                createdAt: new Date().toISOString(),
                attachments: [],
                reactions: [],
              },
            ],
            hasMoreOlder: false,
            hasMoreNewer: false,
          }),
        });
      },
    );

    // 邀请码详情接口
    await page.route(`**/api/invites/${inviteCode}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: inviteCode,
          guild: mockGuild,
          approximateMemberCount: mockGuild.approximateMemberCount,
          approximatePresenceCount: mockGuild.approximatePresenceCount,
          isMember: joined,
        }),
      });
    });

    // 加入公会接口
    await page.route(`**/api/invites/${inviteCode}/join`, (route) => {
      joined = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          guildId: mockGuild.id,
        }),
      });
    });

    await page.goto("/");

    // 验证卡片出现在聊天流中
    const card = page.locator('[data-testid="server-invite-card"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // 验证卡片内容元素：服务器名称、认证徽章、人数、建立日期、描述、小附属标
    await expect(card.getByText("Party Animals").first()).toBeVisible();
    await expect(card.getByTitle("Verified")).toBeVisible();
    await expect(card.getByText(/15,401\s*位在线/)).toBeVisible();
    await expect(card.getByText(/74,738\s*位成员/)).toBeVisible();
    await expect(card.getByText(/建立日期：2019年11月/)).toBeVisible();
    await expect(
      card.getByText(
        "The official Discord server for Party Animals. Find game news, submit suggestions and chat with our wonderful community!",
      ),
    ).toBeVisible();

    // 验证未加入时按钮为“加入”
    const joinBtn = card.locator('[data-testid="server-invite-join-btn"]');
    await expect(joinBtn).toBeVisible();
    await expect(joinBtn).toHaveText(/加入/);

    // 点击“加入”按钮
    await joinBtn.click();

    // 验证加入后，直接跳转到了该服务器的第一条频道 (#general-chat)
    // 检查频道头部或消息区域已呈现目标第一频道的内容
    await expect(
      page.getByText("欢迎来到 Party Animals 官方服务器！"),
    ).toBeVisible({ timeout: 8000 });
  });

  test("2. 已加入状态：卡片按钮显示为'前往服务器'，点击后直接跳转至第一频道", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());

    // 登录鉴权
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test_user_rich_1",
          username: "PartyFan",
          displayName: "PartyFan",
          email: "party@tescord.local",
        }),
      });
    });

    // 用户已属于这两个公会
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          defaultGuild,
          {
            ...mockGuild,
            channels: [mockFirstChannel, mockSecondChannel],
          },
        ]),
      });
    });

    // 初始公会消息
    await page.route(
      `**/api/channels/${defaultGuild.channels[0].id}/messages*`,
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            messages: [
              {
                id: "msg_with_invite_2",
                channelId: defaultGuild.channels[0].id,
                content: `/invite/${inviteCode}`,
                authorId: "test_author_1",
                author: {
                  id: "test_author_1",
                  username: "PartyLeader",
                  avatarUrl: null,
                },
                createdAt: new Date().toISOString(),
                attachments: [],
                reactions: [],
              },
            ],
            hasMoreOlder: false,
            hasMoreNewer: false,
          }),
        });
      },
    );

    // 目标公会第一频道消息
    await page.route(
      `**/api/channels/${mockFirstChannel.id}/messages*`,
      (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            messages: [
              {
                id: "msg_party_first_2",
                channelId: mockFirstChannel.id,
                content: "欢迎回到 Party Animals 官方服务器！",
                authorId: "test_author_1",
                author: {
                  id: "test_author_1",
                  username: "PartyLeader",
                  avatarUrl: null,
                },
                createdAt: new Date().toISOString(),
                attachments: [],
                reactions: [],
              },
            ],
            hasMoreOlder: false,
            hasMoreNewer: false,
          }),
        });
      },
    );

    // 邀请接口：isMember 为 true
    await page.route(`**/api/invites/${inviteCode}`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: inviteCode,
          guild: mockGuild,
          approximateMemberCount: mockGuild.approximateMemberCount,
          approximatePresenceCount: mockGuild.approximatePresenceCount,
          isMember: true,
        }),
      });
    });

    await page.goto("/");

    const card = page.locator('[data-testid="server-invite-card"]');
    await expect(card).toBeVisible({ timeout: 10000 });

    // 验证按钮显示为“前往服务器”
    const goBtn = card.locator('[data-testid="server-invite-joined-btn"]');
    await expect(goBtn).toBeVisible();
    await expect(goBtn).toHaveText(/前往服务器/);

    // 点击“前往服务器”
    await goBtn.click();

    // 验证直接定位跳转至该公会的第一频道
    await expect(
      page.getByText("欢迎回到 Party Animals 官方服务器！"),
    ).toBeVisible({ timeout: 8000 });
  });
});
