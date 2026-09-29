import { test, expect } from "@playwright/test";

test.describe("移动端与平板设备文字频道动态加载与视口优化验收", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
    });
  });

  test("移动端视口 (390x844)：虚拟列表仅挂载紧凑缓冲节点，DOM 负载严格受控", async ({
    page,
  }) => {
    // 设置移动端屏幕视口
    await page.setViewportSize({ width: 390, height: 844 });

    // Mock 50 条消息
    const mockMessages = Array.from({ length: 50 }, (_, i) => ({
      id: `msg_perf_mobile_${i + 1}`,
      channelId: "chn_default_text_01",
      content: `移动端性能测试消息批次 #${i + 1}：支持 Markdown **粗体** 与 \`代码\` 复用。`,
      sequence: i + 1,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(Date.now() - (50 - i) * 60000).toISOString(),
    }));

    await page.route("**/api/channels/*/messages*", (route) => {
      const channelId = new URL(route.request().url()).pathname.match(
        /\/api\/channels\/([^/]+)\/messages/,
      )?.[1];
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          mockMessages.map((message) => ({ ...message, channelId })),
        ),
      });
    });

    await page.goto("/");

    // 确认虚拟列表容器已挂载
    const container = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    await expect(container).toBeVisible({ timeout: 15000 });

    // 统计当前 DOM 树中实际挂载的消息卡片节点数
    const renderedItems = container.locator("[data-message-id]");
    const count = await renderedItems.count();

    // 优化前：即便可视区只有 5 条，总消息 50 条时 overscan=10 导致实际渲染 20~25+ 条
    // 优化后：移动端阶梯 overscan=3，可视区域约 5 条，实际挂载节点数受控 (<= 14 个，实测约 9 个)
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(14);

    // 移动端先选中消息，再显示该消息的快捷操作入口。
    const firstItem = renderedItems.first();
    await firstItem.click();
    const actionBtn = firstItem.locator('button[title="更多"]');
    await expect(actionBtn).toBeVisible();
  });

  test("平板端触控视口 (820x1180)：触屏交互全面激活，快捷操作面板可直接触控唤出", async ({
    page,
  }) => {
    // 设置平板竖屏视口 (宽度 820px 属于 Tablet 范围)
    await page.setViewportSize({ width: 820, height: 1180 });

    const mockMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `msg_perf_tablet_${i + 1}`,
      channelId: "chn_default_text_01",
      content: `平板触控测试消息 #${i + 1}：测试触控操作与长按面板唤出。`,
      sequence: i + 1,
      authorId: "usr_default_admin",
      author: { id: "usr_default_admin", username: "Jackey" },
      createdAt: new Date(Date.now() - (30 - i) * 60000).toISOString(),
    }));

    await page.route("**/api/channels/*/messages*", (route) => {
      const channelId = new URL(route.request().url()).pathname.match(
        /\/api\/channels\/([^/]+)\/messages/,
      )?.[1];
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          mockMessages.map((message) => ({ ...message, channelId })),
        ),
      });
    });

    await page.goto("/");

    const container = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    const isContainerDirectlyVisible = await container
      .isVisible({ timeout: 4000 })
      .catch(() => false);

    if (!isContainerDirectlyVisible) {
      const openDrawerBtn = page
        .getByTitle("打开频道与服务器抽屉")
        .or(page.getByTestId("toggle-mobile-drawer-btn"))
        .or(page.getByTestId("mobile-open-drawer-btn"))
        .first();
      if (await openDrawerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await openDrawerBtn.click();
      }

      const serverBtn = page
        .getByRole("button", { name: /Tescord 极客总部|极客/i })
        .first();
      await expect(serverBtn).toBeVisible({ timeout: 6000 });
      await serverBtn.click();

      const generalChannelBtn = page.getByRole("button", { name: "general" });
      await expect(generalChannelBtn).toBeVisible({ timeout: 6000 });
      await generalChannelBtn.click();
    }

    await expect(container).toBeVisible({ timeout: 6000 });

    // 虚拟列表首项可能仅露出一条边；选择视口中完整可见的最后一条消息。
    const message = container.locator("[data-message-id]").last();
    await expect(message).toBeInViewport({ ratio: 0.8 });
    const box = await message.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + Math.min(box!.width / 2, 100);
    const y = box!.y + box!.height / 2;
    await message.evaluate(
      (element, { x, y }) => {
        const touch = new Touch({
          identifier: 1,
          target: element,
          clientX: x,
          clientY: y,
        });
        element.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            touches: [touch],
            targetTouches: [touch],
            changedTouches: [touch],
          }),
        );
      },
      { x, y },
    );

    const mobileSheet = page.locator('[data-testid="mobile-action-sheet"]');
    await expect(mobileSheet).toBeVisible({ timeout: 4000 });
    await expect(mobileSheet.getByText("引用回复")).toBeVisible();
  });

  test("桌面端视口 (1280x800)：保留丰富悬浮工具条与丝滑渲染", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const mockMessages = [
      {
        id: "msg_perf_desktop_01",
        channelId: "chn_default_text_01",
        content:
          "桌面端富文本测试消息：[Tescord](https://github.com) **流畅运行**",
        sequence: 1,
        authorId: "usr_default_admin",
        author: { id: "usr_default_admin", username: "Jackey" },
        createdAt: new Date().toISOString(),
      },
    ];

    await page.route("**/api/channels/*/messages*", (route) => {
      const channelId = new URL(route.request().url()).pathname.match(
        /\/api\/channels\/([^/]+)\/messages/,
      )?.[1];
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          mockMessages.map((message) => ({ ...message, channelId })),
        ),
      });
    });

    await page.goto("/");

    const container = page.locator(
      '[data-testid="virtual-message-list-container"]',
    );
    const isContainerDirectlyVisible = await container
      .isVisible({ timeout: 4000 })
      .catch(() => false);

    if (!isContainerDirectlyVisible) {
      const serverBtn = page
        .getByRole("button", { name: /Tescord 极客总部|极客/i })
        .first();
      await expect(serverBtn).toBeVisible({ timeout: 6000 });
      await serverBtn.click();

      const generalChannelBtn = page.getByRole("button", { name: "general" });
      await expect(generalChannelBtn).toBeVisible({ timeout: 6000 });
      await generalChannelBtn.click();
    }

    const msgItem = page.locator('[data-message-id="msg_perf_desktop_01"]');
    await expect(msgItem).toBeVisible({ timeout: 6000 });

    // 桌面端鼠标 hover 时，操作菜单栏正常展示
    await msgItem.hover();
    const replyBtn = msgItem.locator('button[title="引用回复"]');
    await expect(replyBtn).toBeVisible();
  });
});
