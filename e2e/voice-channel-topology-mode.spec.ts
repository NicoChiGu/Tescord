import { test, expect } from "@playwright/test";
import { installConnectedLiveKitStub } from "./helpers/media";

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
        emailOrUsername: "Jackey",
        password: "adminpassword123",
      },
    });

    expect(loginRes.ok()).toBeTruthy();
    {
      const loginData = await loginRes.json();
      const token = loginData.accessToken;
      const authHeaders = { Authorization: `Bearer ${token}` };

      // 获取用户的公会列表
      const guildsRes = await request.get("/api/guilds", {
        headers: authHeaders,
      });
      expect(guildsRes.ok()).toBeTruthy();
      {
        const guilds = await guildsRes.json();
        const firstGuild = guilds[0];
        expect(firstGuild).toBeTruthy();
        {
          const channelsRes = await request.get(
            `/api/guilds/${firstGuild.id}/channels`,
            {
              headers: authHeaders,
            },
          );
          const channels = await channelsRes.json();
          const voiceChannel = channels.find((c: any) => c.type === "VOICE");

          expect(voiceChannel).toBeTruthy();
          {
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
    await expect(serverButton).toBeVisible({ timeout: 5000 });
    {
      await serverButton.click();
    }

    // 3. 找到语音频道右侧的设置小齿轮或者右键菜单
    const voiceChannel = page
      .locator(
        "button[data-channel-type='VOICE'], button:has-text('语音'), button:has-text('Voice')",
      )
      .first();
    await expect(voiceChannel).toBeVisible({ timeout: 5000 });
    {
      // 右键触发菜单
      await voiceChannel.click({ button: "right" });
      const editOption = page.getByRole("menuitem", { name: "编辑频道" });
      await expect(editOption).toBeVisible({ timeout: 5000 });
      {
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

        // Keep the shared E2E fixture in its default SFU mode for later cases.
        await voiceChannel.click({ button: "right" });
        await page.getByRole("menuitem", { name: "编辑频道" }).click();
        await expect(modal).toBeVisible();
        await sfuCard.click();
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

  test("SFU 连接后左下角显示实际 RTT 而非占位值", async ({
    page,
  }) => {
    await page.goto("/");
    const guild = page.getByRole("button", { name: /Tescord 极客总部|极客|小窝/i }).first();
    await expect(guild).toBeVisible();
    await guild.click();
    const voice = page.locator("button").filter({ has: page.locator("svg.lucide-volume-2") }).first();
    await expect(voice).toBeVisible();
    const userId = await page.evaluate(() => (window as any).useAuthStore.getState().user.id as string);
    await installConnectedLiveKitStub(page, userId);
    await voice.dblclick();
    await expect(page.getByTestId("voice-connection-status-btn")).toContainText("语音已连接");
    await expect(page.getByTestId("voice-connection-latency")).toHaveText("24ms");
  });
});
