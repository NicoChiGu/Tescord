import { test, expect } from "@playwright/test";
import { Message } from "@tescord/types";

test.describe("移动端触屏 Discord 风格下弹 Drawer 交互验收测试 (Mobile Action Drawer E2E)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  const mockMessages: Message[] = [
    {
      id: "msg_mobile_1",
      channelId: "c_mobile_text",
      authorId: "u_alice",
      author: {
        id: "u_alice",
        username: "Alice",
        displayName: "爱丽丝",
        avatarUrl: null,
        status: "ONLINE",
      },
      content: "Hello from Alice! 移动端长按测试消息。",
      sequence: 1,
      isEncrypted: false,
      isPinned: false,
      reactions: [],
      attachments: [],
      createdAt: new Date(Date.now() - 60000).toISOString(),
    },
    {
      id: "msg_mobile_2",
      channelId: "c_mobile_text",
      authorId: "e2e_mobile_user",
      author: {
        id: "e2e_mobile_user",
        username: "mobile_tester",
        displayName: "移动端测试员",
        avatarUrl: null,
        status: "ONLINE",
      },
      content: "这是我发送的消息，用于测试原地危险删除确认与操作抽屉。",
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
        localStorage.getItem("tescord_e2e_access_token") || "mock_mobile_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "e2e_mobile_user",
          username: "mobile_tester",
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
          id: "e2e_mobile_user",
          username: "mobile_tester",
          displayName: "移动端测试员",
          email: "mobile_tester@tescord.local",
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
            id: "g_mobile_test",
            name: "移动抽屉测试服务器",
            icon: null,
            ownerId: "e2e_mobile_user",
            channels: [
              {
                id: "c_mobile_text",
                name: "日常闲聊",
                type: "TEXT",
                position: 0,
                guildId: "g_mobile_test",
              },
            ],
            members: [
              {
                userId: "e2e_mobile_user",
                user: {
                  id: "e2e_mobile_user",
                  username: "mobile_tester",
                  displayName: "移动端测试员",
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
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mutedChannels: {},
          theme: "dark",
        }),
      });
    });

    await page.route("**/api/channels/**/reactions/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route("**/api/channels/**/messages/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });
  });

  test("长按消息成功唤起 Discord 风格下弹 Drawer 并包含快捷 Reaction 表情栏与操作列表", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 定位第一条消息
    const messageItem = page.locator('[data-message-id="msg_mobile_1"]');
    await expect(messageItem).toBeVisible({ timeout: 10000 });

    // 触发移动端长按呼出抽屉
    await messageItem.dispatchEvent("contextmenu");

    // 验证底部 Action Drawer 弹窗出现
    const drawer = page.locator('[data-testid="mobile-action-sheet"]');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // 验证顶部拖拽把手指示条
    const dragHandle = drawer.locator('[data-testid="drawer-drag-handle"]');
    await expect(dragHandle).toBeVisible();

    // 验证 8 个快捷 Emoji 反应栏存在
    const quickReactions = drawer.locator(
      '[data-testid="drawer-quick-reactions"]',
    );
    await expect(quickReactions).toBeVisible();
    await expect(
      drawer.locator('[data-testid="quick-reaction-👍"]'),
    ).toBeVisible();
    await expect(
      drawer.locator('[data-testid="quick-reaction-❤️"]'),
    ).toBeVisible();

    // 验证操作列表项
    await expect(
      drawer.locator('[data-testid="mobile-action-reply"]'),
    ).toBeVisible();
    await expect(
      drawer.locator('[data-testid="mobile-action-copy"]'),
    ).toBeVisible();

    // 点击遮罩或按 Escape 键关闭
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 3000 });
  });

  test("点击快捷 Emoji 表情能正确触发反应并平滑关闭 Drawer", async ({
    page,
  }) => {
    let reactionAdded = false;
    await page.route("**/api/channels/**/reactions/**", (route) => {
      reactionAdded = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const messageItem = page.locator('[data-message-id="msg_mobile_1"]');
    await expect(messageItem).toBeVisible({ timeout: 10000 });

    // 长按呼出
    await messageItem.dispatchEvent("contextmenu");

    const drawer = page.locator('[data-testid="mobile-action-sheet"]');
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    // 点击 👍 表情
    const thumbsUpBtn = drawer.locator('[data-testid="quick-reaction-👍"]');
    await thumbsUpBtn.click();

    // 抽屉应自动关闭
    await expect(drawer).not.toBeVisible({ timeout: 3000 });
    expect(reactionAdded).toBe(true);
  });

  test("自身消息长按显示删除按钮，且支持原地红色二次确认 (Inline Confirm)", async ({
    page,
  }) => {
    let messageDeleted = false;
    await page.route("**/api/channels/**/messages/**", (route) => {
      if (route.request().method() === "DELETE") {
        messageDeleted = true;
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 定位第二条（属于自己的）消息
    const myMessage = page.locator('[data-message-id="msg_mobile_2"]');
    await expect(myMessage).toBeVisible({ timeout: 10000 });

    // 长按呼出
    await myMessage.dispatchEvent("contextmenu");

    const drawer = page.locator('[data-testid="mobile-action-sheet"]');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // 验证删除按钮存在
    const deleteBtn = drawer.locator('[data-testid="mobile-action-delete"]');
    await expect(deleteBtn).toBeVisible();

    // 第一次点击：触发原地确认状态（背景变红，文字变为“确认删除？”）
    await deleteBtn.click();
    await expect(deleteBtn).toHaveText(/确认删除\?/);

    // 第二次点击：正式执行删除并关闭
    await deleteBtn.click();
    await expect(drawer).not.toBeVisible({ timeout: 3000 });
    expect(messageDeleted).toBe(true);
  });

  test("移动端侧边栏频道长按唤起下弹 Drawer，且支持静音时长无缝下钻与返回", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 打开移动端左侧导航抽屉
    const toggleBtn = page.locator('[data-testid="toggle-mobile-drawer-btn"]');
    await expect(toggleBtn).toBeVisible({ timeout: 10000 });
    await toggleBtn.click();

    // 定位目标频道按钮
    const channelItem = page.getByTestId("channel-button-日常闲聊");
    await expect(channelItem).toBeVisible({ timeout: 5000 });

    // 触发长按呼出响应式抽屉
    await channelItem.dispatchEvent("contextmenu");

    // 验证响应式 ActionDrawer 出现
    const drawer = page.locator('[data-testid="responsive-action-drawer"]');
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // 验证拖拽把手
    await expect(
      drawer.locator('[data-testid="drawer-drag-handle"]'),
    ).toBeVisible();

    // 查找并点击“静音频道”二级菜单触发项
    const muteTrigger = drawer.getByRole("button", { name: /静音频道/i });
    await expect(muteTrigger).toBeVisible();
    await muteTrigger.click();

    // 验证下钻进入子页面：展示“返回”按钮与具体静音时长选项（如 15 分钟）
    const backBtn = drawer.locator('[data-testid="drawer-back-button"]');
    await expect(backBtn).toBeVisible({ timeout: 5000 });
    await expect(backBtn).toHaveText(/静音频道/i);

    const durationOption = drawer.locator("button", { hasText: /15\s*分钟/i });
    await expect(durationOption).toBeVisible();

    // 点击返回按钮，回退至主菜单
    await backBtn.click();
    await expect(muteTrigger).toBeVisible();

    // 按 Escape 键平滑关闭抽屉
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 3000 });
  });
});
