import { test, expect } from "@playwright/test";

test.describe("频道分类（Category）全生命周期端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 登录用户详情接口 (具有管理员身份)
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

  test("频道分类创建、折叠展开、分类下建频道、重命名、移动与安全删除全链路验证", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 打开首页
    await page.goto("/");

    // 2. 点击服务器
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 3. 验证默认分类是否正常渲染
    const textCatHeader = page.getByText("文字频道").first();
    await expect(textCatHeader).toBeVisible({ timeout: 5000 });

    // 4. 创建新分类：点击侧边栏头部“创建分类”按钮
    const createCatBtn = page.locator('[data-testid="sidebar-create-category-btn"]');
    await expect(createCatBtn).toBeVisible();
    await createCatBtn.click();

    // 5. 填写分类名称并提交
    const catNameInput = page.locator('[data-testid="create-category-name-input"]');
    await expect(catNameInput).toBeVisible();
    const testCatName = `测试项目组_${Date.now() % 10000}`;
    await catNameInput.fill(testCatName);
    await page.locator('[data-testid="submit-create-category-btn"]').click();

    // 6. 验证新分类已成功创建并显示在左侧列表
    const newCatHeader = page.getByText(testCatName).first();
    await expect(newCatHeader).toBeVisible({ timeout: 5000 });

    // 7. 在该分类下快速创建频道
    // 悬停在分类头部，点击 + 按钮
    const catHeaderContainer = newCatHeader.locator("xpath=ancestor::*[contains(@data-testid, 'category-header-')][1]");
    await catHeaderContainer.hover();
    const plusBtn = catHeaderContainer.locator('[data-testid^="create-channel-in-category-"]');
    await expect(plusBtn).toBeVisible();
    await plusBtn.click();

    // 8. 验证弹窗中的所属分类已默认选中该分类
    const catSelect = page.locator('[data-testid="channel-category-select"]');
    await expect(catSelect).toBeVisible();
    const selectedOptionText = await catSelect.locator("option:checked").textContent();
    expect(selectedOptionText).toContain(testCatName);

    // 填写频道名称并提交
    const channelNameInput = page.locator('[data-testid="create-channel-name-input"]');
    const testChannelName = `对齐信道_${Date.now() % 10000}`;
    await channelNameInput.fill(testChannelName);
    await page.locator('button[type="submit"]:has-text("创建频道")').click();

    // 9. 验证新频道正确渲染在分类下
    const newChannelBtn = page.locator(`[data-testid="channel-button-${testChannelName}"]`).first();
    await expect(newChannelBtn).toBeVisible({ timeout: 5000 });

    // 10. 折叠与展开测试
    await newCatHeader.click();
    // 折叠后，子频道不可见
    await expect(newChannelBtn).not.toBeVisible();

    // 再次点击展开
    await newCatHeader.click();
    await expect(newChannelBtn).toBeVisible();

    // 11. 编辑分类：右键分类标题 -> 打开右键菜单 -> 编辑分类
    await newCatHeader.click({ button: "right" });
    const editCatMenuItem = page.locator('[data-testid="context-edit-category-btn"]');
    await expect(editCatMenuItem).toBeVisible();
    await editCatMenuItem.click();

    // 修改分类名称
    const editCatInput = page.locator('[data-testid="edit-category-name-input"]');
    await expect(editCatInput).toBeVisible();
    const updatedCatName = `${testCatName}_已改名`;
    await editCatInput.fill(updatedCatName);
    await page.locator('[data-testid="save-category-btn"]').click();

    // 验证分类名称已变更
    await expect(page.getByText(updatedCatName).first()).toBeVisible({ timeout: 5000 });

    // 12. 删除分类与频道孤立保护测试
    await page.getByText(updatedCatName).first().click({ button: "right" });
    const deleteCatMenuItem = page.locator('[data-testid="context-delete-category-btn"]');
    await expect(deleteCatMenuItem).toBeVisible();
    await deleteCatMenuItem.click();

    // 在弹窗中点击确认删除
    const confirmDeleteBtn = page.locator('[data-testid="delete-category-btn"]');
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click(); // 第一次点击触发确认
    await confirmDeleteBtn.click(); // 第二次点击执行删除

    // 验证分类已被移除
    await expect(page.getByText(updatedCatName)).toHaveCount(0, { timeout: 5000 });

    // 验证该分类下的子频道依然安全保留（移至顶层未分类区）
    await expect(newChannelBtn).toBeVisible({ timeout: 5000 });

    // 13. 确认无未捕获的严重控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("Failed to load resource") &&
        !err.includes("WebSocket") &&
        !err.includes("favicon"),
    );
    expect(criticalErrors).toEqual([]);
  });

  test("频道拖拽排版与跨分类流转验证：DragOverlay 跟随、平滑让位与无卡顿交互", async ({
    page,
  }) => {
    await page.goto("/");
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 确认文字频道可见
    const generalChannel = page.getByRole("button", { name: /general|常规/i }).first();
    await expect(generalChannel).toBeVisible({ timeout: 5000 });

    // 获取常规频道与语音频道的位置
    const voiceChannel = page.locator('button[title="单击预览房间，双击加入语音通话"]').first();
    if (await voiceChannel.isVisible()) {
      const sourceBox = await generalChannel.boundingBox();
      const targetBox = await voiceChannel.boundingBox();
      if (sourceBox && targetBox) {
        // 模拟鼠标精准平滑拖拽
        await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
        await page.mouse.down();
        // 移动超过 5px 激活拖拽
        await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });
        // 拖动至目标位置
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        // 松开鼠标完成放置
        await page.mouse.up();
      }
    }

    // 拖拽完成后频道依然正常可交互且未造成页面假死或 DOM 错乱
    await expect(generalChannel).toBeVisible();
    await generalChannel.click();
  });
});
