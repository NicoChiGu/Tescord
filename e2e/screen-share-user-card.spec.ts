import { test, expect } from "@playwright/test";

test.describe("直播屏幕分享与摄像头画面融合（画中画自由切换）E2E 验收", () => {
  test("完整验证屏幕分享在用户卡片内展示、右下角画中画叠加、点击自由切换主次画面与平滑回退全链路", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入用户鉴权状态与浏览器虚拟摄像头 + 屏幕分享 Canvas 双轨 Mock
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

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

        // Mock 虚拟屏幕分享视频流 (1280x720 品牌蓝色画布)
        navigator.mediaDevices.getDisplayMedia = async (options?: any) => {
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#5865f2";
            ctx.fillRect(0, 0, 1280, 720);
          }
          const stream = canvas.captureStream(30);
          return stream;
        };
      }

      // Mock Fullscreen API (保障 Headless 浏览器环境下 100% 触发与状态同步)
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
          id: "usr_default_admin",
          username: "screenshare_pro",
          displayName: "直播验收专家",
          email: "live@example.com",
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

    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 2. 进入首个公会并加入语音频道
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

    const joinPromptBtn = page
      .getByRole("button", { name: /加入语音通话|在此设备重新连接/i })
      .first();
    if (await joinPromptBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await joinPromptBtn.click();
    }

    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 3. 初始状态：成员卡片展示圆形头像，未挂载 video 标签
    const videoTileInitial = page.getByTestId(
      "participant-video-tile-usr_default_admin",
    );
    await expect(videoTileInitial).not.toBeVisible();

    // 4. 开启屏幕分享：直播画面直接在用户画像卡片内展示（不单独建立独立播放器）
    const centerScreenBtn = page.getByTestId("voice-toggle-screen-btn");
    await expect(centerScreenBtn).toBeVisible({ timeout: 5000 });
    await expect(centerScreenBtn).toHaveAttribute("title", "屏幕共享");

    await centerScreenBtn.click();
    const confirmLiveBtn = page.getByTestId("start-screen-share-confirm-btn");
    await expect(confirmLiveBtn).toBeVisible({ timeout: 5000 });
    await confirmLiveBtn.click();

    await expect(centerScreenBtn).toHaveAttribute("title", "停止共享", {
      timeout: 5000,
    });

    // 验证用户卡片原地切换为视频卡片，且主视频呈现为屏幕分享
    const videoTile = page.getByTestId(
      "participant-video-tile-usr_default_admin",
    );
    await expect(videoTile).toBeVisible({ timeout: 5000 });

    // 验证主视口视频
    const mainVideo = page.getByTestId(
      "participant-main-video-usr_default_admin",
    );
    await expect(mainVideo).toBeVisible({ timeout: 5000 });
    // 屏幕分享为主画面时，不应有镜像类 -scale-x-100
    await expect(mainVideo).not.toHaveClass(/-scale-x-100/);

    // 验证此时仅单轨直播，右下角画中画小窗尚未出现
    const pipVideo = page.getByTestId(
      "participant-pip-video-usr_default_admin",
    );
    await expect(pipVideo).not.toBeVisible();

    // 验证卡片内展示 LIVE 直播中徽章
    await expect(videoTile.getByText(/LIVE/i)).toBeVisible();

    // 验证直播推流期间麦克风保持开启（非静音），不被直播误关
    const voiceMuteBtn = page.getByTestId("voice-toggle-mute-btn");
    await expect(voiceMuteBtn).toBeVisible({ timeout: 5000 });
    await expect(voiceMuteBtn).toHaveAttribute("title", "静音");
    await voiceMuteBtn.click();
    await expect(voiceMuteBtn).toHaveAttribute("title", "开麦");
    await expect(
      page.getByTestId("voice-participant-muted-usr_default_admin"),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid^="voice-sidebar-muted-"]').first(),
    ).toBeVisible();

    // 主播本人的卡片可聚焦，观众卡片才提供全屏播放。
    const fullscreenBtn = page.getByTestId("fullscreen-btn-usr_default_admin");
    await expect(fullscreenBtn).toHaveCount(0);
    await videoTile.dblclick();
    const exitFocusBtn = page.getByTestId("stage-unpin-btn");
    await expect(exitFocusBtn).toBeVisible({ timeout: 5000 });
    await expect(videoTile).not.toHaveClass(/!fixed/);
    await exitFocusBtn.click();
    await expect(exitFocusBtn).toHaveCount(0);

    // 5. 在直播中开启摄像头 -> 验证摄像头自动以画中画叠加到右下角
    const centerCameraBtn = page.getByTestId("voice-toggle-camera-btn");
    await expect(centerCameraBtn).toBeVisible({ timeout: 5000 });
    await centerCameraBtn.click();
    await expect(centerCameraBtn).toHaveAttribute("title", "关闭摄像头", {
      timeout: 5000,
    });

    // 验证右下角画中画 (PiP) 叠加小窗浮现
    await expect(pipVideo).toBeVisible({ timeout: 5000 });
    await expect(voiceMuteBtn).toHaveAttribute("title", "开麦");
    await expect(
      page.getByTestId("voice-participant-muted-usr_default_admin"),
    ).toBeVisible();

    // 验证主画面依然为屏幕分享（非镜像），右下角小窗为摄像头（带本人镜像 -scale-x-100）
    await expect(mainVideo).not.toHaveClass(/-scale-x-100/);
    const pipVideoEl = pipVideo.locator("video");
    await expect(pipVideoEl).toBeVisible();
    await expect(pipVideoEl).toHaveClass(/-scale-x-100/);

    // 6. 验证自由切换（Swap）：点击右下角小窗
    await pipVideo.click();

    // 切换后：主画面变为摄像头（带镜像 -scale-x-100），右下角小窗变为屏幕分享（非镜像）
    await expect(mainVideo).toHaveClass(/-scale-x-100/);
    await expect(pipVideoEl).not.toHaveClass(/-scale-x-100/);

    // 再次点击右下角小窗：还原为初始状态
    await pipVideo.click();
    await expect(mainVideo).not.toHaveClass(/-scale-x-100/);
    await expect(pipVideoEl).toHaveClass(/-scale-x-100/);

    // 7. 关闭摄像头 -> 画中画小窗消失，主卡片无缝保持屏幕分享
    await centerCameraBtn.click();
    await expect(centerCameraBtn).toHaveAttribute("title", "打开摄像头", {
      timeout: 5000,
    });
    await expect(pipVideo).not.toBeVisible({ timeout: 5000 });
    await expect(mainVideo).toBeVisible({ timeout: 5000 });
    await expect(mainVideo).not.toHaveClass(/-scale-x-100/);

    // 8. 停止屏幕分享 -> 卡片平滑回退至纯头像状态
    await centerScreenBtn.click();
    await expect(centerScreenBtn).toHaveAttribute("title", "屏幕共享", {
      timeout: 5000,
    });
    await expect(videoTile).not.toBeVisible({ timeout: 5000 });
    await expect(voiceMuteBtn).toHaveAttribute("title", "开麦");
    await voiceMuteBtn.click();
    await expect(voiceMuteBtn).toHaveAttribute("title", "静音");
    await expect(
      page.getByTestId("voice-participant-muted-usr_default_admin"),
    ).not.toBeVisible();

    // 9. 离开语音频道
    await leaveVoiceBtn.click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // 10. 检查控制台无致命未捕获错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
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
