import { test, expect } from "@playwright/test";
import { Message } from "@tescord/types";

test.describe("UI 右键菜单与交互体验专项验收 (Context Menu & Interaction Features)", () => {
  const mockMessages: Message[] = [
    {
      id: "msg_menu_1",
      channelId: "c_text_1",
      authorId: "u_alice",
      author: {
        id: "u_alice",
        username: "Alice",
        displayName: "爱丽丝",
        avatarUrl: null,
        status: "ONLINE",
      },
      content: "Hello from Alice! 这是测试消息。",
      sequence: 1,
      isEncrypted: false,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: new Date(Date.now() - 60000).toISOString(),
    },
    {
      id: "msg_menu_2",
      channelId: "c_text_1",
      authorId: "e2e_tester_user",
      author: {
        id: "e2e_tester_user",
        username: "tester_pro",
        displayName: "专业测试员",
        avatarUrl: null,
        status: "ONLINE",
      },
      content: "Hello from me! 这是我自己的消息，用于验证删除二次确认与悬浮栏。",
      sequence: 2,
      isEncrypted: false,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: new Date().toISOString(),
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
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
      // 禁用后台 WebSocket 避免信令覆盖 Mock 数据
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
          id: "e2e_tester_user",
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
            id: "g_menu_test",
            name: "右键菜单测试服务器",
            icon: null,
            ownerId: "e2e_tester_user",
            channels: [
              {
                id: "c_text_1",
                name: "测试文字频道",
                type: "TEXT",
                position: 0,
                guildId: "g_menu_test",
              },
            ],
            members: [
              {
                userId: "e2e_tester_user",
                user: {
                  id: "e2e_tester_user",
                  username: "tester_pro",
                  displayName: "专业测试员",
                },
              },
              {
                userId: "u_alice",
                user: {
                  id: "u_alice",
                  username: "Alice",
                  displayName: "爱丽丝",
                },
              },
            ],
          },
        ]),
      });
    });

    await page.route("**/api/channels/**/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockMessages),
      });
    });

    await page.route("**/api/users/@me/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outputVolume: 100,
            language: "zh-CN",
            mutedGuilds: {},
            guildNotificationSettings: {},
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

    await page.route("**/api/users/@me/relationships", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });
  });

  test("A1: 服务器列表空白区域右键菜单 - 新建服务器与加入服务器", async ({ page }) => {
    await page.goto("/");

    // 找到左侧服务器列表 aside
    const sidebar = page.locator('aside[data-testid="servers-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 在侧边栏靠近底部的空白处右键点击
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).not.toBeNull();
    if (sidebarBox) {
      await page.mouse.click(
        sidebarBox.x + sidebarBox.width / 2,
        sidebarBox.y + sidebarBox.height - 15,
        { button: "right" },
      );
    }

    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 检查“新建服务器”与“加入服务器”菜单项
    const createServerItem = page.locator('[role="menuitem"]', {
      hasText: /新建服务器|创建服务器/i,
    });
    const joinServerItem = page.locator('[role="menuitem"]', {
      hasText: /加入服务器/i,
    });

    await expect(createServerItem).toBeVisible();
    await expect(joinServerItem).toBeVisible();

    // 点击“新建服务器”打开模态框
    await createServerItem.click();
    await expect(contextMenu).not.toBeVisible();

    // 检查创建服务器模态框弹出
    const modalHeading = page.getByRole("heading", {
      name: /创建你的专属服务器|创建你的服务器|新建服务器/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 点击右上角关闭按钮关闭模态框
    const closeBtn = page.locator('button[title*="关闭"]');
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();
  });

  test("A2: 服务器右键菜单 - 将服务器静音与通知设定", async ({ page }) => {
    await page.goto("/");

    const serverButton = page
      .getByRole("button", { name: /右键菜单测试服务器/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });

    // 右键服务器图标
    await serverButton.click({ button: "right" });
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 验证“将服务器静音”和“通知设定”存在
    const muteServerItem = page.locator('[role="menuitem"]', {
      hasText: /将服务器静音|静音服务器/i,
    });
    const notifSettingsItem = page.locator('[role="menuitem"]', {
      hasText: /通知设定|通知设置/i,
    });

    await expect(muteServerItem).toBeVisible();
    await expect(notifSettingsItem).toBeVisible();

    // 悬停在“将服务器静音”以展开子菜单
    await muteServerItem.hover();
    const mute15mItem = page.locator('[role="menuitem"]', {
      hasText: /15 分钟|15分钟/i,
    });
    await expect(mute15mItem).toBeVisible({ timeout: 3000 });

    // 点击静音 15 分钟
    await mute15mItem.click();
    await expect(contextMenu).not.toBeVisible();

    // 再次右键该服务器，此时静音选项应变为“取消静音”
    await serverButton.click({ button: "right" });
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const unmuteServerItem = page.locator('[role="menuitem"]', {
      hasText: /取消静音/i,
    });
    await expect(unmuteServerItem).toBeVisible();

    // 点击取消静音
    await unmuteServerItem.click();
    await expect(contextMenu).not.toBeVisible();

    // 再次右键打开，检查“通知设定”子菜单
    await serverButton.click({ button: "right" });
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const notifSubTrigger = page.locator('[role="menuitem"]', {
      hasText: /通知设定|通知设置/i,
    });
    await notifSubTrigger.hover();

    const notifMentionsItem = page.locator(
      '[role="menuitemcheckbox"], [role="menuitemradio"]',
      { hasText: /只有\s*@mentions|仅提及/i },
    );
    await expect(notifMentionsItem).toBeVisible({ timeout: 3000 });

    // 检查“禁用 @everyone 和 @here”复选框
    const suppressEveryoneItem = page.locator('[role="menuitemcheckbox"]', {
      hasText: /禁用 @everyone 和 @here/i,
    });
    await expect(suppressEveryoneItem).toBeVisible();

    // 点击切换复选框
    await suppressEveryoneItem.click();
  });

  test("B: 频道列表右键菜单 - 静音频道与取消静音切换", async ({ page }) => {
    await page.goto("/");

    // 点击进入服务器
    const serverButton = page
      .getByRole("button", { name: /右键菜单测试服务器/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 寻找文字频道按钮
    const channelBtn = page
      .getByRole("button", { name: /测试文字频道/i })
      .first();
    await expect(channelBtn).toBeVisible({ timeout: 5000 });

    // 右键频道
    await channelBtn.click({ button: "right" });
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 验证“静音频道”菜单项
    const muteChannelItem = page.locator('[role="menuitem"]', {
      hasText: /静音频道/i,
    });
    await expect(muteChannelItem).toBeVisible();

    // 悬停展开子菜单并点击“15 分钟”
    await muteChannelItem.hover();
    const mute15m = page.locator('[role="menuitem"]', {
      hasText: /15 分钟|15分钟/i,
    });
    await expect(mute15m).toBeVisible({ timeout: 3000 });
    await mute15m.click();
    await expect(contextMenu).not.toBeVisible();

    // 再次右键该频道，验证原本的“静音频道”已直接变成“取消静音”
    await channelBtn.click({ button: "right" });
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    const unmuteChannelItem = page.locator('[role="menuitem"]', {
      hasText: /取消静音频道|取消静音/i,
    });
    await expect(unmuteChannelItem).toBeVisible();

    // 点击取消静音
    await unmuteChannelItem.click();
    await expect(contextMenu).not.toBeVisible();
  });

  test("C1: 消息悬浮工具栏 Emoji 按钮正常唤起表情选择器", async ({ page }) => {
    await page.goto("/");

    const serverButton = page
      .getByRole("button", { name: /右键菜单测试服务器/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const channelBtn = page
      .getByRole("button", { name: /测试文字频道/i })
      .first();
    await expect(channelBtn).toBeVisible({ timeout: 5000 });
    await channelBtn.click();

    // 等待消息卡片可见
    const messageItem = page.locator('[data-message-item]').first();
    await expect(messageItem).toBeVisible({ timeout: 5000 });

    // 鼠标悬停在消息卡片上
    await messageItem.hover();

    // 验证悬浮操作栏出现
    const floatingBar = messageItem.locator(
      '[data-testid="message-floating-bar"]',
    );
    await expect(floatingBar).toBeVisible({ timeout: 3000 });

    // 点击 Emoji 按钮 (data-testid="btn-add-reaction")
    const emojiBtn = messageItem.locator('[data-testid="btn-add-reaction"]');
    await expect(emojiBtn).toBeVisible();
    await emojiBtn.click();

    // 验证表情选择器弹出且处于可见状态（未被父级 overflow-hidden 截断）
    const emojiPicker = page.locator('[data-testid="emoji-picker-popover"]');
    await expect(emojiPicker).toBeVisible({ timeout: 3000 });

    // 验证表情内容呈现
    const firstEmoji = emojiPicker.locator("button").first();
    await expect(firstEmoji).toBeVisible();

    // 按 Escape 关闭表情浮层
    await page.keyboard.press("Escape");
    await expect(emojiPicker).not.toBeVisible();
  });

  test("C2: 消息删除两步点击二次确认", async ({ page }) => {
    await page.goto("/");

    const serverButton = page
      .getByRole("button", { name: /右键菜单测试服务器/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const channelBtn = page
      .getByRole("button", { name: /测试文字频道/i })
      .first();
    await expect(channelBtn).toBeVisible({ timeout: 5000 });
    await channelBtn.click();

    // 第二条是用户自己的消息，具有删除按钮
    const ownMessageItem = page.locator('[data-message-item]').nth(1);
    await expect(ownMessageItem).toBeVisible({ timeout: 5000 });

    // 悬停以显示悬浮工具栏
    await ownMessageItem.hover();
    const deleteBtn = ownMessageItem.locator(
      '[data-testid="btn-delete-message"]',
    );
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });

    // 第一次点击
    await deleteBtn.click();

    // 应该展示“确认删除?”文案
    await expect(ownMessageItem.locator("text=/确认删除\\?/i")).toBeVisible({
      timeout: 2000,
    });

    // 再次在消息上右键测试右键菜单的两步删除确认
    await ownMessageItem.click({ button: "right" });
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    const deleteMenuItem = page.locator('[role="menuitem"]', {
      hasText: /删除消息/i,
    });
    await expect(deleteMenuItem).toBeVisible();

    // 第一次点击右键菜单的删除项
    await deleteMenuItem.click();

    // 菜单项应原地更新为“确认删除?”
    const confirmDeleteMenuItem = page.locator('[role="menuitem"]', {
      hasText: /确认删除\?/i,
    });
    await expect(confirmDeleteMenuItem).toBeVisible();
  });

  test("C3: 聊天区域用户头像右键菜单 - 无独立音量，具备新增好友、传送消息与开始通话", async ({ page }) => {
    await page.goto("/");

    const serverButton = page
      .getByRole("button", { name: /右键菜单测试服务器/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const channelBtn = page
      .getByRole("button", { name: /测试文字频道/i })
      .first();
    await expect(channelBtn).toBeVisible({ timeout: 5000 });
    await channelBtn.click();

    // 在聊天列表的第一条消息头像（Alice）上右键
    const avatar = page.locator('[data-message-item] img').first();
    await expect(avatar).toBeVisible({ timeout: 5000 });
    await avatar.click({ button: "right" });

    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });

    // 1. 验证坚决不包含“用户音量”或“用户独立音量”
    const volumeSlider = page.locator('input[type="range"]');
    await expect(volumeSlider).toHaveCount(0);
    const volumeText = page.locator('[role="menuitem"]', {
      hasText: /用户音量|用户独立音量/i,
    });
    await expect(volumeText).toHaveCount(0);

    // 2. 验证具备“传送消息”、“开始通话”、“新增好友”
    const sendMessageItem = page.locator('[role="menuitem"]', {
      hasText: /传送消息|发送私信/i,
    });
    const startCallItem = page.locator('[role="menuitem"]', {
      hasText: /开始.*通话|发起通话/i,
    });
    const friendActionItem = page.locator('[role="menuitem"]', {
      hasText: /新增好友|添加好友/i,
    });

    await expect(sendMessageItem).toBeVisible();
    await expect(startCallItem).toBeVisible();
    await expect(friendActionItem).toBeVisible();

    // 按 Escape 关闭菜单
    await page.keyboard.press("Escape");
    await expect(contextMenu).not.toBeVisible();
  });
});
