import { test, expect } from "@playwright/test";

test.describe("版本更新公告模态框 (What's New Modal) 自动化验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入由 auth.setup.ts 生成的真实已签名 admin 会话 Token
    await page.addInitScript(() => {
      const e2eToken = localStorage.getItem("tescord_e2e_access_token");
      const e2eRefresh = localStorage.getItem("tescord_e2e_refresh_token");
      if (e2eToken) {
        localStorage.setItem("tescord_access_token", e2eToken);
      }
      if (e2eRefresh) {
        localStorage.setItem("tescord_refresh_token", e2eRefresh);
      }
    });
  });

  test("1. 首次登入或版本升级自动温和弹出，点击'我知道了'写入已读并不再弹窗", async ({
    page,
  }) => {
    // 仅在首次打开时清空版本已阅标记，reload 时保留已读标记
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("e2e_reloaded")) {
        localStorage.removeItem("tescord_last_seen_changelog_version");
      }
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 等待自动弹窗唤起 (有 800ms 温和延时)
    const modal = page.locator('[data-testid="whats-new-modal"]');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // 验证版本号徽章与分类标题
    const versionBadge = page.locator(
      '[data-testid="whats-new-version-badge"]',
    );
    await expect(versionBadge).toHaveText("v0.2.0");

    // 验证分类条目包含“新增功能”
    await expect(modal).toContainText("新增功能");
    await expect(modal).toContainText("多引擎低延迟音视频网关");

    // 点击“我知道了”关闭弹窗
    const gotItBtn = page.locator('[data-testid="whats-new-got-it-btn"]');
    await gotItBtn.click();
    await expect(modal).not.toBeVisible();

    // 验证已阅状态已成功持久化至 localStorage
    const savedVersion = await page.evaluate(() => {
      return localStorage.getItem("tescord_last_seen_changelog_version");
    });
    expect(savedVersion).toBe("0.2.0");

    // 设置 sessionStorage 标记并在刷新后验证不会再次弹出
    await page.evaluate(() => {
      sessionStorage.setItem("e2e_reloaded", "1");
    });
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(modal).not.toBeVisible();
  });

  test("2. 在设置面板（关于与更新）中可主动点击呼出更新公告", async ({
    page,
  }) => {
    // 预先标记当前版本已读，避免自弹窗干扰
    await page.addInitScript(() => {
      localStorage.setItem("tescord_last_seen_changelog_version", "0.2.0");
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const modal = page.locator('[data-testid="whats-new-modal"]');
    await expect(modal).not.toBeVisible();

    // 1. 点击左下角用户设置齿轮
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 15000 });
    await gearBtn.click();

    // 验证设置弹窗呈现
    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 2. 点击左侧导航栏中“版本与更新 / 关于”标签页
    const updatesTabBtn = page.locator('[data-testid="tab-updates-btn"]');
    await expect(updatesTabBtn).toBeVisible();
    await updatesTabBtn.click();

    // 3. 点击“查看更新公告”按钮
    const viewChangelogBtn = page.locator(
      '[data-testid="web-view-changelog-btn"], [data-testid="desktop-view-changelog-btn"]',
    );
    await expect(viewChangelogBtn.first()).toBeVisible({ timeout: 5000 });
    await viewChangelogBtn.first().click();

    // 4. 验证 WhatsNewModal 成功弹出并展示当前版本
    await expect(modal).toBeVisible();
    await expect(
      page.locator('[data-testid="whats-new-version-badge"]'),
    ).toHaveText("v0.2.0");

    // 5. 点击“我知道了”关闭弹窗
    const gotItBtn = page.locator('[data-testid="whats-new-got-it-btn"]');
    await gotItBtn.click();
    await expect(modal).not.toBeVisible();
  });

  test("3. 桌面端增量更新就绪横幅联动：展示自适应'立即重启并应用更新'按钮", async ({
    page,
  }) => {
    // 注入模拟的 electronAPI 对象
    await page.addInitScript(() => {
      let readyCallback: ((data: { version: string }) => void) | null = null;

      (window as any).electronAPI = {
        platform: "win32",
        getDesktopSources: async () => [],
        showNotification: async () => true,
        onNotificationClick: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => true,
        onStatusChangeFromTray: () => () => {},
        syncUserStatus: () => {},
        syncLocale: () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalPTTDown: () => () => {},
        onGlobalPTTUp: () => () => {},
        setPTTKeybind: async () => true,
        minimizeWindow: async () => {},
        maximizeWindow: async () => {},
        closeWindow: async () => {},
        isWindowMaximized: async () => false,
        onWindowMaximizedChange: () => () => {},
        getGPUInfo: async () => ({
          isIntel: false,
          isNvidia: true,
          isAmd: false,
        }),
        network: {
          detectLocalNetwork: async () => ({
            ipv4List: ["192.168.1.100"],
            ipv6List: [],
            hasPublicIPv6: false,
          }),
          mapPort: async () => ({ success: true }),
          unmapPort: async () => true,
        },
        updater: {
          getConfig: async () => ({
            enabled: true,
            currentHostVersion: "0.1.0",
            currentWebVersion: "0.1.0",
            gitRepo: "labsphaela/Tescord",
            preferredProxy: "https://v6.gh-proxy.org/",
          }),
          checkForUpdates: async () => ({ enabled: true, hasUpdate: false }),
          downloadAndApply: async () => ({ success: true }),
          restartToApply: async () => {
            (window as any).__restartTriggered = true;
          },
          onProgress: () => () => {},
          onUpdateReady: (cb: any) => {
            readyCallback = cb;
            return () => {
              readyCallback = null;
            };
          },
          setCustomProxy: async () => ({ success: true }),
        },
      };

      // 预设版本已读
      localStorage.setItem("tescord_last_seen_changelog_version", "0.2.0");

      // 延时模拟后台增量更新下载就绪广播
      setTimeout(() => {
        if (readyCallback) {
          readyCallback({ version: "0.2.0" });
        }
      }, 500);
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 验证更新横幅浮现
    const bannerViewBtn = page.locator(
      '[data-testid="banner-view-changelog-btn"]',
    );
    await expect(bannerViewBtn).toBeVisible({ timeout: 5000 });

    // 从横幅点击“查看更新内容”
    await bannerViewBtn.click();

    // 验证 Modal 弹出
    const modal = page.locator('[data-testid="whats-new-modal"]');
    await expect(modal).toBeVisible();

    // 验证自适应主按钮为“立即重启并应用更新”
    const restartBtn = page.locator('[data-testid="whats-new-restart-btn"]');
    await expect(restartBtn).toBeVisible();
    await expect(restartBtn).toContainText("立即重启并应用更新");

    // 点击重启按钮
    await restartBtn.click();
    await expect(modal).not.toBeVisible();

    const restartTriggered = await page.evaluate(() => {
      return (window as any).__restartTriggered === true;
    });
    expect(restartTriggered).toBe(true);
  });

  test("4. 5 种官方语言即时热切换无破损与文案对称性", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tescord_last_seen_changelog_version", "0.2.0");
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 通过 CustomEvent 唤起弹窗
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("tescord:open-whats-new", {
          detail: { version: "0.2.0", mode: "view" },
        }),
      );
    });

    const modal = page.locator('[data-testid="whats-new-modal"]');
    await expect(modal).toBeVisible();

    // 1. zh-CN 简体中文
    await expect(modal).toContainText("更新公告与新功能");
    await expect(modal).toContainText("新增功能");

    // 2. 切换到 en-US
    await page.evaluate(async () => {
      if ((window as any).changeLocale) {
        await (window as any).changeLocale("en-US");
      }
    });
    await expect(modal).toContainText("What's New in Tescord");
    await expect(modal).toContainText("New Features");

    // 3. 切换到 ja-JP
    await page.evaluate(async () => {
      if ((window as any).changeLocale) {
        await (window as any).changeLocale("ja-JP");
      }
    });
    await expect(modal).toContainText("Tescord の新機能とお知らせ");
    await expect(modal).toContainText("新機能");

    // 4. 切换到 zh-TW
    await page.evaluate(async () => {
      if ((window as any).changeLocale) {
        await (window as any).changeLocale("zh-TW");
      }
    });
    await expect(modal).toContainText("更新公告與新功能");
    await expect(modal).toContainText("體驗優化");

    // 5. 切换到 zh-HK
    await page.evaluate(async () => {
      if ((window as any).changeLocale) {
        await (window as any).changeLocale("zh-HK");
      }
    });
    await expect(modal).toContainText("更新公告與新功能");
    await expect(modal).toContainText("問題修復");
  });
});
