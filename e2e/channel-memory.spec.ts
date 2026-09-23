import { test, expect } from "@playwright/test";
import {
  getSortedGuildChannels,
  getDefaultGuildChannel,
  resolveGuildChannel,
} from "../apps/web/src/utils/channelNavigation.js";
import { Guild } from "@tescord/types";

test.describe("服务器频道记忆与首次进入默认频道 (Channel Memory & Default Channel)", () => {
  let guildAId: string;
  let guildBId: string;
  let guildAName: string;
  let guildBName: string;
  let channelA2Name: string;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    // 1. 登录管理员获取真实有效 Token
    const loginRes = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Jackey", password: "adminpassword123" },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    authToken = loginData.accessToken;

    // 2. 动态创建测试专用的公会 A 与公会 B
    const timestamp = Date.now();
    guildAName = `公会A_${timestamp % 100000}`;
    guildBName = `公会B_${timestamp % 100000}`;

    // 创建公会 A
    const resA = await request.post("/api/guilds", {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: guildAName },
    });
    expect(resA.ok()).toBeTruthy();
    const guildA = await resA.json();
    guildAId = guildA.id;

    // 为公会 A 在“文字频道”分类下创建第二个文字频道 (position: 1)
    const textCatId = guildA.categories?.[0]?.id;
    channelA2Name = `专属茶水间_${timestamp % 10000}`;
    const chRes = await request.post(`/api/guilds/${guildAId}/channels`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        name: channelA2Name,
        type: "TEXT",
        parentId: textCatId,
        position: 1,
      },
    });
    expect(chRes.ok()).toBeTruthy();

    // 创建公会 B
    const resB = await request.post("/api/guilds", {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { name: guildBName },
    });
    expect(resB.ok()).toBeTruthy();
    const guildB = await resB.json();
    guildBId = guildB.id;

    // 3. 注入真实登录凭据到浏览器上下文
    await page.addInitScript(
      ({ token, refToken, user }) => {
        localStorage.setItem("tescord_access_token", token);
        localStorage.setItem("tescord_refresh_token", refToken);
        localStorage.setItem("tescord_last_user", JSON.stringify(user));
      },
      {
        token: authToken,
        refToken: loginData.refreshToken,
        user: loginData.user,
      },
    );
  });

  test.afterEach(async ({ request }) => {
    // 自动清理创建的测试公会，保持数据库纯净
    if (authToken) {
      if (guildAId) {
        await request.delete(`/api/guilds/${guildAId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }).catch(() => undefined);
      }
      if (guildBId) {
        await request.delete(`/api/guilds/${guildBId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }).catch(() => undefined);
      }
    }
  });

  test("切换公会时能准确记住各自最后停留的频道，且切回时恢复该频道，页面刷新持久化有效", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 打开应用首页
    await page.goto("/");
    await expect(page).toHaveTitle(/Tescord/i);

    // 2. 定位公会 A 与公会 B 的侧边栏按钮
    const guildAlphaBtn = page.locator(`button[aria-label="${guildAName}"]`);
    const guildBetaBtn = page.locator(`button[aria-label="${guildBName}"]`);

    await expect(guildAlphaBtn).toBeVisible({ timeout: 15000 });
    await expect(guildBetaBtn).toBeVisible({ timeout: 15000 });

    // 3. 进入公会 A（首次进入无历史记忆）
    await guildAlphaBtn.click();

    // 验证：新进入服务器默认为排序第一的文字频道“常规”
    const defaultChannelBtn = page.locator(
      'button[data-testid="channel-button-常规"]',
    );
    await expect(defaultChannelBtn).toBeVisible({ timeout: 8000 });
    await expect(defaultChannelBtn).toHaveClass(/bg-discord-active/);

    // 4. 用户在公会 A 中主动点击切换到第二个频道（“专属茶水间_xxxx”）
    const customChannelBtn = page.locator(
      `button[data-testid="channel-button-${channelA2Name}"]`,
    );
    await expect(customChannelBtn).toBeVisible({ timeout: 5000 });
    await customChannelBtn.click();

    // 验证此时公会 A 激活的是第二个频道
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);
    await expect(defaultChannelBtn).not.toHaveClass(/bg-discord-active/);

    // 5. 切换到公会 B（首次进入公会 B）
    await guildBetaBtn.click();

    // 验证：公会 B 首次进入也默认选中其排序第一的文字频道“常规”
    const guildBDefaultChannel = page.locator(
      'button[data-testid="channel-button-常规"]',
    );
    await expect(guildBDefaultChannel).toBeVisible({ timeout: 8000 });
    await expect(guildBDefaultChannel).toHaveClass(/bg-discord-active/);

    // 6. 核心验证点：切回公会 A！
    await guildAlphaBtn.click();

    // 验证：系统必须记忆并自动恢复到“专属茶水间_xxxx”，而不是回退到第一个频道“常规”！
    await expect(customChannelBtn).toBeVisible({ timeout: 8000 });
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);
    await expect(defaultChannelBtn).not.toHaveClass(/bg-discord-active/);

    // 7. 切回公会 B，再切回公会 A，反复切换状态依然稳健保持
    await guildBetaBtn.click();
    await expect(guildBDefaultChannel).toHaveClass(/bg-discord-active/);

    await guildAlphaBtn.click();
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);

    // 8. 刷新浏览器页面 (Page Reload)，验证本地 localStorage 记忆已成功持久化并恢复
    await page.reload();
    await expect(guildAlphaBtn).toBeVisible({ timeout: 15000 });

    // 点击公会 A，依然准确记住并激活“专属茶水间_xxxx”
    await guildAlphaBtn.click();
    await expect(customChannelBtn).toBeVisible({ timeout: 8000 });
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);

    // 验证控制台无致命未捕获异常
    const fatalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("WebSocket") &&
        !err.includes("livekit") &&
        !err.includes("Failed to load resource"),
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test("被记忆的频道被删除后，重新切回公会能够安全自动降级到剩余的排序第一文字频道", async ({
    page,
    request,
  }) => {
    // 1. 打开首页并进入公会 A
    await page.goto("/");
    const guildAlphaBtn = page.locator(`button[aria-label="${guildAName}"]`);
    await expect(guildAlphaBtn).toBeVisible({ timeout: 15000 });
    await guildAlphaBtn.click();

    // 2. 选择“专属茶水间_xxxx”
    const customChannelBtn = page.locator(
      `button[data-testid="channel-button-${channelA2Name}"]`,
    );
    await expect(customChannelBtn).toBeVisible({ timeout: 8000 });
    await customChannelBtn.click();
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);

    // 3. 切换至公会 B
    const guildBetaBtn = page.locator(`button[aria-label="${guildBName}"]`);
    await guildBetaBtn.click();

    // 4. 通过 REST API 删除公会 A 中的“专属茶水间_xxxx”频道
    const channelsRes = await request.get(`/api/guilds/${guildAId}/channels`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const channels = await channelsRes.json();
    const ch2 = channels.find((c: any) => c.name === channelA2Name);
    if (ch2) {
      const delRes = await request.delete(`/api/channels/${ch2.id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(delRes.ok()).toBeTruthy();
    }

    // 5. 切回公会 A
    await guildAlphaBtn.click();

    // 6. 验证：由于原先记忆的频道已被删除，系统平滑降级选中剩余的“常规”频道，页面不白屏
    const defaultChannelBtn = page.locator(
      'button[data-testid="channel-button-常规"]',
    );
    await expect(defaultChannelBtn).toBeVisible({ timeout: 8000 });
    await expect(defaultChannelBtn).toHaveClass(/bg-discord-active/);
    await expect(customChannelBtn).not.toBeVisible();
  });

  test("当记忆或选中的频道处于折叠分类中时，自动自愈展开该分类并平滑展示目标频道", async ({
    page,
  }) => {
    // 1. 打开首页并进入公会 A
    await page.goto("/");
    const guildAlphaBtn = page.locator(`button[aria-label="${guildAName}"]`);
    await expect(guildAlphaBtn).toBeVisible({ timeout: 15000 });
    await guildAlphaBtn.click();

    // 2. 选中“专属茶水间_xxxx”
    const customChannelBtn = page.locator(
      `button[data-testid="channel-button-${channelA2Name}"]`,
    );
    await expect(customChannelBtn).toBeVisible({ timeout: 8000 });
    await customChannelBtn.click();
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);

    // 3. 折叠“文字频道”分类（点击分类头部）
    const textCatHeader = page.locator("text=文字频道").first();
    await textCatHeader.click();

    // 4. 切换到公会 B
    const guildBetaBtn = page.locator(`button[aria-label="${guildBName}"]`);
    await guildBetaBtn.click();

    // 5. 切回公会 A：由于系统具有分类自愈联动，分类自动展开，“专属茶水间_xxxx”直接可见且高亮
    await guildAlphaBtn.click();

    await expect(customChannelBtn).toBeVisible({ timeout: 8000 });
    await expect(customChannelBtn).toHaveClass(/bg-discord-active/);
  });

  test("当记忆或选中的频道位于长列表下方时，频道列表自动平滑滚动到该频道可视区域", async ({
    page,
    request,
  }) => {
    // 1. 在公会 A 下创建 15 个文字频道确保列表产生垂直滚动条
    const createdNames: string[] = [];
    const guildDetailsRes = await request.get(`/api/guilds/${guildAId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const guildDetails = await guildDetailsRes.json();
    const catId = guildDetails.categories?.[0]?.id;

    for (let i = 1; i <= 15; i++) {
      const chName = `滚动测试频道_${i}`;
      createdNames.push(chName);
      await request.post(`/api/guilds/${guildAId}/channels`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {
          name: chName,
          type: "TEXT",
          parentId: catId,
          position: i + 10,
        },
      });
    }

    // 2. 打开首页并进入公会 A
    await page.goto("/");
    const guildAlphaBtn = page.locator(`button[aria-label="${guildAName}"]`);
    await expect(guildAlphaBtn).toBeVisible({ timeout: 15000 });
    await guildAlphaBtn.click();

    // 3. 定位并点击底部频道“滚动测试频道_15”
    const lastChName = createdNames[createdNames.length - 1];
    const lastChBtn = page.locator(
      `button[data-testid="channel-button-${lastChName}"]`,
    );
    await lastChBtn.scrollIntoViewIfNeeded();
    await lastChBtn.click();
    await expect(lastChBtn).toHaveClass(/bg-discord-active/);

    // 4. 切换到公会 B
    const guildBetaBtn = page.locator(`button[aria-label="${guildBName}"]`);
    await guildBetaBtn.click();

    // 5. 切回公会 A：记忆恢复“滚动测试频道_15”，自动将其滚动回可视区域
    await guildAlphaBtn.click();

    await expect(lastChBtn).toBeVisible({ timeout: 8000 });
    await expect(lastChBtn).toHaveClass(/bg-discord-active/);

    // 等待平滑动画稳定
    await page.waitForTimeout(600);

    const isInViewport = await page.evaluate(
      ({ chName }) => {
        const container = document.querySelector(
          '[data-testid="channel-list-scroll-container"]',
        ) as HTMLElement;
        const target = document.querySelector(
          `button[data-testid="channel-button-${chName}"]`,
        ) as HTMLElement;
        if (!container || !target) return false;
        const cRect = container.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        return tRect.top >= cRect.top - 20 && tRect.bottom <= cRect.bottom + 20;
      },
      { chName: lastChName },
    );

    expect(isInViewport).toBeTruthy();
  });
});

