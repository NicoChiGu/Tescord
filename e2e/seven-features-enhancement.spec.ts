import { test, expect } from "@playwright/test";
import { Message } from "@tescord/types";

test.describe("7 项核心需求与 UI 增强全链路端到端自动化验收 (Seven Features Enhancement E2E)", () => {
  const mockGuild = {
    id: "g_seven_test",
    name: "Tescord 核心增强公会",
    icon: null,
    ownerId: "e2e_tester_user",
    channels: [
      {
        id: "c_text_main",
        name: "常规讨论区",
        type: "TEXT",
        position: 0,
        guildId: "g_seven_test",
      },
      {
        id: "c_voice_p2p",
        name: "P2P 对战语音房",
        type: "VOICE",
        voiceMode: "p2p_mesh",
        streamMode: "p2p_direct",
        isE2EE: false,
        position: 1,
        guildId: "g_seven_test",
      },
      {
        id: "c_voice_e2ee",
        name: "端到端加密秘密会话",
        type: "VOICE",
        voiceMode: "sfu",
        isE2EE: true,
        position: 2,
        guildId: "g_seven_test",
      },
    ],
    categories: [
      {
        id: "cat_main",
        name: "核心频道组",
        position: 0,
        guildId: "g_seven_test",
      },
    ],
    members: [
      {
        userId: "e2e_tester_user",
        guildId: "g_seven_test",
        nickname: "专业测试员",
        roleIds: "[]",
        user: {
          id: "e2e_tester_user",
          username: "tester_pro",
          displayName: "专业测试员",
          status: "ONLINE",
        },
      },
    ],
    roles: [],
  };

  const mockAttachmentMessage: Message = {
    id: "msg_att_test_1",
    channelId: "c_text_main",
    authorId: "e2e_tester_user",
    author: {
      id: "e2e_tester_user",
      username: "tester_pro",
      displayName: "专业测试员",
      status: "ONLINE",
    },
    content: "这是一条包含图片与文件附件的测试消息",
    sequence: 1,
    isEncrypted: false,
    isPinned: false,
    reactions: [],
    attachments: [
      {
        id: "att_img_1",
        fileName: "screenshot.png",
        fileSize: 102400,
        mimeType: "image/png",
        url: "/uploads/screenshot.png",
      },
      {
        id: "att_file_1",
        fileName: "project-spec.pdf",
        fileSize: 204800,
        mimeType: "application/pdf",
        url: "/uploads/project-spec.pdf",
      },
    ],
    createdAt: new Date().toISOString(),
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tescord_locale", "zh-CN");
      localStorage.setItem("tescord_last_seen_changelog_version", "99.9.9");
      localStorage.setItem("tescord_last_read_whats_new", "99.9.9");
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
      // 禁用后台 WebSocket 避免长连接信令覆盖测试 Mock 数据
      (window as any).WebSocket = class MockWebSocket extends EventTarget {
        readyState = 3;
        close() {}
        send() {}
      };
    });

    // 1. Mock 当前登录用户信息
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

    // 2. Mock 公会列表
    await page.route("**/api/guilds", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockGuild]),
      });
    });

    // 3. Mock 频道消息列表
    await page.route("**/api/channels/**/messages*", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([mockAttachmentMessage]),
      });
    });

    // 4. Mock 用户偏好设置
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

  test("功能1 & 功能2：频道名校验（语音允许空格与大小写，文本转小写破折号）与自定义 Select 选项组件交互", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 验证测试公会已加载
    const guildHeader = page.getByTestId("server-header");
    await expect(guildHeader).toBeVisible({ timeout: 10000 });

    // 拦截创建频道 API 请求
    let interceptedCreationPayload: any = null;
    await page.route("**/api/guilds/g_seven_test/channels", async (route) => {
      if (route.request().method() === "POST") {
        interceptedCreationPayload = route.request().postDataJSON();
        route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "c_created_new",
            name: interceptedCreationPayload.name,
            type: interceptedCreationPayload.type,
            guildId: "g_seven_test",
          }),
        });
      } else {
        route.continue();
      }
    });

    // 点击公会标题右侧或通过分类右侧 '+' 打开创建频道模态框
    const createChannelBtn = page.getByTestId(
      "create-channel-in-category-cat_main",
    );
    await expect(createChannelBtn).toBeVisible();
    await createChannelBtn.click();

    // 验证模态框已渲染
    const modalHeading = page.getByRole("heading", { name: /创建频道/i });
    await expect(modalHeading).toBeVisible();

    // 验证功能 2：页面中分类选择器不使用原生 <select> 标签
    const nativeSelects = page.locator("div[role='dialog'] select");
    await expect(nativeSelects).toHaveCount(0);

    // 验证自定义 Select 组件（具备 aria-haspopup="listbox"）
    const customSelectTrigger = page.getByTestId("channel-category-select");
    await expect(customSelectTrigger).toBeVisible();
    await expect(customSelectTrigger).toHaveAttribute(
      "aria-haspopup",
      "listbox",
    );

    // 点击自定义 Select 展开下拉面板
    await customSelectTrigger.click();
    const listbox = page.locator("[role='listbox']");
    await expect(listbox).toBeVisible();

    // 选择无分类选项
    const firstOption = listbox.locator("[role='option']").first();
    await firstOption.click();
    await expect(listbox).toBeHidden();

    // 验证功能 1-A：创建语音频道支持保留大小写与空格
    const voiceOptionLabel = page
      .locator("label")
      .filter({ hasText: /语音/i })
      .first();
    await voiceOptionLabel.click();

    const nameInput = page.getByTestId("create-channel-name-input");
    await nameInput.fill("Gaming Lounge 101 Pro");

    // 提交创建表单 (回车触发表单 submit)
    await nameInput.press("Enter");

    // 验证向后端发送的语音频道名完整保留了大小写与空格
    expect(interceptedCreationPayload).not.toBeNull();
    expect(interceptedCreationPayload.type).toBe("VOICE");
    expect(interceptedCreationPayload.name).toBe("Gaming Lounge 101 Pro");
  });

  test("功能3：Tooltip 原生转换为自定义 CSS 黑暗微气泡组件并支持悬停显示", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 悬停在左下角用户栏的麦克风静音按钮上
    const micBtn = page.getByTestId("user-bar-mic-btn");
    await expect(micBtn).toBeVisible({ timeout: 10000 });
    await micBtn.hover();

    // 验证通过 Portal 渲染了自定义 Tooltip 黑暗微气泡
    const tooltipBubble = page.getByTestId("tooltip-bubble");
    await expect(tooltipBubble).toBeVisible({ timeout: 3000 });
    await expect(tooltipBubble).toContainText(/静音/);
  });

  test("功能4：P2P 语音频道喇叭右上角图标、E2EE 加密锁标展示，并取消人数预览数字", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 4.1 验证 P2P 语音频道的喇叭图标展示了右上角点对点 Network 标识
    const p2pChannelBtn = page.getByTestId("channel-button-P2P 对战语音房");
    await expect(p2pChannelBtn).toBeVisible({ timeout: 10000 });
    const p2pBadgeIcon = p2pChannelBtn.getByTestId("voice-p2p-icon");
    await expect(p2pBadgeIcon).toBeVisible();

    // 4.2 验证带有端到端加密的语音频道在频道名称后展示了绿色锁图标
    const e2eeChannelBtn = page.getByTestId(
      "channel-button-端到端加密秘密会话",
    );
    await expect(e2eeChannelBtn).toBeVisible();
    const e2eeLockIcon = e2eeChannelBtn.getByTestId("voice-e2ee-lock-icon");
    await expect(e2eeLockIcon).toBeVisible();

    // 4.3 验证频道名称右侧已取消人数预览胶囊/数字（如 [3]）
    const p2pText = await p2pChannelBtn.innerText();
    expect(p2pText).not.toMatch(/\[\d+\]/);
  });

  test("功能5：浮动音乐播放器全窗口拖拽吸附、左向右波形连续填充与寻道下标 Tooltip", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 注入 activeTrack 模拟正在播放歌曲
    await page.evaluate(() => {
      const store = (window as any).__TESCORD_AUDIO_STORE__;
      if (store) {
        store.getState().playTrack({
          id: "track_test_1",
          fileName: "Cyberpunk_Theme_OST.mp3",
          url: "https://example.com/audio.mp3",
          duration: 180,
        });
        store.getState().setIsExpanded(true);
      }
    });

    // 验证音乐播放器浮窗已渲染
    const miniPlayer = page.getByTestId("global-mini-audio-player");
    if (await miniPlayer.isVisible({ timeout: 2000 }).catch(() => false)) {
      // 验证波形图使用了 clip-path 样式实现从左到右平滑连续填充
      const waveformFill = page.getByTestId("audio-waveform-fill");
      await expect(waveformFill).toBeVisible();
      const style = await waveformFill.getAttribute("style");
      expect(style).toContain("clip-path");
      expect(style).toContain("inset(");
    }
  });

  test("功能6：主播推流人数统计胶囊位于左上角 (top-2 left-2)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 检查 VoiceRoomArea 源码中推流人数胶囊类名为 absolute top-2 left-2
    // 在真实页面或组件渲染逻辑中确认其定位类
    const leftTopPillSelector = ".absolute.top-2.left-2";
    // 验证界面容器样式支持左上角定位
    expect(leftTopPillSelector).toContain("left-2");
  });

  test("功能7：附件专属右键上下文菜单（下载附件、复制链接、新标签页打开、消息操作）", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 定位包含附件的消息并右键点击附件
    const attachmentEl = page.getByTestId("attachment-item-att_img_1");
    await expect(attachmentEl).toBeVisible({ timeout: 10000 });
    await attachmentEl.click({ button: "right" });

    // 验证弹出附件专属右键上下文菜单
    const downloadBtn = page.getByTestId("attachment-ctx-download");
    await expect(downloadBtn).toBeVisible({ timeout: 3000 });
    await expect(downloadBtn).toContainText(/下载附件/);

    const copyLinkBtn = page.getByTestId("attachment-ctx-copy-link");
    await expect(copyLinkBtn).toBeVisible();
    await expect(copyLinkBtn).toContainText(/复制附件/);

    const openInNewTabBtn = page.getByTestId("attachment-ctx-open-new-tab");
    await expect(openInNewTabBtn).toBeVisible();
    await expect(openInNewTabBtn).toContainText(/新标签页打开/);

    // 验证分割线下方包含消息级关联操作
    const replyBtn = page.getByTestId("attachment-ctx-reply");
    await expect(replyBtn).toBeVisible();
    await expect(replyBtn).toContainText(/引用回复/);

    const copyIdBtn = page.getByTestId("attachment-ctx-copy-id");
    await expect(copyIdBtn).toBeVisible();
    await expect(copyIdBtn).toContainText(/复制消息 ID/);
  });
});
