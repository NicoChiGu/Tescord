import { test, expect } from "@playwright/test";

test.describe("4 项核心缺陷与用户体验改进验收测试 (four-user-fixes)", () => {
  const mockUser = {
    id: "usr_mock_terata",
    username: "TERATA#70712",
    displayName: "TERATA",
    discriminator: "70712",
    email: "terata@tescord.local",
    role: "USER",
    avatarUrl: null,
    status: "ONLINE",
    customStatus: "在线中",
    createdAt: "2026-09-24T00:00:00.000Z",
  };

  const mockOtherUser = {
    id: "user_tera_test",
    username: "TERA-TEST#98395",
    displayName: "TERA-TEST",
    avatarUrl: null,
  };

  test("1. 响应式布局：在平板横竖屏与桌面端视口切换时，无 Hook 顺序错乱及 length 崩溃", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockUser),
      });
    });
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // 1.1 初始为宽屏（桌面模式 1280x800）
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1.2 旋转/缩放到平板竖屏模式（768x1024，isDesktop 为 false）
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);

    // 1.3 旋转回平板横屏/小桌面模式（1024x768，isDesktop 为 true）
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);

    // 1.4 再缩放到手机模式（390x844）
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // 1.5 再次切换回桌面模式（1440x900）
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    // 验证控制台与运行时没有任何 React Hook 或 length 读取崩溃
    const fatalErrors = pageErrors.filter(
      (msg) =>
        msg.includes(
          "Cannot read properties of undefined (reading 'length')",
        ) ||
        msg.includes("Rendered more hooks than during the previous render") ||
        msg.includes("Rendered fewer hooks than during the previous render"),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test("2. 服务器邀请卡片：头像与横幅具备防拖拽属性 (draggable=false / pointer-events-none)", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockUser),
      });
    });

    const mockInvite = {
      code: "guild-test",
      guild: {
        id: "guild_test_123",
        name: "Testers Guild",
        iconUrl: "/avatars/test.png",
        description: "Guild for testing drag prevention",
        approximateMemberCount: 100,
        approximatePresenceCount: 50,
      },
      channel: {
        id: "channel_test_123",
        name: "general",
      },
      inviter: {
        id: "inviter_01",
        username: "Inviter",
      },
    };

    await page.route("**/api/invites/guild-test", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockInvite),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_default",
            name: "Default",
            channels: [
              {
                id: "c_main",
                name: "chat",
                type: "TEXT",
                guildId: "guild_default",
                position: 0,
              },
            ],
          },
        ]),
      });
    });

    await page.route("**/api/channels/c_main/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "m_invite",
            channelId: "c_main",
            authorId: mockUser.id,
            author: mockUser,
            content: "https://tescord.com/invite/guild-test",
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const inviteCard = page.locator('[data-testid="server-invite-card"]');
    await expect(inviteCard).toBeVisible({ timeout: 5000 });

    // 1. 验证卡片正确展示计算出的在线人数与总成员数
    await expect(inviteCard).toContainText("50 位在线");
    await expect(inviteCard).toContainText("100 位成员");

    // 2. 检查邀请卡片内的横幅图片与公会头像均禁止拖拽
    const cardImages = inviteCard.locator("img");
    const count = await cardImages.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const img = cardImages.nth(i);
      const draggable = await img.getAttribute("draggable");
      expect(draggable).toBe("false");
    }

    // 3. 检查聊天消息中作者头像同样被设置 draggable=false，杜绝拖拽上传
    const authorAvatar = page.locator(
      'img[data-profile-trigger="chat-usr_mock_terata"]',
    );
    await expect(authorAvatar).toBeVisible();
    expect(await authorAvatar.getAttribute("draggable")).toBe("false");
  });

  test("3. 私信通话与连接阶段：不再显示 WebRTC P2P Direct / LiveKit SFU，统一呈现设计卡片", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockUser),
      });
    });
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "dm_c1",
            type: "DM",
            recipients: [mockOtherUser],
            unreadCount: 0,
          },
        ]),
      });
    });

    await page.route("**/api/channels/dm_c1/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击该私信频道
    const dmItem = page.getByText("TERA-TEST");
    await expect(dmItem).toBeVisible({ timeout: 5000 });
    await dmItem.click();

    // 点击发起语音呼叫
    const voiceCallBtn = page.locator(
      '[data-testid="dm-start-voice-call-btn"]',
    );
    await expect(voiceCallBtn).toBeVisible({ timeout: 5000 });
    await voiceCallBtn.click();

    // 验证呼叫舞台呈现（波纹、对方头像、已验证设备·E2EE、取消呼叫按钮）
    const outgoingStage = page.locator(
      '[data-testid="dm-outgoing-call-stage"]',
    );
    await expect(outgoingStage).toBeVisible({ timeout: 5000 });
    await expect(outgoingStage).toContainText("TERA-TEST");
    await expect(outgoingStage).toContainText("已验证设备 · E2EE");
    await expect(
      page.locator('[data-testid="dm-cancel-call-btn"]'),
    ).toBeVisible();

    // 验证无论何时都不再渲染任何 WebRTC P2P Direct 或 LiveKit SFU 字样
    await expect(page.locator("body")).not.toContainText("WebRTC P2P Direct");
    await expect(page.locator("body")).not.toContainText("LiveKit SFU");
    await expect(page.locator("body")).not.toContainText(
      "正在建立加密音视频通道...",
    );

    // 点击取消呼叫
    await page.locator('[data-testid="dm-cancel-call-btn"]').click();
    await expect(outgoingStage).not.toBeVisible();
  });

  test("4. 私信好友列表：未接听/取消呼叫等状态展示为国际化简介而非 [CALL_EVENT:canceled]", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockUser),
      });
    });
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // 模拟包含通话历史状态的私信频道列表
    const dmChannels = [
      {
        id: "dm_c1",
        type: "DM",
        recipients: [mockOtherUser],
        lastMessage: {
          id: "msg_call_1",
          channelId: "dm_c1",
          authorId: mockOtherUser.id,
          content: "[CALL_EVENT:canceled]",
          createdAt: new Date().toISOString(),
        },
      },
      {
        id: "dm_c2",
        type: "DM",
        recipients: [
          {
            id: "user_bob",
            username: "Bob#10002",
            displayName: "Bob",
          },
        ],
        lastMessage: {
          id: "msg_call_2",
          channelId: "dm_c2",
          authorId: "user_bob",
          content: "[CALL_EVENT:missed]",
          createdAt: new Date().toISOString(),
        },
      },
      {
        id: "dm_c3",
        type: "DM",
        recipients: [
          {
            id: "user_charlie",
            username: "Charlie#10003",
            displayName: "Charlie",
          },
        ],
        lastMessage: {
          id: "msg_call_3",
          channelId: "dm_c3",
          authorId: "user_charlie",
          content: "[CALL_EVENT:ended:02:45]",
          createdAt: new Date().toISOString(),
        },
      },
    ];

    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(dmChannels),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 校验私信好友列表中不出现任何 raw [CALL_EVENT: 字符串
    const dmList = page.locator("aside");
    await expect(dmList).not.toContainText("[CALL_EVENT:canceled]");
    await expect(dmList).not.toContainText("[CALL_EVENT:missed]");
    await expect(dmList).not.toContainText("[CALL_EVENT:ended");

    // 校验解析后的本地化文案正确呈现在列表简介中
    await expect(page.getByText("已取消呼叫")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("未接来电")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("通话已结束 (02:45)")).toBeVisible({
      timeout: 5000,
    });
  });
});
