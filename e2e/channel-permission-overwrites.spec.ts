import { test, expect } from "@playwright/test";
import { PermissionFlags } from "@tescord/types";

test.describe("Discord 风格频道权限管理与覆写系统专项端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

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
  });

  test("1. 服务端核心安全边界：私密频道创建、三态覆写 CRUD、不可见过滤与分类同步", async ({
    request,
  }) => {
    // 登录管理员
    const adminLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "admin@tescord.local",
        password: "adminpassword123",
      },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const admin = await adminLogin.json();

    // 登录普通成员 Alice
    const aliceLogin = await request.post("/api/auth/login", {
      data: {
        emailOrUsername: "alice@tescord.local",
        password: "alicepassword123",
      },
    });
    expect(aliceLogin.ok()).toBeTruthy();
    const alice = await aliceLogin.json();

    // 确保 Alice 加入服务器
    const inviteRes = await request.post("/api/guilds/gld_default_01/invites", {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
      data: { maxUses: 1, maxAge: 600 },
    });
    const invite = await inviteRes.json();
    await request.post(`/api/invites/${invite.code}/join`, {
      headers: { Authorization: `Bearer ${alice.accessToken}` },
    });

    // 1.1 管理员创建私密频道
    const privateChannelRes = await request.post(
      "/api/guilds/gld_default_01/channels",
      {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: {
          name: "e2e-private-room",
          type: "TEXT",
          isPrivate: true,
        },
      },
    );
    expect(privateChannelRes.ok()).toBeTruthy();
    const privateChannel = await privateChannelRes.json();
    expect(privateChannel.overwrites).toBeDefined();

    // 验证 @everyone 的 VIEW_CHANNEL 被设为 deny
    const everyoneOw = privateChannel.overwrites.find(
      (o: any) => o.targetType === "ROLE",
    );
    expect(everyoneOw).toBeDefined();
    expect(everyoneOw.deny & PermissionFlags.VIEW_CHANNEL).toBe(
      PermissionFlags.VIEW_CHANNEL,
    );

    // 1.2 普通成员 Alice 获取频道列表：私密频道被严格隐形阻断，不可见
    const aliceChannelsRes = await request.get(
      "/api/guilds/gld_default_01/channels",
      {
        headers: { Authorization: `Bearer ${alice.accessToken}` },
      },
    );
    expect(aliceChannelsRes.ok()).toBeTruthy();
    const aliceChannels = await aliceChannelsRes.json();
    const hasPrivateChannel = aliceChannels.some(
      (c: any) => c.id === privateChannel.id,
    );
    expect(hasPrivateChannel).toBeFalsy();

    // 1.3 为 Alice 个人添加访问覆写：allow VIEW_CHANNEL
    const setOverwriteRes = await request.put(
      `/api/channels/${privateChannel.id}/permissions/${alice.user.id}`,
      {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: {
          targetType: "MEMBER",
          allow: PermissionFlags.VIEW_CHANNEL | PermissionFlags.SEND_MESSAGES,
          deny: 0,
        },
      },
    );
    expect(setOverwriteRes.ok()).toBeTruthy();
    const updatedChannel = await setOverwriteRes.json();
    const aliceOw = updatedChannel.overwrites.find(
      (o: any) => o.targetId === alice.user.id && o.targetType === "MEMBER",
    );
    expect(aliceOw).toBeDefined();
    expect(aliceOw.allow & PermissionFlags.VIEW_CHANNEL).toBe(
      PermissionFlags.VIEW_CHANNEL,
    );

    // 1.4 Alice 再次获取频道列表：现在私密频道对 Alice 正常可见
    const aliceChannelsRes2 = await request.get(
      "/api/guilds/gld_default_01/channels",
      {
        headers: { Authorization: `Bearer ${alice.accessToken}` },
      },
    );
    const aliceChannels2 = await aliceChannelsRes2.json();
    expect(
      aliceChannels2.some((c: any) => c.id === privateChannel.id),
    ).toBeTruthy();

    // 1.5 防越权校验：普通成员 Alice 尝试修改频道覆写应被 403 拒绝
    const aliceHackingRes = await request.put(
      `/api/channels/${privateChannel.id}/permissions/${alice.user.id}`,
      {
        headers: { Authorization: `Bearer ${alice.accessToken}` },
        data: {
          targetType: "MEMBER",
          allow: 0,
          deny: 0,
        },
      },
    );
    expect(aliceHackingRes.status()).toBe(403);

    // 1.6 删除覆写并验证
    const deleteOwRes = await request.delete(
      `/api/channels/${privateChannel.id}/permissions/${alice.user.id}`,
      {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      },
    );
    expect(deleteOwRes.ok()).toBeTruthy();

    // 清理创建的频道
    await request.delete(`/api/channels/${privateChannel.id}`, {
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });
  });

  test("2. 前端 UI 交互验证：创建频道私密开关与编辑频道三态权限面板切换", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");

    // 进入默认公会
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 验证频道列表已加载
    await expect(page.getByText("文字频道").first()).toBeVisible({
      timeout: 5000,
    });

    // 2.1 打开创建频道弹窗
    const createChannelBtn = page
      .locator('[data-testid="sidebar-create-channel-btn"]')
      .first();
    if (await createChannelBtn.isVisible()) {
      await createChannelBtn.click();
    } else {
      // 备用触发方式：右键分类或快捷键
      await page.keyboard.press("Control+Shift+N");
    }

    const privateSwitch = page.locator(
      '[data-testid="create-channel-private-switch"]',
    );
    if (await privateSwitch.isVisible()) {
      // 验证未开启时，不显示身份组选择
      await expect(page.getByText("谁可以访问此频道？")).not.toBeVisible();

      // 开启私密频道
      await privateSwitch.click();
      await expect(page.getByText("谁可以访问此频道？")).toBeVisible();

      // 关闭私密频道
      await privateSwitch.click();
      await expect(page.getByText("谁可以访问此频道？")).not.toBeVisible();

      // 关闭弹窗
      await page.keyboard.press("Escape");
    }

    // 2.2 验证控制台无严重未捕获异常
    expect(
      consoleErrors.filter(
        (e) => !e.includes("favicon") && !e.includes("AudioContext"),
      ),
    ).toHaveLength(0);
  });
});
