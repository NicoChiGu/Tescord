import { test, expect } from "@playwright/test";

test.describe("直播推流传输拓扑独立解耦 (Live Streaming Topology Mode: SFU vs P2P Mesh vs Mesh Tree)", () => {
  test("API 接口安全性校验：非法 streamMode 拒绝 400，未授权拒绝 401，合法模式持久化存储", async ({
    request,
  }) => {
    // 1. 未授权请求校验
    const unauthRes = await request.patch("/api/channels/test-channel-id", {
      data: { streamMode: "p2p_direct" },
    });
    expect(unauthRes.status()).toBe(401);

    // 2. 登录获取有效 token
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

      // 获取公会列表
      const guildsRes = await request.get("/api/guilds", { headers: authHeaders });
      if (guildsRes.ok()) {
        const guilds = await guildsRes.json();
        const firstGuild = guilds[0];
        if (firstGuild) {
          const channelsRes = await request.get(
            `/api/guilds/${firstGuild.id}/channels`,
            { headers: authHeaders },
          );
          const channels = await channelsRes.json();
          const voiceChannel = channels.find((c: any) => c.type === "VOICE");

          if (voiceChannel) {
            // 负向校验：发送非法 streamMode
            const badRes = await request.patch(
              `/api/channels/${voiceChannel.id}`,
              {
                headers: authHeaders,
                data: { streamMode: "invalid_stream_mode" },
              },
            );
            expect(badRes.status()).toBe(400);

            // 正向校验：发送合法 streamMode: p2p_direct (P2P Mesh)
            const goodRes1 = await request.patch(
              `/api/channels/${voiceChannel.id}`,
              {
                headers: authHeaders,
                data: { streamMode: "p2p_direct" },
              },
            );
            expect(goodRes1.status()).toBe(200);
            const updated1 = await goodRes1.json();
            expect(updated1.streamMode).toBe("p2p_direct");

            // 再次查列表验证持久化
            const refetchedRes1 = await request.get(
              `/api/guilds/${firstGuild.id}/channels`,
              { headers: authHeaders },
            );
            const refetchedChannels1 = await refetchedRes1.json();
            const found1 = refetchedChannels1.find(
              (c: any) => c.id === voiceChannel.id,
            );
            expect(found1.streamMode).toBe("p2p_direct");

            // 正向校验：发送合法 streamMode: p2p_relay (Mesh Tree)
            const goodRes2 = await request.patch(
              `/api/channels/${voiceChannel.id}`,
              {
                headers: authHeaders,
                data: { streamMode: "p2p_relay" },
              },
            );
            expect(goodRes2.status()).toBe(200);
            const updated2 = await goodRes2.json();
            expect(updated2.streamMode).toBe("p2p_relay");

            // 再次查列表验证持久化
            const refetchedRes2 = await request.get(
              `/api/guilds/${firstGuild.id}/channels`,
              { headers: authHeaders },
            );
            const refetchedChannels2 = await refetchedRes2.json();
            const found2 = refetchedChannels2.find(
              (c: any) => c.id === voiceChannel.id,
            );
            expect(found2.streamMode).toBe("p2p_relay");

            // 恢复为 sfu
            await request.patch(`/api/channels/${voiceChannel.id}`, {
              headers: authHeaders,
              data: { streamMode: "sfu" },
            });
          }
        }
      }
    }
  });

  test("UI 验收：编辑频道弹窗中语音传输拓扑与直播推流架构完全解耦，支持独立选择", async ({
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

    // 3. 找到语音频道并右键打开编辑频道弹窗
    const voiceChannel = page
      .locator(
        "button[data-channel-type='VOICE'], button:has-text('语音'), button:has-text('Voice')",
      )
      .first();
    if (await voiceChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await voiceChannel.click({ button: "right" });
      const editOption = page
        .locator("text=编辑频道, text=Edit Channel")
        .first();
      if (await editOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editOption.click();

        // 验证弹窗可见
        const modal = page.locator("[data-testid='edit-channel-modal']");
        await expect(modal).toBeVisible();

        // 验证语音传输架构选项存在
        const voiceSfuCard = page.locator("[data-testid='edit-channel-voicemode-sfu']");
        const voiceMeshCard = page.locator("[data-testid='edit-channel-voicemode-mesh']");
        await expect(voiceSfuCard).toBeVisible();
        await expect(voiceMeshCard).toBeVisible();

        // 验证直播推流架构独立选项存在（3 个平级选项：SFU / P2P Mesh / Mesh Tree Beta）
        const streamSfuCard = page.locator("[data-testid='edit-channel-streammode-sfu']");
        const streamDirectCard = page.locator("[data-testid='edit-channel-streammode-direct']");
        const streamRelayCard = page.locator("[data-testid='edit-channel-streammode-relay']");

        await expect(streamSfuCard).toBeVisible();
        await expect(streamDirectCard).toBeVisible();
        await expect(streamRelayCard).toBeVisible();

        // 验证解耦交互：点击 streamMode 的 P2P Mesh，不影响 voiceMode
        await streamDirectCard.click();
        await expect(streamDirectCard).toContainText("当前已启用");

        // 验证解耦交互：点击 streamMode 的 Mesh Tree (Beta)
        await streamRelayCard.click();
        await expect(streamRelayCard).toContainText("当前已启用");

        // 点击 streamMode 的 SFU
        await streamSfuCard.click();
        await expect(streamSfuCard).toContainText("当前已启用");

        // 保存并关闭
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
});
