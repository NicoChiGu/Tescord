import { test, expect } from "@playwright/test";

test.describe("六项核心体验修复专项验收 (头像裁切/布局解耦/Opus频道码率/4轨降噪/前级电平/200%音量)", () => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const tokenPayload = Buffer.from(
    JSON.stringify({
      exp,
      id: "test_user_fixes_1",
      username: "GeekTester",
      role: "USER",
    }),
  ).toString("base64");
  const validJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${tokenPayload}.mock_sig`;

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ({ token }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
        localStorage.setItem(
          "tescord_last_user",
          JSON.stringify({
            id: "test_user_fixes_1",
            username: "GeekTester",
            displayName: "极客小助手",
            email: "tester@tescord.local",
            role: "USER",
            avatarUrl:
              "https://api.dicebear.com/7.x/bottts/svg?seed=GeekTester",
            status: "ONLINE",
          }),
        );
        // 禁用外部 WebSocket 网关，防止未鉴权关闭连接引发 ReauthModal
        (window as any).WebSocket = class MockWebSocket extends EventTarget {
          readyState = 3;
          close() {}
          send() {}
        };
      },
      { token: validJwt },
    );

    // Mock 用户信息接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test_user_fixes_1",
          username: "GeekTester",
          displayName: "极客小助手",
          email: "tester@tescord.local",
          role: "USER",
          avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=GeekTester",
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/api/auth/refresh", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: validJwt,
          refreshToken: "mock_refresh_token",
          user: {
            id: "test_user_fixes_1",
            username: "GeekTester",
            displayName: "极客小助手",
            email: "tester@tescord.local",
            role: "USER",
            status: "ONLINE",
          },
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "guild_voice_test_1",
            name: "极客音频测试服",
            ownerId: "test_user_fixes_1",
            iconUrl: null,
            channels: [
              {
                id: "c_text_1",
                name: "日常闲聊",
                type: "TEXT",
                guildId: "guild_voice_test_1",
              },
              {
                id: "c_voice_1",
                name: "极客开黑语音",
                type: "VOICE",
                guildId: "guild_voice_test_1",
                bitrate: 64000,
              },
            ],
            roles: [],
          },
        ]),
      });
    });

    await page.route("**/api/channels/**/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/api/users/@me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "test_user_fixes_1",
          username: "GeekTester",
          displayName: "极客小助手",
          avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=GeekTester",
        }),
      });
    });
  });

  test("需求 1：用户个人资料中支持头像自定义修改、随机生成与移除，展示正常", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 点击左下角齿轮打开用户设置
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    // 弹窗应挂载
    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 切换到个人资料
    const profileTabBtn = page.getByTestId("tab-profile-btn");
    await profileTabBtn.click();

    // 检查更换头像、随机生成、移除头像按钮
    const changeAvatarBtn = page.getByTestId("change-avatar-btn");
    await expect(changeAvatarBtn).toBeVisible();

    const randomAvatarBtn = page.getByTestId("random-avatar-btn");
    await expect(randomAvatarBtn).toBeVisible();
    await randomAvatarBtn.click();

    const removeAvatarBtn = page.getByTestId("remove-avatar-btn");
    await expect(removeAvatarBtn).toBeVisible();
    await removeAvatarBtn.click();

    // 检查 Avatar 组件展示
    const avatarImg = page
      .locator("img[alt='极客小助手'], img[alt='GeekTester']")
      .first();
    await expect(avatarImg).toBeVisible();

    // 关闭设置弹窗
    const closeBtn = page.getByTestId("close-user-settings-btn");
    await closeBtn.click();
    await expect(settingsModal).not.toBeVisible();
  });

  test("需求 2 & 6：用户设置音视频面板已解耦编码器设置，输出音量最高达200%", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 打开设置面板
    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    const settingsModal = page.getByTestId("user-settings-modal");
    await expect(settingsModal).toBeVisible();

    // 点击“音频与视频”标签
    const audioTabBtn = page.getByTestId("tab-audio-btn");
    await audioTabBtn.click();

    // 验证需求 2：视频编码器与硬件加速已被移除（不在用户设置中）
    const codecSection = page.locator('[data-testid^="codec-option-"]');
    await expect(codecSection).toHaveCount(0);
    const videoCodecsTitle = page.getByText(
      /视频编解码器与硬件加速|Video Codecs/i,
    );
    await expect(videoCodecsTitle).toHaveCount(0);

    // 验证需求 6：输出音量滑块支持最高 200%
    const outputVolumeSlider = page
      .locator("input[type='range'][max='200']")
      .last();
    await expect(outputVolumeSlider).toBeVisible();
    expect(await outputVolumeSlider.getAttribute("max")).toBe("200");

    // 展开高级音频与声学实验室
    const advancedBtn = page.getByTestId("advanced-audio-toggle-btn");
    await expect(advancedBtn).toBeVisible();
    await advancedBtn.click();

    // 验证需求 3：48kHz 开关已彻底从高级折叠面板移除，不影响降噪
    const hifiSwitch = page.getByText(/48kHz 立体声模式|高保真音乐/i);
    await expect(hifiSwitch).toHaveCount(0);

    // 回声消除与自动增益依然保留
    const aecOption = page.getByText("回声消除 (AEC)");
    await expect(aecOption).toBeVisible();
  });

  test("需求 3 验证：语音频道设置中包含 Opus 推流码率调节滑块 (8 kbps ~ 128 kbps)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 进入服务器
    const serverButton = page.getByRole("button", {
      name: "极客音频测试服",
      exact: true,
    });
    await expect(serverButton).toBeVisible();
    await serverButton.click();

    // 找到语音频道
    const voiceChannelRow = page
      .locator("[data-channel-id='c_voice_1']")
      .first();
    await expect(voiceChannelRow).toBeVisible();
    await voiceChannelRow.hover();
    const gearBtn = page.getByTestId("edit-channel-gear-c_voice_1");
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();

    const editModal = page.getByTestId("edit-channel-modal");
    await expect(editModal).toBeVisible();
    const bitrateLabel = page.getByText(
      /音频推流码率|Audio Streaming Bitrate/i,
    );
    await expect(bitrateLabel).toBeVisible();
    const bitrateSlider = editModal.locator(
      "input[type='range'][min='8000'][max='128000']",
    );
    await expect(bitrateSlider).toBeVisible();
    await expect(bitrateSlider).toHaveValue("64000");
    await page.getByTestId("close-edit-channel-btn").click();
  });

  test("需求 4：AI 降噪效果对比播放器采用现代声学电平设计并支持开始测试", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const gearBtn = page.getByTestId("user-settings-gear-btn");
    await expect(gearBtn).toBeVisible({ timeout: 10000 });
    await gearBtn.click();

    const audioTabBtn = page.getByTestId("tab-audio-btn");
    await audioTabBtn.click();

    // 展开高级折叠面板
    const advancedBtn = page.getByTestId("advanced-audio-toggle-btn");
    await expect(advancedBtn).toBeVisible();
    await advancedBtn.click();

    // 验证 A/B 实验室区域与开始录制按钮
    const abStartBtn = page.getByTestId("start-ab-test-btn");
    await expect(abStartBtn).toBeVisible();
  });
});
