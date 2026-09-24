import { test, expect } from "@playwright/test";
import path from "path";

// 构造真实的 320x200 Discord 品牌蓝测试 PNG 图片 Buffer，使得骨架屏与真实图片对比更醒目真实
const samplePngBuffer = Buffer.from(
  "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",
  "base64",
);

test.describe("聊天消息图片加载骨架屏与优雅容错验收 (Chat Image Skeleton & Error Fallback)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
    });
  });

  test("聊天消息图片加载时展示骨架屏(animate-pulse)，并在完全加载完成后平滑关闭骨架屏", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15000 });

    // 1. 进入 general 频道
    const generalChannel = page.locator('text="general"').first();
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();

    // 2. 使用真实 320x200 测试图 Buffer
    const pngBuffer = samplePngBuffer;

    const fileName = `skeleton_demo_${Date.now()}.png`;

    // 3. 路由拦截：对该图片的拉取请求人工注入 1200ms 延迟，以精确捕获骨架屏状态
    await page.route(`**/*${fileName}*`, async (route, request) => {
      if (request.method() === "GET") {
        // 人工延迟 1200ms
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: pngBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 4. 选择文件上传
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    // 5. 等待预览栏出现后，输入消息并发送
    const pendingPreview = page.locator(`text="${fileName}"`);
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    const msgContent = `Skeleton_Verification_${Date.now()}`;
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.fill(msgContent);
    await chatInput.press("Enter");

    // 6. 核心断言 1：在图片 1200ms 延迟返回期间，图片骨架屏必须处于可见状态，且包含 animate-pulse 类
    const skeleton = page.locator('[data-testid="image-skeleton"]').last();
    await expect(skeleton).toBeVisible({ timeout: 8000 });
    await expect(skeleton).toHaveClass(/animate-pulse/);
    await skeleton.scrollIntoViewIfNeeded();

    // 7. 保存骨架屏加载中阶段截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "chat-image-skeleton-loading.png",
      ),
    });

    // 8. 核心断言 2：1200ms 过去图片加载完成后，骨架屏必须完全关闭并消失
    await expect(skeleton).not.toBeVisible({ timeout: 10000 });

    // 9. 核心断言 3：真实图片元素可见且正常呈现
    const renderedImg = page.locator(`img[alt="${fileName}"]`).last();
    await expect(renderedImg).toBeVisible({ timeout: 5000 });
    await renderedImg.scrollIntoViewIfNeeded();

    // 10. 保存加载完成截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "chat-image-skeleton-loaded.png",
      ),
    });

    // 11. 核心断言 4：点击图片打开全屏大图预览灯箱 (Lightbox)，按 ESC 平滑关闭
    await renderedImg.click();
    const lightboxImg = page.locator(`.fixed.inset-0 img[alt="${fileName}"]`);
    await expect(lightboxImg).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(lightboxImg).not.toBeVisible({ timeout: 5000 });

    // 过滤普通网络波动
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("图片加载失败时骨架屏关闭并展示优雅错误卡片，点击重试后恢复正常加载", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15000 });

    const generalChannel = page.locator('text="general"').first();
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();

    const pngBuffer = samplePngBuffer;

    const failFileName = `fail_retry_${Date.now()}.png`;
    let shouldFail = true;

    // 路由拦截：首次拉取该图片时强制返回 500 模拟失败，点击重试后正常返回 200
    await page.route(`**/*${failFileName}*`, async (route, request) => {
      if (request.method() === "GET") {
        if (shouldFail) {
          await route.fulfill({
            status: 500,
            body: "Internal Server Error",
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: pngBuffer,
          });
        }
      } else {
        await route.continue();
      }
    });

    // 上传文件并发送
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: failFileName,
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    const pendingPreview = page.locator(`text="${failFileName}"`);
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    const msgContent = `Error_Retry_Verification_${Date.now()}`;
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.fill(msgContent);
    await chatInput.press("Enter");

    // 核心断言 1：加载失败后，骨架屏关闭，且优雅错误卡片 [data-testid="image-load-error"] 呈现
    const errorCard = page.locator('[data-testid="image-load-error"]').last();
    await expect(errorCard).toBeVisible({ timeout: 10000 });
    await expect(errorCard.locator('text="图片加载失败"')).toBeVisible();
    await errorCard.scrollIntoViewIfNeeded();

    // 保存错误态截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "chat-image-skeleton-error.png",
      ),
    });

    // 恢复正常网络响应
    shouldFail = false;

    // 核心断言 2：点击重试按钮
    const retryBtn = errorCard.locator('button:has-text("点击重试")');
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // 核心断言 3：点击重试后错误卡片消失，图片成功加载呈现
    await expect(errorCard).not.toBeVisible({ timeout: 10000 });
    const renderedImg = page.locator(`img[alt="${failFileName}"]`).last();
    await expect(renderedImg).toBeVisible({ timeout: 10000 });
    await renderedImg.scrollIntoViewIfNeeded();

    // 移开鼠标指针到页面空白区域，确保解除悬停蒙层
    await page.locator("body").hover({ position: { x: 10, y: 10 } });

    // 保存重试恢复成功截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "chat-image-skeleton-retry-success.png",
      ),
    });

    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("500") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
