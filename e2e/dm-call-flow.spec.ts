import { test, expect } from "@playwright/test";

test.describe("私信语音/视频通话全生命周期 (DM Call Flow) E2E 验收", () => {
  test.beforeEach(async ({ page }) => {
    // 打印页面错误以便排查
    page.on("pageerror", (err) => {
      console.log("[PAGE_ERROR]", err.message);
    });

    // 预置已认证 Session
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem(
        "tescord_refresh_token",
        localStorage.getItem("tescord_e2e_refresh_token") || "mock_refresh_token",
      );
    });

    // Mock 端到端加密与基础接口
    await page.route("**/api/e2ee/devices", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.route("**/api/e2ee/keys/prekey", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.route("**/api/channels/*/read", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lastReadSequence: 0 }),
      }),
    );

    // Mock 当前登录用户
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
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
        }),
      });
    });

    // Mock 服务器列表为空 (纯 DM 视角)
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock 私信频道列表
    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "channel_dm_bob",
            name: "Bob",
            type: "DM",
            guildId: null,
            recipients: [
              {
                id: "usr_mock_bob",
                username: "Bob#12345",
                displayName: "Bob",
                status: "ONLINE",
                avatarUrl: null,
              },
            ],
            unreadCount: 0,
            lastMessage: {
              id: "msg_dm_last",
              channelId: "channel_dm_bob",
              authorId: "usr_mock_bob",
              content: "嗨，在吗？我们测一下通话吧！",
              createdAt: new Date().toISOString(),
            },
          },
        ]),
      });
    });

    // Mock 好友关系
    await page.route("**/api/users/@me/relationships", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "rel_bob",
            userId: "usr_mock_terata",
            targetUserId: "usr_mock_bob",
            type: "FRIEND",
            targetUser: {
              id: "usr_mock_bob",
              username: "Bob#12345",
              displayName: "Bob",
              status: "ONLINE",
              avatarUrl: null,
            },
          },
        ]),
      });
    });

    // Mock 频道消息列表（包含通话历史系统卡片）
    await page.route("**/api/channels/*/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg_1",
            channelId: "channel_dm_bob",
            content: "嗨，在吗？我们测一下通话吧！",
            authorId: "usr_mock_bob",
            author: {
              id: "usr_mock_bob",
              username: "Bob#12345",
              displayName: "Bob",
            },
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            attachments: [],
            reactions: [],
          },
          {
            id: "msg_call_ended",
            channelId: "channel_dm_bob",
            content: "[CALL_EVENT:ended:02:15]",
            authorId: "usr_mock_terata",
            author: {
              id: "usr_mock_terata",
              username: "TERATA#70712",
              displayName: "TERATA",
            },
            createdAt: new Date(Date.now() - 1800000).toISOString(),
            attachments: [],
            reactions: [],
          },
          {
            id: "msg_call_missed",
            channelId: "channel_dm_bob",
            content: "[CALL_EVENT:missed]",
            authorId: "usr_mock_bob",
            author: {
              id: "usr_mock_bob",
              username: "Bob#12345",
              displayName: "Bob",
            },
            createdAt: new Date(Date.now() - 900000).toISOString(),
            attachments: [],
            reactions: [],
          },
        ]),
      });
    });

    // Mock 用户配置
    await page.route("**/api/users/@me/settings", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
  });

  test("1. 验证私信聊天视口正确渲染通话历史系统事件卡片 (Call Event Cards)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击进入与 Bob 的私信
    const dmItem = page.locator("[data-testid='dm-item-channel_dm_bob']");
    await expect(dmItem).toBeVisible({ timeout: 10000 });
    await dmItem.click();

    // 验证通话历史卡片渲染
    const callCards = page.locator("[data-testid='dm-call-event-card']");
    await expect(callCards.first()).toBeVisible({ timeout: 5000 });
    const count = await callCards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // 验证通话时长卡片内容
    await expect(callCards.first()).toContainText("02:15");
  });

  test("2. 验证呼出流程 (Outgoing Call)、波纹呼叫舞台与取消呼叫", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击进入与 Bob 的私信
    const dmItem = page.locator("[data-testid='dm-item-channel_dm_bob']");
    await expect(dmItem).toBeVisible({ timeout: 10000 });
    await dmItem.click();

    // 验证顶部发起语音呼叫按钮存在
    const voiceCallBtn = page.locator(
      "[data-testid='dm-start-voice-call-btn']",
    );
    await expect(voiceCallBtn).toBeVisible({ timeout: 5000 });

    // 点击发起语音呼叫
    await voiceCallBtn.click();

    // 验证呼出阶段卡片展示
    const outgoingStage = page.locator(
      "[data-testid='dm-outgoing-call-stage']",
    );
    await expect(outgoingStage).toBeVisible({ timeout: 5000 });
    await expect(outgoingStage).toContainText("Bob");

    // 验证波纹与取消呼叫按钮
    const cancelBtn = page.locator("[data-testid='dm-cancel-call-btn']");
    await expect(cancelBtn).toBeVisible();

    // 点击取消呼叫
    await cancelBtn.click();

    // 验证呼出阶段关闭
    await expect(outgoingStage).not.toBeVisible({ timeout: 5000 });
  });

  test("3. 验证来电弹窗 (Incoming Call Modal)、静音铃声与拒绝操作", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 等待页面就绪
    const dmItem = page.locator("[data-testid='dm-item-channel_dm_bob']");
    await expect(dmItem).toBeVisible({ timeout: 10000 });

    // 模拟网关派发来电信令 CALL_OFFER
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("CALL_OFFER", {
          callId: "call_test_incoming_1",
          channelId: "channel_dm_bob",
          callerId: "usr_mock_bob",
          caller: {
            id: "usr_mock_bob",
            username: "Bob#12345",
            displayName: "Bob",
          },
          hasVideo: false,
        });
      }
    });

    // 验证来电弹窗展示
    const muteRingtoneBtn = page.locator("[data-testid='mute-ringtone-btn']");
    const acceptBtn = page.locator("[data-testid='accept-call-btn']");
    const rejectBtn = page.locator("[data-testid='reject-call-btn']");

    await expect(acceptBtn).toBeVisible({ timeout: 5000 });
    await expect(rejectBtn).toBeVisible();
    await expect(muteRingtoneBtn).toBeVisible();

    // 点击静音铃声
    await muteRingtoneBtn.click();

    // 点击拒绝通话
    await rejectBtn.click();

    // 验证弹窗消失
    await expect(acceptBtn).not.toBeVisible({ timeout: 5000 });
  });

  test("4. 验证已连接通话舞台 (Connected Call Stage)、折叠/展开与挂断流程", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击进入与 Bob 的私信
    const dmItem = page.locator("[data-testid='dm-item-channel_dm_bob']");
    await expect(dmItem).toBeVisible({ timeout: 10000 });
    await dmItem.click();

    // 直接通过 __dmCallStore 设置通话已接通状态
    await page.evaluate(() => {
      const store = (window as any).__dmCallStore;
      if (store) {
        store.getState().startOutgoing({
          channelId: "channel_dm_bob",
          targetUser: {
            id: "usr_mock_bob",
            username: "Bob#12345",
            displayName: "Bob",
          },
          hasVideo: false,
        });
        store.getState().setConnected();
      }
    });

    // 验证全尺寸活跃通话舞台渲染
    const activeStage = page.locator("[data-testid='dm-active-call-stage']");
    await expect(activeStage).toBeVisible({ timeout: 5000 });

    // 验证浮动控制底座控制项存在（静音、拒听、摄像头、屏幕共享、挂断等）
    await expect(page.locator("[data-testid='dm-mute-btn']")).toBeVisible();
    await expect(page.locator("[data-testid='dm-deafen-btn']")).toBeVisible();
    await expect(page.locator("[data-testid='dm-camera-btn']")).toBeVisible();
    await expect(page.locator("[data-testid='dm-screenshare-btn']")).toBeVisible();
    const disconnectBtn = page.locator("[data-testid='dm-disconnect-call-btn']");
    await expect(disconnectBtn).toBeVisible();

    // 测试舞台折叠：点击折叠按钮
    const collapseBtn = page.locator("[data-testid='dm-collapse-stage-btn']");
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();

    // 验证舞台折叠为顶部紧凑条
    const collapsedBar = page.locator("[data-testid='dm-call-collapsed-bar']");
    await expect(collapsedBar).toBeVisible({ timeout: 5000 });
    await expect(collapsedBar).toContainText("Bob");

    // 测试舞台展开：点击展开按钮
    const expandBtn = page.locator("[data-testid='dm-expand-stage-btn']");
    await expect(expandBtn).toBeVisible();
    await expandBtn.click();

    // 验证舞台恢复全尺寸
    await expect(activeStage).toBeVisible({ timeout: 5000 });

    // 点击挂断按钮结束通话
    await disconnectBtn.click();

    // 验证通话舞台关闭
    await expect(activeStage).not.toBeVisible({ timeout: 5000 });
  });

  test("5. 验证切离私信时唤起画中画浮窗 (Picture-in-Picture) 及返回通话视窗", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击进入与 Bob 的私信
    const dmItem = page.locator("[data-testid='dm-item-channel_dm_bob']");
    await expect(dmItem).toBeVisible({ timeout: 10000 });
    await dmItem.click();

    // 设置为已连接通话
    await page.evaluate(() => {
      const store = (window as any).__dmCallStore;
      if (store) {
        store.getState().startOutgoing({
          channelId: "channel_dm_bob",
          targetUser: {
            id: "usr_mock_bob",
            username: "Bob#12345",
            displayName: "Bob",
          },
          hasVideo: false,
        });
        store.getState().setConnected();
      }
    });

    // 确认已进入通话
    await expect(
      page.locator("[data-testid='dm-active-call-stage']"),
    ).toBeVisible({ timeout: 5000 });

    // 点击左侧“好友”标签页切离当前私信频道
    const friendsTabBtn = page.locator("[data-testid='friends-tab-btn']");
    await expect(friendsTabBtn).toBeVisible({ timeout: 5000 });
    await friendsTabBtn.click();

    // 验证画中画小窗呈现
    const pipWindow = page.locator("[data-testid='dm-pip-window']");
    await expect(pipWindow).toBeVisible({ timeout: 5000 });
    await expect(pipWindow).toContainText("Bob");

    // 验证画中画上的展开/返回通话按钮
    const pipExpandBtn = page.locator("[data-testid='dm-pip-expand-btn']");
    await expect(pipExpandBtn).toBeVisible();

    // 点击返回通话视窗
    await pipExpandBtn.click();

    // 验证回到私信聊天并呈现通话舞台
    await expect(
      page.locator("[data-testid='dm-active-call-stage']"),
    ).toBeVisible({ timeout: 5000 });
    await expect(pipWindow).not.toBeVisible();
  });
});
