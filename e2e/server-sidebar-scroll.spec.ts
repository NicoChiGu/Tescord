import { test, expect } from "@playwright/test";

test.describe("服务器侧边栏超出容器时竖向滚动与滚动条隐藏验收", () => {
  test("当服务器数量超出容器高度时能够平滑竖向滚动，隐藏滚动条，且底部创建/探索操作常驻吸底", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 480 });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // 模拟当前登录用户
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_scroll",
          username: "scroll_tester",
          displayName: "滚动验收员",
          email: "scroll@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // 构造 25 个模拟服务器，确保远超侧边栏容器高度（12 个即达 ~600px，25 个达 ~1400px）
    const mockGuilds = Array.from({ length: 25 }, (_, i) => ({
      id: `guild_scroll_${i + 1}`,
      name: `测试服务器_${i + 1}`,
      ownerId: "e2e_user_scroll",
      iconUrl: null,
      categories: [],
      channels: [
        {
          id: `channel_scroll_${i + 1}_general`,
          name: "常规",
          type: "TEXT",
          guildId: `guild_scroll_${i + 1}`,
          position: 0,
          parentId: null,
        },
      ],
      members: [],
    }));

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockGuilds),
      });
    });

    await page.route("**/api/channels/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // 阻断 WebSocket 网关连接，防止网关 READY 事件推送真实数据库中的公会数据覆盖 mock 的 25 个服务器
    await page.routeWebSocket("**/gateway", (socket) => socket.close());

    await page.goto("/");

    // 1. 等待服务器列表容器呈现
    const serverListContainer = page.locator(
      '[data-testid="server-list-container"]',
    );
    await expect(serverListContainer).toBeVisible({ timeout: 10000 });

    // 2. 验证服务器列表项数量正确渲染
    const serverButtons = serverListContainer.getByRole("button");
    await expect(serverButtons).toHaveCount(25);

    // 3. 验证服务器列表内容高度显著大于容器自身视口高度 (证明内容溢出已生效)
    await expect(async () => {
      const { scrollHeight, clientHeight } = await serverListContainer.evaluate(
        (el) => ({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }),
      );
      expect(scrollHeight).toBeGreaterThan(clientHeight);
    }).toPass({ timeout: 5000 });

    // 4. 验证滚动条被彻底隐藏 (no-scrollbar 类名、scrollbar-width 为 none)
    const isScrollbarHidden = await serverListContainer.evaluate((el) => {
      const style = window.getComputedStyle(el);
      // Firefox & 标准: scrollbar-width: none
      const scrollbarWidth = (style as unknown as { scrollbarWidth?: string })
        .scrollbarWidth;
      // 验证类名中包含 no-scrollbar
      const hasClass = el.classList.contains("no-scrollbar");
      return (
        hasClass && (scrollbarWidth === "none" || scrollbarWidth === undefined)
      );
    });
    expect(isScrollbarHidden).toBe(true);

    // 5. 验证竖向滚动功能顺畅运作：向下滚动前 scrollTop 为 0
    const initialScrollTop = await serverListContainer.evaluate(
      (el) => el.scrollTop,
    );
    expect(initialScrollTop).toBe(0);

    // 滚动 150px
    await serverListContainer.evaluate((el) => {
      el.scrollTop = 150;
    });

    // 等待滚动位置生效
    const scrolledTop = await serverListContainer.evaluate(
      (el) => el.scrollTop,
    );
    expect(scrolledTop).toBe(150);

    // 6. 验证吸底固定模式：底部添加服务器(+)与探索发现按钮常驻可见，无需滚到底部也能直接交互
    const addServerBtn = page.getByRole("button", { name: "创建新服务器" });
    const discoveryBtn = page.locator('[data-testid="open-discovery-btn"]');
    await expect(addServerBtn).toBeVisible();
    await expect(discoveryBtn).toBeVisible();

    // 7. 确保无严重控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("Failed to load resource") &&
        !err.includes("favicon"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("用户可以通过拖拽自由调整服务器排序（个人偏好），且本地持久化与页面刷新后保持最新偏好", async ({
    page,
  }) => {
    const mockGuilds = [1, 2].map((index) => ({
      id: `guild_sort_${index}`,
      name: `排序测试服务器_${index}`,
      ownerId: "usr_default_admin",
      iconUrl: null,
      categories: [],
      channels: [],
      members: [],
    }));
    await page.route("**/api/guilds", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockGuilds),
      }),
    );
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.goto("/");

    const serverListContainer = page.locator(
      '[data-testid="server-list-container"]',
    );
    await expect(serverListContainer).toBeVisible({ timeout: 10000 });

    const serverButtons = serverListContainer.getByRole("button");
    // 等待至少有 2 个服务器加载完毕
    await expect(async () => {
      const count = await serverButtons.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 10000 });

    const initialFirstLabel = await serverButtons
      .nth(0)
      .getAttribute("aria-label");
    const initialSecondLabel = await serverButtons
      .nth(1)
      .getAttribute("aria-label");
    expect(initialFirstLabel).toBeTruthy();
    expect(initialSecondLabel).toBeTruthy();
    expect(initialFirstLabel).not.toEqual(initialSecondLabel);

    // 执行拖拽排序：将第 1 个服务器拖动至第 2 个服务器位置
    const firstButton = serverButtons.nth(0);
    const secondButton = serverButtons.nth(1);

    await firstButton.dragTo(secondButton, { steps: 10 });

    // 验证顺序已即时交换响应：原本的第 2 项成为第 1 项
    await expect(serverButtons.nth(0)).toHaveAttribute(
      "aria-label",
      initialSecondLabel!,
      { timeout: 5000 },
    );
    await expect(serverButtons.nth(1)).toHaveAttribute(
      "aria-label",
      initialFirstLabel!,
    );

    // 验证本地持久化设置已记录用户个人排序偏好
    const settingsStr = await page.evaluate(() =>
      localStorage.getItem("tescord_user_settings"),
    );
    expect(settingsStr).not.toBeNull();
    const settingsObj = JSON.parse(settingsStr!);
    expect(Array.isArray(settingsObj?.state?.guildPositions)).toBe(true);

    // 验证页面刷新后偏好持久有效
    await page.reload();
    await expect(serverListContainer).toBeVisible({ timeout: 10000 });
    const refreshedServerButtons = serverListContainer.getByRole("button");
    await expect(refreshedServerButtons.nth(0)).toHaveAttribute(
      "aria-label",
      initialSecondLabel!,
    );
    await expect(refreshedServerButtons.nth(1)).toHaveAttribute(
      "aria-label",
      initialFirstLabel!,
    );

    // 验证点击切换与右键菜单交互未受拖拽干扰
    const targetServerBtn = refreshedServerButtons.nth(0);
    await targetServerBtn.click({ button: "right" });
    const contextMenu = page.locator('[role="menu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(contextMenu).not.toBeVisible();

    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("Failed to load resource") &&
        !err.includes("favicon"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
