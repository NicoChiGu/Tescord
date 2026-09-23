import { test, expect } from "@playwright/test";

test.describe("频道切换前数据清理与防残留 (Channel Switch Cleanup)", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 auth.setup.ts 生成的真实认证凭证
    await page.addInitScript(() => {
      const accessToken =
        localStorage.getItem("tescord_e2e_access_token") ||
        localStorage.getItem("tescord_access_token");
      if (accessToken) {
        localStorage.setItem("tescord_access_token", accessToken);
      }
    });
  });

  test("切换文字频道时即刻清除旧消息并展现骨架屏，杜绝旧频道内容残留", async ({
    page,
  }) => {
    // 拦截 general 频道的历史消息
    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "msg_general_unique_101",
            channelId: "chn_default_text_01",
            content: "【GENERAL 专有内容-绝不能在 crypto-vault 残留】",
            authorId: "usr_default_admin",
            author: { id: "usr_default_admin", username: "Jackey" },
            createdAt: new Date().toISOString(),
          },
        ]),
      });
    });

    // 拦截 crypto-vault 频道的消息请求并保留 resolve 控制权，模拟网络延迟
    let releaseCryptoMessages: () => void = () => {};
    const delayPromise = new Promise<void>((resolve) => {
      releaseCryptoMessages = resolve;
    });

    await page.route(
      "**/api/channels/chn_default_text_02/messages*",
      async (route) => {
        await delayPromise;
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "msg_crypto_unique_202",
              channelId: "chn_default_text_02",
              content: "【crypto-vault 新频道的安全数据已到达】",
              authorId: "usr_default_admin",
              author: { id: "usr_default_admin", username: "Jackey" },
              createdAt: new Date().toISOString(),
            },
          ]),
        });
      },
    );

    await page.goto("/");

    // 1. 进入默认服务器
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 2. 点击进入 general 频道
    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await expect(generalChannelBtn).toBeVisible({ timeout: 8000 });
    await generalChannelBtn.click();

    // 确认 general 频道的特有消息已渲染
    const generalMsg = page.getByText("【GENERAL 专有内容-绝不能在 crypto-vault 残留】");
    await expect(generalMsg).toBeVisible({ timeout: 5000 });

    // 3. 点击切换至 crypto-vault 频道
    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await expect(cryptoChannelBtn).toBeVisible({ timeout: 5000 });
    await cryptoChannelBtn.click();

    // 核心断言 1：点击瞬间，general 的旧消息必须立即被清空消除，绝不再残留！
    await expect(generalMsg).not.toBeVisible();

    // 核心断言 2：在新频道消息尚未返回期间，必须展现骨架屏脉冲占位（Skeleton UI）
    const skeleton = page.locator('[data-testid="chat-message-skeleton-list"]');
    await expect(skeleton).toBeVisible();

    // 4. 释放 crypto-vault 频道的网络请求
    releaseCryptoMessages();

    // 核心断言 3：新数据到达后，骨架屏平滑消失，新内容正确展示
    const cryptoMsg = page.getByText("【crypto-vault 新频道的安全数据已到达】");
    await expect(cryptoMsg).toBeVisible({ timeout: 5000 });
    await expect(skeleton).not.toBeVisible();

    // 再次确认旧频道的独有内容依然不存在
    await expect(generalMsg).not.toBeVisible();
  });

  test("输入框草稿按频道独立隔离保存，切换频道时互不污染并支持切回恢复", async ({
    page,
  }) => {
    // 快速 mock 消息响应为无历史消息
    await page.route("**/api/channels/*/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/");

    // 1. 进入服务器
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 2. 进入 general 频道并填写草稿
    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await expect(generalChannelBtn).toBeVisible({ timeout: 8000 });
    await generalChannelBtn.click();

    const chatInput = page.locator('[data-testid="chat-mention-input"]');
    await expect(chatInput).toBeVisible({ timeout: 5000 });
    const draftGeneral = "这是我为 general 频道草拟的未发送内容-GEN_99";
    await chatInput.fill(draftGeneral);

    // 3. 切换至 crypto-vault 频道
    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await cryptoChannelBtn.click();

    // 核心断言 1：新频道的输入框绝无 general 频道的草稿残留
    const chatInputCrypto = page.locator('[data-testid="chat-mention-input"]');
    await expect(chatInputCrypto).toBeVisible({ timeout: 5000 });
    await expect(chatInputCrypto).toHaveText("");

    // 4. 在 crypto-vault 填写独立草稿
    const draftCrypto = "这是属于 crypto-vault 频道的独立加密备忘草稿";
    await chatInputCrypto.fill(draftCrypto);

    // 5. 切回 general 频道
    await generalChannelBtn.click();

    // 核心断言 2：切回 general 频道后，先前保存的草稿精准恢复
    const chatInputBackGen = page.locator('[data-testid="chat-mention-input"]');
    await expect(chatInputBackGen).toBeVisible({ timeout: 5000 });
    await expect(chatInputBackGen).toHaveText(draftGeneral);

    // 6. 再次切回 crypto-vault 频道
    await cryptoChannelBtn.click();

    // 核心断言 3：切回 crypto-vault 后，其对应草稿也精准恢复
    const chatInputBackCrypto = page.locator('[data-testid="chat-mention-input"]');
    await expect(chatInputBackCrypto).toBeVisible({ timeout: 5000 });
    await expect(chatInputBackCrypto).toHaveText(draftCrypto);
  });
});
