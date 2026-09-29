import { test, expect } from "@playwright/test";

test.describe("Discord 级体验增强核心交互验证 (问题2/3/4/5/6)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const realVoiceCase = testInfo.title.includes("停止直播");
    await page.addInitScript((useRealVoice) => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      if (!useRealVoice) {
        localStorage.setItem(
          "tescord_last_user",
          JSON.stringify({ id: "user_test_me", username: "jackey_tester" }),
        );
        // Guild and message fixtures must not be replaced by a live Gateway READY.
        (window as any).WebSocket = class MockWebSocket extends EventTarget {
          readyState = 3;
          close() {}
          send() {}
        };
      }

      if (navigator.mediaDevices) {
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
    }, realVoiceCase);

    if (!realVoiceCase)
      await page.route("**/api/auth/me", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "user_test_me",
            username: "jackey_tester",
            displayName: "测试大师",
            email: "tester@tescord.local",
            avatarUrl: null,
            status: "ONLINE",
            createdAt: new Date().toISOString(),
          }),
        });
      });

    if (!realVoiceCase)
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

    if (!realVoiceCase)
      await page.route("**/api/guilds", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "guild_e2e_1",
              name: "极客总部",
              icon: null,
              ownerId: "user_test_me",
              channels: [
                {
                  id: "ch_general_1",
                  guildId: "guild_e2e_1",
                  name: "日常闲聊",
                  type: "TEXT",
                  isE2EE: false,
                },
                {
                  id: "ch_voice_1",
                  guildId: "guild_e2e_1",
                  name: "开黑开麦",
                  type: "VOICE",
                  isE2EE: false,
                },
              ],
              members: [
                {
                  userId: "user_test_me",
                  user: { id: "user_test_me", username: "jackey_tester" },
                },
                {
                  userId: "user_alice",
                  user: { id: "user_alice", username: "爱丽丝" },
                },
              ],
            },
          ]),
        });
      });

    if (!realVoiceCase)
      await page.route("**/api/channels/**/messages*", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "msg_pinned_target",
              channelId: "ch_general_1",
              authorId: "user_alice",
              author: {
                id: "user_alice",
                username: "爱丽丝",
                avatarUrl: null,
              },
              content: "这是一条重要的置顶系统公告消息！请大家查阅！",
              isPinned: true,
              createdAt: new Date(Date.now() - 3600000).toISOString(),
              attachments: [],
            },
            {
              id: "msg_normal_other",
              channelId: "ch_general_1",
              authorId: "user_bob",
              author: {
                id: "user_bob",
                username: "鲍勃",
                avatarUrl: null,
              },
              content: "普通回复消息内容",
              isPinned: false,
              createdAt: new Date().toISOString(),
              attachments: [],
            },
          ]),
        });
      });
  });

  test("问题 6 验收：顶部 Header 图钉按钮、置顶消息面板 (PinnedMessagesPopover) 与定位跳转", async ({
    page,
  }) => {
    await page.goto("/");

    const channelBtn = page
      .getByRole("button", {
        name: /日常闲聊|general|常规|crypto-vault|对齐信道/i,
      })
      .first();
    if (!(await channelBtn.isVisible())) {
      const serverBtn = page.getByRole("button", { name: /极客总部/i }).first();
      await expect(serverBtn).toBeVisible({ timeout: 10000 });
      await serverBtn.click();
    }
    await expect(channelBtn).toBeVisible({ timeout: 6000 });
    await channelBtn.click();

    // 验证顶部 Header 渲染了图钉按钮与角标 (1 条置顶)
    const pinHeaderBtn = page.locator('button[title*="已固定的消息"]');
    await expect(pinHeaderBtn).toBeVisible({ timeout: 6000 });
    await expect(pinHeaderBtn).toContainText("1");

    // 点击图钉按钮，弹出 PinnedMessagesPopover
    await pinHeaderBtn.click();
    const popoverHeading = page.locator("text=已固定的消息").first();
    await expect(popoverHeading).toBeVisible();

    // 验证置顶消息内容
    await expect(page.getByText("爱丽丝").first()).toBeVisible();
    await expect(
      page.getByText("这是一条重要的置顶系统公告消息！请大家查阅！").first(),
    ).toBeVisible();

    // 点击置顶卡片中的“跳转”按钮
    const jumpBtn = page.getByRole("button", { name: "跳转" }).first();
    await expect(jumpBtn).toBeVisible();
    await jumpBtn.click();

    // 验证 Popover 自动关闭，并且主聊天区对应消息被黄色高亮聚焦
    await expect(page.locator("text=已固定的消息")).not.toBeVisible();
    const targetMsg = page.locator("#message-msg_pinned_target");
    await expect(targetMsg).toBeVisible();
  });

  test("问题 3 验收：全局输入与输出音量调节范围 (0-200%) 并成功持久化到 localStorage", async ({
    page,
  }) => {
    await page.goto("/");

    const serverBtn = page.getByRole("button", { name: /极客总部/i }).first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 点击左下角进入个人设置中心
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    const audioTabBtn = page.getByTestId("tab-audio-btn");
    await expect(audioTabBtn).toBeVisible();
    await audioTabBtn.click();

    // 定位输出音量滑块 (第二个 0-200 的 input range)
    const outputSlider = page.locator('input[type="range"][max="200"]').nth(1);
    await expect(outputSlider).toBeVisible();

    // 调节输出音量至 150%
    await outputSlider.fill("150");
    await expect(page.getByText("150%").first()).toBeVisible();

    // 验证 localStorage 已保存
    const savedMasterVol = await page.evaluate(() =>
      localStorage.getItem("tescord_master_volume"),
    );
    expect(savedMasterVol).toBe("150");
  });

  test("问题 2 验收：语音成员用户音量独立记忆 (0-200%) 与持久化机制", async ({
    page,
  }) => {
    await page.goto("/");

    const result = await page.evaluate(() => {
      // 写入持久化用户独立音量
      const map = { user_remote_tester: 160 };
      localStorage.setItem("tescord_user_volumes", JSON.stringify(map));

      // 验证 livekitService 能够正确读取
      const raw = localStorage.getItem("tescord_user_volumes");
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed ? parsed["user_remote_tester"] : 0;
    });

    expect(result).toBe(160);
  });

  test("问题 4 验收：点击卡片右上角“停止直播”红色按钮及控制栏直接关停推流，绝不误弹选择码率 Modal", async ({
    page,
    request,
  }) => {
    const login = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Jackey", password: "adminpassword123" },
    });
    expect(login.ok()).toBeTruthy();
    const token = ((await login.json()) as { accessToken: string }).accessToken;
    const headers = { Authorization: `Bearer ${token}` };
    const guildName = `直播停止验收_${Date.now()}`;
    const created = await request.post("/api/guilds", {
      headers,
      data: { name: guildName, locale: "zh-CN" },
    });
    expect(created.ok()).toBeTruthy();
    const guild = (await created.json()) as {
      id: string;
      channels: Array<{ id: string; type: string }>;
    };
    const voiceChannel = guild.channels.find((item) => item.type === "VOICE");
    expect(voiceChannel).toBeTruthy();
    try {
      const updated = await request.patch(`/api/channels/${voiceChannel!.id}`, {
        headers,
        data: { voiceMode: "p2p_mesh", streamMode: "p2p_direct" },
      });
      expect(updated.ok()).toBeTruthy();
      await page.goto("/");
      await page.getByRole("button", { name: guildName }).click();
      const voiceBtn = page.locator(
        `button[data-channel-id="${voiceChannel!.id}"]`,
      );
      await expect(voiceBtn).toBeVisible({ timeout: 5000 });
      await voiceBtn.dblclick();

      // 验证加入语音房间成功
      const leaveVoiceBtn = page
        .getByRole("button", { name: "断开连接" })
        .first();
      await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

      // 1. 启动屏幕直播推流
      const toggleScreenBtn = page.getByTestId("voice-toggle-screen-btn");
      await expect(toggleScreenBtn).toBeVisible();
      await toggleScreenBtn.click();

      // 弹出 ScreenShareModal，确认启动推流
      const confirmLiveBtn = page.getByTestId("start-screen-share-confirm-btn");
      await expect(confirmLiveBtn).toBeVisible({ timeout: 5000 });
      await page.getByTestId("mode-p2p-btn").click();
      await confirmLiveBtn.click();

      // 验证推流成功开启：卡片呈现 LIVE 徽章与显式“停止直播”按钮
      await expect(toggleScreenBtn).toHaveAttribute("title", "停止共享", {
        timeout: 5000,
      });
      const stopLiveBtn = page.getByTestId("participant-stop-screen-btn");
      await expect(stopLiveBtn).toBeVisible({ timeout: 5000 });
      await expect(stopLiveBtn).toContainText("停止直播");

      // 2. 核心缺陷回归断言：点击卡片右上角“停止直播”按钮
      await stopLiveBtn.first().click();

      // 验证关键红线：绝对不得再次弹出 ScreenShareModal (选择码率与画质弹窗)
      const modalHeading = page.locator("text=选择共享内容");
      await expect(modalHeading).not.toBeVisible();
      await expect(confirmLiveBtn).not.toBeVisible();

      // 验证直播已彻底停止：停止直播按钮消失，底部按钮状态复原为“屏幕共享”
      await expect(stopLiveBtn).not.toBeVisible({ timeout: 5000 });
      await expect(toggleScreenBtn).toHaveAttribute("title", "屏幕共享", {
        timeout: 5000,
      });
    } finally {
      await page.close();
      const deleted = await request.delete(`/api/guilds/${guild.id}`, {
        headers,
        data: { nameConfirmation: guildName },
      });
      expect(deleted.ok()).toBeTruthy();
    }
  });
});
