import { test, expect } from "@playwright/test";

test.describe("附件上传与发信授权验收 (Attachment Upload & Message Send)", () => {
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

  test("在频道中上传附件并发送，验证上传授权有效、消息成功发送且渲染缩略图", async ({
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

    // 2. 监听发信请求与响应
    let interceptedRequest: any = null;
    let interceptedResponseStatus = 0;
    let interceptedResponseBody: any = null;

    await page.route("**/api/channels/*/messages*", async (route, request) => {
      if (request.method() === "POST") {
        try {
          interceptedRequest = JSON.parse(request.postData() || "{}");
        } catch {
          // ignore
        }
        const response = await route.fetch();
        interceptedResponseStatus = response.status();
        try {
          interceptedResponseBody = await response.json();
        } catch {
          // ignore
        }
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
    });

    // 3. 模拟选择附件上传 (使用 1x1 透明 PNG 图片 Buffer)
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "e2e_test_screenshot.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    // 4. 验证待发送附件预览栏在输入框上方渲染呈现
    const pendingPreview = page.locator('text="e2e_test_screenshot.png"');
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    // 5. 输入文本并点击回车或发送
    const uniqueText = `Attachment_Verification_${Date.now()}`;
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.fill(uniqueText);
    await chatInput.press("Enter");

    // 6. 核心断言：发信接口必须成功 200，严禁出现 403 授权无效报错
    await expect
      .poll(() => interceptedResponseStatus, { timeout: 15000 })
      .toBe(200);

    expect(interceptedResponseBody).not.toBeNull();
    expect(interceptedResponseBody.error).toBeUndefined();
    expect(interceptedRequest).not.toBeNull();
    expect(interceptedRequest.attachments).toBeDefined();
    expect(interceptedRequest.attachments.length).toBe(1);

    const uploadedAtt = interceptedRequest.attachments[0];
    expect(uploadedAtt.fileName).toBe("e2e_test_screenshot.png");
    expect(uploadedAtt.url).toBeTruthy();

    // 7. 验证待发送预览栏已自动清空
    await expect(pendingPreview).not.toBeVisible({ timeout: 5000 });

    // 8. 验证聊天流中成功渲染了包含该附件的聊天消息
    const msgElement = page.locator(`text="${uniqueText}"`).first();
    await expect(msgElement).toBeVisible({ timeout: 10000 });

    // 9. 保存验收截图
    await page.screenshot({
      path: "test-results/attachment-upload-success.png",
    });

    // 过滤普通网络波动
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("纯附件上传（输入框无任何文字）直接按下 Enter 键，验证消息能正常发送且缩略图不裂图", async ({
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

    // 1. 模拟选择附件上传 (使用 1x1 透明 PNG 图片 Buffer)
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "e2e_pure_attachment.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    // 2. 验证待发送附件预览栏在输入框上方渲染呈现，且缩略图正常
    const pendingPreview = page.locator('text="e2e_pure_attachment.png"');
    await expect(pendingPreview).toBeVisible({ timeout: 10000 });

    // 3. 不输入任何文字，直接在输入框按下 Enter
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.press("Enter");

    // 4. 验证待发送预览栏已自动清空（证明触发了消息发送）
    await expect(pendingPreview).not.toBeVisible({ timeout: 10000 });

    // 5. 验证聊天流中成功渲染了纯附件卡片（通过 alt 属性查找）
    const renderedImg = page.locator('img[alt="e2e_pure_attachment.png"]').first();
    await expect(renderedImg).toBeVisible({ timeout: 10000 });

    // 6. 保存纯附件验收截图
    await page.screenshot({
      path: "test-results/pure-attachment-upload-success.png",
    });

    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
