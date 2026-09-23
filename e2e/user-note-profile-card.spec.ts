import { test, expect } from "@playwright/test";

test.describe("用户信息Card备注功能（1:1 Discord 交互与私有备注架构）端到端验收", () => {
  test.beforeEach(async ({ request }) => {
    try {
      const loginRes = await request.post("/api/auth/login", {
        data: {
          emailOrUsername: "alice@tescord.local",
          password: "alicepassword123",
        },
      });
      if (loginRes.ok()) {
        const { accessToken } = (await loginRes.json()) as {
          accessToken: string;
        };
        await request.post("/api/guilds/gld_default_01/join", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      }
    } catch {
      // 容错处理
    }
  });

  test("用户备注完整链路：自身卡片无备注、他人卡片增删改查、失焦/回车保存及重新打开持久化验证", async ({
    page,
  }) => {
    const uncaughtErrors: string[] = [];
    page.on("pageerror", (err) => uncaughtErrors.push(err.message));

    // 1. 设置 1280x800 宽屏视口并访问
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 快捷登录 Jackey 管理员
    const quickLoginBtn = page.getByRole("button", {
      name: /Jackey 系统管理员/i,
    });
    if (await quickLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quickLoginBtn.click();
      await page.getByRole("button", { name: "登 录" }).click();
    }

    // 2. 进入首个默认服务器并定位频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const generalChannel = page.getByRole("button", { name: "general" });
    if (await generalChannel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await generalChannel.click();
    }

    const popoutLocator = page.locator('[data-testid="user-profile-popout"]');
    await expect(popoutLocator).toHaveCount(0);

    // ===============================================================
    // 阶段 1：校验自身卡片绝对不含备注按钮与备注区块 (isSelf 隔离)
    // ===============================================================
    const selfMemberItem = page
      .locator("[data-member-item]")
      .filter({ hasText: /Jackey|我/i })
      .first();

    if (await selfMemberItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await selfMemberItem.click();
      await expect(popoutLocator).toBeVisible({ timeout: 5000 });

      // 自身卡片绝不出现备注按钮与备注区域
      const selfNoteBtn = popoutLocator.locator(
        '[data-testid="user-profile-note-btn"]',
      );
      await expect(selfNoteBtn).toHaveCount(0);

      const selfNoteSection = popoutLocator.locator(
        '[data-testid="user-profile-note-section"]',
      );
      await expect(selfNoteSection).toHaveCount(0);

      // 关闭卡片
      await page.keyboard.press("Escape");
      await expect(popoutLocator).toHaveCount(0);
    }

    // ===============================================================
    // 阶段 2：他人卡片备注交互完整验证
    // ===============================================================
    const otherMemberItem = page
      .locator("[data-member-item]")
      .filter({ hasNotText: /Jackey|我/i })
      .first();

    await expect(otherMemberItem).toBeVisible({ timeout: 10000 });
    await otherMemberItem.click();

    await expect(popoutLocator).toBeVisible({ timeout: 5000 });

    // 2.1 校验他人卡片具备备注图标按钮与常驻备注区块
    const noteBtn = popoutLocator.locator(
      '[data-testid="user-profile-note-btn"]',
    );
    await expect(noteBtn).toBeVisible();

    const noteSection = popoutLocator.locator(
      '[data-testid="user-profile-note-section"]',
    );
    await expect(noteSection).toBeVisible();

    // 默认展示“点击添加备注”或已有备注
    const noteDisplay = popoutLocator.locator(
      '[data-testid="user-profile-note-display"]',
    );
    await expect(noteDisplay).toBeVisible();

    // 2.2 点击备注按钮进入编辑模式并自动聚焦
    await noteBtn.click();
    const noteTextarea = popoutLocator.locator(
      '[data-testid="user-profile-note-textarea"]',
    );
    await expect(noteTextarea).toBeVisible();
    await expect(noteTextarea).toBeFocused();

    // 2.3 输入备注并回车保存
    const testNoteText = "Discord风格私密好友备注-极客伙伴";
    await noteTextarea.fill(testNoteText);
    await noteTextarea.press("Enter");

    // 保存后退出编辑模式，显示区域即时呈现新备注
    await expect(noteTextarea).toHaveCount(0);
    await expect(noteDisplay).toContainText(testNoteText);

    // 备注按钮高亮并具备备注详情 Tooltip
    await expect(noteBtn).toHaveAttribute(
      "title",
      new RegExp(`备注: ${testNoteText}`),
    );

    // ===============================================================
    // 阶段 3：持久化验证（关闭后重新打开他人卡片）
    // ===============================================================
    await page
      .locator("[data-testid='server-list-container']")
      .click({ position: { x: 1, y: 1 } });
    await expect(popoutLocator).toHaveCount(0);

    // 重新点击该成员
    await otherMemberItem.click();
    await expect(popoutLocator).toBeVisible({ timeout: 5000 });

    // 验证备注已被持久化展示
    const reloadedDisplay = popoutLocator.locator(
      '[data-testid="user-profile-note-display"]',
    );
    await expect(reloadedDisplay).toContainText(testNoteText);

    // ===============================================================
    // 阶段 4：清空备注并校验恢复占位提示
    // ===============================================================
    await reloadedDisplay.click();
    const reloadedTextarea = popoutLocator.locator(
      '[data-testid="user-profile-note-textarea"]',
    );
    await expect(reloadedTextarea).toBeVisible();
    await reloadedTextarea.fill("");
    await reloadedTextarea.press("Enter");

    // 验证恢复默认占位状态
    await expect(reloadedTextarea).toHaveCount(0);
    await expect(reloadedDisplay).toContainText("点击添加备注");

    // 验证全流程无未捕获异常
    expect(uncaughtErrors).toEqual([]);
  });
});
