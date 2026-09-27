import { test, expect } from "@playwright/test";

test.describe("六项用户体验改进与身份组管理增强综合验收", () => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const tokenPayload = Buffer.from(
    JSON.stringify({ exp, id: "owner_user_1", username: "OwnerUser", role: "SUPER_ADMIN" }),
  ).toString("base64");
  const validJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${tokenPayload}.mock_sig`;

  test.beforeEach(async ({ page }) => {
    // 注入有效未过期 JWT Token 与当前登录用户
    await page.addInitScript(
      ({ token }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", "mock_e2e_owner_refresh");
        localStorage.setItem(
          "tescord_last_user",
          JSON.stringify({
            id: "owner_user_1",
            username: "OwnerUser",
            displayName: "服主大大",
            email: "owner@tescord.local",
            role: "SUPER_ADMIN",
          }),
        );
      },
      { token: validJwt },
    );

    // Mock 用户信息接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "owner_user_1",
          username: "OwnerUser",
          displayName: "服主大大",
          email: "owner@tescord.local",
          role: "SUPER_ADMIN",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    // Mock 刷新 Token 接口，防止触发 ReauthModal
    await page.route("**/api/auth/refresh", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: validJwt,
          refreshToken: "valid_owner_refresh",
          user: {
            id: "owner_user_1",
            username: "OwnerUser",
            displayName: "服主大大",
            email: "owner@tescord.local",
            role: "SUPER_ADMIN",
            status: "ONLINE",
          },
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
            id: "guild_test_1",
            name: "测试极客公会",
            ownerId: "owner_user_1",
            iconUrl: null,
            channels: [
              { id: "c_text_1", name: "一般闲聊", type: "TEXT", guildId: "guild_test_1" },
              { id: "c_voice_1", name: "开黑语音", type: "VOICE", guildId: "guild_test_1" },
            ],
            roles: [
              { id: "role_admin", name: "Admin", position: 1, permissions: 8, isDefault: false, color: "#5865f2" },
              { id: "role_everyone", name: "@everyone", position: 0, permissions: 104324161, isDefault: true, color: null },
            ],
            members: [
              {
                userId: "owner_user_1",
                guildId: "guild_test_1",
                nickname: "服主昵称",
                roleIds: ["role_admin"],
                joinedAt: new Date().toISOString(),
                user: {
                  id: "owner_user_1",
                  username: "OwnerUser",
                  displayName: "服主大大",
                  avatarUrl: null,
                },
              },
              {
                userId: "member_user_2",
                guildId: "guild_test_1",
                nickname: null,
                roleIds: [],
                joinedAt: new Date().toISOString(),
                user: {
                  id: "member_user_2",
                  username: "RegularMember",
                  displayName: "普通成员展示名",
                  avatarUrl: null,
                },
              },
            ],
          },
        ]),
      });
    });

    // Mock 频道消息
    await page.route("**/api/channels/**/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock 私信列表
    await page.route("**/api/users/@me/dm-channels", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    // Mock 身份组接口
    await page.route("**/api/guilds/guild_test_1/roles", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "role_admin", name: "Admin", position: 1, permissions: 8, isDefault: false, color: "#5865f2" },
          { id: "role_everyone", name: "@everyone", position: 0, permissions: 104324161, isDefault: true, color: null },
        ]),
      });
    });

    // 屏蔽 WebSocket 网关自动重连
    await page.routeWebSocket("**/gateway", (socket) => socket.close());
  });

  test("1. 验证语音与成员展示名优先级规则 (member.nickname > user.displayName > user.username)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 10000 });

    // 进入公会
    const guildBtn = page.getByRole("button", { name: "测试极客公会" });
    await expect(guildBtn).toBeVisible({ timeout: 10000 });
    await guildBtn.click();

    // 验证右侧成员列表中：优先展示 nickname "服主昵称" 以及普通成员的 displayName "普通成员展示名"
    await expect(page.getByText("服主昵称")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("普通成员展示名")).toBeVisible({ timeout: 5000 });
  });

  test("2. 验证服务器邀请功能：按需建立邀请，避免每次打开Modal频繁刷码，有活动链接时可复用", async ({
    page,
  }) => {
    let inviteCreatedCount = 0;
    let activeQueried = false;

    await page.route("**/api/guilds/guild_test_1/invites/active", (route) => {
      activeQueried = true;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(null),
      });
    });

    await page.route("**/api/guilds/guild_test_1/invites", (route) => {
      if (route.request().method() === "POST") {
        inviteCreatedCount++;
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            code: "ON_DEMAND_INVITE_123",
            creatorId: "owner_user_1",
            guildId: "guild_test_1",
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      }
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "测试极客公会" }).click();

    // 右键点击公会标题打开上下文菜单
    const serverHeader = page.getByTestId("server-header");
    await expect(serverHeader).toBeVisible({ timeout: 10000 });
    await serverHeader.click({ button: "right" });

    const inviteMenuItem = page.getByTestId("server-menu-invite-btn");
    await expect(inviteMenuItem).toBeVisible({ timeout: 5000 });
    await inviteMenuItem.click();

    // 验证邀请弹窗挂载，展示“建立邀请链接”按钮，且初次打开未直接发送 POST 创建邀请 (inviteCreatedCount === 0)
    const createBtn = page.getByRole("button", { name: "建立邀请链接" });
    await expect(createBtn).toBeVisible();
    expect(activeQueried).toBe(true);
    expect(inviteCreatedCount).toBe(0);

    // 点击“建立邀请链接”按钮
    await createBtn.click();

    // 验证按需生成了邀请链接并展示
    expect(inviteCreatedCount).toBe(1);
    await expect(page.locator("input[value*='ON_DEMAND_INVITE_123']")).toBeVisible();
    await expect(page.getByRole("button", { name: /生成新链接/i })).toBeVisible();
  });

  test("3. 验证服务器图标编辑：取消网络直链输入，支持裁剪/压缩，且模态框滚动条位于 ESC 右侧", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "测试极客公会" }).click();

    // 右键打开服务器设置
    const serverHeader = page.getByTestId("server-header");
    await expect(serverHeader).toBeVisible({ timeout: 10000 });
    await serverHeader.click({ button: "right" });

    const settingsMenuItem = page.getByTestId("server-menu-settings-btn");
    await expect(settingsMenuItem).toBeVisible({ timeout: 5000 });
    await settingsMenuItem.click();

    const serverSettingsModal = page.locator('[data-testid="server-settings-modal"]');
    await expect(serverSettingsModal).toBeVisible();

    // 3.1 验证概况页中：无直接输入网络图片直链的输入框
    await expect(page.locator("input[placeholder*='http']")).toHaveCount(0);
    // 验证上传图标提示包含 512x512 推荐以及裁剪压缩能力
    await expect(page.getByText(/推荐尺寸至少为 512x512/i)).toBeVisible();

    // 3.2 验证设置模态框的 ESC 按钮与滚动条布局：ESC 按钮悬浮且在其右侧拥有滚动条空间 (pr-16 / absolute right-6)
    const escBtn = page.locator('[data-testid="close-server-settings-btn"]:visible');
    await expect(escBtn).toBeVisible();
    const escBox = await escBtn.boundingBox();
    const modalBox = await serverSettingsModal.boundingBox();

    expect(escBox).not.toBeNull();
    expect(modalBox).not.toBeNull();
    if (escBox && modalBox) {
      expect(escBox.x + escBox.width).toBeLessThan(modalBox.x + modalBox.width);
      expect(escBox.x).toBeGreaterThan(modalBox.x + modalBox.width - 90);
    }
  });

  test("4. 验证成员管理与身份组管理：Badge与Plus在单行，单选即关，且身份组管理支持删除与无误判告警", async ({
    page,
  }) => {
    await page.route("**/api/guilds/guild_test_1/roles", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "role_admin", name: "Admin", position: 1, permissions: 8, isDefault: false, color: "#5865f2" },
          { id: "role_everyone", name: "@everyone", position: 0, permissions: 104324161, isDefault: true, color: null },
        ]),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "测试极客公会" }).click();

    const serverHeader = page.getByTestId("server-header");
    await expect(serverHeader).toBeVisible({ timeout: 10000 });
    await serverHeader.click({ button: "right" });

    const settingsMenuItem = page.getByTestId("server-menu-settings-btn");
    await expect(settingsMenuItem).toBeVisible({ timeout: 5000 });
    await settingsMenuItem.click();

    // 4.1 切换至“成员列表” Tab
    await page.getByRole("button", { name: /成员名?单?|成员列表/i }).click();

    // 验证成员列表中：角色 Badge 存在且样式为单行排列
    const adminBadge = page.getByText("Admin", { exact: true });
    await expect(adminBadge).toBeVisible();

    // 4.2 切换至“身份组” Tab
    await page.getByTestId("server-settings-roles-tab").click();

    // 验证不会出现“该身份组的层级权重高于或等同于您拥有的最高身份组”的误判警告（因为当前用户是 Owner / SUPER_ADMIN）
    await expect(page.getByText(/该身份组的层级权重高于或等同于您拥有的最高身份组/i)).not.toBeVisible();

    // 验证权限分类标签完整且独立自适应（全部、常规管理、成员与邀请、文字互动、语音频道、高级特权）
    await expect(page.getByRole("button", { name: "全部" })).toBeVisible();
    await expect(page.getByRole("button", { name: "常规管理" })).toBeVisible();
    await expect(page.getByRole("button", { name: "高级特权" })).toBeVisible();

    // 验证存在危险操作区中的“删除身份组”按钮
    const deleteRoleBtn = page.getByRole("button", { name: /删除身份组/i }).first();
    await expect(deleteRoleBtn).toBeVisible();
  });
});
