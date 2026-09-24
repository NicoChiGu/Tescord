import { test, expect } from "@playwright/test";

test.describe("端到端双棘轮加密频道消息收发与查看验收 (E2EE Channel Messaging)", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 auth.setup.ts 生成的认证凭证
    await page.addInitScript(() => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
    });
  });

  test("在加密频道中正常发送加密信封消息，正确展示 Beta 标识与已解密明文", async ({
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

    // 1. 切换至加密频道 crypto-vault (chn_default_text_02)
    const cryptoChannelItem = page.locator('text="crypto-vault"').first();
    await expect(cryptoChannelItem).toBeVisible({ timeout: 15000 });
    await cryptoChannelItem.click();

    // 2. 验证侧边栏频道项不显示 E2EE 字样
    const channelBtn = page.locator(
      '[data-testid="channel-button-crypto-vault"]',
    );
    await expect(channelBtn).toBeVisible();
    await expect(channelBtn).not.toContainText("E2EE");

    // 3. 验证 Header 呈现精简的“端加密”按钮
    const e2eeHeaderBtn = page.locator(
      '[data-testid="chat-header-e2ee-badge"]',
    );
    await expect(e2eeHeaderBtn).toBeVisible({ timeout: 10000 });
    await expect(e2eeHeaderBtn).toContainText("端加密");

    // 4. 点击端加密按钮验证安全验证码模态框包含 Beta 提示
    await e2eeHeaderBtn.click();
    const safetyModal = page.locator('text="端到端双棘轮安全验证码"');
    await expect(safetyModal).toBeVisible();
    const betaNotice = page.locator('text="实验性功能提示 (Beta)"');
    await expect(betaNotice).toBeVisible();

    // 关闭模态框
    const closeBtn = page.locator('button:has-text("确认并关闭")');
    await closeBtn.click();
    await expect(safetyModal).not.toBeVisible();

    // 5. 监听发信请求并发送加密测试消息
    let interceptedRequest: any = null;
    let interceptedResponseStatus: number = 0;

    await page.route("**/api/channels/*/messages*", async (route, request) => {
      if (request.method() === "POST") {
        try {
          interceptedRequest = JSON.parse(request.postData() || "{}");
        } catch {
          // ignore parse error
        }
        const response = await route.fetch();
        interceptedResponseStatus = response.status();
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
    });

    const testSecretMsg = `E2EE_Automated_Secret_${Date.now()}`;
    const chatInput = page.locator('div[contenteditable="true"]').first();
    await expect(chatInput).toBeVisible();
    await chatInput.click();
    await chatInput.fill(testSecretMsg);
    await chatInput.press("Enter");

    // 6. 验证网络请求：已成功发出且包含加密信封，非 400 拒绝
    await expect
      .poll(() => interceptedResponseStatus, { timeout: 10000 })
      .toBe(200);
    expect(interceptedRequest).not.toBeNull();
    expect(interceptedRequest.isEncrypted).toBe(true);

    // 验证密文信封结构
    const envelope = JSON.parse(interceptedRequest.content);
    expect(envelope.version).toBe(1);
    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.ephemeralPublicKey).toBeDefined();
    expect(envelope.iv).toBeDefined();

    // 7. 验证界面解密渲染：展示自然明文，聊天流中不展示加密的信息 (无 Double Ratchet 已解密标签)
    const renderedMsg = page.locator(`text="${testSecretMsg}"`).first();
    await expect(renderedMsg).toBeVisible({ timeout: 10000 });

    const decryptedTag = page.getByText(/Double Ratchet 已解密/);
    await expect(decryptedTag).toHaveCount(0);

    // 8. 切换频道切离并重新切回，验证历史加密消息拉取与自愈解密，同样保持无冗余加密标签
    const generalChannelItem = page.locator('text="general"').first();
    await generalChannelItem.click();
    await expect(page.locator(`text="${testSecretMsg}"`)).not.toBeVisible();

    // 重新切回 crypto-vault
    await cryptoChannelItem.click();
    const reloadedMsg = page.locator(`text="${testSecretMsg}"`).first();
    await expect(reloadedMsg).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Double Ratchet 已解密/)).toHaveCount(0);

    // 9. 保存简化后的加密频道界面截图作为验收凭证
    await page.screenshot({ path: "test-results/simplified-e2ee-ui.png" });

    // 过滤掉无关的网络波动错误，确保页面无严重异常
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::ERR_") &&
        !err.includes("WebSocket") &&
        !err.includes("favicon"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
