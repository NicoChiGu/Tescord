import { test, expect } from "@playwright/test";

test.describe("用户信息卡片 (UserProfilePopout) 全局单例互斥显示 E2E 验收", () => {
  test("核心缺陷回归：聊天消息头像呼出卡片与右侧成员列表卡片只能同时显示一个，且支持平滑切换与折叠", async ({
    page,
  }) => {
    // 监听全局未捕获异常
    const uncaughtErrors: string[] = [];
    page.on("pageerror", (err) => uncaughtErrors.push(err.message));

    // 1. 设置 1280x800 宽屏桌面端视口
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 若当前在登录页，点击一键快捷登录“Jackey 系统管理员”并点击登录
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

    // 3. 定位聊天消息中的作者头像与右侧成员列表中的成员项
    const chatAvatar = page.locator('[data-profile-trigger^="chat-"]').first();
    await expect(chatAvatar).toBeVisible({ timeout: 10000 });

    const memberItem = page.locator("[data-member-item]").first();
    await expect(memberItem).toBeVisible({ timeout: 10000 });

    const popoutLocator = page.locator('[data-testid="user-profile-popout"]');
    // 初始状态下不存在任何用户信息卡片
    await expect(popoutLocator).toHaveCount(0);

    // ===============================================================
    // 场景 1（用户反馈的核心缺陷）：聊天头像呼出卡片 -> 点击成员列表项
    // 期望结果：聊天卡片关闭，成员卡片打开，全屏幕上只能且仅能同时显示一个卡片
    // ===============================================================
    await chatAvatar.click();
    await expect(popoutLocator).toBeVisible({ timeout: 5000 });
    // 严格断言：全屏卡片数严格为 1
    await expect(popoutLocator).toHaveCount(1);

    // 点击右侧成员列表项
    await memberItem.click();
    await expect(popoutLocator).toBeVisible({ timeout: 5000 });
    // 核心红线校验：绝不能同时渲染两个卡片！必须依然严格为 1
    await expect(popoutLocator).toHaveCount(1);

    // ===============================================================
    // 场景 2：反向切换——从右侧成员卡片点击回聊天消息中的头像
    // 期望结果：右侧成员卡片平滑切换为聊天头像卡片，全屏卡片数严格为 1
    // ===============================================================
    await chatAvatar.click();
    await expect(popoutLocator).toBeVisible({ timeout: 5000 });
    await expect(popoutLocator).toHaveCount(1);

    // ===============================================================
    // 场景 3：同项重复点击折叠——点击当前已展开的触发项收起卡片
    // ===============================================================
    await chatAvatar.click();
    await expect(popoutLocator).toHaveCount(0);

    // ===============================================================
    // 场景 4：右侧成员项展开后，ESC 键及点击外部区域关闭卡片
    // ===============================================================
    await memberItem.click();
    await expect(popoutLocator).toHaveCount(1);
    await page.waitForTimeout(50);

    // 4.1 测试 ESC 快捷键关闭
    await page.keyboard.press("Escape");
    await expect(popoutLocator).toHaveCount(0);

    // 4.2 重新打开卡片，测试点击外部空白区域关闭
    await memberItem.click();
    await expect(popoutLocator).toHaveCount(1);
    await page.waitForTimeout(50);

    // 点击顶部常驻的通用频道按钮（明确在卡片外部）
    await page.getByRole("button", { name: "general" }).click();
    await expect(popoutLocator).toHaveCount(0);

    // 确认全链路执行中控制台无未捕获异常
    expect(uncaughtErrors).toEqual([]);
  });
});
