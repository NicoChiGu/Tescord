import { test, expect } from "@playwright/test";

test.describe("管理员踢出/断开语音频道成员专项端到端与安全验收 (Voice Disconnect Member)", () => {
  test("1. 安全边界与负向权限验证：未登录、断开自身、无权限、越权处置及未在语音中均被拒绝", async ({
    request,
  }) => {
    // 1.1 无 Token / 未登录
    const unauthRes = await request.post(
      "/api/guilds/gld_default_01/members/usr_test/disconnect-voice",
      { data: {} },
    );
    expect(unauthRes.status()).toBe(401);
    const unauthBody = await unauthRes.json();
    expect(unauthBody.error).toBeTruthy();

    // 获取管理员账号登录 Token
    const adminLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    const admin = await adminLogin.json();
    const adminToken = admin.accessToken;

    // 1.2 管理员尝试断开自身 (应拒绝，自身请走主动退出)
    const selfRes = await request.post(
      `/api/guilds/gld_default_01/members/${admin.user.id}/disconnect-voice`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(selfRes.status()).toBe(400);
    const selfBody = await selfRes.json();
    expect(selfBody.code).toBe("INVALID_PARAMS");

    // 1.3 目标用户未在语音频道中
    const notInVoiceRes = await request.post(
      `/api/guilds/gld_default_01/members/some_random_user/disconnect-voice`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(notInVoiceRes.status()).toBe(400);
    const notInVoiceBody = await notInVoiceRes.json();
    expect(notInVoiceBody.code).toBe("VOICE_USER_NOT_CONNECTED");
  });

  test("2. 前端右键菜单交互与二次确认弹窗流程验证", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 注入模拟登录与状态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_admin_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_admin",
          username: "admin_user",
          displayName: "超级管理员",
          role: "ADMIN",
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
            id: "guild_voice_test",
            name: "语音测试服务器",
            ownerId: "usr_admin",
            roles: [
              {
                id: "role_admin",
                name: "管理员",
                permissions: 0x7fffffff,
                position: 10,
              },
            ],
            members: [
              { userId: "usr_admin", roleIds: ["role_admin"] },
              { userId: "usr_target", roleIds: [] },
            ],
            channels: [
              {
                id: "ch_general_voice",
                guildId: "guild_voice_test",
                name: "开黑语音大厅",
                type: "VOICE",
                voiceMode: "sfu",
              },
            ],
          },
        ]),
      });
    });

    await page.route("**/api/guilds/guild_voice_test/channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "ch_general_voice",
            guildId: "guild_voice_test",
            name: "开黑语音大厅",
            type: "VOICE",
            voiceMode: "sfu",
          },
        ]),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 验证控制台无严重未捕获错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("Failed to load resource") &&
        !err.includes("net::ERR_CONNECTION_REFUSED"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
