import { test, expect } from "@playwright/test";
import { installConnectedLiveKitStub } from "./helpers/media";

test("connection popover shows measured RTT and percentage loss, then clears stale samples", async ({
  page,
}) => {
  await page.goto("/");
  const guild = page
    .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
    .first();
  await expect(guild).toBeVisible();
  await guild.click();

  const voice = page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-volume-2") })
    .first();
  await expect(voice).toBeVisible();
  const userId = await page.evaluate(
    () => (window as any).useAuthStore.getState().user.id as string,
  );
  await installConnectedLiveKitStub(page, userId);
  await voice.dblclick();

  const trigger = page.getByTestId("voice-connection-status-btn");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("语音已连接");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const popover = page.getByTestId("voice-connection-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator("canvas")).toBeVisible();
  await expect(popover).toContainText("本机 ↔ SFU 往返时间");
  await expect(popover).toContainText("24 毫秒");
  await expect(popover).toContainText("0.0%");
  await expect(popover).toContainText("端到端加密状态未验证");

  await page.evaluate(() => {
    const service = (window as any).__livekitService;
    const [identity, sample] = [...service.networkStatsMap.entries()][0];
    service.networkStatsMap.set(identity, {
      ...sample,
      rtt: 84,
      packetLoss: 2.5,
      timestamp: Date.now(),
    });
    service.onNetworkStatsChangedCallbacks.forEach(
      (callback: (stats: Map<string, unknown>) => void) =>
        callback(service.networkStatsMap),
    );
  });
  await expect(popover).toContainText("84 毫秒");
  await expect(popover).toContainText("2.5%");
  await expect(popover).not.toContainText("250.0%");

  await page.evaluate(() => {
    const service = (window as any).__livekitService;
    const [identity, sample] = [...service.networkStatsMap.entries()][0];
    service.networkStatsMap.set(identity, {
      ...sample,
      timestamp: Date.now() - 30_000,
    });
    service.onNetworkStatsChangedCallbacks.forEach(
      (callback: (stats: Map<string, unknown>) => void) =>
        callback(service.networkStatsMap),
    );
  });
  await expect(popover).toContainText("暂无数据");
  await expect(popover).not.toContainText("84 毫秒");

  await page.getByTestId("connection-more-stats-btn").click();
  await expect(popover).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: /WebRTC 媒体引擎与网络健康看板/ }),
  ).toBeVisible();
});

test("connection popover renders smooth Discord-style canvas wave and prevents latency jumping on intermittent nulls", async ({
  page,
}) => {
  await page.goto("/");
  const guild = page
    .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
    .first();
  await expect(guild).toBeVisible();
  await guild.click();

  const voice = page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-volume-2") })
    .first();
  await expect(voice).toBeVisible();
  const userId = await page.evaluate(
    () => (window as any).useAuthStore.getState().user.id as string,
  );
  await installConnectedLiveKitStub(page, userId);
  await voice.dblclick();

  const trigger = page.getByTestId("voice-connection-status-btn");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("语音已连接");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const popover = page.getByTestId("voice-connection-popover");
  await expect(popover).toBeVisible();

  // 验证 Canvas 存在且具有真实物理尺寸
  const canvas = popover.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(50);

  // 模拟 WebRTC 采样瞬时遇到空窗（rtt 变成 undefined），验证防抖动平滑机制：在新鲜期内不应闪退成暂无数据
  await page.evaluate(() => {
    const service = (window as any).__livekitService;
    const [identity, sample] = [...service.networkStatsMap.entries()][0];
    service.networkStatsMap.set(identity, {
      ...sample,
      rtt: undefined, // 模拟偶发单次未读到 RTT
      timestamp: Date.now(),
    });
    service.onNetworkStatsChangedCallbacks.forEach(
      (callback: (stats: Map<string, unknown>) => void) =>
        callback(service.networkStatsMap),
    );
  });

  // 在新鲜期内保留最后有效 RTT，防跳动与清空生效
  await expect(popover).toContainText("24 毫秒");
  await expect(popover).not.toContainText("暂无数据");
});
