import { test, expect } from "@playwright/test";

test.describe("用户身份解耦、图1样式还原与好友系统 (Friends & Identity) E2E 验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录 Token 会话与本地 Mock 存储
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem(
        "tescord_refresh_token",
        localStorage.getItem("tescord_e2e_refresh_token") ||
          "mock_refresh_token",
      );
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "usr_mock_terata",
          username: "TERATA#70712",
        }),
      );
      // 禁用后台 WebSocket 避免网关信令 INVALID_SESSION 唤起 ReauthModal 拦截交互
      (window as any).WebSocket = class MockWebSocket extends EventTarget {
        readyState = 3;
        close() {}
        send() {}
      };
    });

    // Mock 服务器与频道列表避免触发 401
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

    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me/settings", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    // Mock 当前登录用户信息 (带 displayName 与 5 位数字 discriminator)
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
          avatarUrl: null,
          status: "ONLINE",
          customStatus: "这个人很神秘，什么都还没写...",
          bio: "这个人很神秘，什么都还没写...",
          bannerColor: "#5865f2",
          bannerUrl: null,
          themeColor: "#e5a93c",
          showActivity: true,
          createdAt: "2026-09-24T00:00:00.000Z",
        }),
      });
    });

    // Mock 好友关系列表接口
    await page.route("**/api/users/@me/relationships", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "rel_1",
              userId: "usr_mock_terata",
              targetUserId: "usr_mock_friend_1",
              type: "FRIEND",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              targetUser: {
                id: "usr_mock_friend_1",
                username: "BestBuddy#54321",
                displayName: "好伙伴",
                discriminator: "54321",
                status: "ONLINE",
                customStatus: "正在开发 Tescord",
                avatarUrl: null,
              },
            },
            {
              id: "rel_2",
              userId: "usr_mock_terata",
              targetUserId: "usr_mock_applicant",
              type: "PENDING_INCOMING",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              targetUser: {
                id: "usr_mock_applicant",
                username: "NewComer#88888",
                displayName: "新朋友",
                discriminator: "88888",
                status: "IDLE",
                avatarUrl: null,
              },
            },
          ]),
        });
      } else if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() || {};
        const identifier = body.identifier || "";

        if (!identifier.includes("#")) {
          route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              error: "请输入完整的用户标识，例如 用户名#12345",
            }),
          });
          return;
        }

        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "rel_new",
            userId: "usr_mock_terata",
            targetUserId: "usr_target_999",
            type: "PENDING_OUTGOING",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            targetUser: {
              id: "usr_target_999",
              username: identifier,
              displayName: identifier.split("#")[0],
              discriminator: identifier.split("#")[1],
              status: "OFFLINE",
            },
          }),
        });
      } else {
        route.continue();
      }
    });

    // Mock 用户资料与状态更新接口
    await page.route("**/api/users/@me", (route) => {
      const data = route.request().postDataJSON() || {};
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_mock_terata",
          username: data.username ? `${data.username}#70712` : "TERATA#70712",
          displayName:
            data.displayName !== undefined ? data.displayName : "TERATA",
          discriminator: "70712",
          status: data.status || "ONLINE",
          customStatus:
            data.customStatus !== undefined ? data.customStatus : null,
          bio: data.bio !== undefined ? data.bio : null,
          bannerColor:
            data.bannerColor !== undefined ? data.bannerColor : "#5865f2",
          bannerUrl: data.bannerUrl !== undefined ? data.bannerUrl : null,
          themeColor:
            data.themeColor !== undefined ? data.themeColor : "#e5a93c",
          showActivity:
            data.showActivity !== undefined ? data.showActivity : true,
          avatarUrl: null,
          createdAt: "2026-09-24T00:00:00.000Z",
        }),
      });
    });
  });

  test("1. 验证私信栏【好友】面板交互：在线列表、待处理角标与格式负向/正向添加申请", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1366, height: 850 });
    await page.goto("/");

    // 1.1 点击左侧次级栏中的【好友】主入口按钮
    const friendsTabBtn = page.getByTestId("friends-tab-btn");
    await expect(friendsTabBtn).toBeVisible();
    await friendsTabBtn.click();

    // 1.2 验证顶部标签栏存在：在线、全部、待处理、添加好友
    await expect(page.getByRole("button", { name: "在线" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全部" })).toBeVisible();
    await expect(page.getByRole("button", { name: "待处理" })).toBeVisible();
    await expect(page.getByRole("button", { name: "添加好友" })).toBeVisible();

    // 1.3 验证在线好友列表中展示双层主副标题
    await expect(page.getByText("好伙伴")).toBeVisible();
    await expect(page.getByText("@BestBuddy#54321")).toBeVisible();

    // 1.4 切换至【待处理】标签页
    await page.getByRole("button", { name: "待处理" }).click();
    await expect(page.getByText("新朋友")).toBeVisible();
    await expect(page.getByText("@NewComer#88888")).toBeVisible();

    // 1.5 切换至【添加好友】标签页进行负向与正向校验
    await page.getByRole("button", { name: "添加好友" }).click();
    const addInput = page.getByPlaceholder("你可以输入例如 Nick#12312");
    const submitBtn = page.getByRole("button", { name: "发送好友申请" });

    // 负向 1：仅输入纯昵称
    await addInput.fill("Nick");
    await submitBtn.click();
    await expect(
      page.getByText("缺少数字标签！请输入完整的用户识别码"),
    ).toBeVisible();

    // 负向 2：仅输入纯标签
    await addInput.fill("#12312");
    await submitBtn.click();
    await expect(
      page.getByText("缺少用户名称！请输入完整的用户识别码"),
    ).toBeVisible();

    // 负向 3：数字标签位数不对
    await addInput.fill("Nick#123");
    await submitBtn.click();
    await expect(
      page.getByText("识别码格式不正确，标签必须为 5 位数字"),
    ).toBeVisible();

    // 正向：输入完整正确的识别码
    await addInput.fill("Nick#12312");
    await submitBtn.click();
    await expect(
      page.getByText("好友申请已成功发送给 Nick#12312！"),
    ).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test("2. 验证个人资料设置中调整显示昵称、用户识别码及图 1 样式 1:1 动态实时还原", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1366, height: 850 });
    await page.goto("/");

    // 2.1 打开设置模态框
    const settingsBtn = page.getByTestId("user-settings-gear-btn");
    await settingsBtn.click();
    const modal = page.getByTestId("user-settings-modal");
    await expect(modal).toBeVisible();

    // 2.2 切换至个人资料 Tab
    await page.getByTestId("tab-profile-btn").click();

    // 2.3 验证显示昵称与不可更改数字标签徽章
    const displayNameInput = page.getByTestId("profile-display-name-input");
    await expect(displayNameInput).toBeVisible();
    await expect(
      modal.getByTitle("数字鉴别码终身唯一绑定，不可修改"),
    ).toBeVisible();

    // 2.4 在设置中输入新的显示昵称
    await displayNameInput.fill("TERATA_PRO");

    // 2.5 检查右侧 1:1 动态实时卡片（图1 效果：主大字 TERATA_PRO，副 @TERATA#70712）
    await expect(page.getByTestId("profile-preview-display-name")).toHaveText(
      "TERATA_PRO",
    );
    await expect(page.getByTestId("profile-preview-sub-identifier")).toHaveText(
      "@TERATA#70712",
    );

    // 2.6 出现未保存更改条并保存
    const noticeBar = page.getByTestId("unsaved-changes-notice-bar");
    await expect(noticeBar).toBeVisible();
    const saveBtn = page.getByTestId("save-profile-changes-btn");
    await saveBtn.click();

    expect(consoleErrors).toHaveLength(0);
  });
});