test.describe("纯函数单元测试：频道视觉排序与默认频道解析算法 (channelNavigation)", () => {
  const dummyGuild: Guild = {
    id: "g_mock",
    name: "测试公会",
    ownerId: "u_1",
    createdAt: new Date().toISOString(),
    categories: [
      {
        id: "cat_voice",
        guildId: "g_mock",
        name: "语音分类",
        position: 1,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "cat_text",
        guildId: "g_mock",
        name: "文字分类",
        position: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
    channels: [
      {
        id: "ch_uncat_2",
        name: "未分类文字2",
        type: "TEXT",
        position: 1,
        createdAt: "",
      },
      {
        id: "ch_uncat_1",
        name: "未分类语音1",
        type: "VOICE",
        position: 0,
        createdAt: "",
      },
      {
        id: "ch_cat_text_1",
        name: "文字频道1",
        type: "TEXT",
        parentId: "cat_text",
        position: 0,
        createdAt: "",
      },
      {
        id: "ch_cat_voice_1",
        name: "语音频道1",
        type: "VOICE",
        parentId: "cat_voice",
        position: 0,
        createdAt: "",
      },
    ],
    members: [],
  };

  test("getSortedGuildChannels: 准确先排未分类再按分类升序排列子频道", () => {
    const sorted = getSortedGuildChannels(dummyGuild);
    expect(sorted.map((c) => c.id)).toEqual([
      "ch_uncat_1",
      "ch_uncat_2",
      "ch_cat_text_1",
      "ch_cat_voice_1",
    ]);
  });

  test("getDefaultGuildChannel: 优先命中首个文字频道，即使排在第0项的是语音频道", () => {
    // 视觉第一项是 ch_uncat_1 (VOICE)，但在 preferText: true 下应优先选择 ch_uncat_2 (TEXT)
    const defaultChannel = getDefaultGuildChannel(dummyGuild, true);
    expect(defaultChannel?.id).toBe("ch_uncat_2");
    expect(defaultChannel?.type).toBe("TEXT");
  });

  test("getDefaultGuildChannel: 当公会仅包含语音频道时，优雅回退到排序第一项语音频道", () => {
    const pureVoiceGuild: Guild = {
      ...dummyGuild,
      channels: [
        {
          id: "ch_v2",
          name: "语音房2",
          type: "VOICE",
          position: 1,
          createdAt: "",
        },
        {
          id: "ch_v1",
          name: "语音房1",
          type: "VOICE",
          position: 0,
          createdAt: "",
        },
      ],
      categories: [],
    };
    const defaultChannel = getDefaultGuildChannel(pureVoiceGuild, true);
    expect(defaultChannel?.id).toBe("ch_v1");
  });

  test("resolveGuildChannel: 有有效历史记忆时优先恢复，记忆失效时回退到默认", () => {
    // 记忆存在且有效
    const resolvedExisting = resolveGuildChannel(
      dummyGuild,
      "ch_cat_voice_1",
      true,
    );
    expect(resolvedExisting?.id).toBe("ch_cat_voice_1");

    // 记忆不存在/已被删除
    const resolvedMissing = resolveGuildChannel(
      dummyGuild,
      "non_existent_id",
      true,
    );
    expect(resolvedMissing?.id).toBe("ch_uncat_2");
  });
});
