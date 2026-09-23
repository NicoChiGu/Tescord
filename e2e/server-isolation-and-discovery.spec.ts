import { test, expect } from "@playwright/test";

test.describe("服务器未加入隔离与公开社区探索中心验收 (Server Isolation & Discovery)", () => {
  test("未加入服务器的用户不可见该服务器，主界面展示探索引导大厅并支持一键发现加入公开社区", async ({
    page,
    request,
  }) => {
    // 1. 使用纯净测试用户 Alice 登录 (Alice 初始未加入任何服务器)
    const loginRes = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "alice@tescord.local",
        password: "alicepassword123",
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    const aliceToken = loginData.accessToken;

    // 确保 Alice 处于纯净零公会状态（防上一次异常中断污染）
    const initialGuildsRes = await request.get("/api/guilds", {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const initialGuilds = await initialGuildsRes.json();
    for (const g of initialGuilds) {
      await request.post(`/api/guilds/${g.id}/leave`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
    }

    // 2. 验证后端 GET /api/guilds 接口对 Alice 严格返回空列表 (零公会隔离)
    const guildsRes = await request.get("/api/guilds", {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(guildsRes.ok()).toBeTruthy();
    const guildsData = await guildsRes.json();
    expect(guildsData).toEqual([]);

    // 3. 验证公开探索接口 GET /api/discovery/guilds 返回了公共公会
    const discoveryRes = await request.get("/api/discovery/guilds", {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(discoveryRes.ok()).toBeTruthy();
    const publicGuilds = await discoveryRes.json();
    expect(publicGuilds.length).toBeGreaterThanOrEqual(1);
    const defaultPublicGuild = publicGuilds.find(
      (g: any) => g.name === "Tescord 极客总部",
    );
    expect(defaultPublicGuild).toBeDefined();
    expect(defaultPublicGuild.isJoined).toBeFalsy();

    // 4. 以 Alice 身份进入前端页面
    await page.addInitScript(
      ({ token, refreshToken }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", refreshToken);
      },
      { token: aliceToken, refreshToken: loginData.refreshToken },
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 5. 验证主界面在零公会状态下渲染探索引导大厅 EmptyGuildsWelcome
    const emptyWelcome = page.locator('[data-testid="empty-guilds-welcome"]');
    await expect(emptyWelcome).toBeVisible({ timeout: 10000 });

    const welcomeDiscoveryCard = page.locator(
      '[data-testid="welcome-discovery-card"]',
    );
    await expect(welcomeDiscoveryCard).toBeVisible();

    const welcomeCreateCard = page.locator(
      '[data-testid="welcome-create-card"]',
    );
    await expect(welcomeCreateCard).toBeVisible();

    // 6. 点击欢迎卡片或侧边栏指南针按钮打开 DiscoveryModal
    await welcomeDiscoveryCard.click();

    const discoveryModal = page.locator('[data-testid="discovery-modal"]');
    await expect(discoveryModal).toBeVisible();

    // 7. 在探索中心卡片列表中查看到“Tescord 极客总部”
    const publicCard = page.locator(
      `[data-testid="public-guild-card-${defaultPublicGuild.id}"]`,
    );
    await expect(publicCard).toBeVisible();
    await expect(publicCard.getByText("Tescord 极客总部")).toBeVisible();

    // 8. 点击“加入服务器”按钮
    const joinBtn = page.locator(
      `[data-testid="join-guild-btn-${defaultPublicGuild.id}"]`,
    );
    await expect(joinBtn).toBeVisible();
    await joinBtn.click();

    // 9. 验证弹窗关闭，公会成功加入并在侧边栏出现
    await expect(discoveryModal).not.toBeVisible({ timeout: 5000 });

    const guildButton = page.getByRole("button", {
      name: /Tescord 极客总部/i,
    });
    await expect(guildButton).toBeVisible({ timeout: 10000 });

    // 10. 验证主界面平滑退出零公会大厅，显示出公会频道及聊天区域
    await expect(emptyWelcome).not.toBeVisible();
    const generalChannelBtn = page.getByRole("button", { name: "general" });
    if (await generalChannelBtn.isVisible()) {
      await generalChannelBtn.click();
    }
    const chatHeading = page
      .getByRole("heading", { name: /欢迎来到|general|常规|voice-chat/i })
      .first();
    await expect(chatHeading).toBeVisible({ timeout: 10000 });

    // 11. 测试后清理：Alice 退出该公会，维持幂等性
    await request.post(`/api/guilds/${defaultPublicGuild.id}/leave`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
  });

  test("私有服务器完全不对未加入者公开且不能在探索列表中被检索", async ({
    request,
  }) => {
    // 1. 管理员 Jackey 登录并创建一个私有公会
    const adminLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const { accessToken: adminToken } = await adminLogin.json();

    const privateGuildName = `绝密项目组_${Date.now()}`;
    const createRes = await request.post("/api/guilds", {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: privateGuildName,
        isPublic: false, // 严格私有
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const privateGuild = await createRes.json();

    // 2. 用户 Bob 登录
    const bobLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "bob@tescord.local",
        password: "bobpassword123",
      },
    });
    expect(bobLogin.ok()).toBeTruthy();
    const { accessToken: bobToken } = await bobLogin.json();

    // 3. Bob 调用 GET /api/guilds，绝不能看到该私有公会
    const bobGuildsRes = await request.get("/api/guilds", {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const bobGuilds = await bobGuildsRes.json();
    const hasPrivateGuildInList = bobGuilds.some(
      (g: any) => g.id === privateGuild.id,
    );
    expect(hasPrivateGuildInList).toBeFalsy();

    // 4. Bob 调用 GET /api/discovery/guilds，该私有公会也不能出现在探索列表
    const discoveryRes = await request.get("/api/discovery/guilds", {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    const publicGuilds = await discoveryRes.json();
    const hasPrivateInDiscovery = publicGuilds.some(
      (g: any) => g.id === privateGuild.id,
    );
    expect(hasPrivateInDiscovery).toBeFalsy();

    // 5. Bob 强行尝试调用 POST /api/guilds/:guildId/join 加入该私有公会，应被拒绝 (403)
    const illegalJoinRes = await request.post(
      `/api/guilds/${privateGuild.id}/join`,
      {
        headers: { Authorization: `Bearer ${bobToken}` },
      },
    );
    expect(illegalJoinRes.status()).toBe(403);
    const illegalData = await illegalJoinRes.json();
    expect(illegalData.error).toContain("私有服务器");

    // 6. 清理测试数据：管理员解散该测试公会
    await request.delete(`/api/guilds/${privateGuild.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  });

  test("同一客户端在用户切换时彻底清空上一个账号的聊天消息与公会数据，绝无跨用户消息残留", async ({
    page,
    request,
  }) => {
    // 监听原生 window.confirm 确认框并自动确定
    page.on("dialog", (dialog) => dialog.accept());

    // 1. 获取管理员 Jackey（已在默认公会）与测试用户 Bob（零公会）的凭证
    const jackeyLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    expect(jackeyLogin.ok()).toBeTruthy();
    const jackeyData = await jackeyLogin.json();

    const bobLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "bob@tescord.local",
        password: "bobpassword123",
      },
    });
    expect(bobLogin.ok()).toBeTruthy();
    const bobData = await bobLogin.json();

    // 2. Jackey 在所属公会的 general 频道发送特有测试消息
    const jackeyGuildsRes = await request.get("/api/guilds", {
      headers: { Authorization: `Bearer ${jackeyData.accessToken}` },
    });
    const jackeyGuilds = await jackeyGuildsRes.json();
    const targetGuild = jackeyGuilds[0];
    expect(targetGuild).toBeDefined();

    const channelsRes = await request.get(
      `/api/guilds/${targetGuild.id}/channels`,
      {
        headers: { Authorization: `Bearer ${jackeyData.accessToken}` },
      },
    );
    const channels = await channelsRes.json();
    const generalChannel =
      channels.find((c: any) => c.name === "general") || channels[0];

    const uniqueSecretMessage = `SWITCH_EXCLUSIVE_SECRET_${Date.now()}`;
    const sendMsgRes = await request.post(
      `/api/channels/${generalChannel.id}/messages`,
      {
        headers: { Authorization: `Bearer ${jackeyData.accessToken}` },
        data: { content: uniqueSecretMessage },
      },
    );
    expect(sendMsgRes.ok()).toBeTruthy();

    // 3. 用户 Jackey 在浏览器中进入主界面并停留在该聊天频道
    await page.addInitScript(
      ({ token, refreshToken }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", refreshToken);
      },
      { token: jackeyData.accessToken, refreshToken: jackeyData.refreshToken },
    );

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 点击切换至 general 文字频道
    const generalChannelBtn = page.getByRole("button", { name: "general" });
    if (await generalChannelBtn.isVisible()) {
      await generalChannelBtn.click();
    }

    // 验证 Jackey 界面正常加载出该公会和聊天信息
    const secretMsgLocator = page.getByText(uniqueSecretMessage);
    await expect(secretMsgLocator).toBeVisible({ timeout: 10000 });

    // 4. 用户 Jackey 打开设置中心并退出当前账号
    const settingsBtn = page.locator('[data-testid="user-settings-gear-btn"]');
    await expect(settingsBtn).toBeVisible({ timeout: 5000 });
    await settingsBtn.click();

    const logoutBtn = page.locator('[data-testid="user-logout-btn"]');
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    // 5. 验证弹窗成功触发登出并展示登录弹窗 AuthModal
    const emailInput = page.locator('[data-testid="auth-email-input"]');
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    const passwordInput = page.locator('[data-testid="auth-password-input"]');
    const submitBtn = page.locator('[data-testid="auth-submit-btn"]');

    // 6. 切换为用户 Bob 登录
    await emailInput.fill("bob@tescord.local");
    await passwordInput.fill("bobpassword123");
    await submitBtn.click();

    // 7. 核心断言：Bob 登录成功后
    // - 立即进入 EmptyGuildsWelcome 探索引导大厅
    // - 绝对不残留上一个账号 Jackey 的频道聊天消息与公会数据
    const emptyWelcome = page.locator('[data-testid="empty-guilds-welcome"]');
    await expect(emptyWelcome).toBeVisible({ timeout: 10000 });

    // 验证 Jackey 的私密消息从 DOM 中彻底清空，完全不可见
    await expect(secretMsgLocator).not.toBeVisible();

    // 深度验证：整页文本中绝对没有遗留任何旧账号的聊天内容
    const pageText = await page.textContent("body");
    expect(pageText).not.toContain(uniqueSecretMessage);
  });
});

