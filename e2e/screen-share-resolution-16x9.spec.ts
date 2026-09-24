import { test, expect } from "@playwright/test";

test.describe("屏幕分享 16:9 自适应分辨率与屏幕尺寸硬性禁用 E2E 验收", () => {
  test("在屏幕共享弹窗中根据屏幕尺寸动态限制最大 16:9 分辨率，并支持 Discord 风格矩阵解耦选择与推流", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入用户鉴权状态、虚拟媒体流 Mock 以及包含不同物理分辨率屏幕源的 ElectronAPI
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

      // Mock 虚拟桌面源 (模拟一台 1080P 主显示器与一台 4K 扩展显示器)
      (window as any).electronAPI = {
        platform: "win32",
        getDesktopSources: async () => [
          {
            id: "screen:0:0",
            name: "显示器 1 (1080P 标准屏)",
            thumbnail:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            type: "screen",
            displayDimensions: { width: 1920, height: 1080 },
          },
          {
            id: "screen:1:0",
            name: "显示器 2 (4K 原画高分屏)",
            thumbnail:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            type: "screen",
            displayDimensions: { width: 3840, height: 2160 },
          },
        ],
        showNotification: async () => true,
        onNotificationClick: () => () => {},
        getAutoLaunch: async () => false,
        setAutoLaunch: async () => true,
        onStatusChangeFromTray: () => () => {},
        syncUserStatus: () => {},
        onGlobalMuteToggle: () => () => {},
        onGlobalPTTDown: () => () => {},
        onGlobalPTTUp: () => () => {},
        setPTTKeybind: async () => true,
        minimizeWindow: async () => {},
        maximizeWindow: async () => {},
        closeWindow: async () => {},
        isWindowMaximized: async () => false,
        onWindowMaximizedChange: () => () => {},
      };

      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          const AudioContextClass =
            window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          const osc = audioCtx.createOscillator();
          const dst = audioCtx.createMediaStreamDestination();
          osc.connect(dst);
          try {
            osc.start();
          } catch {}
          const audioTrack = dst.stream.getAudioTracks()[0];

          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#23a55a";
            ctx.fillRect(0, 0, 640, 480);
          }
          const videoStream = canvas.captureStream(30);
          const videoTrack = videoStream.getVideoTracks()[0];

          return new MediaStream([audioTrack, videoTrack]);
        };

        navigator.mediaDevices.getDisplayMedia = async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 1920;
          canvas.height = 1080;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#5865f2";
            ctx.fillRect(0, 0, 1920, 1080);
          }
          return canvas.captureStream(60);
        };
      }
    });

    // Mock 用户认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_res_user",
          username: "resolution_guru",
          displayName: "超清画质师",
          email: "res@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock LiveKit Token
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

    await page.goto("/");

    // 2. 进入首个服务器并加入语音频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.click();

    const joinVoiceCallBtn = page.getByRole("button", {
      name: /加入语音通话/i,
    });
    if (
      await joinVoiceCallBtn.isVisible({ timeout: 1500 }).catch(() => false)
    ) {
      await joinVoiceCallBtn.click();
    }

    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 点击语音控制栏的屏幕分享按钮
    const screenShareBtn = page.getByTestId("voice-toggle-screen-btn");
    await expect(screenShareBtn).toBeVisible({ timeout: 5000 });
    await screenShareBtn.click();

    // 3. 验证屏幕分享设置弹窗开启
    await expect(page.getByText(/屏幕与应用直播分享/i)).toBeVisible();

    // 4. 验证 Discord 风格矩阵解耦组件存在
    await expect(
      page.getByText(/直播画质与帧率 \(16:9 自适应\)/i),
    ).toBeVisible();

    // 5. 默认选中显示器 1 (1080P 标准屏)，验证 16:9 物理尺寸最大分辨率限制与硬性禁用
    await expect(page.getByText(/当前屏幕最高支持:\s*1080P/i)).toBeVisible();

    const resBtn480p = page.getByTestId("resolution-btn-480p");
    const resBtn720p = page.getByTestId("resolution-btn-720p");
    const resBtn1080p = page.getByTestId("resolution-btn-1080p");
    const resBtn1440p = page.getByTestId("resolution-btn-1440p");
    const resBtn4k = page.getByTestId("resolution-btn-4k");

    // 验证 480p, 720p, 1080p 均处于可用状态
    await expect(resBtn480p).toBeEnabled();
    await expect(resBtn720p).toBeEnabled();
    await expect(resBtn1080p).toBeEnabled();

    // 验证 1440p (2K) 与 4k 被硬性禁用置灰，并带有“超出屏幕”标识
    await expect(resBtn1440p).toBeDisabled();
    await expect(resBtn4k).toBeDisabled();
    await expect(resBtn1440p).toContainText("超出屏幕");
    await expect(resBtn4k).toContainText("超出屏幕");

    // 6. 验证帧率单选切换 (15fps / 30fps / 60fps)
    const fpsBtn15 = page.getByTestId("fps-btn-15");
    const fpsBtn30 = page.getByTestId("fps-btn-30");
    const fpsBtn60 = page.getByTestId("fps-btn-60");

    await expect(fpsBtn15).toBeVisible();
    await expect(fpsBtn30).toBeVisible();
    await expect(fpsBtn60).toBeVisible();

    // 显式点击并验证 1080p 分辨率选项
    await resBtn1080p.click();
    await expect(resBtn1080p).toHaveClass(/bg-discord-brand/);

    // 切换到 30fps，验证推荐码率自动更新为 3.0 Mbps
    await fpsBtn30.click();
    await expect(fpsBtn30).toHaveClass(/bg-discord-brand/);
    await expect(page.getByText(/推荐码率:\s*3\.0\s*Mbps/i)).toBeVisible();

    // 7. 切换选中的屏幕源为“显示器 2 (4K 原画高分屏)”
    const monitor2Card = page.getByText(/显示器 2/i).first();
    await expect(monitor2Card).toBeVisible();
    await monitor2Card.click();

    // 验证检测上限动态刷新为 4K
    await expect(page.getByText(/当前屏幕最高支持:\s*4K/i)).toBeVisible();

    // 验证 1440p (2K) 与 4K 按钮解除禁用并可点击
    await expect(resBtn1440p).toBeEnabled();
    await expect(resBtn4k).toBeEnabled();

    // 选中 4K 原画分辨率与 60fps
    await resBtn4k.click();
    await expect(resBtn4k).toHaveClass(/bg-discord-brand/);
    await fpsBtn60.click();
    await expect(fpsBtn60).toHaveClass(/bg-discord-brand/);

    // 验证 4K 60fps 推荐码率与尺寸更新 (3840 × 2160, 推荐码率: 16.0 Mbps)
    await expect(page.getByText(/3840\s*×\s*2160\s*\(16:9\)/i)).toBeVisible();
    await expect(page.getByText(/推荐码率:\s*16\.0\s*Mbps/i)).toBeVisible();

    // 8. 点击开始直播
    const startConfirmBtn = page.getByTestId("start-screen-share-confirm-btn");
    await expect(startConfirmBtn).toBeVisible();
    await startConfirmBtn.click();

    // 9. 验证直播流启动成功，卡片上呈现直播指示器
    await expect(page.getByText(/Simulcast 屏幕直播中/i)).toBeVisible({
      timeout: 8000,
    });

    // 10. 检查控制台无致命未捕获错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("LiveKit") &&
        !err.includes("AudioContext") &&
        !err.includes("401") &&
        !err.includes("Unauthorized"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
