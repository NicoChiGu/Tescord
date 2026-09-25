import { test, expect } from "@playwright/test";

test.describe("令牌失效重新登录 Modal 与会话无感恢复验收", () => {
  test("401 拦截后弹出毛玻璃重新登录 Modal、阻断关闭并在验证密码后无缝恢复", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 预注入认证凭据
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_old_access_token");
      localStorage.setItem("tescord_refresh_token", "mock_old_refresh_token");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "tester_user_1",
          username: "JackeyTester",
          email: "jackey@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      );
    });

    // Mock 用户信息
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "tester_user_1",
          username: "JackeyTester",
          email: "jackey@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock 公会列表
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_1",
            name: "测试专属公会",
            icon: null,
            ownerId: "tester_user_1",
            channels: [
              {
                id: "chan_1",
                name: "常规闲聊",
                type: "TEXT",
                guildId: "guild_1",
                position: 0,
              },
            ],
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

    await page.route("**/api/auth/login", (route) => {
      let requestData: any = {};
      try {
        requestData = route.request().postDataJSON() || {};
      } catch {
        // ignore
      }
      if (requestData?.password === "wrong_pass") {
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "密码错误，请重新输入" }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            accessToken: "mock_new_access_token",
            refreshToken: "mock_new_refresh_token",
            expiresIn: 900,
            user: {
              id: "tester_user_1",
              username: "JackeyTester",
              email: "jackey@tescord.local",
              status: "ONLINE",
            },
          }),
        });
      }
    });

    // Keep this case focused on HTTP refresh; a deliberately fake JWT would
    // otherwise be rejected by the real Gateway before the request below.
    await page.routeWebSocket("**/gateway", (socket) => socket.close());

    await page.goto("/");

    // 1. 等待主界面渲染完毕
    const reauthBackdrop = page.locator(
      '[data-testid="reauth-modal-backdrop"]',
    );
    await expect(reauthBackdrop).not.toBeVisible();

    const root = page.locator("#root");
    await expect(root).toBeVisible({ timeout: 10000 });

    // 2. 模拟发起业务操作触发 401，且 refreshAuth 接口也返回 401（双层失效，需弹窗重登）
    let refreshAttempted = false;
    await page.route("**/api/auth/refresh", (route) => {
      refreshAttempted = true;
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Refresh token expired" }),
      });
    });

    let messageSentCount = 0;
    await page.route("**/api/channels/*/messages", (route) => {
      messageSentCount++;
      if (messageSentCount === 1) {
        // 第一次请求返回 401
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unauthorized access token expired" }),
        });
      } else {
        // 第二次重放请求返回 200 成功
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "msg_new_1",
            content: "自动恢复发送的消息",
            authorId: "tester_user_1",
            channelId: "chan_1",
            createdAt: new Date().toISOString(),
          }),
        });
      }
    });

    // 在页面中主动触发一次带有鉴权头的业务请求
    const fetchResultPromise = page.evaluate(async () => {
      const res = await window.fetch("/api/channels/chan_1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "自动恢复发送的消息" }),
      });
      return { ok: res.ok, status: res.status };
    });

    // 3. 验证 ReauthModal 被成功唤起
    await expect(reauthBackdrop).toBeVisible({ timeout: 5000 });
    await expect.poll(() => refreshAttempted).toBe(true);

    // 验证遮罩类名包含 backdrop-blur-md (毛玻璃背景虚化效果)
    const backdropClass = await reauthBackdrop.getAttribute("class");
    expect(backdropClass).toContain("backdrop-blur-md");

    // 验证用户名与安全警示显示
    await expect(
      reauthBackdrop.getByRole("heading", { name: "JackeyTester" }),
    ).toBeVisible();
    await expect(
      reauthBackdrop.getByText("jackey@tescord.local"),
    ).toBeVisible();

    // 4. 验证模态阻断特性：按 Escape 键不可退出
    await page.keyboard.press("Escape");
    await expect(reauthBackdrop).toBeVisible();

    // 验证点击遮罩背景不可关闭
    await reauthBackdrop.click({ position: { x: 10, y: 10 } });
    await expect(reauthBackdrop).toBeVisible();

    // 5. 模拟输入错误密码提交，验证错误提示
    const passwordInput = page.locator('[data-testid="reauth-password-input"]');
    const submitBtn = page.locator('[data-testid="reauth-submit-btn"]');

    await passwordInput.fill("wrong_pass");
    await submitBtn.click();

    // 验证报错提示可见
    const errorAlert = page.locator('[data-testid="reauth-error-alert"]');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText("密码错误");

    // 6. 输入正确密码并提交
    await passwordInput.fill("correct_pass");
    await submitBtn.click();

    // 7. 验证 ReauthModal 顺利消失
    await expect(reauthBackdrop).not.toBeVisible({ timeout: 5000 });

    // 8. 验证此前被挂起的业务请求已经由 Auto-Retry Queue 成功重发并完成
    const fetchResult = await fetchResultPromise;
    expect(fetchResult.ok).toBe(true);
    expect(fetchResult.status).toBe(200);
    expect(messageSentCount).toBe(2);

    // 确保没有致命控制台错误（排除 401/400 模拟网络状态响应与 WebSocket 重连日志）
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("401") &&
        !err.includes("400"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("WebSocket 会话失效事件可唤起 ReauthModal，且支持切换账号彻底登出", async ({
    page,
  }) => {
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
    // 预注入认证凭据
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_ws_access_token");
      localStorage.setItem("tescord_refresh_token", "mock_ws_refresh_token");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "ws_user_1",
          username: "WebSocketTester",
          email: "ws@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      );
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "ws_user_1",
          username: "WebSocketTester",
          email: "ws@tescord.local",
          avatarUrl: null,
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

    await page.goto("/");

    const root = page.locator("#root");
    await expect(root).toBeVisible({ timeout: 10000 });

    const reauthBackdrop = page.locator(
      '[data-testid="reauth-modal-backdrop"]',
    );

    // 模拟服务端推送 AUTH_SESSION_EXPIRED 事件或通过 useAuthStore.openReauthModal 触发
    await page.evaluate(() => {
      (window as any).useAuthStore
        ?.getState()
        .openReauthModal("WebSocket 会话被服务端主动终止");
    });

    // 验证 ReauthModal 弹出
    await expect(reauthBackdrop).toBeVisible({ timeout: 5000 });
    await expect(
      reauthBackdrop.getByRole("heading", { name: "WebSocketTester" }),
    ).toBeVisible();
    await expect(
      reauthBackdrop.getByText(
        /WebSocket 会话被服务端主动终止|登录凭据已完全失效|登录会话已过期/,
      ),
    ).toBeVisible();

    // 点击“切换其他账号”
    const switchBtn = page.locator('[data-testid="reauth-switch-account-btn"]');
    await expect(switchBtn).toBeVisible();
    await switchBtn.click();

    // 验证 ReauthModal 消失，且页面切换为初始未登录欢迎/登录页
    await expect(reauthBackdrop).not.toBeVisible();

    const loginBtn = page.getByRole("button", { name: /登\s*录/i });
    await expect(loginBtn).toBeVisible({ timeout: 5000 });

    // 验证 localStorage 已清理
    const tokenInStorage = await page.evaluate(() =>
      localStorage.getItem("tescord_access_token"),
    );
    expect(tokenInStorage).toBeNull();
  });
});
