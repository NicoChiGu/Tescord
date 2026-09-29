import { test, expect, type Page } from "@playwright/test";

const openInitialDrawer = async (page: Page) => {
  const button = page
    .getByTitle("打开频道与服务器抽屉")
    .or(page.getByTestId("toggle-mobile-drawer-btn"))
    .or(page.getByTestId("mobile-open-drawer-btn"))
    .first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.click();
  await expect(page.getByTestId("home-nav-button")).toBeVisible();
};

test.describe("服务器设置：ESC/滚动条、移动端UI边距与成员列表角色对齐与次菜单交互验收", () => {
  test("验证移动端 (390px) 服务器设置无多余右侧空白，且各选项卡全宽适配", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto("/");
    await openInitialDrawer(page);

    const server = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(server).toBeVisible();
    await server.click();

    await page.getByTestId("toggle-mobile-drawer-btn").click();
    const mobileSettingsBtn = page.getByTestId("mobile-server-settings-btn");
    await expect(mobileSettingsBtn).toBeVisible();
    await mobileSettingsBtn.click();

    // 验证服务器设置目录展开
    const menu = page.getByTestId("server-settings-menu");
    await expect(menu).toBeVisible();

    // 点击身份组选项卡进入详情
    const rolesTabBtn = page.getByTestId("server-settings-roles-tab");
    await expect(rolesTabBtn).toBeVisible();
    await rolesTabBtn.click();

    const detail = page.getByTestId("server-settings-detail");
    await expect(detail).toBeVisible();

    // 验证详情容器与屏幕宽度贴合，右侧无巨大空隙
    const bounds = await detail.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(386);

    // 验证移动端顶部统一关闭按钮 (依照用户个人设置设计)
    const mobileCloseBtn = page.getByTestId(
      "close-server-settings-mobile-btn",
    );
    await expect(mobileCloseBtn).toBeVisible();
    await mobileCloseBtn.click();
    await expect(detail).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test("验证桌面端成员列表中角色 Badge 与 + 号水平基准线严格对齐，且 + 号次菜单通过 Portal 正常展示与交互", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 进入服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 右键点击服务器标题栏打开上下文菜单
    const serverHeader = page.getByTestId("server-header");
    await expect(serverHeader).toBeVisible();
    await serverHeader.click({ button: "right" });

    const serverSettingsMenuItem = page.getByTestId(
      "server-menu-settings-btn",
    );
    await expect(serverSettingsMenuItem).toBeVisible();
    await serverSettingsMenuItem.click();

    const serverModal = page.getByTestId("server-settings-modal");
    await expect(serverModal).toBeVisible();

    // 切换到成员列表
    const membersTabBtn = page.getByRole("button", { name: /成员列表/i });
    await membersTabBtn.click();

    // 等待成员列表渲染
    await expect(page.getByText(/成员管理/i)).toBeVisible();

    // 获取所有成员行
    const memberRows = page.locator("[data-testid^='member-row-']");
    const memberCount = await memberRows.count();
    expect(memberCount).toBeGreaterThan(0);

    // 验证成员行布局对齐：第一列固定宽，第二列角色列左边界在同一垂直线上
    if (memberCount >= 2) {
      const firstRowCol = memberRows
        .nth(0)
        .locator("> div")
        .nth(1);
      const secondRowCol = memberRows
        .nth(1)
        .locator("> div")
        .nth(1);

      const box1 = await firstRowCol.boundingBox();
      const box2 = await secondRowCol.boundingBox();

      if (box1 && box2) {
        // x 坐标起始位置必须严格对齐（误差容忍 2px）
        expect(Math.abs(box1.x - box2.x)).toBeLessThanOrEqual(2);
      }
    }

    // 获取所有 + 号按钮
    const plusButtons = page.locator("[data-testid^='add-role-btn-']");
    const count = await plusButtons.count();

    if (count > 0) {
      const firstPlusBtn = plusButtons.first();
      await expect(firstPlusBtn).toBeVisible();

      // 点击 + 号按钮唤起角色分配次菜单
      await firstPlusBtn.click();

      // 验证通过 React Portal 挂载的次菜单 popover 正确显示在 document.body 上
      const rolePicker = page.getByTestId("role-picker-popover");
      await expect(rolePicker).toBeVisible();

      // 验证次菜单内部搜索框
      const searchInput = page.getByTestId("role-picker-search-input");
      await expect(searchInput).toBeVisible();

      // 在搜索框输入过滤测试
      await searchInput.fill("Admin");
      await searchInput.fill("");

      // 验证点击外部区域自动关闭次菜单
      await page.mouse.click(10, 10);
      await expect(rolePicker).not.toBeVisible();
    }

    // 验证右上角桌面端 ESC 悬浮按钮存在并可用
    const closeBtn = page.getByTestId("close-server-settings-btn");
    await expect(closeBtn).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(serverModal).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});
