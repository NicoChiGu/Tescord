import { test, expect } from "@playwright/test";

test.describe("真实用户在线状态 (Online Presence / Status) 端到端全链路验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录 Token 会话
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 当前登录用户身份 (Jackey)
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "Jackey",
          displayName: "Jackey (Admin)",
          email: "admin@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
          customStatus: "正在打磨 Tescord 核心架构 🚀",
          bio: "Founder of Tescord",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    // Mock 状态修改接口
    await page.route("**/api/users/@me", (route) => {
      const data = route.request().postDataJSON() || {};
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "Jackey",
          status: data.status || "ONLINE",
          customStatus: data.customStatus || "正在打磨 Tescord 核心架构 🚀",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
        }),
      });
    });
  });

  test("验证进入服务器后成员列表渲染与初始状态指示灯", async ({ page }) => {
    await page.goto("/");

    // 1. 点击进入首个默认服务器 (Tescord 极客总部)
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 点击进入默认文本频道 (general)
    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });
    await generalChannel.click();

    // 3. 验证成员列表中自身账号渲染及初始状态小圆点可见
    const jackeyItem = page.locator('[data-member-item="usr_default_admin"]');
    await expect(jackeyItem).toBeVisible({ timeout: 10000 });
    await expect(jackeyItem.locator(".rounded-full").last()).toBeVisible();

    // 4. 当网关在线状态同步后，验证指示灯实时呈现绿色 (bg-emerald-500)
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("PRESENCE_UPDATE", {
          userId: "usr_default_admin",
          status: "ONLINE",
        });
      }
    });
    await expect(jackeyItem.locator(".bg-emerald-500")).toBeVisible({
      timeout: 5000,
    });
  });

  test("验证右键菜单切换自身状态至请勿打扰 (DND) 与隐身 (INVISIBLE)", async ({
    page,
  }) => {
    await page.goto("/");

    // 进入服务器与频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });
    await generalChannel.click();

    const jackeyItem = page.locator('[data-member-item="usr_default_admin"]');
    await expect(jackeyItem).toBeVisible({ timeout: 10000 });

    // 1. 右键自身头像唤起上下文菜单
    await jackeyItem.click({ button: "right" });

    // 验证状态选项可见
    await expect(page.getByText("在线状态")).toBeVisible();
    await expect(
      page.getByRole("menuitemradio", { name: /请勿打扰/i }),
    ).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /隐身/i })).toBeVisible();

    // 2. 切换至“请勿打扰 (DND)”
    await page.getByRole("menuitemradio", { name: /请勿打扰/i }).click();

    // 验证状态指示灯变红 (rose-500)
    await expect(jackeyItem.locator(".bg-rose-500")).toBeVisible({
      timeout: 5000,
    });

    // 3. 再次右键切换至“隐身 (INVISIBLE)”
    await jackeyItem.click({ button: "right" });
    await page.getByRole("menuitemradio", { name: /隐身/i }).click();

    // 验证自身端显示“隐身 (仅自己可见)”的空心灰色小圆圈
    const invisibleDot = jackeyItem.locator('[title="隐身 (仅自己可见)"]');
    await expect(invisibleDot).toBeVisible({ timeout: 5000 });
    await expect(invisibleDot).toHaveClass(/border-gray-400/);
  });

  test("验证接收网关 PRESENCE_UPDATE 广播后成员列表即时响应式联动", async ({
    page,
  }) => {
    await page.goto("/");

    // 进入服务器与频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const generalChannel = page.getByRole("button", { name: "general" });
    await expect(generalChannel).toBeVisible({ timeout: 5000 });
    await generalChannel.click();

    const jackeyItem = page.locator('[data-member-item="usr_default_admin"]');
    await expect(jackeyItem).toBeVisible({ timeout: 10000 });

    // 模拟服务端网关向前端下发 PRESENCE_UPDATE 事件：将 Jackey 切为 IDLE
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("PRESENCE_UPDATE", {
          userId: "usr_default_admin",
          status: "IDLE",
          customStatus: "离开片刻 ☕",
        });
      }
    });

    // 验证成员项实时变为黄色 (amber-500)，且签名即时刷新为“离开片刻 ☕”
    await expect(jackeyItem.locator(".bg-amber-500")).toBeVisible({
      timeout: 5000,
    });
    await expect(jackeyItem.getByText("离开片刻 ☕")).toBeVisible();

    // 再次下发 PRESENCE_UPDATE：恢复为 ONLINE
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("PRESENCE_UPDATE", {
          userId: "usr_default_admin",
          status: "ONLINE",
          customStatus: "重回战线 🚀",
        });
      }
    });

    // 验证指示灯恢复为绿色
    await expect(jackeyItem.locator(".bg-emerald-500")).toBeVisible({
      timeout: 5000,
    });
    await expect(jackeyItem.getByText("重回战线 🚀")).toBeVisible();
  });

  test("验证私信会话列表中好友状态指示灯与 PRESENCE_UPDATE 实时一致性联动", async ({
    page,
  }) => {
    // 拦截私信列表接口，返回包含 Alice 的私信会话
    await page.route("**/api/users/@me/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "dm_channel_alice",
            type: "DM",
            name: "Alice",
            recipients: [
              {
                id: "usr_default_admin",
                username: "Jackey",
                status: "ONLINE",
              },
              {
                id: "usr_alice",
                username: "Alice",
                status: "ONLINE",
                customStatus: "正在钻研代码 💻",
              },
            ],
            messages: [
              {
                id: "msg_alice_1",
                channelId: "dm_channel_alice",
                authorId: "usr_alice",
                author: {
                  id: "usr_alice",
                  username: "Alice",
                },
                content: "你好呀 Jackey",
                createdAt: new Date().toISOString(),
              },
            ],
            lastMessage: {
              id: "msg_alice_1",
              content: "你好呀 Jackey",
            },
            unreadCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto("/");

    // 点击左侧边栏顶部的“私信与主页”按钮，切换至私信列表视图
    const dmHomeBtn = page.getByRole("button", { name: "私信与主页" });
    await expect(dmHomeBtn).toBeVisible({ timeout: 10000 });
    await dmHomeBtn.click();

    // 左侧呈现私信列表
    const aliceDmItem = page.locator(
      '[data-testid="dm-item-dm_channel_alice"]',
    );
    await expect(aliceDmItem).toBeVisible({ timeout: 10000 });

    // 验证初始状态灯为在线绿色 (bg-discord-green)
    await expect(aliceDmItem.locator(".bg-discord-green")).toBeVisible({
      timeout: 5000,
    });

    // 模拟服务端广播 PRESENCE_UPDATE：将 Alice 置为 DND (请勿打扰)
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("PRESENCE_UPDATE", {
          userId: "usr_alice",
          status: "DND",
          customStatus: "会议进行中 🔕",
        });
      }
    });

    // 验证私信列表中的 Alice 状态灯秒级变为红色 (bg-rose-500)
    await expect(aliceDmItem.locator(".bg-rose-500")).toBeVisible({
      timeout: 5000,
    });

    // 模拟服务端广播 PRESENCE_UPDATE：将 Alice 置为 OFFLINE (离线)
    await page.evaluate(() => {
      const client = (window as any).__gatewayClient;
      if (client) {
        client.emit("PRESENCE_UPDATE", {
          userId: "usr_alice",
          status: "OFFLINE",
        });
      }
    });

    // 验证私信列表中的 Alice 状态灯秒级变为离线灰色 (bg-zinc-500)
    await expect(aliceDmItem.locator(".bg-zinc-500")).toBeVisible({
      timeout: 5000,
    });
  });
});
