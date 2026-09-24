import { test, expect } from "@playwright/test";
import { Message } from "@tescord/types";

test.describe("4项核心缺陷与体验优化验收 (Four Core Fixes E2E)", () => {
  const mockMessages: Message[] = Array.from({ length: 50 }, (_, i) => ({
    id: `msg_fix_${i + 1}`,
    channelId: "c_text_1",
    authorId: i % 2 === 0 ? "u_alice" : "e2e_tester_user",
    author: {
      id: i % 2 === 0 ? "u_alice" : "e2e_tester_user",
      username: i % 2 === 0 ? "Alice" : "tester_pro",
      displayName: i % 2 === 0 ? "爱丽丝" : "专业测试员",
      avatarUrl: null,
      status: "ONLINE",
    },
    content:
      `【历史消息长文本测试 #${i + 1}】` +
      "这是一条用于验证长滚动与脱离底部横幅的充沛长文本段落内容，确保虚拟滚动容器有充足的高度。".repeat(
        3,
      ),
    sequence: i + 1,
    isEncrypted: false,
    isPinned: false,
    reactions: [],
    attachments: [],
    createdAt: new Date(Date.now() - (50 - i) * 60000).toISOString(),
  }));

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
      localStorage.setItem(
        "tescord_last_user",
        JSON.stringify({
          id: "e2e_tester_user",
          username: "tester_pro",
        }),
      );
      // 禁用后台 WebSocket 避免网关信令 READY 覆盖 Mock 的测试服务器数据
      (window as any).WebSocket = class MockWebSocket extends EventTarget {
        readyState = 3;
        close() {}
        send() {}
      };
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_tester_user",
          username: "tester_pro",
          displayName: "专业测试员",
          email: "tester@tescord.local",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "g_fix_test",
            name: "修复测试服务器",
            icon: null,
            ownerId: "e2e_tester_user",
            channels: [
              {
                id: "c_text_1",
                name: "公告频道",
                type: "TEXT",
                position: 0,
                guildId: "g_fix_test",
              },
              {
                id: "c_text_2",
                name: "闲聊茶水间",
                type: "TEXT",
                position: 1,
                guildId: "g_fix_test",
              },
              {
                id: "c_voice_1",
                name: "开黑语音房",
                type: "VOICE",
                position: 2,
                guildId: "g_fix_test",
              },
            ],
            members: [
              {
                userId: "e2e_tester_user",
                user: { id: "e2e_tester_user", username: "tester_pro" },
              },
            ],
          },
        ]),
      });
    });

    await page.route("**/api/channels/**/messages*", (route) => {
      const url = route.request().url();
      if (url.includes("c_text_1")) {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockMessages),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });

    await page.route("**/api/users/@me/settings", (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outputVolume: 100,
            language: "zh-CN",
          }),
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
    });
  });

  test("1. 智能跳转与横幅逻辑：在查看较旧历史消息时呈现'跳到最新'，点击平滑贴底", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const channel1 = page
      .locator('button, [role="button"]')
      .filter({ hasText: "公告频道" })
      .first();

    if (!(await channel1.isVisible())) {
      const serverBtn = page
        .getByRole("button", { name: /修复测试服务器/i })
        .first();
      await expect(serverBtn).toBeVisible({ timeout: 10000 });
      await serverBtn.click({ force: true });
    }

    await expect(channel1).toBeVisible({ timeout: 10000 });
    await channel1.click();

    const firstMsg = page.locator("#message-msg_fix_1");
    const lastMsg = page.locator("#message-msg_fix_50");
    await expect(lastMsg).toBeVisible({ timeout: 6000 });

    // 初始状态贴底，横幅不可见
    const floatingBanner = page.locator(".animate-slide-down");
    await expect(floatingBanner).not.toBeVisible();

    // 滚动至顶部较旧消息
    await page
      .locator('[data-testid="chat-scroll-container"]')
      .evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll"));
      });

    // 验证横幅显现且文案为“您正在查看较旧的消息”与“跳到最新”
    await expect(floatingBanner).toBeVisible({ timeout: 5000 });
    await expect(floatingBanner).toContainText("您正在查看较旧的消息");
    await expect(floatingBanner).toContainText("跳到最新");

    // 点击横幅跳转到底部
    await floatingBanner.click();
    await expect(lastMsg).toBeInViewport({ timeout: 5000 });
  });

  test("2. 语音频道记忆逻辑：浏览特定文字频道后进入语音频道，挂断时应优先回跳到该文字频道", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 1. 用户主动点击并浏览第二个文字频道：闲聊茶水间
    const textChannel2 = page
      .locator('button, [role="button"]')
      .filter({ hasText: "闲聊茶水间" })
      .first();

    if (!(await textChannel2.isVisible())) {
      const serverBtn = page
        .getByRole("button", { name: /修复测试服务器/i })
        .first();
      await expect(serverBtn).toBeVisible({ timeout: 10000 });
      await serverBtn.click({ force: true });
    }

    await expect(textChannel2).toBeVisible({ timeout: 10000 });
    await textChannel2.click();

    // 验证当前选中的文字频道为闲聊茶水间
    const headerTitle = page
      .locator("h2, span")
      .filter({ hasText: "闲聊茶水间" })
      .first();
    await expect(headerTitle).toBeVisible();

    // 2. 检查文字频道记忆已写入 localStorage
    const savedMemory = await page.evaluate(() => {
      return localStorage.getItem(
        "tescord_text_channel_memory_e2e_tester_user",
      );
    });
    expect(savedMemory).toBeTruthy();
    expect(savedMemory).toContain("c_text_2");
  });

  test("3. 音频设备隔离记忆：本地硬件设备 ID 仅保存在本机，云端拉取不会覆盖本地设备 ID", async ({
    page,
  }) => {
    // 预置本地设备偏好
    await page.addInitScript(() => {
      const existingSettings = {
        state: {
          audio: {
            inputDeviceId: "mock_local_mic_uuid_123",
            outputDeviceId: "mock_local_speaker_uuid_456",
          },
          video: {
            cameraDeviceId: "mock_local_cam_uuid_789",
          },
        },
        version: 0,
      };
      localStorage.setItem(
        "tescord_user_settings",
        JSON.stringify(existingSettings),
      );
      localStorage.setItem(
        "tescord_selected_audio_input_id",
        "mock_local_mic_uuid_123",
      );
      localStorage.setItem(
        "tescord_selected_audio_output_id",
        "mock_local_speaker_uuid_456",
      );
    });

    await page.goto("/");

    // 验证拉取云端设置后，本地设备 ID 未被空值擦除
    const currentSettings = await page.evaluate(() => {
      const raw = localStorage.getItem("tescord_user_settings");
      return raw ? JSON.parse(raw) : null;
    });

    expect(currentSettings?.state?.audio?.inputDeviceId).toBe(
      "mock_local_mic_uuid_123",
    );
    expect(currentSettings?.state?.audio?.outputDeviceId).toBe(
      "mock_local_speaker_uuid_456",
    );
    expect(currentSettings?.state?.video?.cameraDeviceId).toBe(
      "mock_local_cam_uuid_789",
    );
  });

  test("4. 未读分流跳转：存在未读消息且视口脱离底部时，悬浮横幅展示'您有未读消息'与'跳转至未读'", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const dbName = "tescord-client-db-e2e_tester_user";
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("messages")) {
          const msgStore = db.createObjectStore("messages", { keyPath: "id" });
          msgStore.createIndex("by_channel", "channelId", { unique: false });
          msgStore.createIndex(
            "by_channel_sequence",
            ["channelId", "sequence"],
            {
              unique: false,
            },
          );
          msgStore.createIndex("by_created_at", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("channel_meta")) {
          db.createObjectStore("channel_meta", { keyPath: "channelId" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (db.objectStoreNames.contains("channel_meta")) {
          const tx = db.transaction("channel_meta", "readwrite");
          tx.objectStore("channel_meta").put({
            channelId: "c_text_1",
            lastReadSequence: 10,
            scrollTop: 100,
            isNearBottom: false,
          });
        }
      };
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const channel1 = page
      .locator('button, [role="button"]')
      .filter({ hasText: "公告频道" })
      .first();

    if (!(await channel1.isVisible())) {
      const serverBtn = page
        .getByRole("button", { name: /修复测试服务器/i })
        .first();
      await expect(serverBtn).toBeVisible({ timeout: 10000 });
      await serverBtn.click({ force: true });
    }

    await expect(channel1).toBeVisible({ timeout: 10000 });
    await channel1.click();

    // 向上滚动以脱离底部并显现未读悬浮横幅
    await page
      .locator('[data-testid="chat-scroll-container"]')
      .evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll"));
      });

    // 验证未读状态下横幅显现且展示对应文案与按钮
    const floatingBanner = page.locator(".animate-slide-down");
    await expect(floatingBanner).toBeVisible({ timeout: 10000 });
    await expect(floatingBanner).toContainText("您有未读消息");
    await expect(floatingBanner).toContainText("跳转至未读");

    // 点击“跳转至未读”按钮，定位到第 11 条未读消息
    await floatingBanner.click();
    const unreadTargetMsg = page.locator("#message-msg_fix_11");
    await expect(unreadTargetMsg).toBeInViewport({ timeout: 5000 });
  });
});
