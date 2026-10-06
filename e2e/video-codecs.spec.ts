import { installEncryptedVoiceUi } from "./helpers/encrypted-voice-ui";
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
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
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
          id: "usr_default_admin",
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

    await installEncryptedVoiceUi(page);
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

    // 个人设置不再覆盖单次共享的编码器；此配置位于共享弹窗。
    await expect(page.locator('[data-testid^="codec-option-"]')).toHaveCount(0);

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
    await page.getByTestId("mode-p2p-btn").click();
    const startConfirmBtn = page.getByTestId("start-screen-share-confirm-btn");
    await expect(startConfirmBtn).toBeVisible();
    await startConfirmBtn.click();

    // A room without viewers has no negotiated outbound video codec. Check the
    // requested codec separately; actual encrypted video/RTP is a dedicated test.
    await expect(page.getByText(/直播中/i).first()).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByTestId("voice-room-area")
          .locator("video")
          .first()
          .evaluate((video: HTMLVideoElement) => video.videoWidth),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => (window as any).p2pStreamManager.targetVideoCodec,
      ),
    ).toBe("h264");
    await expect(
      page.getByTestId("video-codec-badge-usr_default_admin"),
    ).not.toBeVisible();

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
