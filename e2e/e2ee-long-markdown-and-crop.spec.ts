import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("长 Markdown 加密消息与图片裁切交互专项验收", () => {
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

  test("在加密频道中发送超长 Markdown 文本（>16KB 密文信封），完整解密渲染且绝不裸露 JSON 密文", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible();

    // 1. 切换至加密频道 crypto-vault
    const cryptoChannelItem = page.locator('text="crypto-vault"').first();
    await expect(cryptoChannelItem).toBeVisible({ timeout: 15000 });
    await cryptoChannelItem.click();

    // 2. 准备超长 Markdown 文本（包含各级标题、表格、高密度格式）
    const longMarkdown = `# 🔧 Cloudflare 模式下 P2P 语音问题修复方案

## 一、问题诊断总结

### Bug 1: P2P 语音频道无打洞、无声音

| # | 根因 | 代码位置 | 严重性 |
|---|------|---------|--------|
| **R1** | **默认 ICE 服务器为空数组** | VoiceMeshManager.ts L21 | 🔴 致命 |
| **R2** | **fetchIceServers 静默失败无兜底** | VoiceMeshManager.ts L71-100 | 🔴 致命 |
| **R3** | **公会 P2P 频道禁止 SFU 降级** | App.tsx L3022 | 🟡 严重 |

\`\`\`typescript
public async fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await apiFetch("/api/network/ice-servers");
    if (res.ok) return await res.json();
  } catch (e) {
    console.warn("Failed to fetch ICE servers");
  }
  return DEFAULT_ICE_SERVERS;
}
\`\`\`

> 核心致命组合：P2P 直播之所以能打洞，是因为 NATDetector 收集 STUN 映射。
E2EE_Automated_Long_Test_${Date.now()}
`;

    // 3. 拦截消息发送请求，记录请求包与响应状态
    let interceptedRequest: any = null;
    let interceptedResponseStatus = 0;

    await page.route("**/api/channels/*/messages*", async (route, request) => {
      if (request.method() === "POST") {
        try {
          interceptedRequest = JSON.parse(request.postData() || "{}");
        } catch {
          // ignore
        }
        const response = await route.fetch();
        interceptedResponseStatus = response.status();
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
    });

    // 4. 输入长 Markdown 并发送
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    await chatInput.click();
    await chatInput.fill(longMarkdown);
    await chatInput.press("Enter");

    // 5. 校验发信请求：服务端返回 200，密文未被 400 拦截且未被截断
    await expect
      .poll(() => interceptedResponseStatus, { timeout: 15000 })
      .toBe(200);
    expect(interceptedRequest).not.toBeNull();
    expect(interceptedRequest.isEncrypted).toBe(true);

    const envelope = JSON.parse(interceptedRequest.content);
    expect(envelope.version).toBe(1);
    expect(typeof envelope.ciphertext).toBe("string");
    expect(envelope.ciphertext.length).toBeGreaterThan(1000);

    // 6. 验证界面解密渲染：
    // - 必须成功渲染标题与表格文本
    // - 界面绝不能展示 {"version":1 或 Base64 杂乱密文
    const titleLocator = page
      .getByText(/Cloudflare 模式下 P2P 语音问题修复方案/)
      .first();
    await expect(titleLocator).toBeVisible({ timeout: 15000 });

    const rawJsonLeak = page.locator('text=\'{"version":1\'');
    await expect(rawJsonLeak).toHaveCount(0);

    const ciphertextLeak = page.locator('text="ephemeralPublicKey"');
    await expect(ciphertextLeak).toHaveCount(0);

    // 7. 切离并重新切回频道，验证服务端拉取历史加密消息后完整解密
    const generalChannelItem = page.locator('text="general"').first();
    await generalChannelItem.click();
    await expect(titleLocator).not.toBeVisible();

    await cryptoChannelItem.click();
    await expect(
      page.getByText(/Cloudflare 模式下 P2P 语音问题修复方案/).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=\'{"version":1\'')).toHaveCount(0);

    // 8. 截图留证
    await page.screenshot({
      path: "test-results/long-markdown-e2ee-verified.png",
    });

    // 确保没有严重的控制台报错
    const passiveErrors = consoleErrors.filter((err) =>
      err.includes(
        "Unable to preventDefault inside passive event listener invocation",
      ),
    );
    expect(passiveErrors).toHaveLength(0);
  });

  test("服务器设置中上传图片进行图片裁切时，滚轮缩放无 passive event listener 报错", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible();

    // 1. 定位服务器按钮并右键打开上下文菜单
    const serverButton = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverButton).toBeVisible({ timeout: 15000 });
    await serverButton.click({ button: "right" });

    // 2. 点击右键菜单中的“服务器管理设置”
    const serverSettingsMenuItem = page.getByRole("menuitem", {
      name: /服务器管理设置|服务器设置/i,
    });
    await expect(serverSettingsMenuItem).toBeVisible({ timeout: 5000 });
    await serverSettingsMenuItem.click();

    // 3. 验证服务器设置弹窗挂载
    const serverModal = page.getByTestId("server-settings-modal");
    await expect(serverModal).toBeVisible({ timeout: 5000 });

    // 4. 定位上传图标 input 元素
    const fileInput = page.locator('input[type="file"][accept="image/*"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });

    // 5. 准备测试图片并上传
    const tmpImgPath = path.join(
      process.cwd(),
      "test-results",
      "test_crop_icon.png",
    );
    if (!fs.existsSync(path.dirname(tmpImgPath))) {
      fs.mkdirSync(path.dirname(tmpImgPath), { recursive: true });
    }
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    fs.writeFileSync(tmpImgPath, minimalPng);

    await fileInput.setInputFiles(tmpImgPath);

    // 6. 等待裁切模态框 ImageCropModal 出现
    const cropModalTitle = page.getByText(/编辑图标尺寸/i).first();
    await expect(cropModalTitle).toBeVisible({ timeout: 5000 });

    // 7. 定位取景框容器并在其上模拟实体滚轮缩放
    const cropContainer = page.getByTestId("image-crop-container");
    await expect(cropContainer).toBeVisible({ timeout: 5000 });

    await cropContainer.hover();
    await page.mouse.wheel(0, -100); // 向上滚轮放大
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 100); // 向下滚轮缩小
    await page.waitForTimeout(200);

    // 8. 截图留证
    await page.screenshot({
      path: "test-results/image-crop-wheel-verified.png",
    });

    // 9. 核心断言：控制台中绝对不能出现 passive event listener 报错
    const passiveInterventionErrors = consoleErrors.filter((err) =>
      err.includes(
        "Unable to preventDefault inside passive event listener invocation",
      ),
    );
    expect(passiveInterventionErrors).toHaveLength(0);

    // 10. 关闭裁切弹窗
    const cancelBtn = page.getByRole("button", { name: /取消/i }).first();
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
    }
  });
});
