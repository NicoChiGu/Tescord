import { test, expect } from "@playwright/test";

test.describe("客户端更新服务与 gh-proxy 加速端到端验收", () => {
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

    // 注入模拟的 electronAPI 对象以测试桌面端专属更新能力
    await page.addInitScript(() => {


      let progressCb: any = null;
      let readyCb: any = null;
      let mockProxy = "";

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
        getGPUInfo: async () => ({ isIntel: false, isNvidia: true, isAmd: false }),
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
            customProxy: mockProxy,
          }),
          checkForUpdates: async () => ({
            enabled: true,
            hasUpdate: true,
            currentHostVersion: "0.1.0",
            currentWebVersion: "0.1.0",
            latestVersion: "0.2.0",
            isHostUpdateRequired: false,
            manifest: {
              version: "0.2.0",
              releaseDate: new Date().toISOString(),
              minHostVersion: "0.1.0",
              webPackageUrl: "tescord-web-v0.2.0.zip",
              webPackageSha256: "abc1234567890",
              changelog: "### 🚀 新增功能\n- 支持轻量 Web 增量免安装更新！\n- 支持 gh-proxy 阶梯加速",
              mandatory: false,
            },
          }),
          downloadAndApply: async () => {
            if (progressCb) {
              progressCb({
                state: "downloading",
                percent: 50,
                transferredBytes: 5000000,
                totalBytes: 10000000,
              });
              progressCb({
                state: "extracting",
                percent: 95,
                transferredBytes: 10000000,
                totalBytes: 10000000,
              });
              progressCb({
                state: "ready",
                percent: 100,
                transferredBytes: 10000000,
                totalBytes: 10000000,
              });
            }
            if (readyCb) {
              readyCb({ version: "0.2.0" });
            }
            return { success: true, newVersion: "0.2.0" };
          },
          restartToApply: async () => {},
          setCustomProxy: async (proxy: string) => {
            mockProxy = proxy;
            return true;
          },
          onProgress: (cb: any) => {
            progressCb = cb;
            return () => {
              progressCb = null;
            };
          },
          onUpdateReady: (cb: any) => {
            readyCb = cb;
            return () => {
              readyCb = null;
            };
          },
        },
      };

      (window as any).__triggerMockUpdateReady = (ver: string) => {
        if (readyCb) readyCb({ version: ver });
      };
    });

    await page.goto("/");
  });

  test("应当在用户设置中提供'版本与更新'面板，并能正确触发增量更新检测与 gh-proxy 加速配置", async ({
    page,
  }) => {
    // 1. 等待页面加载完成并打开用户设置齿轮
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 15000 });
    await gearBtn.click();

    // 验证设置弹窗呈现
    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 2. 验证左侧导航栏中“版本与更新”标签页按钮存在
    const updatesTabBtn = page.locator('[data-testid="tab-updates-btn"]');
    await expect(updatesTabBtn).toBeVisible();
    await updatesTabBtn.click();

    // 3. 验证更新面板内容渲染
    await expect(page.getByText("客户端版本与更新 (Updates)")).toBeVisible();
    await expect(page.getByText("当前版本 (Active Version)")).toBeVisible();
    await expect(page.getByText("labsphaela/Tescord")).toBeVisible();
    await expect(page.getByText("自动检测已就绪")).toBeVisible();

    // 4. 验证 gh-proxy 阶梯加速规则展示
    await expect(page.getByText("https://v6.gh-proxy.org/")).toBeVisible();
    await expect(page.getByText("https://gh-proxy.com/")).toBeVisible();

    // 5. 点击“检查更新”按钮
    const checkBtn = page.getByRole("button", { name: /检查更新/i });
    await checkBtn.click();

    // 6. 验证展示检测到的新版本与增量更新提示
    await expect(page.getByText("发现新版本: v0.2.0")).toBeVisible();
    await expect(page.getByText("增量免安装更新", { exact: true })).toBeVisible();
    await expect(page.getByText("支持轻量 Web 增量免安装更新！")).toBeVisible();


    // 7. 点击立即下载增量更新
    const downloadBtn = page.getByRole("button", {
      name: /立即下载并应用增量更新/i,
    });
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();

    // 8. 验证就绪状态及重启按钮
    await expect(page.getByText("新版本已在本地解压就绪！")).toBeVisible();
    await expect(page.getByRole("button", { name: /立即重启应用/i })).toBeVisible();
  });

  test("当后台静默接收到增量更新就绪事件时，应当在页面右下角浮出温和重启提醒横幅", async ({
    page,
  }) => {
    // 等待页面主用户面板渲染完毕，确保监听器已注册
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 15000 });

    // 模拟后台静默派发 updater-update-ready 事件
    await page.evaluate(() => {
      (window as any).__triggerMockUpdateReady("0.2.0");
    });


    // 验证右下角浮出悬浮通知横幅
    await expect(page.getByText("新版本 v0.2.0 已就绪")).toBeVisible();
    await expect(
      page.getByText("免安装增量更新已在后台下载完毕，点击重启即可秒级载入新特性！")
    ).toBeVisible();

    const restartBtn = page.getByRole("button", { name: /立即重启/i });
    await expect(restartBtn).toBeVisible();
  });

});
