import { test, expect } from "@playwright/test";

test.describe("双引擎 AI 降噪（RNNoise + DTLN）与三轨 A/B 录音试听全链路验收", () => {
  test("完整验证双引擎 3 档切换、多轨试听对比、头像徽标感知与底栏快捷轮换", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入用户鉴权状态与 Mock 路由
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_noise_user",
          username: "acoustic_tester",
          displayName: "声学验收员",
          email: "acoustic@example.com",
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

    // 3. 打开“音频与降噪设置”控制中心
    const audioSettingsBtn = page.getByRole("button", {
      name: "音频与降噪设置",
    });
    await expect(audioSettingsBtn).toBeVisible({ timeout: 5000 });
    await audioSettingsBtn.click();

    // 4. 验证弹窗与双引擎卡片挂载
    const modalHeading = page.getByRole("heading", {
      name: /语音引擎与 RNNoise|降噪控制中心/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 验证标题与描述文字
    await expect(
      page.getByText(/RNNoise \/ DTLN 双引擎神经网络深度降噪|RNNoise 神经网络深度降噪/i),
    ).toBeVisible();

    // 5. 验证 3 档分段卡片选择器
    const offCard = page.getByRole("button", { name: /直通原声|未降噪/i });
    const rnnoiseCard = page.getByRole("button", { name: /RNNoise 标准轻量/i });
    const dtlnCard = page.getByRole("button", { name: /DTLN 深度净化/i });

    await expect(offCard).toBeVisible();
    await expect(rnnoiseCard).toBeVisible();
    await expect(dtlnCard).toBeVisible();

    // 6. 测试切换至 DTLN 深度净化档位 (消机械键盘音)
    await dtlnCard.click();
    await expect(page.getByText(/DTLN 双流 LSTM/i)).toBeVisible();

    // 7. 测试切换至直通关闭档位
    await offCard.click();
    await expect(page.getByText(/直通模式 \(未降噪\)/i)).toBeVisible();

    // 8. 切换回 RNNoise 标准轻量档位
    await rnnoiseCard.click();
    await expect(page.getByText(/RNNoise WASM 480分帧/i)).toBeVisible();

    // 9. 展开高级设置并验证三轨 A/B 录音对比测试工具
    const advancedToggleBtn = page.getByRole("button", {
      name: /高级音频设置与降噪实验室/i,
    });
    if (await advancedToggleBtn.isVisible()) {
      await advancedToggleBtn.click();
    }
    await expect(
      page.getByText(/AI 降噪前后效果三轨录音试听对比/i),
    ).toBeVisible();

    const startABBtn = page.getByRole("button", {
      name: /开始 5 秒环境与键盘杂音多轨录音测试/i,
    });
    await expect(startABBtn).toBeVisible();

    // 10. 关闭弹窗并通过快捷方式验证语音频道内的降噪表现
    const closeBtn = page.getByRole("button", { name: "关闭", exact: true });
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();

    // 11. 进入语音频道
    const voiceChannelBtn = page
      .getByRole("button", { name: /语音闲聊|开黑开麦|voice/i })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.click();

    // 验证加入成功（底栏断开连接按钮呈现）
    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 12. 验证头像上的降噪徽标
    const noiseBadge = page.locator("text=RNNoise 降噪").first();
    await expect(noiseBadge).toBeVisible({ timeout: 5000 });

    // 13. 点击底栏 Sparkles 按钮进行模式轮转 (RNNoise -> DTLN)
    const sparklesBtn = page.getByTestId("voice-sparkles-btn");
    await expect(sparklesBtn).toBeVisible({ timeout: 5000 });
    await sparklesBtn.click();

    // 验证头像徽标动态切换为 DTLN 深度降噪
    const dtlnBadge = page.locator("text=DTLN 深度降噪").first();
    await expect(dtlnBadge).toBeVisible({ timeout: 5000 });

    // 14. 退出语音频道
    await leaveVoiceBtn.click();
    await expect(leaveVoiceBtn).not.toBeVisible({ timeout: 5000 });

    // 15. 确保控制台无致命未捕获错误
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
