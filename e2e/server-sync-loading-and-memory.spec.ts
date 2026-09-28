import { test, expect } from "@playwright/test";

test.describe("服务器列表同步秒开加载与最后访问位置全域记忆 (Server Sync Loading & Location Memory)", () => {
  let guildAId: string;
  let guildAName: string;
  let channelA2Name: string;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    // 1. 登录管理员获取真实有效 Token
    const loginRes = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Jackey", password: "adminpassword123" },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    authToken = loginData.accessToken;

    // 2. 动态创建测试专用公会 A
    const timestamp = Date.now();
    guildAName = `秒开记忆公会_${timestamp % 100000}`;

    const resA = await request.post("/api/guilds", {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: guildAName },
    });
    expect(resA.ok()).toBeTruthy();
    const guildA = await resA.json();
    guildAId = guildA.id;

    // 在文字频道分类下创建第二个文字频道
    const textCatId = guildA.categories?.[0]?.id;
    channelA2Name = `秒开测试频道_${timestamp % 10000}`;
    const chRes = await request.post(`/api/guilds/${guildAId}/channels`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        name: channelA2Name,
        type: "TEXT",
        parentId: textCatId,
        position: 1,
      },
    });
    expect(chRes.ok()).toBeTruthy();

    // 3. 注入真实登录凭据到浏览器上下文
    await page.addInitScript(
      ({ token, refToken, user }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", refToken);
        localStorage.setItem("tescord_last_user", JSON.stringify(user));
      },
      {
        token: authToken,
        refToken: loginData.refreshToken,
        user: loginData.user,
      },
    );
  });

  test.afterEach(async ({ request }) => {
    if (authToken && guildAId) {
      await request
        .delete(`/api/guilds/${guildAId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        .catch(() => undefined);
    }
  });

  test("1. 停留于公会及子频道时刷新页面，本地缓存同步水合秒开直接恢复该公会与频道", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // 打开应用
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 点击进入公会 A
    const guildBtn = page.locator(`button[aria-label="${guildAName}"]`);
    await expect(guildBtn).toBeVisible({ timeout: 15000 });
    await guildBtn.click();

    // 选中第二个频道
    const customChannelBtn = page.locator(
      `button[data-testid="channel-button-${channelA2Name}"]`,
    );
    await expect(customChannelBtn).toBeVisible({ timeout: 8000 });
    await customChannelBtn.click();
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);

    // 等待本地存储写入完成
    await page.waitForTimeout(500);

    // 核心验证：页面刷新！
    await page.reload();

    // 刷新后，由于本地同步缓存水合（0ms 秒开），公会按钮应立刻存在，且公会 A 的指定频道仍处于激活状态
    await expect(guildBtn).toBeVisible({ timeout: 8000 });
    const refreshedChannelBtn = page.locator(
      `button[data-testid="channel-button-${channelA2Name}"]`,
    );
    await expect(refreshedChannelBtn).toBeVisible({ timeout: 8000 });
    await expect(refreshedChannelBtn).toHaveClass(/bg-discord-active/);

    const fatalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("WebSocket") &&
        !err.includes("livekit") &&
        !err.includes("Failed to load resource") &&
        !err.includes("database connection is closing"),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test("2. 点击 Home 切换到好友主页后刷新，坚决停留在好友主页（绝不再被强制跳转回首个公会）", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // 打开应用
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 先点击进入公会 A
    const guildBtn = page.locator(`button[aria-label="${guildAName}"]`);
    await expect(guildBtn).toBeVisible({ timeout: 15000 });
    await guildBtn.click();

    // 再点击 Home 图标切回私信/好友主页
    const homeBtn = page.locator('button[data-testid="home-nav-button"]');
    await expect(homeBtn).toBeVisible({ timeout: 8000 });
    await homeBtn.click();

    // 确认好友面板主区域已展示
    const friendsTabHeader = page.locator("text=好友");
    await expect(friendsTabHeader.first()).toBeVisible({ timeout: 8000 });

    // 等待存储同步
    await page.waitForTimeout(500);

    // 核心验证：在好友主页执行页面刷新！
    await page.reload();

    // 刷新后，必须继续停留在好友主页，等待接口返回后也绝不能被强制跳入任何公会！
    await expect(friendsTabHeader.first()).toBeVisible({ timeout: 10000 });

    // 等待 2 秒确保 refreshGuilds 和 Gateway READY 全部完成，验证依然在好友主页
    await page.waitForTimeout(2000);
    await expect(friendsTabHeader.first()).toBeVisible();

    const customChannelBtn = page.locator(
      `button[data-testid="channel-button-${channelA2Name}"]`,
    );
    // 频道列表绝不应该可见（因为不在公会视图内）
    await expect(customChannelBtn).not.toBeVisible();

    const fatalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("WebSocket") &&
        !err.includes("livekit") &&
        !err.includes("Failed to load resource") &&
        !err.includes("database connection is closing"),
    );
    expect(fatalErrors).toHaveLength(0);
  });
});
