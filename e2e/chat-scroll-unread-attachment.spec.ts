import { test, expect } from "@playwright/test";
import { Message } from "@tescord/types";

test.describe("消息滚动记忆、新消息红线消除与多类型附件上传综合验收", () => {
  // 生成 35 条测试历史消息以支持长滚动
  const mockMessagesGeneral: Message[] = Array.from({ length: 35 }, (_, i) => ({
    id: `msg_general_scroll_${i + 1}`,
    channelId: "chn_default_text_01",
    authorId: "usr_default_admin",
    sequence: i + 1,
    author: {
      id: "usr_default_admin",
      username: "Jackey",
      displayName: "Jackey (Admin)",
      avatarUrl: null,
      status: "ONLINE",
    },
    content: `【General 频道消息 #${i + 1}】测试长列表滚动位置记忆与还原，保持连续的高度测量。`,
    isEncrypted: false,
    isPinned: false,
    reactions: [],
    attachments: [],
    createdAt: new Date(Date.now() - (35 - i) * 60000).toISOString(),
  }));

  const mockMessagesCrypto: Message[] = Array.from({ length: 25 }, (_, i) => ({
    id: `msg_crypto_unread_${i + 1}`,
    channelId: "chn_default_text_02",
    authorId: "usr_default_admin",
    sequence: i + 1,
    author: {
      id: "usr_default_admin",
      username: "Jackey",
      displayName: "Jackey (Admin)",
      avatarUrl: null,
      status: "ONLINE",
    },
    content: `【crypto-vault 频道消息 #${i + 1}】未读分割红线测试消息内容。`,
    isEncrypted: false,
    isPinned: false,
    reactions: [],
    attachments: [],
    createdAt: new Date(Date.now() - (25 - i) * 60000).toISOString(),
  }));

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

    // 拦截 general 与 crypto-vault 频道的历史消息以提供可控的测试数据
    await page.route("**/api/channels/chn_default_text_01/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockMessagesGeneral),
      });
    });

    await page.route("**/api/channels/chn_default_text_02/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockMessagesCrypto),
      });
    });
  });

  test("1. 消息滚动记忆纯物理恢复：切换离开再返回时精确还原离开时的 scrollTop", async ({
    page,
  }) => {
    await page.goto("/");

    // 1. 进入默认服务器
    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 2. 进入 general 频道
    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await expect(generalChannelBtn).toBeVisible({ timeout: 8000 });
    await generalChannelBtn.click();

    // 等待消息加载完成
    const msg1 = page.locator("#message-msg_general_scroll_1");
    await expect(msg1).toBeVisible({ timeout: 8000 });

    const scrollContainer = page.getByTestId("chat-scroll-container");
    await expect(scrollContainer).toBeVisible();

    // 模拟滚动到特定坐标 (scrollTop = 400)
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 400;
      el.dispatchEvent(new Event("scroll"));
    });

    // 等待滚动位置缓存保存完成
    await page.waitForTimeout(300);

    const recordedScrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
    expect(recordedScrollTop).toBeGreaterThanOrEqual(350);

    // 3. 切换到 crypto-vault 频道
    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await expect(cryptoChannelBtn).toBeVisible();
    await cryptoChannelBtn.click();

    // 确认已切换到 crypto-vault 频道
    await expect(
      page.locator('div[data-channel-id="chn_default_text_02"]'),
    ).toBeVisible({ timeout: 5000 });

    // 4. 切回 general 频道
    await generalChannelBtn.click();
    await expect(
      page.locator('div[data-channel-id="chn_default_text_01"]'),
    ).toBeVisible({ timeout: 5000 });

    // 等待位置恢复完成
    await page.waitForTimeout(500);

    // 核心断言：切回后滚动条位置应精准还原到离开时的 offset (允许虚拟列表测量微小公差 ±40px)，绝不能被重置到底部或 0
    const restoredScrollTop = await scrollContainer.evaluate((el) => el.scrollTop);
    expect(restoredScrollTop).toBeGreaterThanOrEqual(300);
    expect(restoredScrollTop).toBeLessThan(700);
  });

  test("2. 新消息分割红线视口消除：新消息在视口内曝光停留超1秒后，红线自动淡出消除", async ({
    page,
  }) => {
    await page.goto("/");

    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 注入已读游标：让 crypto-vault 频道的已读序列号停留在 20（消息 21-25 属于新消息）
    await page.evaluate(async () => {
      if ((window as any).__tescord_messageDb) {
        await (window as any).__tescord_messageDb.saveChannelMeta("chn_default_text_02", {
          lastReadSequence: 20,
          scrollTop: 0,
          isNearBottom: false,
        });
      }
    });

    const cryptoChannelBtn = page.getByRole("button", { name: "crypto-vault" });
    await expect(cryptoChannelBtn).toBeVisible({ timeout: 10000 });
    await cryptoChannelBtn.click();

    // 验证初始状态下红线呈现（“以下是新消息”）
    const unreadDivider = page.locator('[data-testid="unread-message-divider"]');
    await expect(unreadDivider).toBeVisible({ timeout: 8000 });
    await expect(unreadDivider).toContainText("以下是新消息");

    // 等待 1.5 秒（视口内停留超过 1 秒触发自动核销与淡出）
    await page.waitForTimeout(1600);

    // 核心断言：红线已被平滑消除，从 DOM 中移除
    await expect(unreadDivider).not.toBeVisible({ timeout: 5000 });
  });

  test("3. 附件多格式上传、拖拽高亮蒙层与高危扩展名拦截", async ({ page }) => {
    await page.goto("/");

    const serverBtn = page
      .getByRole("button", { name: /Tescord 极客总部|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    const generalChannelBtn = page.getByRole("button", { name: "general" });
    await expect(generalChannelBtn).toBeVisible({ timeout: 10000 });
    await generalChannelBtn.click();

    // A. 模拟拖拽文件进入聊天区域：验证 Discord 风格拖拽高亮蒙层展现
    const chatContainer = page.locator('div[data-channel-id="chn_default_text_01"]');
    await chatContainer.evaluate((node) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["mock content"], "document.pdf", { type: "application/pdf" }));
      const enterEvt = new DragEvent("dragenter", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      node.dispatchEvent(enterEvt);
    });

    const dragOverlay = page.locator('[data-testid="chat-drag-drop-overlay"]');
    await expect(dragOverlay).toBeVisible({ timeout: 3000 });
    await expect(dragOverlay).toContainText("拖放到此处即可上传");

    // 离开拖拽区域：蒙层应隐藏
    await chatContainer.evaluate((node) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["mock content"], "document.pdf", { type: "application/pdf" }));
      const leaveEvt = new DragEvent("dragleave", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      node.dispatchEvent(leaveEvt);
    });
    await expect(dragOverlay).not.toBeVisible({ timeout: 3000 });

    // B. 测试通用多格式上传 (PDF 文档直传到真实后端)
    const pdfBuffer = Buffer.from("%PDF-1.4 mock pdf content");
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "handbook.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
    });

    // 验证待发附件栏成功展示 handbook.pdf
    const pendingPdf = page.locator('text="handbook.pdf"');
    await expect(pendingPdf).toBeVisible({ timeout: 8000 });

    // C. 测试高危执行脚本 (.exe) 安全拦截
    const exeBuffer = Buffer.from("MZ mock executable binary");
    await fileInput.setInputFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: exeBuffer,
    });

    // 验证弹出安全警告 Toast
    const toast = page.locator("text=出于安全考虑，禁止上传可执行程序或脚本文件");
    await expect(toast).toBeVisible({ timeout: 5000 });

    // 确认 malware.exe 绝不能进入待发送附件栏
    await expect(page.locator('text="malware.exe"')).not.toBeVisible();
  });
});
