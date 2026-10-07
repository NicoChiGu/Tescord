import { test, expect } from "@playwright/test";
import path from "path";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs.js";

// 构造 320x200 真实测试 PNG 图片 Buffer (长宽比 1.6: 16/10)
const samplePngBuffer = Buffer.from(
  "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",
  "base64",
);

/**
 * 创建合法的最小 PCM WAV 音频二进制 Buffer
 */
function createMockWavBuffer(seconds = 2, sampleRate = 8000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = Math.floor(seconds * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < dataSize / 2; i++) {
    const sample = Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 12000;
    buffer.writeInt16LE(Math.floor(sample), 44 + i * 2);
  }
  return buffer;
}

const mockAudioBuffer = createMockWavBuffer(3);

test.describe("移动端消息图片骨架屏动态等比缩减 & 迷你悬浮音乐播放器触屏拖拽验收", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((version) => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
      localStorage.setItem("tescord_last_seen_changelog_version", version);
    }, CURRENT_APP_VERSION);
  });

  test("1. 移动端窄屏(360x740)下消息图片骨架屏动态倍率缩减且严格保持长宽比，不超出聊天容器", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 切换至主流移动端竖屏视口 (360px 宽度)
    await page.setViewportSize({ width: 360, height: 740 });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15000 });

    const generalChannel = page.locator('text="general"').first();
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();

    const fileName = `mobile_skeleton_${Date.now()}.png`;

    // 路由拦截：人工延迟 1000ms 返回图片，捕获骨架屏状态
    await page.route(`**/*${fileName}*`, async (route, request) => {
      if (request.method() === "GET") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: samplePngBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 上传待测图片
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: samplePngBuffer,
    });

    const pendingPreview = page.locator(`text="${fileName}"`);
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    const chatInput = page.locator('div[contenteditable="true"]').first();
    await chatInput.fill(`Mobile_Skeleton_Test_${Date.now()}`);
    await chatInput.press("Enter");

    // 核心断言 1：图片处于加载态时，骨架屏处于可见状态
    const skeleton = page.locator('[data-testid="image-skeleton"]').last();
    await expect(skeleton).toBeVisible({ timeout: 8000 });
    await expect(skeleton).toHaveClass(/animate-pulse/);

    // 核心断言 2：骨架屏容器宽度不得超出屏幕视口宽度，且必须受到动态倍率收缩约束 (<= 280px)
    const skeletonContainer = skeleton.locator(
      "xpath=ancestor::div[contains(@class, 'group/att')]",
    );
    await expect(skeletonContainer).toBeVisible();

    const containerBox = await skeletonContainer.boundingBox();
    expect(containerBox).not.toBeNull();
    // 360px 移动屏下，图片骨架屏宽度绝不能为桌面端的 380px，必须 <= 280px 且 > 120px
    expect(containerBox!.width).toBeLessThanOrEqual(280);
    expect(containerBox!.width).toBeGreaterThanOrEqual(120);

    // 核心断言 3：长宽比必须严格维持（原图为 320x200 即 1.6 宽高比，允许亚像素轻微四舍五入）
    const actualRatio = containerBox!.width / containerBox!.height;
    expect(actualRatio).toBeGreaterThan(1.4);
    expect(actualRatio).toBeLessThan(1.8);

    // 保存移动端骨架屏截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "mobile-chat-image-skeleton-loading.png",
      ),
    });

    // 核心断言 4：完全加载后骨架屏关闭，图片可见，依然严守边界不横向撑破视口
    await expect(skeleton).not.toBeVisible({ timeout: 10000 });
    const renderedImg = page.locator(`img[alt="${fileName}"]`).last();
    await expect(renderedImg).toBeVisible({ timeout: 5000 });

    const loadedContainer = renderedImg.locator(
      "xpath=ancestor::div[contains(@class, 'group/att')]",
    );
    await expect(loadedContainer).toBeVisible();
    const loadedContainerBox = await loadedContainer.boundingBox();
    expect(loadedContainerBox).not.toBeNull();
    expect(loadedContainerBox!.width).toBeLessThanOrEqual(280);

    // 过滤非严重警告
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("2. 迷你悬浮音乐播放窗口在移动端触屏手势下支持平滑拖拽与边界防护", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 移动端视口
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15000 });

    const generalChannel = page.locator('text="general"').first();
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();

    const audioName = `mobile_drag_track_${Date.now()}.wav`;

    await page.route(`**/*${audioName}*`, async (route, req) => {
      if (req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: mockAudioBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 发送音频并播放触发小窗
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: audioName,
      mimeType: "audio/wav",
      buffer: mockAudioBuffer,
    });
    await expect(page.locator(`text="${audioName}"`)).toBeVisible({
      timeout: 10000,
    });

    const chatInput = page.locator('div[contenteditable="true"]').first();
    await chatInput.fill(`Play_Audio_${Date.now()}`);
    await chatInput.press("Enter");

    const playerCard = page
      .locator('[data-testid="audio-attachment-player"]')
      .filter({ hasText: audioName })
      .last();
    await expect(playerCard).toBeVisible({ timeout: 10000 });

    const playBtn = playerCard
      .locator('button[aria-label="播放"], button[title="播放"]')
      .first();
    await playBtn.click();

    // 核心断言 1：全局迷你小窗呈现，且包含 touch-none 防止原生滚动冲突
    const miniPlayer = page.locator('[data-testid="global-mini-audio-player"]');
    await expect(miniPlayer).toBeVisible({ timeout: 10000 });
    await expect(miniPlayer).toHaveClass(/touch-none/);

    const initialBox = await miniPlayer.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialX = initialBox!.x;
    const initialY = initialBox!.y;

    // 核心断言 2：模拟触屏手势进行 Pointer/Touch 拖拽
    // 派发 pointerdown -> pointermove -> pointerup
    const gripHandle = miniPlayer.locator("svg.lucide-grip-vertical").first();
    await expect(gripHandle).toBeVisible();
    const handleBox = await gripHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;

    // 向左上方拖拽 80px, 100px
    await page.evaluate(
      ({ startX, startY, moveX, moveY }) => {
        const player = document.querySelector(
          '[data-testid="global-mini-audio-player"]',
        );
        if (!player) return;

        player.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: 1,
            pointerType: "touch",
            clientX: startX,
            clientY: startY,
            button: 0,
            bubbles: true,
            cancelable: true,
          }),
        );

        window.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerId: 1,
            pointerType: "touch",
            clientX: moveX,
            clientY: moveY,
            bubbles: true,
            cancelable: true,
          }),
        );

        window.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: 1,
            pointerType: "touch",
            clientX: moveX,
            clientY: moveY,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      {
        startX,
        startY,
        moveX: startX - 80,
        moveY: startY - 100,
      },
    );

    // 等待位置更新
    await page.waitForTimeout(300);

    const afterBox = await miniPlayer.boundingBox();
    expect(afterBox).not.toBeNull();

    // 验证纵坐标产生了明显位移 (向上移动了约 100px)
    expect(afterBox!.y).toBeLessThan(initialY - 30);
    // 验证视口边界安全防护：横纵坐标绝未溢出为负数
    expect(afterBox!.x).toBeGreaterThanOrEqual(0);
    expect(afterBox!.y).toBeGreaterThanOrEqual(0);
    expect(afterBox!.x + afterBox!.width).toBeLessThanOrEqual(375 + 10);

    // 保存移动端拖拽后的效果截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "mobile-floating-player-dragged.png",
      ),
    });

    // 过滤非严重警告
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
