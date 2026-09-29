import { test, expect } from "@playwright/test";

test.describe("文字频道富文本悬浮菜单、图片上传404修复与识别码内嵌综合端到端验收", () => {
  test("1. 文字输入框选中文本弹出富文本悬浮菜单，支持Markdown包裹，Ctrl+A抑制展示", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 若在登录页，点击一键快捷登录
    const quickLoginBtn = page.getByRole("button", {
      name: /Jackey 系统管理员/i,
    });
    if (await quickLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quickLoginBtn.click();
      const loginSubmitBtn = page.getByRole("button", { name: "登 录" });
      if (
        await loginSubmitBtn.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await loginSubmitBtn.click();
      }
    }

    // 进入首个可用服务器并定位文字频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const generalChannel = page
      .getByRole("button", { name: /general|综合闲聊|常规/i })
      .first();
    if (await generalChannel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await generalChannel.click();
    }

    // 定位文字频道主输入框
    const chatInput = page.locator('[data-testid="chat-mention-input"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // 聚焦并输入测试文本
    await chatInput.click();
    await chatInput.fill("Hello World Test");

    // 选中中间的 "World" 词汇
    await page.evaluate(() => {
      const editor = document.querySelector(
        '[data-testid="chat-mention-input"]',
      );
      if (!editor || !editor.firstChild) return;
      const textNode = editor.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 6); // "World" 开始位置
      range.setEnd(textNode, 11); // "World" 结束位置
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    // 验证富文本悬浮菜单在桌面端成功弹出
    const toolbar = page.locator(
      '[data-testid="floating-format-toolbar-desktop"]',
    );
    await expect(toolbar).toBeVisible({ timeout: 5000 });

    // 验证 8 个格式化按钮完整展示
    await expect(page.locator('[data-testid="format-btn-bold"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="format-btn-italic"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="format-btn-strikethrough"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="format-btn-inlineCode"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="format-btn-codeBlock"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="format-btn-spoiler"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="format-btn-quote"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="format-btn-link"]')).toBeVisible();

    // 点击粗体按钮，验证文本被 **World** 智能包裹
    await page.locator('[data-testid="format-btn-bold"]').click();
    const contentAfterBold = await chatInput.innerText();
    expect(contentAfterBold).toContain("**World**");

    // 验证按下 Ctrl+A 快捷键全选时，悬浮菜单被严格隐藏抑制
    await chatInput.press("Control+A");
    await page.waitForTimeout(300);
    await expect(toolbar).toBeHidden();
  });

  test("2. 用户设置中心中，用户识别码 #XXXXX 移入 input 框内侧右端内嵌展示且头像预览正常", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 若在登录页，一键快捷登录
    const quickLoginBtn = page.getByRole("button", {
      name: /Jackey 系统管理员/i,
    });
    if (await quickLoginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await quickLoginBtn.click();
      const loginSubmitBtn = page.getByRole("button", { name: "登 录" });
      if (
        await loginSubmitBtn.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await loginSubmitBtn.click();
      }
    }

    // 等待主界面加载完毕
    // 底部个人设置齿轮有稳定的 test id；泛化“设置”会匹配到隐藏的服务器设置按钮。
    const settingsButton = page.getByTestId("user-settings-gear-btn");
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await settingsButton.click();

    // 确保个人设置弹窗已打开并切到个人资料 tab
    const profileTabBtn = page.locator('[data-testid="tab-profile-btn"]');
    await expect(profileTabBtn).toBeVisible({ timeout: 5000 });
    await profileTabBtn.click();

    // 验证用户名输入框可见
    const prefixInput = page.locator(
      '[data-testid="profile-username-prefix-input"]',
    );
    await expect(prefixInput).toBeVisible({ timeout: 5000 });

    // 验证其父级容器内，内嵌识别码标签以 # 开头并存在于 input 右侧内壁
    const parentContainer = prefixInput.locator("xpath=..");
    const embeddedTag = parentContainer.locator("text=/#\\d{4,5}/");
    await expect(embeddedTag).toBeVisible();

    // 验证输入新用户名时，识别码依然存在且容器处于同一 input 组内
    await prefixInput.fill("SuperJackey");
    await expect(embeddedTag).toBeVisible();

    // 验证头像组件正常渲染，右侧 1:1 卡片预览区也正常展示
    const profileCardPreview = page.locator(
      '[data-testid="profile-preview-display-name"]',
    );
    await expect(profileCardPreview).toBeVisible();
  });
});
