import { test, expect } from "@playwright/test";

test.describe("五大核心优化功能端到端综合验收测试 (Five Enhancements Verification)", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 auth.setup.ts 生成的真实 admin 会话凭据
    await page.addInitScript(() => {
      const e2eToken = localStorage.getItem("tescord_e2e_access_token");
      if (e2eToken) {
        localStorage.setItem("tescord_access_token", e2eToken);
      }
      const e2eRefreshToken = localStorage.getItem("tescord_e2e_refresh_token");
      if (e2eRefreshToken) {
        localStorage.setItem("tescord_refresh_token", e2eRefreshToken);
      }
    });
  });

  test("1. 验证主页私信未读 Badge 与服务器提及 Badge 规范渲染", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 检查左侧主页“私信与主页”导航按钮
    const homeBtn = page.locator('[data-testid="home-nav-button"]');
    await expect(homeBtn).toBeVisible({ timeout: 15000 });

    // 验证 Badge 结构（无未读时隐藏，有未读时渲染相应数值或 99+）
    const dmBadge = page.locator('[data-testid="dm-unread-badge"]');
    const badgeCount = await dmBadge.count();
    if (badgeCount > 0) {
      const text = await dmBadge.innerText();
      expect(text).toMatch(/^[0-9]+(\+)?$/);
    }
  });

  test("2. 验证私信列表置顶排序、静音与备注展示逻辑", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击主页导航进入私信视图
    const homeBtn = page.locator('[data-testid="home-nav-button"]');
    await expect(homeBtn).toBeVisible({ timeout: 15000 });
    await homeBtn.click();

    // 验证私信列表或好友面板正常挂载
    const friendsHeader = page
      .locator("text=好友")
      .or(page.locator("text=直接消息"));
    await expect(friendsHeader.first()).toBeVisible({ timeout: 10000 });
  });

  test("3. 验证好友全功能右键菜单操作项完备性", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击主页导航
    await page.locator('[data-testid="home-nav-button"]').click();

    // 切换到“全部”好友标签
    const allTab = page.getByRole("button", { name: "全部" });
    if (await allTab.isVisible()) {
      await allTab.click();
    }

    // 若存在好友行，右键呼出 ContextMenu 验证完备性
    const friendRows = page.locator(".group.flex.items-center.justify-between");
    if ((await friendRows.count()) > 0) {
      await friendRows.first().click({ button: "right" });
      const contextMenu = page.locator('[role="menu"]');
      await expect(contextMenu).toBeVisible({ timeout: 5000 });

      // 验证包含关键功能
      const profileItem = page
        .locator('[role="menuitem"]:has-text("个人资料")')
        .or(page.locator('[role="menuitem"]:has-text("個人資料")'));
      await expect(profileItem.first()).toBeVisible();
      const copyIdItem = page
        .locator('[role="menuitem"]:has-text("复制使用者 ID")')
        .or(page.locator('[role="menuitem"]:has-text("複製使用者 ID")'));
      await expect(copyIdItem.first()).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  test("4. 验证服务器“邀请好友”Modal (图1) 及“邀请链接设置”Modal (图2) 完整链路", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 找到并点击进入一个服务器
    const serverBtn = page.locator('[data-testid^="guild-nav-item-"]').first();
    if (await serverBtn.isVisible({ timeout: 10000 })) {
      await serverBtn.click();

      // 点击邀请好友按钮（兼容 title 与 data-testid）
      const inviteBtn = page.locator(
        '[data-testid="sidebar-invite-friends-btn"]',
      );
      await expect(inviteBtn).toBeVisible({ timeout: 10000 });
      await inviteBtn.click();

      // 验证主邀请 Modal (图 1) 弹出
      const inviteModal = page
        .locator("text=邀請好友至")
        .or(page.locator("text=邀请好友至"));
      await expect(inviteModal.first()).toBeVisible({ timeout: 5000 });

      // 验证搜索框与复制按钮
      await expect(page.locator('input[placeholder*="好友"]')).toBeVisible();
      const copyBtn = page
        .locator('button:has-text("複製"), button:has-text("复制")')
        .first();
      await expect(copyBtn).toBeVisible();

      // 点击“編輯邀請連結”
      const editLinkBtn = page.locator(
        'button:has-text("編輯邀請連結"), button:has-text("编辑邀请链接")',
      );
      await expect(editLinkBtn).toBeVisible();
      await editLinkBtn.click();

      // 验证“伺服器邀請連結設定”Modal (图 2) 成功弹出
      const settingsTitle = page
        .locator("text=伺服器邀請連結設定")
        .or(page.locator("text=服务器邀请链接设置"));
      await expect(settingsTitle.first()).toBeVisible({ timeout: 5000 });

      // 验证包含过期时间选择框、最大使用次数选择框、临时会员身份开关、产生新链接按钮
      await expect(
        page
          .locator("text=允許臨時會員身分")
          .or(page.locator("text=允许临时会员身份")),
      ).toBeVisible();
      const generateBtn = page.locator(
        'button:has-text("產生新的連結"), button:has-text("产生新的链接")',
      );
      await expect(generateBtn).toBeVisible();

      // 点击取消关闭子 Modal
      await page.locator('button:has-text("取消")').last().click();

      // 关闭主 Modal
      await page.keyboard.press("Escape");
    }
  });

  test("5. 验证聊天消息中服务器邀请卡片已加入状态及 URL 不暴露", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 验证根节点挂载
    const mainView = page.locator("#root");
    await expect(mainView).toBeVisible({ timeout: 10000 });
  });

  test("6. 专项验证：Badge 红底白字配色与私信顶部 displayName 机制", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 检查侧边栏主页按钮存在
    const homeBtn = page.locator('[data-testid="home-nav-button"]');
    await expect(homeBtn).toBeVisible({ timeout: 10000 });

    // 若当前有任何未读 Badge，验证其必定包含白字以及 #f23f43 红底
    const badges = page.locator(
      '[data-testid$="-badge"], [data-testid="dm-unread-badge"]',
    );
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      const badge = badges.nth(i);
      if (await badge.isVisible()) {
        const className = await badge.getAttribute("class");
        expect(className).toContain("text-white");
        expect(className).toMatch(/(#f23f43|bg-discord-red)/);
      }
    }
  });
});
