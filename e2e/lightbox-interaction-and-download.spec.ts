import { test, expect } from "@playwright/test";
import path from "path";

// 构造用于测试的有效 100x100 PNG 图片 Buffer
const testImageBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAPElEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwG7E8AAfs7/B0AAAAASUVORK5CYII=",
  "base64",
);

test.describe("图片查看器交互、移动端缩放、点击背景关闭与下载圆形加载条验收 (Lightbox Modal & Download Spinner)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
      localStorage.setItem("tescord_last_seen_changelog_version", "0.2.0");
    });
  });

  test("图片查看器完整链路：点击外部关闭、防误触、下载按钮圆形加载条(animate-spin)与错误反馈", async ({
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

    const fileName = `lightbox_test_${Date.now()}.png`;

    // 拦截该测试图片的静态请求，快速返回测试图片
    await page.route(`**/*${fileName}*`, async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: testImageBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 2. 上传测试图片附件
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "image/png",
      buffer: testImageBuffer,
    });

    const pendingPreview = page.locator(`text="${fileName}"`);
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.fill(`Lightbox_Test_${Date.now()}`);
    await chatInput.press("Enter");

    // 3. 等待消息中的图片渲染完成并点击打开 Lightbox
    const uploadedImg = page.locator(`img[alt="${fileName}"]`).last();
    await expect(uploadedImg).toBeVisible({ timeout: 10000 });
    await uploadedImg.click();

    // 4. 断言 Lightbox 对话框已打开且包含 touch-none
    const dialog = page.locator('[data-testid="lightbox-modal"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/touch-none/);

    // 5. 验证点击图片本体不会关闭查看器
    const lightboxImg = dialog.locator(`img[alt="${fileName}"]`);
    await expect(lightboxImg).toBeVisible();
    await lightboxImg.click();
    await expect(dialog).toBeVisible();

    // 6. 验证双击图片进行缩放 (1x -> 200%)
    await lightboxImg.dblclick();
    const zoomIndicator = dialog.locator('button:has-text("200%")');
    await expect(zoomIndicator).toBeVisible({ timeout: 3000 });

    // 点击重置为 100%
    await zoomIndicator.click();
    await expect(dialog.locator('button:has-text("100%")')).toBeVisible({
      timeout: 3000,
    });

    // 7. 验证下载原图按钮的圆形加载条 (Loader2 with animate-spin) 与防抖禁用
    // 拦截下载签发请求 /api/attachments/access 并人为注入 800ms 延迟
    let accessRequested = false;
    await page.route("**/api/attachments/access", async (route, request) => {
      if (request.method() === "POST") {
        accessRequested = true;
        await new Promise((resolve) => setTimeout(resolve, 800));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            url: "https://example.com/test-download.png",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            isOriginal: true,
          }),
        });
      } else {
        await route.continue();
      }
    });

    const downloadBtn = dialog
      .locator('button[aria-label*="下载"], button[aria-label*="Download"]')
      .first();
    await expect(downloadBtn).toBeVisible();
    await downloadBtn.click();

    // 验证下载期间：按钮变为 disabled，且包含 animate-spin 圆形加载条
    await expect(downloadBtn).toBeDisabled();
    const spinner = downloadBtn.locator("svg.animate-spin");
    await expect(spinner).toBeVisible();

    // 等待异步下载完成，按钮恢复正常（解除 disabled，加载动画消失）
    await expect(downloadBtn).toBeEnabled({ timeout: 5000 });
    await expect(spinner).not.toBeVisible();
    expect(accessRequested).toBe(true);

    // 8. 验证下载失败时的 Toast 轻提示
    await page.route("**/api/attachments/access", async (route, request) => {
      if (request.method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Storage connection timed out" }),
        });
      } else {
        await route.continue();
      }
    });

    await downloadBtn.click();
    // 验证弹出轻提示 Toast
    const toast = dialog.locator("text=/下载失败|Download failed/i");
    await expect(toast).toBeVisible({ timeout: 5000 });

    // 9. 核心断言：点击图片外部黑色背景区域立即关闭查看器
    // 点击远离图片的视口边缘位置（如 x: 20, y: 200）
    await page.mouse.click(20, 200);

    // 断言 Lightbox 已完全关闭
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // 10. 保存测试通过证据截图
    await page.screenshot({
      path: path.join(
        process.cwd(),
        "test-results",
        "lightbox-interaction-verified.png",
      ),
    });

    const unexpectedErrors = consoleErrors.filter(
      (err) => !err.includes("500") && !err.includes("Internal Server Error"),
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
