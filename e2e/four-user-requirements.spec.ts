import { test, expect, Page } from "@playwright/test";
import { Message, SearchMessagesResponse } from "@tescord/types";

test.describe("4 项核心用户需求与缺陷修复完整验收 (four-user-requirements)", () => {
  const mockGuild = {
    id: "g_search_guild_1",
    name: "Tescord 核心公会",
    icon: null,
    ownerId: "e2e_tester_user",
    channels: [
      {
        id: "c_main_text",
        name: "综合讨论区",
        type: "TEXT",
        position: 0,
        guildId: "g_search_guild_1",
      },
      {
        id: "c_voice_room",
        name: "游戏语音房",
        type: "VOICE",
        position: 1,
        guildId: "g_search_guild_1",
      },
    ],
    members: [
      {
        userId: "e2e_tester_user",
        user: { id: "e2e_tester_user", username: "tester_pro" },
      },
    ],
  };

  const mockGuild2: any = {
    id: "g_search_guild_2",
    name: "二号公会",
    ownerId: "e2e_tester_user",
    iconUrl: null,
    channels: [],
    members: [],
  };

  const mockTargetFriend = {
    id: "u_friend_alice",
    username: "alice_wonderland",
    displayName: "爱丽丝",
    status: "ONLINE",
    avatarUrl: null,
  };

  const mockSearchMessages: Message[] = [
    {
      id: "msg_search_target_1",
      channelId: "c_main_text",
      authorId: "u_friend_alice",
      author: {
        id: "u_friend_alice",
        username: "alice_wonderland",
        displayName: "爱丽丝",
        avatarUrl: null,
        status: "ONLINE",
      },
      content: "这是一条包含 DiscordSearch 关键词的重要项目公告测试消息！",
      sequence: 1,
      isEncrypted: false,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: new Date().toISOString(),
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tescord_locale", "zh-CN");
      localStorage.setItem("tescord_last_seen_changelog_version", "v0.3.1");
      localStorage.setItem("tescord_last_read_whats_new", "v0.3.1");
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "e2e_tester_user",
          username: "tester_pro",
        }),
      );
      // 禁用后台 WebSocket 避免网关长连接覆盖 Mock 数据
      (window as any).WebSocket = class MockWebSocket extends EventTarget {
        readyState = 3;
        close() {}
        send() {}
      };
    });

    // 1. Mock 登录用户信息
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

    // 2. Mock 服务器列表
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockGuild, mockGuild2]),
      });
    });

    // 3. Mock 用户偏好设置
    await page.route("**/api/users/@me/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outputVolume: 100,
            language: "zh-CN",
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
    });

    // 4. Mock 频道消息列表
    await page.route("**/api/channels/**/messages*", (route) => {
      if (route.request().url().includes("search")) {
        return; // 交由专门的 search 路由处理
      }
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "msg_sent_1",
            channelId: "c_main_text",
            content: "发送成功",
            createdAt: new Date().toISOString(),
          }),
        });
        return;
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockSearchMessages),
      });
    });

    // 5. Mock 好友关系列表 (有一名在线好友爱丽丝)
    await page.route("**/api/users/@me/relationships", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "rel_mock_1",
            userId: "e2e_tester_user",
            targetUserId: mockTargetFriend.id,
            type: "FRIEND",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            targetUser: mockTargetFriend,
          },
        ]),
      });
    });

    // 6. Mock 活跃邀请码查询与创建
    await page.route("**/api/guilds/*/invites/active", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invite: {
            code: "MOCK_INVITE_888",
            guildId: mockGuild.id,
            inviterId: "e2e_tester_user",
            maxUses: 0,
            uses: 0,
            expiresAt: null,
            createdAt: new Date().toISOString(),
          },
        }),
      });
    });

    await page.route("**/api/guilds/*/invites", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            code: "NEW_INVITE_999",
            guildId: mockGuild.id,
            inviterId: "e2e_tester_user",
            maxUses: 0,
            uses: 0,
            expiresAt: null,
            createdAt: new Date().toISOString(),
          }),
        });
      }
    });

    // 7. Mock 获取或创建私信会话接口 (POST /api/users/@me/channels 与 POST /api/channels/dm)
    await page.route("**/api/users/@me/channels", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "c_dm_alice_channel",
            type: "DM",
            recipientId: mockTargetFriend.id,
            createdAt: new Date().toISOString(),
          }),
        });
      }
    });

    await page.route("**/api/channels/dm", (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "c_dm_alice_channel",
            type: "DM",
            recipientId: mockTargetFriend.id,
            createdAt: new Date().toISOString(),
          }),
        });
      }
    });

    // 8. Mock 搜索引擎 API (公会和频道多维联合检索)
    await page.route("**/api/**/messages/search*", (route) => {
      const response: SearchMessagesResponse = {
        total: 1,
        page: 1,
        limit: 25,
        messages: [
          {
            id: "msg_search_target_1",
            channelId: "c_main_text",
            authorId: mockTargetFriend.id,
            author: mockTargetFriend,
            content:
              "这是一条包含 DiscordSearch 关键词的重要项目公告测试消息！",
            channelName: "综合讨论区",
            sequence: 1,
            isEncrypted: false,
            isPinned: false,
            reactions: [],
            attachments: [],
            createdAt: new Date().toISOString(),
          },
        ],
      };
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    });
  });

  // 辅助函数：确保进入测试公会的“综合讨论区”频道
  const enterGuildChannel = async (page: Page) => {
    // 检查并关闭更新公告弹窗（若仍有触发）
    const whatsNewClose = page.locator('button:has-text("我知道了")');
    if (await whatsNewClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await whatsNewClose.click();
    }

    // 点击侧边栏的目标服务器图标
    const serverBtn = page
      .locator(`button[aria-label="${mockGuild.name}"]`)
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 点击该服务器下的“综合讨论区”文本频道
    const channelItem = page.locator('span:has-text("综合讨论区")').first();
    await expect(channelItem).toBeVisible({ timeout: 10000 });
    await channelItem.click();
  };

  test("需求 1：修复邀请好友至服务器时，点击邀请无任何反应", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 关闭更新弹窗 (若有)
    const whatsNewClose = page.locator('button:has-text("我知道了")');
    if (await whatsNewClose.isVisible({ timeout: 1500 }).catch(() => false)) {
      await whatsNewClose.click();
    }

    // 监听发送私信和发送邀请消息请求
    let dmCreated = false;
    let inviteMessageSent = false;
    page.on("request", (req) => {
      if (
        (req.url().includes("/api/users/@me/channels") ||
          req.url().includes("/api/channels/dm")) &&
        req.method() === "POST"
      ) {
        dmCreated = true;
      }
      if (
        req.url().includes("/api/channels/c_dm_alice_channel/messages") &&
        req.method() === "POST"
      ) {
        inviteMessageSent = true;
      }
    });

    // 触发打开邀请好友模态框
    await page.evaluate((guild) => {
      window.dispatchEvent(
        new CustomEvent("tescord:open-invite-modal", { detail: { guild } }),
      );
    }, mockGuild);

    // 验证模态框已正常渲染并展示好友列表
    const inviteModal = page.locator(".fixed.inset-0.z-50");
    await expect(inviteModal).toBeVisible({ timeout: 5000 });
    await expect(inviteModal.locator("h3")).toContainText(
      /好友.*Tescord 核心公会/,
    );

    // 验证自动预生成的邀请链接输入框存在且包含链接
    const inviteInput = inviteModal.locator("input[readonly]");
    await expect(inviteInput).toBeVisible();
    await expect(inviteInput).toHaveValue(/MOCK_INVITE_888/);

    // 定位好友条目中的“邀请”按钮并点击
    const inviteBtn = inviteModal
      .locator("button")
      .filter({ hasText: /^(邀请|邀請)$/ })
      .first();
    await expect(inviteBtn).toBeVisible();
    await inviteBtn.click();

    // 验证网络请求成功发出，并且按钮状态从“邀请”变为“已邀请”（带对勾）且被禁用
    await expect(async () => {
      expect(dmCreated).toBeTruthy();
      expect(inviteMessageSent).toBeTruthy();
    }).toPass({ timeout: 5000 });

    const invitedBtn = inviteModal
      .locator("button")
      .filter({ hasText: /^(已邀请|已邀請)$/ })
      .first();
    await expect(invitedBtn).toBeVisible();
    await expect(invitedBtn).toBeDisabled();
  });

  test("需求 2：解决增加文字尺寸时排版异常（图1/图2缺陷：Header 图钉与成员列表按钮防挤压截断）", async ({
    page,
  }) => {
    // 模拟视口较窄 (800x600)
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await enterGuildChannel(page);

    // 模拟全局文字尺寸放大为 20px (对应最大号字号)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });

    // 验证频道标题存在截断样式并且不会无限制撑破
    const channelTitle = page.locator('[data-testid="chat-header-title"]');
    await expect(channelTitle).toBeVisible();
    const classList = await channelTitle.getAttribute("class");
    expect(classList).toContain("truncate");

    // 验证置顶图钉按钮在视口内完全可见且未被裁剪 (flex-shrink-0)
    const pinsBtn = page.locator('button[title*="固定的消息"]').first();
    await expect(pinsBtn).toBeVisible();
    const pinsBox = await pinsBtn.boundingBox();
    expect(pinsBox).not.toBeNull();
    if (pinsBox) {
      expect(pinsBox.x + pinsBox.width).toBeLessThanOrEqual(800);
      expect(pinsBox.x).toBeGreaterThan(0);
    }

    // 验证成员列表切换按钮在视口内完全可见且未被裁剪
    const memberToggleBtn = page.locator('button[title="成员列表"]').first();
    await expect(memberToggleBtn).toBeVisible();
    const memberBox = await memberToggleBtn.boundingBox();
    expect(memberBox).not.toBeNull();
    if (memberBox) {
      expect(memberBox.x + memberBox.width).toBeLessThanOrEqual(800);
      expect(memberBox.x).toBeGreaterThan(0);
    }
  });

  test("需求 3：Discord 原生级搜索引擎体系（抽屉展开、关键词搜索与 Jump to message）", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await enterGuildChannel(page);

    // 打开搜索抽屉
    const searchDrawerBtn = page
      .locator('[data-testid="toggle-search-drawer-btn"]')
      .first();
    if (await searchDrawerBtn.isVisible()) {
      await searchDrawerBtn.click();
    } else {
      const searchBoxInput = page.locator('input[placeholder*="搜索"]').first();
      await searchBoxInput.click();
      await searchBoxInput.press("Enter");
    }

    // 验证右侧独立滑出搜索抽屉 (SearchResultsDrawer) 展开
    const searchDrawer = page.locator('[data-testid="search-results-drawer"]');
    await expect(searchDrawer).toBeVisible({ timeout: 5000 });

    // 验证包含作用域切换 pill（当前频道 / 整个服务器）
    await expect(
      searchDrawer.locator("button", { hasText: mockGuild.name }),
    ).toBeVisible();
    await expect(
      searchDrawer.locator("button", { hasText: "#综合讨论区" }),
    ).toBeVisible();

    // 验证包含快速语法药丸标签
    await expect(
      searchDrawer.locator("button", { hasText: "from:" }),
    ).toBeVisible();
    await expect(
      searchDrawer.locator("button", { hasText: "in:" }),
    ).toBeVisible();

    // 在抽屉的搜索输入框输入关键词 "DiscordSearch" 并回车
    const searchInput = searchDrawer.locator('input[type="text"]');
    await searchInput.fill("DiscordSearch");
    await searchInput.press("Enter");

    // 验证搜索结果列表中展示了匹配的消息
    const resultCard = searchDrawer.locator(
      "text=这是一条包含 DiscordSearch 关键词的重要项目公告测试消息！",
    );
    await expect(resultCard).toBeVisible({ timeout: 5000 });

    // 点击结果卡片，验证抽屉执行了跳转定位并触发消息高亮闪烁
    await resultCard.click();
    const chatMessage = page.locator("#message-msg_search_target_1");
    await expect(chatMessage).toBeVisible();
  });

  test("需求 4：服务器列表 PC 端鼠标瞬时拖拽重排与触屏端手势逻辑隔离", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 定位服务器列表中的第一个与第二个服务器图标按钮
    const serverButton1 = page
      .locator(`button[aria-label="${mockGuild.name}"]`)
      .first();
    const serverButton2 = page
      .locator(`button[aria-label="${mockGuild2.name}"]`)
      .first();
    await expect(serverButton1).toBeVisible();
    await expect(serverButton2).toBeVisible();

    // 1. 验证触屏端保护：确认按钮未常驻 touch-none 样式类，确保触屏用户可顺畅上下滑动侧栏
    const serverBtnClass = await serverButton1.getAttribute("class");
    expect(serverBtnClass).not.toContain("touch-none");

    // 2. 验证右键菜单长按行为：触发长按/右键呼出上下文菜单
    await serverButton1.dispatchEvent("contextmenu");
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible();

    // 模拟当按 Escape 时，菜单正常关闭
    await page.keyboard.press("Escape");
    await expect(contextMenu).not.toBeVisible();

    // 3. 核心验收：验证 PC 端鼠标拖拽彻底与触屏逻辑隔离（不派发 Escape，鼠标左键拖拽 5px 即顺畅启动并成功完成排序）
    const box1 = await serverButton1.boundingBox();
    const box2 = await serverButton2.boundingBox();
    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();

    if (box1 && box2) {
      await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
      await page.mouse.down({ button: "left" });
      // 向下拖动超过第二个服务器位置
      await page.mouse.move(
        box2.x + box2.width / 2,
        box2.y + box2.height / 2 + 10,
        { steps: 20 },
      );
      await page.mouse.up();
      // 等待排序动画与状态刷新
      await page.waitForTimeout(200);

      // 验证 PC 拖拽重排成功：第二个公会现在排列在前面或两者位置发生调换
      const serverButtons = page.locator(
        '[data-testid="server-list-container"] button',
      );
      const firstAriaLabel = await serverButtons
        .first()
        .getAttribute("aria-label");
      expect(firstAriaLabel).toBe(mockGuild2.name);
    }
  });
});
