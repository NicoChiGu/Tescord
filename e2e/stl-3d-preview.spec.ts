import { test, expect } from "@playwright/test";
import { CURRENT_APP_VERSION } from "../apps/web/src/data/changelogs.js";

// 标准 ASCII STL 测试模型 (由 2 个三角面片组成的一块 10x10x2 mm 平板)
const sampleStlAscii = `solid test_plate
  facet normal 0.000000e+00 0.000000e+00 1.000000e+00
    outer loop
      vertex 0.000000e+00 0.000000e+00 2.000000e+00
      vertex 1.000000e+01 0.000000e+00 2.000000e+00
      vertex 0.000000e+00 1.000000e+01 2.000000e+00
    endloop
  endfacet
  facet normal 0.000000e+00 0.000000e+00 1.000000e+00
    outer loop
      vertex 1.000000e+01 0.000000e+00 2.000000e+00
      vertex 1.000000e+01 1.000000e+01 2.000000e+00
      vertex 0.000000e+00 1.000000e+01 2.000000e+00
    endloop
  endfacet
endsolid test_plate`;

const testStlBuffer = Buffer.from(sampleStlAscii, "utf-8");

test.describe("消息附件 STL 3D 模型在线预览与交互验收 (STL 3D Preview Modal)", () => {
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

  test("STL 3D 模型上传、卡片专属标识、在线 3D 预览弹窗、统计面板与交互控制完整链路", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      console.log(`[Browser ${msg.type()}]:`, msg.text());
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

    const fileName = `model_sample_${Date.now()}.stl`;

    // 拦截该 STL 文件的请求，快速返回 STL 几何数据
    await page.route(`**/*${fileName}*`, async (route, request) => {
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "model/stl",
          body: testStlBuffer,
        });
      } else {
        await route.continue();
      }
    });

    // 2. 上传 STL 附件文件
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "model/stl",
      buffer: testStlBuffer,
    });

    // 等待输入框下方的待发送附件预览出现
    const pendingPreview = page.locator(`text="${fileName}"`);
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    // 发送消息
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.fill(`STL_Preview_Test_${Date.now()}`);
    await chatInput.press("Enter");

    // 3. 验证聊天流中的 STL 附件卡片渲染
    const attachmentCard = page
      .locator('[data-testid="file-attachment-card"]')
      .filter({ hasText: fileName })
      .last();
    await expect(attachmentCard).toBeVisible({ timeout: 10000 });

    // 验证卡片专属的 3D Box 图标与 3D 预览按钮
    const stlIcon = attachmentCard.locator('[data-testid="file-stl-icon"]');
    await expect(stlIcon).toBeVisible();

    const previewBtn = attachmentCard.locator(
      '[data-testid="file-stl-preview-btn"]',
    );
    await expect(previewBtn).toBeVisible();

    // 4. 点击 3D 预览按钮，唤起 3D 灯箱模态窗
    await previewBtn.click();

    const stlModal = page.locator('[data-testid="stl-preview-modal"]');
    await expect(stlModal).toBeVisible({ timeout: 10000 });

    // 5. 验证 3D WebGL 画布渲染成功
    const canvasContainer = stlModal.locator(
      '[data-testid="stl-viewer-canvas-container"]',
    );
    await expect(canvasContainer).toBeVisible({ timeout: 10000 });

    const canvasEl = canvasContainer.locator("canvas");
    await expect(canvasEl).toBeVisible({ timeout: 10000 });

    // 6. 验证底部控制面板与几何物理统计数据
    const controlPanel = stlModal.locator('[data-testid="stl-control-panel"]');
    await expect(controlPanel).toBeVisible({ timeout: 10000 });

    // 验证三角面片数统计 (2 面)
    const trianglesStat = stlModal.locator(
      '[data-testid="stl-triangles-stat"]',
    );
    await expect(trianglesStat).toBeVisible();
    await expect(trianglesStat).toContainText("2");

    // 验证尺寸统计面板
    const dimensionsStat = stlModal.locator(
      '[data-testid="stl-dimensions-stat"]',
    );
    await expect(dimensionsStat).toBeVisible();
    await expect(dimensionsStat).toContainText("mm");

    // 7. 测试交互控制：自动慢速旋转切换
    const autoRotateBtn = stlModal.locator(
      '[data-testid="stl-auto-rotate-btn"]',
    );
    await expect(autoRotateBtn).toBeVisible();
    await autoRotateBtn.click();
    // 再次点击恢复
    await autoRotateBtn.click();

    // 8. 测试交互控制：重置视角
    const resetCameraBtn = stlModal.locator(
      '[data-testid="stl-reset-camera-btn"]',
    );
    await expect(resetCameraBtn).toBeVisible();
    await resetCameraBtn.click();

    // 9. 关闭模态框并验证生命周期释放
    const closeBtn = stlModal.locator('[data-testid="stl-close-button"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // 验证模态框已关闭
    await expect(stlModal).not.toBeVisible();

    // 10. 测试直接点击文件名同样能唤起 3D 预览
    const fileNameEl = attachmentCard.locator(`text="${fileName}"`);
    await fileNameEl.click();
    await expect(stlModal).toBeVisible({ timeout: 10000 });

    // 按 ESC 键关闭
    await page.keyboard.press("Escape");
    await expect(stlModal).not.toBeVisible();

    // 验证无未捕获的严重控制台异常
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("Download") &&
        !err.includes("ERR_BLOCKED_BY_CLIENT"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
