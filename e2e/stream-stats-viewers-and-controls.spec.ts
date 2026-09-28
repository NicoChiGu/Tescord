import { test, expect } from "@playwright/test";
import { installConnectedLiveKitStub } from "./helpers/media.js";

test.describe("主播推流控制、媒体编解码统计与观众管理端到端验收", () => {
  test.beforeEach(async ({ page }) => {
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
          username: "e2e_streamer",
          displayName: "主播测试员",
          email: "streamer@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/network/ice-servers", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          turnActive: true,
        }),
      });
    });
  });

  test("主播禁止全屏播放、支持聚焦，右上角展示（·）人数徽标并能弹出观众管理，且能正常查看主播推流统计", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入服务器并加入语音频道
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    const voiceChannelBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-volume-2") })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await installConnectedLiveKitStub(page, "usr_default_admin");
    await voiceChannelBtn.dblclick();

    await expect(page.getByText("语音已连接")).toBeVisible({ timeout: 5000 });

    // 2. 开启摄像头 (本地主播推流状态)
    const toggleCameraBtn = page.locator(
      '[data-testid="voice-toggle-camera-btn"]',
    );
    if (await toggleCameraBtn.isVisible()) {
      await toggleCameraBtn.click();
    }

    // 3. 验证需求 4：主播卡片上禁止全屏播放 (全屏按钮不存在)
    const fullscreenBtn = page.locator(
      '[data-testid="fullscreen-btn-usr_default_admin"]',
    );
    await expect(fullscreenBtn).not.toBeAttached();

    // 4. 验证需求 3：右上角存在带有红点的【（·）人数】徽标按钮
    const viewersBadgeBtn = page.locator(
      '[data-testid="stream-viewers-badge-btn-usr_default_admin"]',
    );
    await expect(viewersBadgeBtn).toBeVisible({ timeout: 5000 });
    await expect(viewersBadgeBtn).toContainText("(");

    // 5. 点击【（·）人数】徽标打开观众管理弹窗
    await viewersBadgeBtn.click();
    const viewersModalTitle = page.getByText("当前正在观看");
    await expect(viewersModalTitle).toBeVisible({ timeout: 5000 });
    await viewersBadgeBtn.click();
    await expect(viewersModalTitle).not.toBeVisible();
    await viewersBadgeBtn.click();
    await expect(viewersModalTitle).toBeVisible();

    // 验证暂无观众或观众列表呈现
    const emptyNotice = page.getByText(/暂无观众观看此直播|0/);
    await expect(emptyNotice.first()).toBeVisible();

    // 关闭观众管理弹窗
    const closeViewersBtn = page
      .locator('[data-testid="stream-viewers-drag-handle"]')
      .locator("button")
      .first();
    await closeViewersBtn.click();
    await expect(viewersModalTitle).not.toBeVisible();

    // 6. 验证需求 2：主播能点击媒体属性按钮正常查看推流统计 (HUD)
    const statsBtn = page
      .locator('[data-testid="participant-stats-btn"]')
      .first();
    await expect(statsBtn).toBeAttached({ timeout: 5000 });
    await statsBtn.click({ force: true });

    // 验证 HUD 弹出并正确展示
    const hudTitle = page.getByText("媒体属性与实时统计");
    await expect(hudTitle).toBeVisible({ timeout: 5000 });

    // 验证本地推流标识与帧数标签 (Encoded Frames 或 本地推流)
    const localRole = page.getByText(/本地推流/);
    await expect(localRole.first()).toBeVisible();

    const framesLabel = page.getByText(/已编码帧数/);
    await expect(framesLabel.first()).toBeVisible();
  });
});
