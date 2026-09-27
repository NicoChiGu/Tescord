import { test, expect } from "@playwright/test";

test.describe("语音频道摄像头直播（Webcam Live Streaming）与舞台聚焦验收", () => {
  test("完整验证摄像头推拉流、自拍镜像、网格视频挂载、舞台聚焦/钉选与侧边栏快捷开关全链路", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入用户鉴权状态与浏览器虚拟摄像头 Mock
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

      // Mock 虚拟摄像头视频流 (基于 HTML5 Canvas captureStream)
      if (navigator.mediaDevices) {
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
      }
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "webcam_tester",
          displayName: "摄像头验收员",
          email: "camera@example.com",
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

    // 2. 进入首个公会
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 双击加入语音频道
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 验证加入成功（主房或左侧栏断开连接按钮呈现）
    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 4. 验证中央底部控制栏与左侧常驻面板中的摄像头按钮
    const centerCameraBtn = page.getByTestId("voice-toggle-camera-btn");
    await expect(centerCameraBtn).toBeVisible({ timeout: 5000 });
    await expect(centerCameraBtn).toHaveAttribute("title", "打开摄像头");

    const sidebarCameraBtn = page.getByTestId("sidebar-toggle-video-btn");
    await expect(sidebarCameraBtn).toBeVisible({ timeout: 5000 });
    await expect(sidebarCameraBtn).toContainText("开启视频");

    // 初始状态下：成员卡片展示圆形头像，未挂载 video 标签
    const videoTileInitial = page.getByTestId(
      "participant-video-tile-usr_default_admin",
    );
    await expect(videoTileInitial).not.toBeVisible();

    // 5. 点击开启摄像头
    await centerCameraBtn.click();

    // 验证按钮样式变为已开启激活状态
    await expect(centerCameraBtn).toHaveAttribute("title", "关闭摄像头", {
      timeout: 10000,
    });
    await expect(sidebarCameraBtn).toContainText("停用视频", {
      timeout: 10000,
    });

    // 6. 验证成员卡片平滑切换为视频视口 (包含 <video> 与镜像样式)
    const videoTile = page.getByTestId(
      "participant-video-tile-usr_default_admin",
    );
    await expect(videoTile).toBeVisible({ timeout: 10000 });

    const videoEl = videoTile.locator("video");
    await expect(videoEl).toBeVisible({ timeout: 10000 });
    // 验证本地自拍视角使用了镜像样式 (-scale-x-100)
    await expect(videoEl).toHaveClass(/-scale-x-100/);

    // 7. 测试“舞台聚焦增强模式”：点击成员卡片将其钉选至主舞台
    await videoTile.click();

    // 验证主舞台聚焦区呈现
    const unpinBtn = page.getByTestId("stage-unpin-btn");
    await expect(unpinBtn).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/聚焦/i).first()).toBeVisible();

    // 8. 取消主舞台钉选
    await unpinBtn.click();
    await expect(unpinBtn).not.toBeVisible({ timeout: 5000 });

    // 9. 通过左下角侧边栏快捷开关关闭摄像头
    await sidebarCameraBtn.click();
    await expect(sidebarCameraBtn).toContainText("开启视频", { timeout: 5000 });
    await expect(centerCameraBtn).toHaveAttribute("title", "打开摄像头", {
      timeout: 5000,
    });

    // 验证视频视口注销，平滑回退至头像展示
    await expect(videoTile).not.toBeVisible({ timeout: 5000 });

    // 10. 离开语音频道
    await leaveVoiceBtn.click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // 11. 确保控制台无致命未捕获错误
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
