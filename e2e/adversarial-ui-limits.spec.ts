import { test, expect } from "@playwright/test";
import { installConnectedLiveKitStub } from "./helpers/media";

const samplePngBuffer = Buffer.from(
  "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",
  "base64",
);

test.describe("前端对抗与状态极限测试 (Challenger 2 Empirical Adversarial Limits)", () => {
  test("1. P2P 模式下极端 RTT (0ms, 9999ms)、100% 丢包率与 0 成员在房间时的 Popover 柱状图渲染稳定性", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    const guild = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(guild).toBeVisible({ timeout: 15000 });
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

    // 1.1 注入 P2P 激活状态与 9999ms 超高延迟 + 100% 丢包率极端节点
    await page.evaluate(() => {
      const vm = (window as any).voiceMeshManager;
      if (!vm) throw new Error("voiceMeshManager is unavailable");
      vm.getIsMeshActive = () => true;

      const reports = new Map();
      reports.set("peer-extreme-1", {
        targetUserId: "peer-extreme-1",
        rtt: 9999,
        jitter: 150,
        packetLoss: 100,
        connectionType: "P2P",
        status: "connected",
        remoteAddress: "240e:398:123::1:5000",
        updatedAt: Date.now(),
      });

      vm.latencyCallbacks.forEach((cb: (m: Map<string, any>) => void) =>
        cb(reports),
      );
    });

    // 断言 P2P 直连柱状图渲染
    const histogram = page.getByTestId("p2p-mesh-histogram");
    await expect(histogram).toBeVisible();
    const bar = page.getByTestId("p2p-histogram-bar-peer-extreme-1");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("9999ms");
    await expect(popover).toContainText("9999");
    await expect(popover).toContainText("100.0%");

    // 1.2 注入 0ms 极端延迟
    await page.evaluate(() => {
      const vm = (window as any).voiceMeshManager;
      const reports = new Map();
      reports.set("peer-zero-rtt", {
        targetUserId: "peer-zero-rtt",
        rtt: 0,
        jitter: 0,
        packetLoss: 0,
        connectionType: "LAN",
        status: "connected",
        updatedAt: Date.now(),
      });
      vm.latencyCallbacks.forEach((cb: (m: Map<string, any>) => void) =>
        cb(reports),
      );
    });

    await expect(histogram).toContainText("暂无数据");
    await expect(popover).not.toContainText("NaN");

    // 1.3 注入 0 成员空网格
    await page.evaluate(() => {
      const vm = (window as any).voiceMeshManager;
      const reports = new Map();
      vm.latencyCallbacks.forEach((cb: (m: Map<string, any>) => void) =>
        cb(reports),
      );
    });

    await expect(histogram).toContainText("暂无数据");
    await expect(popover).toContainText("(0 节点)");
    await expect(popover).not.toContainText("NaN");

    const fatalErrors = consoleErrors.filter(
      (e) => !e.includes("net::ERR_") && !e.includes("WebSocket"),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test("2. LightboxModal 原图下载失败与中断时毛玻璃状态卡片与重试状态恢复", async ({
    page,
  }) => {
    await page.goto("/");
    const generalChannel = page.locator('text="general"').first();
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();

    const fileName = `lightbox_fail_test_${Date.now()}.png`;

    await page.route(`**/*${fileName}*`, async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: samplePngBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 上传真实有效 PNG 图片
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: samplePngBuffer,
    });

    const pendingPreview = page.locator(`text="${fileName}"`);
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    const chatInput = page.locator('div[contenteditable="true"]').first();
    await chatInput.click();
    await chatInput.fill(`Fail_Test_${Date.now()}`);
    await chatInput.press("Enter");

    // 等待消息图片上传渲染
    const uploadedImg = page.locator(`img[alt="${fileName}"]`).last();
    await expect(uploadedImg).toBeVisible({ timeout: 15000 });

    // 拦截原图获取接口以模拟下载错误
    let retryAttemptCount = 0;
    await page.route("**/api/attachments/access", async (route, request) => {
      if (request.method() === "POST") {
        retryAttemptCount++;
        if (retryAttemptCount === 1) {
          // 第一次报错
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Storage access timeout" }),
          });
        } else {
          // 第二次重试恢复
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              attachments: [
                {
                  id: fileName,
                  url: `https://localhost:4173/${fileName}`,
                  expiresAt: Date.now() + 3600000,
                },
              ],
            }),
          });
        }
      } else {
        await route.continue();
      }
    });

    // 点击打开 Lightbox
    await uploadedImg.click();
    const dialog = page.locator('[data-testid="lightbox-modal"]');
    await expect(dialog).toBeVisible();

    // 点击下载原图按钮 (必定触发 /api/attachments/access)
    const downloadBtn = dialog
      .locator('button[aria-label*="下载"], button[aria-label*="Download"]')
      .first();
    await expect(downloadBtn).toBeVisible({ timeout: 5000 });
    await downloadBtn.click();

    // 验证下载接口报错 500 后，弹出 Toast 轻提示且下载按钮恢复正常 (不产生死锁)
    const toast = dialog.locator("text=/下载失败|Download failed|timeout/i");
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(downloadBtn).toBeEnabled({ timeout: 5000 });

    // 再次点击下载，触发重试 (第 2 次成功返回)
    await downloadBtn.click();
    expect(retryAttemptCount).toBeGreaterThanOrEqual(2);
  });

  test("3. 5 套多语言 (zh-CN, zh-TW, zh-HK, en-US, ja-JP) 界面排版无破损与无未映射键", async ({
    page,
  }) => {
    await page.goto("/");
    const guild = page
      .getByRole("button", { name: /Tescord 极客总部|极客|小窝/i })
      .first();
    await expect(guild).toBeVisible({ timeout: 15000 });
    await guild.click();

    const locales = ["en-US", "ja-JP", "zh-TW", "zh-HK", "zh-CN"] as const;

    for (const locale of locales) {
      await page.evaluate((loc) => {
        (window as any).changeLocale(loc);
      }, locale);

      await page.waitForTimeout(300);

      const bodyText = await page.innerText("body");
      expect(bodyText).not.toMatch(/voice:[a-zA-Z]/);
      expect(bodyText).not.toMatch(/chat:[a-zA-Z]/);
      expect(bodyText).not.toMatch(/common:[a-zA-Z]/);
      expect(bodyText).not.toMatch(/modals:[a-zA-Z]/);
    }
  });
});
