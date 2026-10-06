import { installEncryptedVoiceUi } from "./helpers/encrypted-voice-ui";
import { test, expect } from "@playwright/test";

test.describe("三引擎降噪与四轨 A/B 录音试听全链路验收", () => {
  test("完整验证三引擎切换、试听入口与底栏快捷轮换", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 注入用户鉴权状态与 Mock 路由
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_default_admin",
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

    await installEncryptedVoiceUi(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 2. 进入首个公会
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 3. 打开“音频与降噪设置”控制中心
    const audioSettingsBtn = page.getByRole("button", {
      name: "音频与降噪设置",
    });
    await expect(audioSettingsBtn).toBeVisible({ timeout: 5000 });
    await audioSettingsBtn.click();

    // 4. 验证弹窗与三个真实引擎卡片挂载
    const modalHeading = page.getByRole("heading", {
      name: /语音引擎与 RNNoise|降噪控制中心/i,
    });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 验证标题与描述文字
    await expect(page.getByText("本地降噪引擎", { exact: true })).toBeVisible();

    // 5. 验证 4 档分段卡片选择器
    const offCard = page.getByRole("button", { name: /直通原声|未降噪/i });
    const rnnoiseCard = page.getByRole("button", { name: /RNNoise 标准轻量/i });
    const dtlnCard = page.getByRole("button", { name: /DTLN 深度净化/i });
    const dfn3Card = page.getByRole("button", { name: /DeepFilterNet3/i });

    await expect(offCard).toBeVisible();
    await expect(rnnoiseCard).toBeVisible();
    await expect(dtlnCard).toBeVisible();
    await expect(dfn3Card).toBeVisible();

    // 6. 测试切换至 DTLN
    await dtlnCard.click();
    await expect(dtlnCard).toHaveClass(/border-discord-green/);

    // 7. 测试切换至 DeepFilterNet3
    await dfn3Card.click();
    await expect(dfn3Card).toHaveClass(/border-purple-500/);

    // 8. 测试切换至直通关闭档位
    await offCard.click();
    await expect(offCard).toHaveClass(/border-rose-500/);

    // 9. 切换回 RNNoise 标准轻量档位
    await rnnoiseCard.click();
    await expect(rnnoiseCard).toHaveClass(/border-discord-brand/);

    // 10. 展开高级设置并验证四轨 A/B 录音对比测试工具
    const advancedToggleBtn = page.getByRole("button", {
      name: /高级音频设置与降噪实验室/i,
    });
    if (await advancedToggleBtn.isVisible()) {
      await advancedToggleBtn.click();
    }
    await expect(page.getByText(/AI 降噪前后效果/i)).toBeVisible();

    const startABBtn = page.getByRole("button", {
      name: /开始 5 秒环境与键盘杂音多轨录音测试/i,
    });
    await expect(startABBtn).toBeVisible();

    // 11. 关闭弹窗并通过快捷方式验证语音频道内的降噪表现
    const closeBtn = page.getByTestId("close-user-settings-btn");
    await closeBtn.click();
    await expect(modalHeading).not.toBeVisible();

    // 12. 进入语音频道
    const voiceChannelBtn = page
      .locator('button[data-testid^="channel-button-"][title]')
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await voiceChannelBtn.dblclick();

    // 验证加入成功（底栏断开连接按钮呈现）
    const leaveVoiceBtn = page
      .getByRole("button", { name: "断开连接" })
      .first();
    await expect(leaveVoiceBtn).toBeVisible({ timeout: 8000 });

    // 13. 点击底栏 Sparkles 按钮展开浮层菜单并精确点选 DFNv3
    const sparklesBtn = page.getByTestId("voice-sparkles-btn");
    await expect(sparklesBtn).toBeVisible({ timeout: 5000 });
    await expect(sparklesBtn).toHaveAttribute(
      "title",
      /RNNoise AI 智能降噪已开启/,
    );
    await sparklesBtn.click();

    // 浮层菜单弹出并展示 4 种模式
    const noiseMenu = page.getByTestId("voice-noise-menu");
    await expect(noiseMenu).toBeVisible();
    await expect(page.getByTestId("noise-option-dfn3")).toBeVisible();
    await expect(page.getByTestId("noise-option-dtln")).toBeVisible();

    // 点击 DFNv3 选项
    await page.getByTestId("noise-option-dfn3").click();
    await expect(noiseMenu).not.toBeVisible();

    // 验证底栏按钮动态切换为 DFNv3 旗舰降噪
    await expect(sparklesBtn).toHaveAttribute(
      "title",
      /DFNv3 旗舰全频降噪已开启/,
    );

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
