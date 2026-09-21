import { test, expect } from "@playwright/test";

test.describe("屏幕分享伴音异常与自动优雅降级 (NotReadableError Audio Fallback) E2E 验收", () => {
  test("当捕获系统伴音失败 (NotReadableError) 时，系统必须自动无缝降级为纯画面推流并展示全局 Toast 提示", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Mock 鉴权、网关与底层 getDisplayMedia 音频源故障模拟
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

      (window as any).__getDisplayMediaCalls = [];

      if (navigator.mediaDevices) {
        // Mock 虚拟摄像头视频流 (640x480 绿色画布)
        navigator.mediaDevices.getUserMedia = async (constraints: any) => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#23a55a";
            ctx.fillRect(0, 0, 640, 480);
          }
          const stream = canvas.captureStream(30);
          return stream;
        };

        // Mock getDisplayMedia: 模拟当 audio !== false 时抛出 NotReadableError
        navigator.mediaDevices.getDisplayMedia = async (options?: any) => {
          (window as any).__getDisplayMediaCalls.push(
            options ? JSON.parse(JSON.stringify(options)) : options,
          );

          // 若请求了音频，模拟操作系统声卡独占/窗口无伴音抛出 NotReadableError
          if (options && options.audio) {
            const error = new DOMException(
              "Could not start audio source",
              "NotReadableError",
            );
            throw error;
          }

          // 降级为纯视频时正常返回视频流画布
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#5865f2";
            ctx.fillRect(0, 0, 1280, 720);
          }
          return canvas.captureStream(30);
        };
      }

      // Mock Fullscreen API
      let currentFullscreenEl: Element | null = null;
      Object.defineProperty(document, "fullscreenElement", {
        get: () => currentFullscreenEl,
        configurable: true,
      });
      Element.prototype.requestFullscreen = async function () {
        currentFullscreenEl = this;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
      document.exitFullscreen = async function () {
        currentFullscreenEl = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      };
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_screenshare_user",
          username: "audio_fallback_tester",
          displayName: "伴音降级测试员",
          email: "fallback@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/livekit/token", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "mock_livekit_token",
          url: "wss://localhost:7880",
        }),
      });
    });

    // 2. 访问首页并进入语音频道
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 3. 打开屏幕分享弹窗
    const centerScreenBtn = page.getByTestId("voice-toggle-screen-btn");
    await expect(centerScreenBtn).toBeVisible({ timeout: 5000 });
    await centerScreenBtn.click();

    const modalHeading = page.getByRole("heading", {
      name: /屏幕与应用直播分享/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 验证弹窗内显示了友好提示文案
    const tipText = page.getByText(
      "若声卡独占或窗口不支持伴音，将自动降级为纯画面",
    );
    await expect(tipText).toBeVisible();

    // 验证伴音开关默认开启
    const audioCheckbox = page.locator('input[type="checkbox"]').first();
    await expect(audioCheckbox).toBeChecked();

    // 4. 点击“开始直播”，触发 getDisplayMedia
    const confirmLiveBtn = page.getByTestId("start-screen-share-confirm-btn");
    await expect(confirmLiveBtn).toBeVisible({ timeout: 5000 });
    await confirmLiveBtn.click();

    // 5. 验证自动优雅降级机制生效：
    // (1) 页面上出现全局 Toast 警告通知
    const globalToast = page.locator('[data-testid="global-toast"]');
    await expect(globalToast).toBeVisible({ timeout: 5000 });
    await expect(globalToast).toContainText("系统伴音未能启动");
    await expect(globalToast).toContainText("已自动降级为纯画面直播");

    // (2) 验证 getDisplayMedia 被连续调用了两次：
    // 第一次带有 audio 约束（抛错），第二次自动降级为 audio: false 成功
    const calls = await page.evaluate(
      () => (window as any).__getDisplayMediaCalls,
    );
    expect(calls.length).toBe(2);
    expect(calls[0].audio).toBeTruthy();
    expect(calls[1].audio).toBe(false);

    // (3) 验证屏幕分享成功启动（按钮变为“停止共享”）
    await expect(centerScreenBtn).toHaveAttribute("title", "停止共享", {
      timeout: 5000,
    });

    // (4) 测试关闭 Toast 按钮
    const closeToastBtn = globalToast.locator("button");
    await closeToastBtn.click();
    await expect(globalToast).not.toBeVisible();
  });
});
