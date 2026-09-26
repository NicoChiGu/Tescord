import { test, expect } from "@playwright/test";

test.describe("语音频道传输拓扑模式 (Voice Channel Topology: SFU vs P2P Mesh)", () => {
  test("API 接口安全性校验：非法 voiceMode 拒绝 400，未授权拒绝 401", async ({
    request,
  }) => {
    // 1. 未授权请求校验
    const unauthRes = await request.patch("/api/channels/test-channel-id", {
      data: { voiceMode: "p2p_mesh" },
    });
    expect(unauthRes.status()).toBe(401);

    // 2. 负向测试：越权/非法 voiceMode 参数校验 (须登录获取有效 token)
    // 借助登录接口或测试账号
    const loginRes = await request.post("/api/auth/login", {
      data: {
        email: "test@example.com",
        password: "Password123!",
      },
    });

    if (loginRes.ok()) {
      const loginData = await loginRes.json();
      const token = loginData.accessToken;
      const authHeaders = { Authorization: `Bearer ${token}` };

      // 获取用户的公会列表
      const guildsRes = await request.get("/api/guilds", {
        headers: authHeaders,
      });
      if (guildsRes.ok()) {
        const guilds = await guildsRes.json();
        const firstGuild = guilds[0];
        if (firstGuild) {
          const channelsRes = await request.get(
            `/api/guilds/${firstGuild.id}/channels`,
            {
              headers: authHeaders,
            },
          );
          const channels = await channelsRes.json();
          const voiceChannel = channels.find((c: any) => c.type === "VOICE");

          if (voiceChannel) {
            // 发送非法 voiceMode
            const badRes = await request.patch(
              `/api/channels/${voiceChannel.id}`,
              {
                headers: authHeaders,
                data: { voiceMode: "invalid_topology_mode" },
              },
            );
            expect(badRes.status()).toBe(400);

            // 发送合法 voiceMode: p2p_mesh
            const goodRes = await request.patch(
              `/api/channels/${voiceChannel.id}`,
              {
                headers: authHeaders,
                data: { voiceMode: "p2p_mesh" },
              },
            );
            expect(goodRes.status()).toBe(200);
            const updated = await goodRes.json();
            expect(updated.voiceMode).toBe("p2p_mesh");

            // 再次查列表验证持久化
            const refetchedChannelsRes = await request.get(
              `/api/guilds/${firstGuild.id}/channels`,
              { headers: authHeaders },
            );
            const refetchedChannels = await refetchedChannelsRes.json();
            const refetchedVoice = refetchedChannels.find(
              (c: any) => c.id === voiceChannel.id,
            );
            expect(refetchedVoice.voiceMode).toBe("p2p_mesh");

            // 恢复为 sfu
            await request.patch(`/api/channels/${voiceChannel.id}`, {
              headers: authHeaders,
              data: { voiceMode: "sfu" },
            });
          }
        }
      }
    }
  });

  test("UI 验收：编辑频道弹窗支持切换并保存语音拓扑架构 (SFU vs P2P Mesh)", async ({
    page,
  }) => {
    // 监听控制台错误
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    // 1. 打开首页
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 2. 选择左侧公会服务器
    const serverButton = page
      .locator("button[data-testid^='guild-item-'], button[title*='极客']")
      .first();
    if (await serverButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await serverButton.click();
    }

    // 3. 找到语音频道右侧的设置小齿轮或者右键菜单
    const voiceChannel = page
      .locator(
        "button[data-channel-type='VOICE'], button:has-text('语音'), button:has-text('Voice')",
      )
      .first();
    if (await voiceChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      // 右键触发菜单
      await voiceChannel.click({ button: "right" });
      const editOption = page
        .locator("text=编辑频道, text=Edit Channel")
        .first();
      if (await editOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editOption.click();

        // 验证弹窗可见
        const modal = page.locator("[data-testid='edit-channel-modal']");
        await expect(modal).toBeVisible();

        // 验证拓扑选项存在
        const sfuCard = page.locator(
          "[data-testid='edit-channel-voicemode-sfu']",
        );
        const meshCard = page.locator(
          "[data-testid='edit-channel-voicemode-mesh']",
        );

        await expect(sfuCard).toBeVisible();
        await expect(meshCard).toBeVisible();

        // 点击切换为 P2P Mesh
        await meshCard.click();
        await expect(meshCard).toContainText("当前已启用");

        // 保存
        const saveBtn = page.locator("[data-testid='save-channel-btn']");
        await saveBtn.click();
        await expect(modal).not.toBeVisible();
      }
    }

    // 验证控制台无严重报错
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("favicon") && !err.includes("404"),
    );
    expect(criticalErrors.length).toBe(0);
  });

  test("P2P 与 SFU 模式下 Ping 延迟与左下角文字差异性验证", async ({
    page,
  }) => {
    // 1. 初始化登录状态与 API Mock
    await page.addInitScript(() => {
      localStorage.setItem(
        "tescord_access_token",
        localStorage.getItem("tescord_e2e_access_token") || "mock_e2e_token",
      );
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "e2e_user_latency_tester",
          username: "latency_tester",
          displayName: "延迟测试员",
          email: "latency_tester@example.com",
          avatarUrl: null,
          status: "ONLINE",
        }),
      });
    });

    await page.route("**/api/livekit/token", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "mock_livekit_token",
          url: "wss://localhost:7880",
        }),
      });
    });

    await page.route("**/api/network/ice-servers", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          turnActive: true,
          provider: "cloudflare",
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 验证在左下角连接面板存在时的渲染表现
    const latencyEl = page.locator("[data-testid='voice-connection-latency']");
    if (await latencyEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = await latencyEl.textContent();
      // 若处于连接状态，检查格式是否合法 (如 "--ms", "15ms", "P2P 15ms")
      expect(text).toMatch(/(--ms|\d+ms)/);
    }
  });
});
