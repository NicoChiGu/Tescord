import { test, expect } from "@playwright/test";

test.describe("用户资料卡片重排版与图1/图2交互差异化验收 (UserProfilePopout Redesign)", () => {
  test("图1（自身卡片：气泡状态与编辑个人资料）与图2（他人卡片：快捷私信与共同服务器）完整交互链路验证", async ({
    page,
  }) => {
    // 监听全局未捕获异常
    const uncaughtErrors: string[] = [];
    page.on("pageerror", (err) => uncaughtErrors.push(err.message));

    // 1. 设置 1280x800 宽屏桌面端视口并访问
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 若在登录页，一键快捷登录“Jackey 系统管理员”
    const quickLoginBtn = page.getByRole("button", {
      name: /Jackey 系统管理员/i,
    });
    if (await quickLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quickLoginBtn.click();
      await page.getByRole("button", { name: "登 录" }).click();
    }

    // 2. 进入首个默认服务器 (Tescord 极客总部) 并进入 general 频道
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
    // 阶段 1：【图1设计方案】查看当前登录用户自身
    // ===============================================================
    // 在右侧成员列表中找到当前用户（Jackey / 我）
    const selfMemberItem = page
      .locator("[data-member-item]")
      .filter({ hasText: /Jackey|我/i })
      .first();

    if (await selfMemberItem.isVisible({ timeout: 5000 }).catch(() => false)) {
      await selfMemberItem.click();
      await expect(popoutLocator).toBeVisible({ timeout: 5000 });

      // 1.1 校验图1核心元素：存在“編輯個人資料”按钮
      const editProfileBtn = popoutLocator.getByRole("button", {
        name: /編輯個人資料/i,
      });
      await expect(editProfileBtn).toBeVisible();

      // 1.2 校验图1核心元素：绝对不能存在“傳訊息給 @”输入框
      const dmInputOnSelf = popoutLocator.getByPlaceholder(/傳訊息給 @/i);
      await expect(dmInputOnSelf).toHaveCount(0);

      // 1.3 校验自定义状态气泡与行内编辑交互
      const statusBubble = popoutLocator.locator(".group\\/bubble");
      if (await statusBubble.isVisible({ timeout: 2000 }).catch(() => false)) {
        await statusBubble.click();
        const inlineInput = popoutLocator.getByPlaceholder("设定状态...");
        await expect(inlineInput).toBeVisible();
        await inlineInput.fill("正在测试图1卡片");
        await inlineInput.press("Enter");
        // 保存后变回展示气泡，且内容已更新
        await expect(
          popoutLocator.getByText("正在测试图1卡片"),
        ).toBeVisible({ timeout: 5000 });
      }

      // 关闭卡片 (再次点击该项折叠或按 ESC)
      await page.waitForTimeout(100);
      await page.keyboard.press("Escape");
      if (await popoutLocator.isVisible().catch(() => false)) {
        await selfMemberItem.click();
      }
      await expect(popoutLocator).toHaveCount(0);
    }

    // ===============================================================
    // 阶段 2：【图2设计方案】查看其他服务器成员
    // ===============================================================
    // 在成员列表中找到非自身的其他成员
    const otherMemberItem = page
      .locator("[data-member-item]")
      .filter({ hasNotText: /Jackey|我/i })
      .first();

    await expect(otherMemberItem).toBeVisible({ timeout: 10000 });
    await otherMemberItem.click();

    await expect(popoutLocator).toBeVisible({ timeout: 5000 });

    // 2.1 校验图2核心元素：共同服务器指示
    const mutualGuilds = popoutLocator.getByText(/個伺服器/i);
    await expect(mutualGuilds).toBeVisible();

    // 2.2 校验图2核心元素：绝对不含自身的大按钮“編輯個人資料”
    const editBtnOnOther = popoutLocator.getByRole("button", {
      name: /編輯個人資料/i,
    });
    await expect(editBtnOnOther).toHaveCount(0);

    // 2.3 校验图2核心元素：右上角更多操作菜单
    const moreBtn = popoutLocator.getByTitle("更多操作");
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    await expect(popoutLocator.getByText("@提及成员")).toBeVisible();
    await moreBtn.click(); // 再次点击折叠

    // 2.4 校验图2核心元素：底部“傳訊息給 @用户”快捷输入框
    const quickDMInput = popoutLocator.getByPlaceholder(/傳訊息給 @/i);
    await expect(quickDMInput).toBeVisible();

    // 2.5 快捷私信测试：输入内容并回车，自动跳转至私信窗口
    await quickDMInput.fill("你好，这是一条图2快捷私信测试");
    await quickDMInput.press("Enter");

    // 卡片在发送后自动关闭
    await expect(popoutLocator).toHaveCount(0, { timeout: 5000 });

    // 确认全流程无控制台严重未捕获错误
    expect(uncaughtErrors).toEqual([]);
  });
});
