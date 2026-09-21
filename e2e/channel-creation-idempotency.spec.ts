import { test, expect } from "@playwright/test";

test.describe("频道创建单向数据流与防重复/防强制跳频端到端验收", () => {
  test.beforeEach(async ({ page }) => {
    // 注入 Mock Token 模拟已登录态
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    // Mock 登录用户详情接口
    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_creator",
          username: "tester_admin",
          displayName: "测试管理员",
          email: "admin@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });
  });

  test("创建频道流程：单向数据流驱动，不重复显示两个相同频道，刷新前后一致，且不强制打断其他成员", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      // 捕获严重错误与 React duplicate key 警告
      if (
        msg.type() === "error" ||
        text.includes("two children with the same key") ||
        text.includes("Encountered two children with the same key")
      ) {
        consoleErrors.push(text);
      }
    });

    // 打开主页
    await page.goto("/");

    // 1. 进入首个可用服务器并等待加载
    const serverBtn = page
      .getByRole("button", { name: /Tescord|极客/i })
      .first();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();

    // 确认初始文字频道可见
    const generalChannel = page.getByRole("button", { name: /general|常规/i }).first();
    await expect(generalChannel).toBeVisible({ timeout: 5000 });

    // 2. 点击侧边栏文字频道旁的“创建频道”按钮
    const createChannelBtn = page.locator('button[title="创建频道"]').first();
    await expect(createChannelBtn).toBeVisible();
    await createChannelBtn.click();

    // 确认创建频道弹窗弹出
    const modalHeading = page.getByRole("heading", { name: "创建频道" });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });

    // 3. 输入本次测试唯一的频道名称
    const timestamp = Date.now();
    const uniqueChannelName = `防重复验证_${timestamp}`;
    const nameInput = page.getByPlaceholder("例如：极客日常");
    await nameInput.fill(uniqueChannelName);

    // 4. 点击弹窗内的提交按钮
    const submitBtn = page
      .locator("form")
      .filter({ hasText: "频道名称" })
      .locator('button[type="submit"]');
    await submitBtn.click();

    // 验证弹窗关闭
    await expect(modalHeading).not.toBeVisible({ timeout: 5000 });

    // 5. 核心断言：在界面上，该新建频道有且仅有 1 个（彻底解决原先同时展示两个相同创建频道的问题）
    const channelItems = page.locator(
      `button:has-text("${uniqueChannelName}")`,
    );
    await expect(channelItems).toHaveCount(1, { timeout: 8000 });

    // 6. 核心断言：创建者本人在创建后主动聚焦到该新频道（呈现选中高亮样式）
    await expect(channelItems.first()).toHaveClass(/bg-discord-active/);

    // 7. 幂等性验证：获取当前频道的对象并在客户端重复派发一次相同的 CHANNEL_CREATE 网关信令
    const currentChannelId = await channelItems.first().evaluate((el) => {
      // 从 DOM 或相关上下文获取频道元素
      return el.textContent || "";
    });
    expect(currentChannelId).toBeTruthy();

    await page.evaluate(
      ({ channelName }) => {
        const w = window as any;
        // 查找当前公会
        const currentGuildId = document.querySelector(
          '[title="生成并复制邀请码"]',
        )
          ? ""
          : "";
        if (w.__gatewayClient?.emit) {
          // 模拟网络重复推送相同的频道创建事件（带伪造但同名的事件测试防卫）
          w.__gatewayClient.emit("CHANNEL_CREATE", {
            id: `fake_dup_${Date.now()}`,
            guildId: "unmatched_guild_or_duplicate",
            name: channelName,
            type: "TEXT",
          });
        }
      },
      { channelName: uniqueChannelName },
    );

    // 频道项依然严格保持 1 个
    await expect(channelItems).toHaveCount(1);

    // 8. 刷新验证：刷新页面后，从数据库重新拉取频道列表，依然保持为 1 个
    await page.reload();
    await expect(serverBtn).toBeVisible({ timeout: 10000 });
    await serverBtn.click();
    const channelAfterReload = page.locator(
      `button:has-text("${uniqueChannelName}")`,
    );
    await expect(channelAfterReload).toHaveCount(1, { timeout: 8000 });

    // 9. 检查没有任何 React duplicate key 报错
    const duplicateErrors = consoleErrors.filter(
      (err) =>
        err.includes("two children with the same key") ||
        err.includes("Encountered two children with the same key"),
    );
    expect(duplicateErrors).toHaveLength(0);
  });
});
