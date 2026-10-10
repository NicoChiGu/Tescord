import { test, expect } from "@playwright/test";

test.describe("Steam 游戏检测与全域图片展示 E2E 验收", () => {
  const mockSteamActivity = {
    name: "黑神话：悟空 (Black Myth: Wukong)",
    type: "PLAYING" as const,
    details: "Steam",
    applicationId: "2358720",
    timestamps: {
      start: Date.now() - 3600000,
    },
    assets: {
      largeImage:
        "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2358720/header.jpg",
      largeText: "黑神话：悟空 (Black Myth: Wukong)",
      smallImage: "steam",
      smallText: "Steam",
    },
  };

  test.beforeEach(async ({ page }) => {
    // 注入已登录会话与 Electron 游戏侦测能力
    await page.addInitScript((activity) => {
      const e2eToken =
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token";
      localStorage.setItem("tescord_access_token", e2eToken);
      localStorage.setItem("tescord_refresh_token", "mock_e2e_refresh_token");

      (window as any).electronAPI = {
        platform: "win32",
        getDesktopSources: async () => [],
        showNotification: async () => true,
        onNotificationClick: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => true,
        onStatusChangeFromTray: () => () => {},
        syncUserStatus: () => {},
        syncLocale: () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalPTTDown: () => () => {},
        onGlobalPTTUp: () => () => {},
        setPTTKeybind: async () => true,
        minimizeWindow: async () => {},
        maximizeWindow: async () => {},
        closeWindow: async () => {},
        isWindowMaximized: async () => false,
        onWindowMaximizedChange: () => () => {},
        getWindowMode: async () => "main",
        setWindowMode: async () => {},
        notifyAuthSuccess: async () => {},
        notifyLogout: async () => {},
        getDetectedGame: () => Promise.resolve(activity),
        onGameActivityChanged: () => () => {},
      };
    }, mockSteamActivity);

    // Mock 当前用户资料与活动
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_mock_gamer",
          username: "Jackey",
          displayName: "Jackey",
          email: "jackey@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          showActivity: true,
          activities: [mockSteamActivity],
          createdAt: new Date().toISOString(),
        }),
      });
    });

    // Mock 服务器列表为空，默认处于私信/好友主界面
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // 拦截好友关系接口，注入正在玩 Steam 游戏的好友
    await page.route("**/api/users/@me/relationships", async (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "rel_mock_1",
            userId: "usr_jackey",
            targetUserId: "usr_friend_elden",
            type: "FRIEND",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            targetUser: {
              id: "usr_friend_elden",
              username: "EldenLord",
              displayName: "褪色者",
              avatarUrl: null,
              status: "ONLINE",
              showActivity: true,
              activities: [
                {
                  name: "艾尔登法环 (ELDEN RING)",
                  type: "PLAYING",
                  details: "Steam",
                  applicationId: "1245620",
                  timestamps: { start: Date.now() - 1800000 },
                },
              ],
              createdAt: new Date().toISOString(),
            },
          },
        ]),
      });
    });

    // 拦截私信会话列表接口
    await page.route("**/api/users/@me/channels", async (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "dm_mock_elden",
            type: "DM",
            name: "褪色者",
            unreadCount: 0,
            recipients: [
              {
                id: "usr_friend_elden",
                username: "EldenLord",
                displayName: "褪色者",
                avatarUrl: null,
                status: "ONLINE",
                showActivity: true,
                activities: [
                  {
                    name: "艾尔登法环 (ELDEN RING)",
                    type: "PLAYING",
                    details: "Steam",
                    applicationId: "1245620",
                  },
                ],
                createdAt: new Date().toISOString(),
              },
            ],
            lastMessage: null,
          },
        ]),
      });
    });
  });

  test("验证 Electron 游戏侦测首屏同步、左下角底栏状态及 CurrentUserPopout 沉浸式卡片", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1366, height: 850 });
    await page.goto("/");

    // 1. 验证左下角状态条通过 getDetectedGame 首屏同步呈现正在游玩的游戏名称
    const userPanelBtn = page.getByTestId("current-user-panel-btn");
    await expect(userPanelBtn).toBeVisible({ timeout: 15000 });
    await expect(userPanelBtn.getByText(/黑神话：悟空/i)).toBeVisible({
      timeout: 10000,
    });

    // 2. 点击左下角底栏呼出 CurrentUserPopout
    await userPanelBtn.click();
    const currentUserPopout = page.getByTestId("current-user-popout");
    await expect(currentUserPopout).toBeVisible({ timeout: 5000 });

    // 3. 验证 CurrentUserPopout 渲染沉浸式游戏面板
    const gamePanel = currentUserPopout.getByTestId(
      "current-user-playing-game-panel",
    );
    await expect(gamePanel).toBeVisible({ timeout: 5000 });
    await expect(gamePanel.getByText("Steam").first()).toBeVisible();
    await expect(gamePanel.getByText(/黑神话：悟空/i)).toBeVisible();
    await expect(
      gamePanel.getByTestId("steam-game-image-container"),
    ).toBeVisible();

    // 4. 关闭弹窗
    await page.keyboard.press("Escape");
    await expect(currentUserPopout).not.toBeVisible();

    expect(
      consoleErrors.filter((e) => !e.includes("ResizeObserver")),
    ).toHaveLength(0);
  });

  test("验证私信会话列表与好友列表中 Steam 标识与游戏状态展示", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 850 });
    await page.goto("/");

    // 1. 验证主界面已加载
    await expect(page.getByTestId("current-user-panel-btn")).toBeVisible({
      timeout: 15000,
    });

    // 2. 点击 Home 按钮切换至私信/好友主页
    const homeBtn = page.getByTestId("home-nav-button");
    await expect(homeBtn).toBeVisible({ timeout: 10000 });
    await homeBtn.click();

    // 3. 点击好友标签页
    const friendsTabBtn = page.getByTestId("friends-tab-btn");
    await expect(friendsTabBtn).toBeVisible({ timeout: 10000 });
    await friendsTabBtn.click();

    // 4. 验证全部/在线好友列表中展示艾尔登法环活动
    const friendItem = page.getByTestId("friend-item-usr_friend_elden");
    await expect(friendItem).toBeVisible({ timeout: 10000 });
    await expect(friendItem.getByText(/艾尔登法环/i)).toBeVisible();

    // 5. 验证私信列表副标题也呈现正在游玩状态
    const dmItem = page.getByTestId("dm-item-dm_mock_elden");
    await expect(dmItem).toBeVisible({ timeout: 5000 });
    await expect(dmItem.getByText(/艾尔登法环/i)).toBeVisible();
  });

  test("验证服务端 Steam 图片代理缓存接口 (/api/games/steam/:appId/image)", async ({
    request,
  }) => {
    // 验证合法 AppID 代理拉取或返回缓存
    const response = await request.get("/api/games/steam/2358720/image");
    expect([200, 404, 502]).toContain(response.status());
    if (response.status() === 200) {
      expect(response.headers()["content-type"]).toContain("image/");
      expect(response.headers()["cache-control"]).toContain("public");
    }

    // 验证非法 AppID 参数拦截 (400 INVALID_PARAMS)
    const invalidRes = await request.get("/api/games/steam/invalid_app/image");
    expect(invalidRes.status()).toBe(400);
    const errBody = await invalidRes.json();
    expect(errBody.code).toBe("INVALID_PARAMS");
  });
});
