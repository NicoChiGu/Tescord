import { test, expect } from "@playwright/test";

test.describe("视频编码格式（H.264 / AV1 / VP9 / VP8 / HEVC）与硬件加速 E2E 验收", () => {
  test("在设置中心切换视频编码器、配置双编码降级与自定义码率，并在屏幕共享弹窗中灵活指定编码格式与查看视频卡片角标", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入用户鉴权状态与虚拟媒体流 Mock
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem("tescord_preferred_video_codec", "h264");

      if (navigator.mediaDevices) {
        // Mock 虚拟摄像头与麦克风视频音频双轨流
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

        // Mock 虚拟屏幕分享视频流 (1280x720)
        navigator.mediaDevices.getDisplayMedia = async () => {
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
    });

    // Mock 用户认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_codec_user",
          username: "codec_master",
          displayName: "编解码特工",
          email: "codec@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock LiveKit 媒体 Token 路由
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

    // 2. 进入首个可用服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 打开个人设置中心 (齿轮按钮)
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();

    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 4. 验证“推流编码格式与硬件加速”面板正确渲染
    await expect(
      page.getByText(/推流编码格式与硬件加速 \(Video Codecs\)/i),
    ).toBeVisible();

    const h264Option = page.getByTestId("codec-option-h264");
    const av1Option = page.getByTestId("codec-option-av1");
    const vp8Option = page.getByTestId("codec-option-vp8");
    const vp9Option = page.getByTestId("codec-option-vp9");

    await expect(h264Option).toBeVisible();
    await expect(av1Option).toBeVisible();
    await expect(vp8Option).toBeVisible();
    await expect(vp9Option).toBeVisible();

    // 4.1 验证默认选中的编码器为 H.264
    await expect(h264Option).toHaveClass(/border-discord-brand/);

    // 4.2 点击切换到 AV1 编码器
    await av1Option.click();
    await expect(av1Option).toHaveClass(/border-discord-brand/);

    // 4.3 验证 VP8 双编码兜底降级开关 (Backup Codec)
    const backupCodecCheckbox = page.getByTestId(
      "enable-backup-codec-checkbox",
    );
    await expect(backupCodecCheckbox).toBeVisible();
    await expect(backupCodecCheckbox).toBeChecked();

    // 4.4 验证自定义推流码率调节与重置
    const bitrateSlider = page.getByTestId("custom-bitrate-slider");
    await expect(bitrateSlider).toBeVisible();
    const bitrateLabel = page.getByTestId("current-custom-bitrate-label");
    await expect(bitrateLabel).toContainText("跟随预设");

    // 拖动/改变码率值
    await bitrateSlider.fill("4500000");
    await bitrateSlider.dispatchEvent("change");
    await expect(bitrateLabel).toContainText("4500 kbps");

    // 点击重置按钮恢复自适应
    const resetBitrateBtn = page.getByTestId("reset-custom-bitrate-btn");
    await expect(resetBitrateBtn).toBeVisible();
    await resetBitrateBtn.click();
    await expect(bitrateLabel).toContainText("跟随预设");

    // 关闭设置弹窗
    const closeSettingsBtn = page.getByTestId("close-settings-btn");
    if (await closeSettingsBtn.isVisible()) {
      await closeSettingsBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(settingsModal).not.toBeVisible();

    // 5. 加入一个语音频道以测试发起屏幕直播
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|日常闲聊|voice/i })
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

    // 6. 点击中央控制栏的屏幕分享按钮打开 ScreenShareModal
    const screenShareBtn = page.getByTestId("voice-toggle-screen-btn");
    await expect(screenShareBtn).toBeVisible({ timeout: 5000 });
    await screenShareBtn.click();

    // 7. 验证屏幕共享弹窗中的编码格式选择器
    await expect(
      page.getByText(/屏幕与应用直播分享 \(LiveKit Simulcast\)/i),
    ).toBeVisible();
    await expect(page.getByText(/视频编码格式 \(Video Codec\)/i)).toBeVisible();

    const autoCodecBtn = page.getByTestId("modal-codec-auto");
    const modalH264Btn = page.getByTestId("modal-codec-h264");
    const modalAv1Btn = page.getByTestId("modal-codec-av1");
    const modalVp8Btn = page.getByTestId("modal-codec-vp8");

    await expect(autoCodecBtn).toBeVisible();
    await expect(modalH264Btn).toBeVisible();
    await expect(modalAv1Btn).toBeVisible();
    await expect(modalVp8Btn).toBeVisible();

    // 切换本次直播编码格式为 H.264
    await modalH264Btn.click();
    await expect(modalH264Btn).toHaveClass(/bg-discord-brand/);

    // 展开自定义码率微调折叠面板
    const toggleBitrateBtn = page.getByTestId("toggle-custom-bitrate-btn");
    await expect(toggleBitrateBtn).toBeVisible();
    await toggleBitrateBtn.click();

    const modalBitrateSlider = page.getByTestId("modal-custom-bitrate-slider");
    await expect(modalBitrateSlider).toBeVisible();
    await modalBitrateSlider.fill("5000000");
    await modalBitrateSlider.dispatchEvent("change");

    const modalBitrateLabel = page.getByTestId("modal-custom-bitrate-label");
    await expect(modalBitrateLabel).toContainText("5000 kbps");

    // 8. 点击开始直播
    const startConfirmBtn = page.getByTestId("start-screen-share-confirm-btn");
    await expect(startConfirmBtn).toBeVisible();
    await startConfirmBtn.click();

    // 9. 验证直播流启动成功，用户视频卡片上呈现 [H264] 编码格式角标
    const codecBadge = page.getByTestId("video-codec-badge-e2e_codec_user");
    await expect(codecBadge).toBeVisible({ timeout: 8000 });
    await expect(codecBadge).toContainText("H264");

    // 验证房间顶部直播指示器
    await expect(
      page.getByText(/\[H264\]\s*Simulcast 屏幕直播中/i),
    ).toBeVisible();

    // 10. 打开网络质量看板，确认动态视频编码指标展示
    const netStatsBtn = page.getByTestId("network-stats-btn");
    if (await netStatsBtn.isVisible()) {
      await netStatsBtn.click();
      await expect(
        page.getByText(/WebRTC 媒体引擎与网络健康看板/i),
      ).toBeVisible();
      await expect(page.getByText(/H264/i)).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // 11. 校验控制台未抛出致命未捕获错误
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
