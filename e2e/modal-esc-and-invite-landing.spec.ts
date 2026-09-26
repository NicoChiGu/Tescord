import { test, expect } from "@playwright/test";

test.describe("清库401自愈、Discord风格邀请落地页与Modal大窗口ESC独立工具栏验收", () => {
  test("1. 遗留 401 凭据清库后访问：不卡白屏/加载条，自动自愈重定向回登录页", async ({
    page,
  }) => {
    // 注入清库前的残留 Token
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "stale_purged_token");
      localStorage.setItem("tescord_refresh_token", "stale_purged_refresh");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "purged_user_id",
          username: "PurgedUser",
          email: "purged@tescord.local",
        }),
      );
    });

    // 服务端返回 401 USER_NOT_FOUND (清库后状态)
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: "用户不存在或会话已失效",
          code: "USER_NOT_FOUND",
        }),
      });
    });

    await page.route("**/api/auth/refresh", (route) => {
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: "会话已过期",
          code: "AUTH_FAILURE",
        }),
      });
    });

    await page.goto("/");

    // 验证不卡在全局加载条
    const loader = page.locator(".app-loader-track");
    await expect(loader).not.toBeVisible({ timeout: 10000 });

    // 验证安全回退至登录/注册界面 (AuthModal)
    const loginBtn = page.getByRole("button", { name: /登\s*录/i });
    await expect(loginBtn).toBeVisible({ timeout: 5000 });

    // 验证本地无效活跃 token 已被清空自愈
    const tokenInStorage = await page.evaluate(() =>
      localStorage.getItem("tescord_access_token"),
    );
    expect(tokenInStorage).toBeNull();
  });

  test("2. 未登录直接访问 /invite/:code：展示 Discord 风格邀请名片、统计及登录/注册引导", async ({
    page,
  }) => {
    // 确保为未登录状态
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Mock 匿名获取邀请码元数据
    await page.route("**/api/invites/cyberpunk_2077", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "cyberpunk_2077",
          guild: {
            id: "guild_cyber_99",
            name: "夜之城开发者联盟",
            iconUrl: null,
            description:
              "欢迎来到赛博朋克 2077 技术研讨与私有化节点部署交流公会！",
            approximateMemberCount: 128,
            approximatePresenceCount: 46,
          },
          inviter: {
            id: "inviter_johnny",
            username: "JohnnySilverhand",
          },
          isMember: false,
        }),
      });
    });

    await page.goto("/invite/cyberpunk_2077");

    // 验证 Discord 风格落地卡片挂载
    const landingModal = page.locator('[data-testid="invite-landing-modal"]');
    await expect(landingModal).toBeVisible({ timeout: 10000 });

    // 验证公会名称与简介
    await expect(
      landingModal.getByRole("heading", { name: "夜之城开发者联盟" }),
    ).toBeVisible();
    await expect(
      landingModal.getByText(
        "欢迎来到赛博朋克 2077 技术研讨与私有化节点部署交流公会！",
      ),
    ).toBeVisible();

    // 验证在线人数与总成员数展示
    await expect(landingModal.getByText(/46\s*在线/)).toBeVisible();
    await expect(landingModal.getByText(/128\s*成员/)).toBeVisible();

    // 验证未登录下的引导按钮：注册与登录
    const registerBtn = page.locator(
      '[data-testid="invite-landing-register-btn"]',
    );
    const loginBtn = page.locator('[data-testid="invite-landing-login-btn"]');
    await expect(registerBtn).toBeVisible();
    await expect(loginBtn).toBeVisible();

    // 点击【已有账号？直接登录】
    await loginBtn.click();

    // 验证卡片关闭并露出登录/注册邮箱表单
    await expect(landingModal).not.toBeVisible();
    await expect(page.getByRole("button", { name: /继续/i })).toBeVisible();

    // 验证 sessionStorage 暂存了该邀请码以便登录后自动加入
    const savedPending = await page.evaluate(() =>
      sessionStorage.getItem("tescord_pending_invite"),
    );
    expect(savedPending).toBe("cyberpunk_2077");
  });

  test("3. 已登录直接访问 /invite/:code：展示邀请卡片并支持一键接受加入公会", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    await page.route("**/api/auth/refresh", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "valid_login_token",
          refreshToken: "valid_refresh_token",
          user: {
            id: "logged_in_user_id",
            username: "OnlineTester",
            email: "online@tescord.local",
            status: "ONLINE",
          },
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "valid_login_token");
      localStorage.setItem("tescord_refresh_token", "valid_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "logged_in_user_id",
          username: "OnlineTester",
          email: "online@tescord.local",
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me/dm-channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock 邀请码详情接口
    await page.route("**/api/invites/matrix_club", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "matrix_club",
          guild: {
            id: "guild_matrix_1",
            name: "黑客帝国俱乐部",
            iconUrl: null,
            description: "探寻真实世界的母体节点",
            approximateMemberCount: 50,
            approximatePresenceCount: 18,
          },
          inviter: {
            id: "morpheus",
            username: "Morpheus",
          },
          isMember: false,
        }),
      });
    });

    let joinCalled = false;
    await page.route("**/api/invites/matrix_club/join", (route) => {
      joinCalled = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          guildId: "guild_matrix_1",
          guild: {
            id: "guild_matrix_1",
            name: "黑客帝国俱乐部",
            channels: [{ id: "c1", name: "综合讨论", type: "TEXT" }],
          },
        }),
      });
    });

    await page.goto("/invite/matrix_club");

    // 验证挂载 Discord 风格卡片
    const landingModal = page.locator('[data-testid="invite-landing-modal"]');
    await expect(landingModal).toBeVisible({ timeout: 10000 });
    await expect(
      landingModal.getByRole("heading", { name: "黑客帝国俱乐部" }),
    ).toBeVisible();

    // 验证已登录状态展示【接受邀请并加入】
    const acceptBtn = page.locator('[data-testid="invite-landing-accept-btn"]');
    await expect(acceptBtn).toBeVisible();

    // 点击接受邀请加入
    await acceptBtn.click();

    // 验证加入接口调用且卡片关闭
    expect(joinCalled).toBe(true);
    await expect(landingModal).not.toBeVisible();
  });

  test("4. 桌面大窗口下 Modal ESC 按钮独立 Tools Column 专属布局验收（不遮挡内容）", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    await page.route("**/api/auth/refresh", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "valid_desk_token",
          refreshToken: "valid_desk_refresh",
          user: {
            id: "desk_user_id",
            username: "DeskTester",
            email: "desk@tescord.local",
            status: "ONLINE",
          },
        }),
      });
    });

    // 设置为宽屏桌面端
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "valid_desk_token");
      localStorage.setItem("tescord_refresh_token", "valid_desk_refresh");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "desk_user_id",
          username: "DeskTester",
          email: "desk@tescord.local",
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
            id: "guild_desk_1",
            name: "大屏验收测试公会",
            ownerId: "desk_user_id",
            channels: [{ id: "c_main", name: "一般闲聊", type: "TEXT" }],
          },
        ]),
      });
    });

    await page.route("**/api/users/@me/dm-channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 });

    // 1. 打开用户设置 UserSettingsModal
    const userSettingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(userSettingsBtn).toBeVisible({ timeout: 10000 });
    await userSettingsBtn.click();

    const userSettingsModal = page.locator(
      '[data-testid="user-settings-modal"]',
    );
    await expect(userSettingsModal).toBeVisible();

    // 验证桌面端关闭按钮存在且带有 ESC 文本提示
    const closeBtn = page.locator(
      '[data-testid="close-user-settings-btn"]:visible',
    );
    await expect(closeBtn).toBeVisible();
    await expect(userSettingsModal.getByText("ESC")).toBeVisible();

    // 验证几何位置关系：关闭按钮位于独立列中，与左侧内容区域不发生重叠
    const closeBox = await closeBtn.boundingBox();
    const contentBox = await page
      .locator('[data-testid="user-settings-detail"]')
      .boundingBox();

    expect(closeBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    if (closeBox && contentBox) {
      // 验证关闭按钮靠右居于独立工具栏中
      expect(closeBox.x).toBeGreaterThan(contentBox.x + contentBox.width - 100);
    }

    // 按 ESC 键关闭
    await page.keyboard.press("Escape");
    await expect(userSettingsModal).not.toBeVisible();
  });
});
