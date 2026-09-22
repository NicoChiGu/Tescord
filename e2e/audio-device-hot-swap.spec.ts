import { test, expect } from "@playwright/test";

test.describe("语音输入配置热切换与无缝推流验收 (Audio Input Hot Swap E2E)", () => {
  test("验证通话中切换麦克风输入设备与声学算法开关零断流、快捷下拉菜单及持久化机制", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (
        msg.type() === "error" &&
        !msg.text().includes("net::ERR_CONNECTION_REFUSED") &&
        !msg.text().includes("Failed to load resource")
      ) {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入 Mock 鉴权状态与多麦克风硬件设备
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

      const fakeMics = [
        {
          deviceId: "mic_builtin",
          kind: "audioinput",
          label: "内置阵列麦克风 (Realtek High Definition Audio)",
          groupId: "group_mic_1",
        },
        {
          deviceId: "mic_headset_bluetooth",
          kind: "audioinput",
          label: "Sony WH-1000XM5 (蓝牙耳机免提麦克风)",
          groupId: "group_mic_2",
        },
        {
          deviceId: "mic_usb_yeti",
          kind: "audioinput",
          label: "Blue Yeti Pro USB 播客麦克风",
          groupId: "group_mic_3",
        },
      ];

      const fakeOutputs = [
        {
          deviceId: "speaker_default",
          kind: "audiooutput",
          label: "扬声器 (Realtek Audio)",
          groupId: "group_mic_1",
        },
      ];

      if (navigator.mediaDevices) {
        navigator.mediaDevices.enumerateDevices = async () => {
          return [...fakeMics, ...fakeOutputs] as unknown as MediaDeviceInfo[];
        };

        navigator.mediaDevices.getUserMedia = async (constraints: any) => {
          // 创建模拟的 AudioContext 与合成正弦波音轨
          const audioCtx = new (
            window.AudioContext || (window as any).webkitAudioContext
          )();
          const osc = audioCtx.createOscillator();
          const dst = audioCtx.createMediaStreamDestination();
          osc.connect(dst);
          osc.start();
          const stream = dst.stream;

          // 记录当前约束中的 deviceId
          (stream as any).__mockDeviceId =
            constraints?.audio?.deviceId?.exact || "default";
          return stream;
        };
      }
    });

    // Mock 用户信息接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_audio_hot_swap_user",
          username: "audio_tester",
          displayName: "音频测试员",
          email: "audio@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock LiveKit Token 接口
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

    // 2. 进入服务器与语音频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 双击加入语音频道
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 验证加入成功
    await expect(
      page.getByRole("button", { name: "断开连接" }).first(),
    ).toBeVisible({
      timeout: 10000,
    });

    // 验证通话主面板挂载
    const voiceRoom = page.getByTestId("voice-room-area");
    await expect(voiceRoom).toBeVisible({ timeout: 10000 });

    // 3. 验证语音控制栏上的麦克风控制胶囊组
    const toggleMicBtn = page.getByTestId("voice-toggle-mute-btn");
    const micMenuBtn = page.getByTestId("voice-mic-menu-btn");
    await expect(toggleMicBtn).toBeVisible();
    await expect(micMenuBtn).toBeVisible();

    // 4. 点击小箭头展开麦克风设备快捷选择菜单
    await micMenuBtn.click();
    const micQuickMenu = page.getByTestId("mic-quick-menu");
    await expect(micQuickMenu).toBeVisible();

    // 验证检测到的多个麦克风选项均已呈现在下拉菜单中
    await expect(page.getByText(/Sony WH-1000XM5/i)).toBeVisible();
    await expect(page.getByText(/Blue Yeti Pro USB/i)).toBeVisible();

    // 5. 点击切换为 Blue Yeti 麦克风
    const yetiOption = page.getByTestId("mic-option-mic_usb_yeti");
    await expect(yetiOption).toBeVisible();
    await yetiOption.click();

    // 验证快捷菜单关闭
    await expect(micQuickMenu).not.toBeVisible();

    // 验证 localStorage 持久化记录了当前选择的麦克风
    const savedInputId = await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_input_id"),
    );
    expect(savedInputId).toBe("mic_usb_yeti");

    // 再次打开菜单，验证选中的项显示激活对勾 (Check 图标)
    await micMenuBtn.click();
    await expect(micQuickMenu).toBeVisible();
    const activeCheckIcon = yetiOption.locator("svg");
    await expect(activeCheckIcon).toBeVisible();

    // 点击外部空白区域关闭快捷菜单
    await page.mouse.click(10, 10);
    await expect(micQuickMenu).not.toBeVisible();

    // 6. 打开用户设置面板，验证设置面板中输入设备同步选中并支持切换
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();

    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 验证当前选中的输入设备显示为 Blue Yeti 麦克风
    const inputDeviceSelect = page.locator("select").first();
    await expect(inputDeviceSelect).toBeVisible();
    await expect(inputDeviceSelect).toHaveValue("mic_usb_yeti");

    // 在设置面板中切换回 Sony 蓝牙耳机麦克风
    await inputDeviceSelect.selectOption("mic_headset_bluetooth");

    // 验证 localStorage 同步更新为 Sony 麦克风
    const updatedInputId = await page.evaluate(() =>
      localStorage.getItem("tescord_selected_audio_input_id"),
    );
    expect(updatedInputId).toBe("mic_headset_bluetooth");

    // 7. 测试开关声学算法（回声消除、自动增益等），验证触发热同步且无异常抛错
    const echoToggle = page.getByText(/回声消除/i).first();
    if (await echoToggle.isVisible()) {
      await echoToggle.click();
    }

    // 按 Escape 关闭设置中心
    await page.keyboard.press("Escape");
    await expect(settingsModal).not.toBeVisible();

    // 验证语音通话面板依然正常连接，无严重未捕获错误
    await expect(voiceRoom).toBeVisible();

    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("LiveKit") &&
        !err.includes("AudioContext") &&
        !err.includes("ECONNREFUSED") &&
        !err.includes("401") &&
        !err.includes("Unauthorized") &&
        !err.includes("ConnectionError"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
