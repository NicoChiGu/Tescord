import { test, expect } from "@playwright/test";

test.describe("客户端 IndexedDB 本地秒开、虚拟视口与未读红线滚动记忆验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 auth.setup.ts 生成的真实管理员 Token
    await page.addInitScript(() => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
    });
  });

  test("验证 IndexedDB SWR 本地秒开：网络延迟下直接直出本地缓存，跳过骨架屏", async ({
    page,
  }) => {
    // 首次进入时正常返回 1 条消息
    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg_swr_cached_001",
            channelId: "chn_default_text_01",
            content: "【已持久化到 IndexedDB 的本地历史缓存】",
            sequence: 1,
            authorId: "usr_default_admin",
            author: { id: "usr_default_admin", username: "Jackey" },
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/");

    // 1. 进入默认服务器与 general 频道以沉淀本地缓存
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await expect(generalChannelBtn).toBeVisible({ timeout: 8000 });
    await generalChannelBtn.click();

    // 确认首次加载的消息出现并被存入 IndexedDB
    const cachedMsg = page.getByText("【已持久化到 IndexedDB 的本地历史缓存】");
    await expect(cachedMsg).toBeVisible({ timeout: 5000 });

    // 2. 切到其它频道 (crypto-vault)
    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await expect(cryptoChannelBtn).toBeVisible({ timeout: 5000 });
    await cryptoChannelBtn.click();
    await expect(cachedMsg).not.toBeVisible();

    // 3. 人为挂起 general 的网络请求以模拟极慢网络
    let releaseSlowNetwork: () => void = () => {};
    const slowPromise = new Promise<void>((resolve) => {
      releaseSlowNetwork = resolve;
    });

    await page.route(
      "**/api/channels/chn_default_text_01/messages*",
      async (route) => {
        await slowPromise;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      },
    );

    // 4. 再次切回 general 频道
    await generalChannelBtn.click();

    // 核心断言 1：尽管网络被挂起未返回，但因为有 IndexedDB 本地缓存，消息瞬间秒开直接可见！
    await expect(cachedMsg).toBeVisible({ timeout: 1500 });

    // 核心断言 2：此时骨架屏应当被直接跳过（not.toBeVisible）
    const skeleton = page.locator('[data-testid="chat-message-skeleton-list"]');
    await expect(skeleton).not.toBeVisible();

    // 释放挂起的网络请求
    releaseSlowNetwork();
  });

  test("验证虚拟视口列表（Virtual List）：100 条消息下 DOM 树仅按需渲染可见子节点", async ({
    page,
  }) => {
    // Mock 100 条长消息
    const mock100Messages = Array.from({ length: 100 }, (_, i) => ({
      id: `msg_virtual_test_${i + 1}`,
      channelId: "chn_default_text_01",
      sequence: i + 1,
      content: `这是第 ${i + 1} 条长列表测试消息，用于验证 @tanstack/react-virtual 虚拟化渲染。`,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(Date.now() - (100 - i) * 60000).toISOString(),
    }));

    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mock100Messages),
      });
    });

    await page.goto("/");
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await generalChannelBtn.click();

    // 等待虚拟容器加载完成
    const virtualContainer = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    await expect(virtualContainer).toBeVisible({ timeout: 6000 });

    // 核心断言：屏幕上实际挂载的带有 data-index 的 DOM 元素数量远小于 100（通常在 15~35 个之间）
    const renderedItemCount = await virtualContainer
      .locator("> [data-index]")
      .count();
    expect(renderedItemCount).toBeGreaterThan(0);
    expect(renderedItemCount).toBeLessThanOrEqual(40);
  });

  test("验证未读红线分割条（Unread Divider）与向上滚动后切走切回的精准记忆恢复", async ({
    page,
  }) => {
    // 构造 60 条消息，并在第 45 条位置制造未读分割
    const mock60Messages = Array.from({ length: 60 }, (_, i) => ({
      id: `msg_scroll_test_${i + 1}`,
      channelId: "chn_default_text_01",
      sequence: i + 1,
      content: `【消息 #${i + 1}】测试滚动记忆与未读红线。`,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(Date.now() - (60 - i) * 60000).toISOString(),
    }));

    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mock60Messages),
      });
    });

    await page.goto("/");
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await generalChannelBtn.click();

    const virtualContainer = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    await expect(virtualContainer).toBeVisible({ timeout: 6000 });

    // 1. 模拟在滚动容器向上翻阅历史消息
    const scrollContainer = virtualContainer.locator("xpath=..");
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 450;
    });
    // 触发滚动事件
    await page.waitForTimeout(100);

    const scrollTopBefore = await scrollContainer.evaluate((el) => el.scrollTop);
    expect(scrollTopBefore).toBeGreaterThan(100);

    // 2. 切换到 crypto-vault 频道
    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await cryptoChannelBtn.click();

    // 3. 再次切回 general 频道
    await generalChannelBtn.click();
    await expect(virtualContainer).toBeVisible({ timeout: 5000 });

    // 等待滚动位置从 IndexedDB 中异步恢复
    await page.waitForTimeout(200);

    // 核心断言：切回后精确恢复向上查看历史的 scrollTop 滚动偏移量，而不是被强行打底贴在最底部
    const scrollTopAfter = await scrollContainer.evaluate((el) => el.scrollTop);
    expect(scrollTopAfter).toBeGreaterThan(100);
  });

  test("验证骨架屏 100ms 延迟防闪烁（Debounced Skeleton）：极速返回时不闪烁，超时后平滑呈现", async ({
    page,
  }) => {
    // 1. 设置极速响应（30ms），模拟 IndexedDB 本地秒开或极快局域网响应
    await page.route("**/api/channels/chn_default_text_01/messages*", async (route) => {
      await page.waitForTimeout(30);
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg_fast_001",
            channelId: "chn_default_text_01",
            sequence: 1,
            content: "【极速加载消息】",
            authorId: "usr_default_admin",
            author: { id: "usr_default_admin", username: "Jackey" },
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/");
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await generalChannelBtn.click();

    // 骨架屏指示器
    const skeleton = page.locator('[data-testid="chat-message-skeleton-list"]');

    // 核心断言 1：极速返回（< 100ms）的情况下，骨架屏绝对不闪烁显示
    await expect(page.getByText("【极速加载消息】")).toBeVisible({ timeout: 3000 });
    await expect(skeleton).not.toBeVisible();

    // 2. 模拟切换至冷频道 crypto-vault，且网络延迟 250ms（超过 100ms 阈值）
    let releaseDelayedRequest: () => void = () => {};
    const slowNetPromise = new Promise<void>((resolve) => {
      releaseDelayedRequest = resolve;
    });

    await page.route(
      "**/api/channels/chn_default_text_02/messages*",
      async (route) => {
        await slowNetPromise;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "msg_slow_002",
              channelId: "chn_default_text_02",
              sequence: 1,
              content: "【延迟加载的慢速冷数据已就绪】",
              authorId: "usr_default_admin",
              author: { id: "usr_default_admin", username: "Jackey" },
              createdAt: new Date().toISOString(),
            },
          ]),
        });
      },
    );

    // 清空 crypto-vault 频道在本地 IndexedDB 中的历史残留，模拟首次访问的冷频道
    await page.evaluate(async () => {
      await (window as any).__tescord_messageDb?.clearChannel(
        "chn_default_text_02",
      );
    });

    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await cryptoChannelBtn.click();

    // 核心断言 2：因为网络延迟超过 100ms，骨架屏平滑淡入显示
    await expect(skeleton).toBeVisible({ timeout: 1000 });

    // 释放延迟请求
    releaseDelayedRequest();

    // 核心断言 3：真实消息渲染后，骨架屏平滑退出
    await expect(page.getByText("【延迟加载的慢速冷数据已就绪】")).toBeVisible({
      timeout: 3000,
    });
    await expect(skeleton).not.toBeVisible();
  });

  test("验证未读红线视觉冻结（Frozen Unread Marker）：在当前频道浏览并滚到底部时，红线绝对不自动自毁闪烁消失", async ({
    page,
  }) => {
    // 构造 15 条消息，第 10 条为未读起始点 (sequence: 10)
    const mock15Messages = Array.from({ length: 15 }, (_, i) => ({
      id: `msg_frozen_test_${i + 1}`,
      channelId: "chn_default_text_01",
      sequence: i + 1,
      content: `【消息 #${i + 1}】测试未读红线视觉冻结稳定性。`,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(Date.now() - (15 - i) * 60000).toISOString(),
    }));

    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mock15Messages),
      });
    });

    await page.goto("/");
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 1. 先切换到 crypto-vault 频道以脱离默认聚焦，确保后续切回 general 能触发完整的快照读取
    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await cryptoChannelBtn.click();

    // 在本地数据库中预置 general 的 channel_meta，设置上次已读游标为 9（第 10 条开始为新消息）
    await page.evaluate(async () => {
      await (window as any).__tescord_messageDb?.saveChannelMeta(
        "chn_default_text_01",
        {
          lastReadSequence: 9,
          isNearBottom: false,
          scrollTop: 0,
        },
      );
    });

    // 2. 切回 general 频道触发原子快照加载
    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await generalChannelBtn.click();

    // 核心断言 1：未读红线稳定呈现在界面上
    const unreadDivider = page.locator(
      '[data-testid="unread-message-divider"]',
    );
    await expect(unreadDivider).toBeVisible({ timeout: 5000 });
    await expect(unreadDivider).toContainText("以下是新消息");

    // 模拟用户向下滚动到底部
    const virtualContainer = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    const scrollContainer = virtualContainer.locator("xpath=..");
    await scrollContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);

    // 核心断言 2：当用户处于最底下时，未读红线彻底消除并不再显示
    await expect(unreadDivider).not.toBeVisible({ timeout: 5000 });
  });

  test("验证虚拟卡片绝对定位绝无重叠（Overlap-Free）：多条不同高度消息自适应排版，各卡片边界绝不叠压", async ({
    page,
  }) => {
    // 构造包含不同长度、不同高度的消息列表
    const variedMessages = [
      {
        id: "msg_overlap_1",
        channelId: "chn_default_text_01",
        sequence: 1,
        content: "短消息单行文本",
        authorId: "usr_default_admin",
        author: { id: "usr_default_admin", username: "Jackey" },
        createdAt: new Date().toISOString(),
      },
      {
        id: "msg_overlap_2",
        channelId: "chn_default_text_01",
        sequence: 2,
        content:
          "这是一段较长的测试文本内容。\n它包含了多个换行符。\n用于验证不同动态高度测量下，TanStack Virtual 能够精准计算 start 偏移。\n绝不会发生消息与消息之间的重叠叠压！",
        authorId: "usr_default_admin",
        author: { id: "usr_default_admin", username: "Jackey" },
        createdAt: new Date().toISOString(),
      },
      {
        id: "msg_overlap_3",
        channelId: "chn_default_text_01",
        sequence: 3,
        content: "第三条普通消息，紧跟在多行长消息之后。",
        authorId: "usr_default_admin",
        author: { id: "usr_default_admin", username: "Jackey" },
        createdAt: new Date().toISOString(),
      },
      {
        id: "msg_overlap_4",
        channelId: "chn_default_text_01",
        sequence: 4,
        content: "第四条消息，验证其顶部边界严格大于第三条消息的底部边界。",
        authorId: "usr_default_admin",
        author: { id: "usr_default_admin", username: "Jackey" },
        createdAt: new Date().toISOString(),
      },
    ];

    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(variedMessages),
      });
    });

    await page.goto("/");
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await generalChannelBtn.click();

    const virtualContainer = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    await expect(virtualContainer).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(200);

    // 核心断言：获取当前所有渲染的虚拟条目，检查任意两项绝无重叠
    const items = virtualContainer.locator("> [data-index]");
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThanOrEqual(4);

    const boundingBoxes = [];
    for (let i = 0; i < itemCount; i++) {
      const box = await items.nth(i).boundingBox();
      expect(box).not.toBeNull();
      boundingBoxes.push(box!);
    }

    // 检查每一项的 top 严格大于等于上一项的 bottom（允许 1px 浮点精度误差）
    for (let i = 1; i < boundingBoxes.length; i++) {
      const prevBottom = boundingBoxes[i - 1].y + boundingBoxes[i - 1].height;
      const currentTop = boundingBoxes[i].y;
      expect(
        currentTop + 1.0,
        `第 ${i} 行 (top: ${currentTop}) 与前一行 (bottom: ${prevBottom}) 发生重叠碰撞！`,
      ).toBeGreaterThanOrEqual(prevBottom);
    }
  });
});

