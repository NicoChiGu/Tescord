import { test, expect } from "@playwright/test";

test.describe("P2P 直连与智能接力直播传输模式端到端自动化验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") ||
          "mock_p2p_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_p2p_refresh_token");

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
        network: {
          detectLocalNetwork: async () => ({
            ipv4List: ["192.168.1.100"],
            ipv6List: ["240e:390:xxxx:xxxx::1"],
            hasPublicIPv6: true,
            defaultIPv4: "192.168.1.100",
            defaultIPv6: "240e:390:xxxx:xxxx::1",
          }),
          mapPort: async (port: number) => ({
            success: true,
            externalIP: "114.248.x.x",
            mappedPort: port,
          }),
          unmapPort: async () => true,
        },
      };

      if (navigator.mediaDevices) {
        const createMockStream = () => {
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
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#5865f2";
            ctx.fillRect(0, 0, 1280, 720);
          }
          const videoStream = canvas.captureStream(30);
          const videoTrack = videoStream.getVideoTracks()[0];

          return new MediaStream([audioTrack, videoTrack]);
        };

        navigator.mediaDevices.getUserMedia = async () => createMockStream();
        navigator.mediaDevices.getDisplayMedia = async () => createMockStream();
      }
    });

    // Mock 用户认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
          username: "p2p_tester",
          displayName: "P2P架构体验官",
          email: "p2p@tescord.local",
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

    // Mock 频道与服务器数据
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_p2p_test",
            name: "P2P 极客实验室",
            iconUrl: null,
            ownerId: "usr_default_admin",
            channels: [
              {
                id: "chan_voice_p2p",
                guildId: "guild_p2p_test",
                name: "开黑开播 1",
                type: "VOICE",
                bitrate: 64000,
                position: 0,
                createdAt: new Date().toISOString(),
              },
            ],
            members: [],
            roles: [],
          },
        ]),
      });
    });
  });

  test("主播可以在直播弹窗中自由选择「服务器中继」与「P2P 直连打洞」，并能切换 Mesh 直连与 Tree 接力", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入服务器
    const serverButton = page
      .getByRole("button", { name: /P2P 极客实验室|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 加入语音频道
    const voiceChannelBtn = page
      .getByRole("button", { name: /开黑开播 1|voice/i })
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

    // 3. 点击控制栏屏幕分享按钮唤起弹窗
    const screenShareBtn = page.getByTestId("voice-toggle-screen-btn");
    await expect(screenShareBtn).toBeVisible({ timeout: 5000 });
    await screenShareBtn.click();

    // 4. 验证 ScreenShareModal 弹窗中的传输模式组件
    const sfuModeBtn = page.locator('[data-testid="mode-sfu-btn"]');
    const p2pModeBtn = page.locator('[data-testid="mode-p2p-btn"]');

    await expect(sfuModeBtn).toBeVisible({ timeout: 5000 });
    await expect(p2pModeBtn).toBeVisible({ timeout: 5000 });

    // 默认应为服务器 SFU 模式，此时不展示 P2P 拓扑子单选
    const p2pSubmodeDirect = page.locator('[data-testid="p2p-submode-direct"]');
    await expect(p2pSubmodeDirect).not.toBeVisible();

    // 5. 点击切换到 P2P 模式
    await p2pModeBtn.click();

    // 验证展示了 P2P 拓扑子选项（主播全承担 Mesh / 智能接力转发 Tree）
    await expect(p2pSubmodeDirect).toBeVisible({ timeout: 3000 });
    const p2pSubmodeRelay = page.locator('[data-testid="p2p-submode-relay"]');
    await expect(p2pSubmodeRelay).toBeVisible({ timeout: 3000 });

    // 验证默认勾选直连单播
    await expect(p2pSubmodeDirect).toBeChecked();

    // 切换至智能接力转发
    await p2pSubmodeRelay.click();
    await expect(p2pSubmodeRelay).toBeChecked();
    await expect(p2pSubmodeDirect).not.toBeChecked();

    // 6. 切换回服务器中继模式，验证子选项自动折叠收起
    await sfuModeBtn.click();
    await expect(p2pSubmodeDirect).not.toBeVisible();

    // 关闭弹窗
    const cancelBtn = page.getByRole("button", { name: "取消" });
    await cancelBtn.click();
  });

  test("网络健康看板中能够实时展示「P2P 穿透与拓扑诊断 (NAT & Relay HUD)」", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入服务器
    const serverButton = page
      .getByRole("button", { name: /P2P 极客实验室|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 加入语音频道
    const voiceChannelBtn = page
      .getByRole("button", { name: /开黑开播 1|voice/i })
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

    // 3. 从连线浮层的“更多数据”进入网络看板
    const voiceCardTrigger = page.locator("button", {
      hasText: "语音已连接",
    });
    await expect(voiceCardTrigger).toBeVisible({ timeout: 8000 });
    await voiceCardTrigger.click();
    const popover = page.getByTestId("voice-connection-popover");
    await expect(popover).toBeVisible();
    await page.getByTestId("connection-more-stats-btn").click();
    await expect(popover).not.toBeVisible();

    // 4. 验证网络看板中包含 P2P NAT 诊断卡片
    const natHeader = page.getByText(/P2P 穿透与拓扑诊断/i);
    await expect(natHeader).toBeVisible({ timeout: 5000 });

    const natTypeRow = page.getByText(/NAT 穿透类型/i);
    await expect(natTypeRow).toBeVisible();

    const ipv6Row = page.getByText(/全球公网 IPv6 状态/i);
    await expect(ipv6Row).toBeVisible();

    // 按 Escape 键关闭看板并验证消失
    await page.keyboard.press("Escape");
    await expect(natHeader).not.toBeVisible({ timeout: 3000 });
  });

  test("主播以 P2P 直连模式启动直播推流后，本地卡片能够即刻渲染推流画面且保持稳定", async ({
    page,
  }) => {
    page.on("console", (msg) =>
      console.log(`[PAGE ${msg.type()}]: ${msg.text()}`),
    );
    page.on("pageerror", (err) => console.log(`[PAGE ERROR]: ${err.message}`));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入服务器与语音频道并双击加入通话
    const serverButton = page
      .getByRole("button", { name: /P2P 极客实验室|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const voiceChannelBtn = page
      .getByRole("button", { name: /开黑开播 1|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 2. 点击控制栏屏幕分享按钮唤起弹窗
    const shareScreenBtn = page.getByTestId("voice-toggle-screen-btn");
    await expect(shareScreenBtn).toBeVisible({ timeout: 6000 });
    await shareScreenBtn.click();

    // 3. 模态窗弹出，选择 P2P 直连模式并启动推流
    const p2pModeBtn = page.locator('[data-testid="mode-p2p-btn"]');
    await expect(p2pModeBtn).toBeVisible({ timeout: 5000 });
    await p2pModeBtn.click();

    const startStreamBtn = page.locator(
      '[data-testid="start-screen-share-confirm-btn"]',
    );
    await expect(startStreamBtn).toBeVisible({ timeout: 3000 });
    await startStreamBtn.click();

    // 4. 验证开播后按钮状态切换为“停止共享”
    await expect(shareScreenBtn).toHaveAttribute("title", "停止共享", {
      timeout: 5000,
    });

    // 5. 核心验证：主播卡片内成功挂载并渲染出屏幕推流 <video> 画面（解决原先主播端黑屏丢失画面的根因）
    const videoElement = page.locator(
      '[data-testid="participant-main-video-usr_default_admin"]',
    );
    await expect(videoElement).toBeVisible({ timeout: 8000 });
  });
});
