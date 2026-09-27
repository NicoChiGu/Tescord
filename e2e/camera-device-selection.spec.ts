import { test, expect } from "@playwright/test";

test.describe("Discord 风格摄像头设备选择与视频预览全链路验收", () => {
  test("完整验证系统摄像头设备枚举、设置中心画面实时测试预览、镜像翻转与通话控制栏快捷切换菜单", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入 Mock 用户鉴权状态与多摄像头设备 Mock
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

      // Mock 多硬件摄像头设备列表
      const fakeCameras = [
        {
          deviceId: "cam_logitech_streamcam",
          kind: "videoinput",
          label: "Logitech StreamCam 1080p (USB)",
          groupId: "group_cam_1",
        },
        {
          deviceId: "cam_obs_virtual",
          kind: "videoinput",
          label: "OBS Virtual Camera",
          groupId: "group_cam_2",
        },
      ];

      const fakeAudios = [
        {
          deviceId: "mic_default",
          kind: "audioinput",
          label: "默认麦克风 (Realtek Audio)",
          groupId: "group_audio_1",
        },
        {
          deviceId: "speaker_default",
          kind: "audiooutput",
          label: "默认扬声器 (Realtek Audio)",
          groupId: "group_audio_1",
        },
      ];

      if (navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices = async () => {
          return [
            ...fakeAudios,
            ...fakeCameras,
          ] as unknown as MediaDeviceInfo[];
        };

        navigator.mediaDevices.getUserMedia = async (constraints: any) => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle =
              constraints?.video?.deviceId?.exact === "cam_obs_virtual"
                ? "#5865f2"
                : "#23a55a";
            ctx.fillRect(0, 0, 640, 360);
          }
          const stream = canvas.captureStream(30);
          return stream;
        };
      }
    });

    // Mock 用户信息
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "streamer_jack",
          displayName: "摄像头主理人",
          email: "camera@tescord.local",
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
    await expect(page).toHaveTitle(/Tescord/i);

    // ==========================================
    // 第一部分：个人设置中心（语音与视频）交互验收
    // ==========================================

    // 1. 点击左下角齿轮进入设置中心
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 2. 验证左侧分类导航显示「语音与视频」Tab
    const audioTabBtn = page.getByTestId("tab-audio-btn");
    await expect(audioTabBtn).toBeVisible();
    await expect(audioTabBtn).toContainText("语音与视频");

    // 3. 验证视频设置区与摄像头下拉选择器
    await expect(page.getByText(/视频设置 \(Video Settings\)/i)).toBeVisible();
    const cameraSelect = page.getByTestId("camera-device-select");
    await expect(cameraSelect).toBeVisible();

    // 验证两个 Mock 摄像头均出现在下拉列表中
    await expect(
      cameraSelect.locator('option[value="cam_logitech_streamcam"]'),
    ).toBeAttached();
    await expect(
      cameraSelect.locator('option[value="cam_obs_virtual"]'),
    ).toBeAttached();

    // 4. 验证画面测试按钮与 16:9 实时视频预览窗口
    const startTestBtn = page.getByTestId("start-video-test-btn");
    await expect(startTestBtn).toBeVisible();
    await expect(startTestBtn).toContainText("测试视频");

    // 点击「测试视频」按钮
    await startTestBtn.click();

    // 按钮转变为「停止测试」，视频元素激活呈现
    const stopTestBtn = page.getByTestId("stop-video-test-btn");
    await expect(stopTestBtn).toBeVisible();
    await expect(stopTestBtn).toContainText("停止测试");

    const testVideoEl = page.getByTestId("camera-test-video");
    await expect(testVideoEl).toBeVisible();
    await expect(testVideoEl).toHaveClass(/-scale-x-100/); // 默认镜像翻转

    // 验证镜像画面复选框切换
    const mirrorCheckbox = page.getByTestId("camera-mirror-checkbox");
    await expect(mirrorCheckbox).toBeChecked();
    await mirrorCheckbox.uncheck();
    await expect(testVideoEl).not.toHaveClass(/-scale-x-100/);
    await mirrorCheckbox.check();
    await expect(testVideoEl).toHaveClass(/-scale-x-100/);

    // 5. 在测试运行中切换摄像头下拉项
    await cameraSelect.selectOption("cam_obs_virtual");
    await expect(testVideoEl).toBeVisible();

    // 6. 停止测试视频
    await stopTestBtn.click();
    await expect(page.getByTestId("start-video-test-btn")).toBeVisible();

    // 按 Escape 关闭设置中心
    await page.keyboard.press("Escape");
    await expect(settingsModal).not.toBeVisible();

    // ==========================================
    // 第二部分：通话控制栏快捷切换菜单交互验收
    // ==========================================

    // 1. 进入首个服务器并加入语音频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 5000 });
    await serverButton.click();

    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 验证加入成功
    await expect(
      page.getByRole("button", { name: "断开连接" }).first(),
    ).toBeVisible({
      timeout: 8000,
    });

    // 2. 验证中央底部摄像头组合控制（开关 + 小箭头）
    const centerCameraBtn = page.getByTestId("voice-toggle-camera-btn");
    const cameraMenuBtn = page.getByTestId("voice-camera-menu-btn");
    await expect(centerCameraBtn).toBeVisible();
    await expect(cameraMenuBtn).toBeVisible();

    // 3. 点击小箭头呼出摄像头快捷菜单
    await cameraMenuBtn.click();
    const quickMenu = page.getByTestId("camera-quick-menu");
    await expect(quickMenu).toBeVisible();
    await expect(quickMenu).toContainText("选择摄像头设备");

    // 验证快捷菜单中的摄像头选项
    const camOption1 = page.getByTestId("camera-option-cam_logitech_streamcam");
    const camOption2 = page.getByTestId("camera-option-cam_obs_virtual");
    await expect(camOption1).toBeVisible();
    await expect(camOption2).toBeVisible();

    // 切换选中 OBS Virtual Camera
    await camOption2.click();
    await expect(quickMenu).not.toBeVisible();

    // 4. 再次打开菜单验证选中状态已持久化勾选
    await cameraMenuBtn.click();
    await expect(quickMenu).toBeVisible();
    await expect(camOption2).toHaveClass(/bg-discord-brand\/20/);

    // 5. 点击快捷菜单底部的「视频设置...」直达个人设置中心
    const menuSettingsBtn = page.getByTestId("camera-menu-settings-btn");
    await expect(menuSettingsBtn).toBeVisible();
    await menuSettingsBtn.click();

    // 验证设置中心被唤起且当前处于「语音与视频」面板
    await expect(settingsModal).toBeVisible();
    await expect(page.getByTestId("camera-device-select")).toBeVisible();
    await expect(page.getByTestId("camera-device-select")).toHaveValue(
      "cam_obs_virtual",
    );

    // 关闭设置中心
    await page.keyboard.press("Escape");
    await expect(settingsModal).not.toBeVisible();

    // 6. 开启摄像头推流
    await centerCameraBtn.click();
    await expect(centerCameraBtn).toHaveAttribute("title", "关闭摄像头");

    // 验证自身视频画面挂载
    const localVideoTile = page.getByTestId(
      "participant-video-tile-usr_default_admin",
    );
    await expect(localVideoTile).toBeVisible();

    // 在通话推流中通过快捷菜单热切换摄像头
    await cameraMenuBtn.click();
    await page.getByTestId("camera-option-cam_logitech_streamcam").click();
    await expect(localVideoTile).toBeVisible();

    // 关闭摄像头
    await centerCameraBtn.click();
    await expect(centerCameraBtn).toHaveAttribute("title", "打开摄像头");

    // 确保没有未捕获的严重控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("LiveKit") &&
        !err.includes("AudioContext") &&
        !err.includes("ECONNREFUSED") &&
        !err.includes("401") &&
        !err.includes("Unauthorized"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
