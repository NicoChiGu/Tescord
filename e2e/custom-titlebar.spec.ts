import { test, expect } from "@playwright/test";

test.describe("Electron 自定义无边框窗口与沉浸式顶栏 (TitleBar) 验收", () => {
  test("1. 纯 Web 浏览器环境下自动隐藏顶栏，不占用任何界面高度", async ({
    page,
  }) => {
    await page.goto("/");

    // 确认自定义标题栏不存在
    const titlebar = page.locator('[data-testid="custom-titlebar"]');
    await expect(titlebar).toHaveCount(0);

    // 确认根容器正常挂载
    const root = page.locator("#root");
    await expect(root).toBeVisible();
  });

  test("2. Windows/Linux 桌面端模式下呈现完整顶栏与三键控制，并支持双击最大化与状态动态同步", async ({
    page,
  }) => {
    // 注入 Windows 环境下的完整 Mock Electron API (包含应用全局事件订阅)
    await page.addInitScript(() => {
      (window as any).__ipcCalls = [];
      let maximized = false;
      let maximizeChangeHandler: ((isMax: boolean) => void) | null = null;

      (window as any).electronAPI = {
        platform: "win32",
        // 窗口控制
        minimizeWindow: async () => {
          (window as any).__ipcCalls.push("minimize");
        },
        maximizeWindow: async () => {
          maximized = !maximized;
          (window as any).__ipcCalls.push(
            maximized ? "maximize" : "unmaximize",
          );
          if (maximizeChangeHandler) maximizeChangeHandler(maximized);
        },
        closeWindow: async () => {
          (window as any).__ipcCalls.push("close");
        },
        isWindowMaximized: async () => maximized,
        onWindowMaximizedChange: (callback: (isMax: boolean) => void) => {
          maximizeChangeHandler = callback;
          return () => {
            maximizeChangeHandler = null;
          };
        },
        // 核心配套桌面 API (防未实现报错)
        getDesktopSources: async () => [],
        showNotification: async () => true,
        onNotificationClick: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => false,
        onStatusChangeFromTray: () => () => {},
        syncUserStatus: () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalPTTDown: () => () => {},
        onGlobalPTTUp: () => () => {},
        setPTTKeybind: async () => true,
      };
    });

    await page.goto("/");

    // 1. 验证标题栏挂载且包含 TESCORD 品牌名称
    const titlebar = page.locator('[data-testid="custom-titlebar"]');
    await expect(titlebar).toBeVisible({ timeout: 10000 });
    await expect(titlebar).toContainText("TESCORD");

    // 2. 验证三个控制按钮可见
    const minimizeBtn = page.locator('[data-testid="window-minimize-btn"]');
    const maximizeBtn = page.locator('[data-testid="window-maximize-btn"]');
    const closeBtn = page.locator('[data-testid="window-close-btn"]');

    await expect(minimizeBtn).toBeVisible();
    await expect(maximizeBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    // 初始状态下最大化按钮标题应为“最大化”
    await expect(maximizeBtn).toHaveAttribute("title", "最大化");

    // 3. 验证点击最小化
    await minimizeBtn.click();
    let calls = await page.evaluate(() => (window as any).__ipcCalls);
    expect(calls).toContain("minimize");

    // 4. 验证点击最大化及动态图标/提示切换
    await maximizeBtn.click();
    calls = await page.evaluate(() => (window as any).__ipcCalls);
    expect(calls).toContain("maximize");
    // 状态更新后标题变为“向下还原”
    await expect(maximizeBtn).toHaveAttribute("title", "向下还原");

    // 再次点击还原
    await maximizeBtn.click();
    calls = await page.evaluate(() => (window as any).__ipcCalls);
    expect(calls).toContain("unmaximize");
    await expect(maximizeBtn).toHaveAttribute("title", "最大化");

    // 5. 验证双击空白拖拽区触发最大化
    const dragArea = titlebar.locator("div.flex-1");
    await dragArea.dblclick();
    calls = await page.evaluate(() => (window as any).__ipcCalls);
    expect(calls.filter((c: string) => c === "maximize").length).toBe(2);

    // 6. 验证点击关闭
    await closeBtn.click();
    calls = await page.evaluate(() => (window as any).__ipcCalls);
    expect(calls).toContain("close");
  });

  test("3. macOS 桌面端模式下适配原生交通灯，隐藏右侧自绘制按钮并保留左侧避让边距", async ({
    page,
  }) => {
    // 注入 macOS 环境下的完整 Mock Electron API
    await page.addInitScript(() => {
      (window as any).electronAPI = {
        platform: "darwin",
        minimizeWindow: async () => {},
        maximizeWindow: async () => {},
        closeWindow: async () => {},
        isWindowMaximized: async () => false,
        onWindowMaximizedChange: () => () => {},
        getDesktopSources: async () => [],
        showNotification: async () => true,
        onNotificationClick: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => false,
        onStatusChangeFromTray: () => () => {},
        syncUserStatus: () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalPTTDown: () => () => {},
        onGlobalPTTUp: () => () => {},
        setPTTKeybind: async () => true,
      };
    });

    await page.goto("/");

    // 1. 验证标题栏挂载且呈现品牌
    const titlebar = page.locator('[data-testid="custom-titlebar"]');
    await expect(titlebar).toBeVisible({ timeout: 10000 });
    await expect(titlebar).toContainText("TESCORD");

    // 2. 验证右侧自绘制控制按钮已隐藏（macOS 原生交通灯接管）
    const minimizeBtn = page.locator('[data-testid="window-minimize-btn"]');
    const maximizeBtn = page.locator('[data-testid="window-maximize-btn"]');
    const closeBtn = page.locator('[data-testid="window-close-btn"]');

    await expect(minimizeBtn).toHaveCount(0);
    await expect(maximizeBtn).toHaveCount(0);
    await expect(closeBtn).toHaveCount(0);

    // 3. 验证左侧区域避让交通灯 (包含 pl-20 类)
    const logoContainer = titlebar.locator("div").first();
    await expect(logoContainer).toHaveClass(/pl-20/);
  });
});
