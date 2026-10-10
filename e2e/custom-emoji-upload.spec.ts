import { test, expect } from "@playwright/test";

test.describe("自定义表情上传与生命周期验收 (Custom Emoji Upload & Lifecycle)", () => {
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

  test("在用户设置中上传个人自定义表情，验证无 channelId 错误、成功入库并在列表中呈现", async ({
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

    // 1. 打开用户设置面板
    const userSettingsBtn = page.getByTestId("user-settings-gear-btn");
    await expect(userSettingsBtn).toBeVisible({ timeout: 10000 });
    await userSettingsBtn.click();

    // 2. 点击“我的表情”Tab
    const emojisTab = page.locator('button[data-testid="tab-emojis-btn"]');
    await expect(emojisTab).toBeVisible({ timeout: 5000 });
    await emojisTab.click();

    // 3. 拦截预签名上传接口与创建表情接口
    let presignedUrlResponse: any = null;
    let createEmojiResponse: any = null;

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/attachments/presigned-url") && response.request().method() === "POST") {
        try {
          presignedUrlResponse = {
            status: response.status(),
            body: await response.json(),
          };
        } catch {
          // ignore
        }
      } else if (url.includes("/api/users/me/emojis") && response.request().method() === "POST") {
        try {
          createEmojiResponse = {
            status: response.status(),
            body: await response.json(),
          };
        } catch {
          // ignore
        }
      }
    });

    // 4. 选择表情图片文件
    const uniqueEmojiName = `emoji_${Date.now().toString().slice(-6)}`;
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const fileInput = page.locator('input[data-testid="user-emoji-file-input"]');
    await fileInput.setInputFiles({
      name: `${uniqueEmojiName}.png`,
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    // 5. 验证上传编辑表单出现
    const nameInput = page.locator('input[placeholder="my_sticker"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(uniqueEmojiName);

    // 6. 点击“保存”提交上传
    const saveButton = page.locator('button[type="submit"]:has-text("保存")').first();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // 7. 核心断言：预签名接口不能有 channelId is required 错误，状态码必须是 200
    await expect
      .poll(() => presignedUrlResponse?.status, { timeout: 15000 })
      .toBe(200);

    expect(presignedUrlResponse?.body?.uploadUrl).toBeTruthy();
    expect(presignedUrlResponse?.body?.fileUrl).toContain("/public-assets/");

    // 8. 核心断言：创建表情接口必须返回 200
    await expect
      .poll(() => createEmojiResponse?.status, { timeout: 15000 })
      .toBe(200);

    expect(createEmojiResponse?.body?.name).toBe(uniqueEmojiName);

    // 9. 验证界面中表情卡片呈现
    const emojiItem = page.locator(`text=":${uniqueEmojiName}:"`).first();
    await expect(emojiItem).toBeVisible({ timeout: 10000 });

    // 10. 检查没有未捕获的严重控制台错误
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("404"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
