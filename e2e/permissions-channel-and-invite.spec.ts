import { test, expect } from "@playwright/test";

test.describe("频道与分类拖拽及创建/邀请入口权限控制专项端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });
  });

  test("1. 普通成员（无 MANAGE_CHANNELS 与 CREATE_INVITE 权限）：彻底禁用拖拽、隐藏新建分类/新建频道及邀请入口", async ({
    page,
    request,
  }) => {
    const adminLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    const aliceLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "alice@tescord.local",
        password: "alicepassword123",
      },
    });
    const admin = await adminLogin.json();
    const alice = await aliceLogin.json();
    const inviteResponse = await request.post(
      "/api/guilds/gld_default_01/invites",
      {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { maxUses: 1, maxAge: 600 },
      },
    );
    const invite = await inviteResponse.json();
    const joinResponse = await request.post(
      `/api/invites/${invite.code}/join`,
      { headers: { Authorization: `Bearer ${alice.accessToken}` } },
    );
    expect(joinResponse.ok()).toBeTruthy();
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_normal_access_token") || "",
      );
      localStorage.setItem(
        "tescord_refresh_token",
        localStorage.getItem("tescord_e2e_normal_refresh_token") || "",
      );
    });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Mock 当前用户为普通用户 Alice (非 owner, 且用户名非 admin/Jackey)
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_test_alice",
          username: "alice",
          displayName: "Alice (普通成员)",
          email: "alice@tescord.local",
          role: "USER",
          status: "ONLINE",
        }),
      });
    });

    // 监听排序接口，断言无权限时不被调用
    let reorderPositionsCalled = false;
    await page.route("**/api/guilds/*/categories/positions", (route) => {
      reorderPositionsCalled = true;
      route.fulfill({ status: 200, body: "{}" });
    });
    await page.route("**/api/guilds/*/channels/positions", (route) => {
      reorderPositionsCalled = true;
      route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. 进入服务器并等待频道侧边栏加载
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 2. 确认默认分类已经呈现
    const catHeader = page.locator('[data-testid^="category-header-"]').first();
    await expect(catHeader).toBeVisible({ timeout: 5000 });

    // 3. 断言侧边栏头部三大特权按钮（创建分类、创建频道、生成邀请码）全部不可见
    const createCategoryBtn = page.locator(
      '[data-testid="sidebar-create-category-btn"]',
    );
    const createChannelBtn = page.locator(
      '[data-testid="sidebar-create-channel-btn"]',
    );
    const inviteBtn = page.getByTestId("sidebar-invite-friends-btn");

    await expect(createCategoryBtn).toHaveCount(0);
    await expect(createChannelBtn).toHaveCount(0);
    await expect(inviteBtn).toHaveCount(0);

    // 4. 断言分类条目：具备普通 pointer 样式而不是 cursor-grab，且右侧无“+”新建频道按钮
    await expect(catHeader).toHaveClass(/cursor-pointer/);
    await expect(catHeader).not.toHaveClass(/cursor-grab/);
    await catHeader.hover();
    const plusInCategory = catHeader.locator(
      '[data-testid^="create-channel-in-category-"]',
    );
    await expect(plusInCategory).toHaveCount(0);

    // 5. 验证拖拽禁用：尝试拖拽频道条目，断言不会发起 positions 排序请求
    const channelButtons = page.locator('[data-testid^="channel-button-"]');
    const channelCount = await channelButtons.count();
    if (channelCount >= 2) {
      const firstChannel = channelButtons.nth(0);
      const secondChannel = channelButtons.nth(1);
      await firstChannel.dragTo(secondChannel, { force: true });
      expect(reorderPositionsCalled).toBe(false);
    }

    // 6. 验证右键菜单入口隔离
    // 6.1 右键服务器图标
    await serverBtn.click({ button: "right" });
    await expect(page.getByText("邀请其他人")).toHaveCount(0);
    await expect(page.getByText("创建频道")).toHaveCount(0);
    await expect(page.getByText("创建分类")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 6.2 右键分类标题
    await catHeader.click({ button: "right" });
    await expect(
      page.locator('[data-testid="context-create-channel-btn"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="context-edit-category-btn"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="context-delete-category-btn"]'),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 6.3 右键频道条目
    const firstChannel = channelButtons.first();
    await firstChannel.click({ button: "right" });
    await expect(
      page.locator('[data-testid="channel-context-menu-invite"]'),
    ).toHaveCount(0);
    await expect(page.getByText("邀请其他人")).toHaveCount(0);
    await expect(page.getByText("编辑频道")).toHaveCount(0);
    await expect(page.getByText("删除频道")).toHaveCount(0);
    await page.keyboard.press("Escape");

    expect(consoleErrors).toEqual([]);
    await request.delete(
      `/api/guilds/gld_default_01/members/${alice.user.id}`,
      { headers: { Authorization: `Bearer ${admin.accessToken}` } },
    );
  });

  test("2. 特权/管理员用户：完整展示侧边栏按钮、分类新建按钮、频道右键邀请与右键管理功能", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // Mock 登录用户为管理员 Jackey
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "Jackey",
          displayName: "测试管理员",
          email: "admin@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. 进入服务器并等待加载
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 2. 验证侧边栏头部三大特权按钮全部可见
    await expect(
      page.locator('[data-testid="sidebar-create-category-btn"]'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('[data-testid="sidebar-create-channel-btn"]'),
    ).toBeVisible();
    await expect(page.getByTestId("sidebar-invite-friends-btn")).toBeVisible();

    // 3. 验证分类标题栏具备可拖拽样式且包含“+”新建频道按钮
    const catHeader = page.locator('[data-testid^="category-header-"]').first();
    await expect(catHeader).toBeVisible();
    await expect(catHeader).toHaveClass(/cursor-grab/);
    await catHeader.hover();
    const plusInCategory = catHeader.locator(
      '[data-testid^="create-channel-in-category-"]',
    );
    await expect(plusInCategory).toBeVisible();

    // 4. 验证右键菜单项完整展现
    // 4.1 右键服务器
    await serverBtn.click({ button: "right" });
    await expect(page.getByText(/邀请好友|邀请其他人/)).toBeVisible();
    await expect(page.getByText("创建频道")).toBeVisible();
    await expect(page.getByText("创建分类")).toBeVisible();
    await page.keyboard.press("Escape");

    // 4.2 右键分类
    await catHeader.click({ button: "right" });
    await expect(
      page.locator('[data-testid="context-create-channel-btn"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="context-edit-category-btn"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="context-delete-category-btn"]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // 4.3 右键频道条目：验证频道右键菜单中的“邀请其他人”及管理项正常显示
    const channelItem = page
      .locator('[data-testid^="channel-button-"]')
      .first();
    await channelItem.click({ button: "right" });
    await expect(
      page.locator('[data-testid="channel-context-menu-invite"]'),
    ).toBeVisible();
    await expect(page.getByText("编辑频道")).toBeVisible();
    await expect(page.getByText("删除频道")).toBeVisible();
    await page.keyboard.press("Escape");

    expect(consoleErrors).toEqual([]);
  });
});
