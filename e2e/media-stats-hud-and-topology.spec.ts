import { test, expect } from "@playwright/test";
import { installConnectedLiveKitStub } from "./helpers/media";

test.describe("媒体属性面板、传输速率与网络连接架构端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入已登录状态
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 认证接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_1",
          username: "e2e_tester",
          displayName: "E2E测试员",
          email: "e2e@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    // Mock 双栈 ICE 服务器接口
    await page.route("**/api/network/ice-servers", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          iceServers: [
            { urls: "stun:stun.cloudflare.com:3478" },
            { urls: "stun:stun.qq.com:3478" },
            {
              urls: ["turn:127.0.0.1:3478?transport=udp"],
              username: "tescorduser",
              credential: "tescordpass",
            },
          ],
          turnActive: true,
        }),
      });
    });
  });

  test("纯语音通话显示 SFU 架构，未采集指标保持未知且不误判为 P2P，支持拖拽浮动、失焦自动收起与聚焦模式联动", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // 1. 进入服务器
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 10000 });
    await serverButton.click();

    // 2. 加入语音频道
    const voiceChannelBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-volume-2") })
      .first();
    await expect(voiceChannelBtn).toBeVisible({ timeout: 5000 });
    await installConnectedLiveKitStub(page, "e2e_user_1");
    await voiceChannelBtn.dblclick();

    // 3. 确认已成功进入语音频道
    await expect(page.getByText("语音已连接")).toBeVisible({ timeout: 5000 });

    // 4. 纯语音卡片右上角应常驻媒体属性按钮 (data-testid="participant-stats-btn")
    const statsBtn = page
      .locator('[data-testid="participant-stats-btn"]')
      .first();
    await expect(statsBtn).toBeAttached({ timeout: 5000 });

    // 点击媒体属性按钮打开 HUD 面板，并自动联动激活 Spotlight 聚焦模式
    await statsBtn.click({ force: true });

    // 5. 验证媒体属性 HUD 面板内容展示
    const hudTitle = page.getByText("媒体属性与实时统计");
    await expect(hudTitle).toBeVisible({ timeout: 5000 });

    // 验证网络拓扑与架构正确显示为 SFU，不再被误标为 P2P Direct
    const topologyItem = page.getByText("网络拓扑:");
    await expect(topologyItem).toBeVisible();
    const topologyVal = page.getByText(/LiveKit SFU|SFU/);
    await expect(topologyVal.first()).toBeVisible();

    const connectionModeItem = page.getByText("连接架构:");
    await expect(connectionModeItem).toBeVisible();
    await expect(connectionModeItem.locator("..").getByText("协商中")).toBeVisible();

    // 确保绝对没有误判为 P2P Direct
    const p2pDirectBug = page.getByText(/P2P Direct \(UDP \/ Host\)/);
    await expect(p2pDirectBug).not.toBeVisible();

    // 验证 IP 协议栈徽章
    const ipStackItem = page.getByText("IP 协议栈:");
    await expect(ipStackItem).toBeVisible();
    await expect(ipStackItem.locator("..").getByText("未知")).toBeVisible();

    // 验证实时传输速率与流量
    const bitrateItem = page.getByText("下行/下载码率:");
    await expect(bitrateItem).toBeVisible();
    await expect(bitrateItem.locator("..").getByText("未知")).toBeVisible();

    // 验证复制全部属性与统计按钮可用
    const copyBtn = page.getByTitle("复制全部属性与统计");
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // 6. 验证容器内拖拽功能 (Draggable inside card)
    const hudPanel = hudTitle.locator("xpath=ancestor::div[contains(@class, 'z-40')]");
    const initialBox = await hudPanel.boundingBox();
    expect(initialBox).not.toBeNull();

    const dragHandle = page.locator('[data-testid="stream-stats-drag-handle"]');
    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // 移动至拖拽手柄并按住平移
    const startX = handleBox!.x + 40;
    const startY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY + 40, { steps: 5 });
    await page.mouse.up();

    const afterDragBox = await hudPanel.boundingBox();
    expect(afterDragBox).not.toBeNull();
    // 验证位置已发生平移
    expect(afterDragBox!.x).not.toBe(initialBox!.x);

    // 7. 验证失焦自闭 (Click Outside)
    // 点击卡片外部的视口空白处，面板应自动关闭隐藏
    await page.mouse.click(10, 10);
    await expect(hudTitle).not.toBeVisible({ timeout: 3000 });

    // 8. 重新点击按钮展开 HUD，验证 ESC 键失焦收起
    await statsBtn.click({ force: true });
    await expect(hudTitle).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(hudTitle).not.toBeVisible({ timeout: 3000 });

    // 9. 重新展开 HUD，验证退出聚焦模式时联动销毁 HUD（如果没有聚焦就不允许显示）
    await statsBtn.click({ force: true });
    await expect(hudTitle).toBeVisible();
    const unpinBtn = page.locator('[data-testid="stage-unpin-btn"]').first();
    if (await unpinBtn.isVisible()) {
      await unpinBtn.click({ force: true });
      // 退出聚焦后，HUD 应立即不可见
      await expect(hudTitle).not.toBeVisible({ timeout: 3000 });
    }

    // 10. 验证通过右键菜单打开
    const stageCard = page
      .locator('[data-testid^="participant-card-"], [data-testid^="participant-video-tile-"]')
      .first();
    if (await stageCard.isVisible()) {
      await stageCard.click({ button: "right" });
      const contextMenuItem = page.getByText("媒体属性与详细统计 (Stats)");
      if (await contextMenuItem.isVisible()) {
        await contextMenuItem.click();
        await expect(hudTitle).toBeVisible();
        // 关闭面板按钮正常可用
        const closeBtn = page.getByTitle("关闭面板");
        await expect(closeBtn).toBeVisible();
        await closeBtn.click();
        await expect(hudTitle).not.toBeVisible();
      }
    }
  });
});
