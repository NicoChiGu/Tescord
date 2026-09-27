import { test, expect } from "@playwright/test";

test.describe("VoiceMesh 对端离开防重试与单人待命防降级验收测试", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    // 注入模拟登录与媒体环境
    await page.addInitScript(() => {
      localStorage.setItem("tescord_access_token", "mock_e2e_token");
      localStorage.setItem("tescord_refresh_token", "mock_refresh_token");

      if (navigator.mediaDevices) {
        const createMockStream = () => {
          const AudioContextClass =
            window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          const osc = audioCtx.createOscillator();
          const dst = audioCtx.createMediaStreamDestination();
          osc.connect(dst);
          try {
            osc.start();
          } catch {}
          const audioTrack = dst.stream.getAudioTracks()[0];
          return new MediaStream([audioTrack]);
        };

        navigator.mediaDevices.getUserMedia = async (constraints) => {
          return createMockStream();
        };
      }
    });

    await page.route("**/api/network/ice-servers", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
          ttl: 300,
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

    await page.route("**/rtc/**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });

    await page.route("**/api/auth/me", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "usr_mesh_tester_a",
          username: "tester_a",
          displayName: "测试员A",
          email: "tester_a@example.com",
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
            id: "guild_p2p_test",
            name: "P2P测试公会",
            channels: [
              {
                id: "ch_voice_mesh",
                guildId: "guild_p2p_test",
                name: "语音频道",
                type: "VOICE",
                voiceMode: "p2p_mesh",
              },
            ],
            members: [
              { userId: "usr_mesh_tester_a" },
              { userId: "usr_mesh_tester_b" },
            ],
          },
        ]),
      });
    });
  });

  test("对端发送 VOICE_LEAVE 后本端立即销毁连接并清空重试，禁止打洞重试与 SFU 降级", async ({
    page,
  }) => {
    const logs: string[] = [];
    page.on("console", (msg) => {
      logs.push(msg.text());
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(
      () => Boolean((window as any).voiceMeshManager),
      {
        timeout: 10000,
      },
    );

    const result = await page.evaluate(async () => {
      const vmm = (window as any).voiceMeshManager;
      if (!vmm) throw new Error("voiceMeshManager 未挂载到 window");

      let fallbackTriggered = false;
      const unbindFallback = vmm.onFallbackNeeded(() => {
        fallbackTriggered = true;
      });

      vmm.setContext("usr_mesh_tester_a");

      // 1. 创建本地模拟流并初始化 2 人 Mesh 通话 (A 和 B)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await vmm.startVoiceMesh("ch_voice_mesh", "guild_p2p_test", stream, [
        "usr_mesh_tester_b",
      ]);

      const initialMemberCount = vmm.getOtherMemberCount();

      // 2. 模拟收到对端 B 的 VOICE_LEAVE 离开信令
      await vmm.handleVoiceSignal({
        guildId: "guild_p2p_test",
        channelId: "ch_voice_mesh",
        senderId: "usr_mesh_tester_b",
        streamOwnerId: "usr_mesh_tester_b",
        type: "VOICE_LEAVE",
      });

      const memberCountAfterLeave = vmm.getOtherMemberCount();
      const connectedPeers = vmm.getConnectedPeersCount();

      // 3. 模拟等待超过首次打洞重试的 1200ms 时间窗口
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 4. 单人守卫验证：即使显式触发降级，也应被单人守卫拦截
      vmm.triggerFallbackToSFU("测试单人拦截");

      unbindFallback();

      return {
        initialMemberCount,
        memberCountAfterLeave,
        connectedPeers,
        fallbackTriggered,
        isMeshActive: vmm.getIsMeshActive(),
      };
    });

    expect(result.initialMemberCount).toBe(1);
    expect(result.memberCountAfterLeave).toBe(0);
    expect(result.connectedPeers).toBe(0);
    expect(result.fallbackTriggered).toBe(false);
    expect(result.isMeshActive).toBe(true);

    // 验证控制台日志：收到离开信令并清空重试队列，绝无打洞重试日志
    const hasLeaveLog = logs.some(
      (l) => l.includes("VOICE_LEAVE") || l.includes("保持纯 P2P 待命"),
    );
    expect(hasLeaveLog).toBe(true);

    const hasRetryLog = logs.some((l) =>
      l.includes("正在为节点 usr_mesh_tester_b 安排第 1/3 次打洞重试"),
    );
    expect(hasRetryLog).toBe(false);
  });

  test("异常断线时单人守卫：目标离房后拦截重试与 SFU 降级", async ({
    page,
  }) => {
    const logs: string[] = [];
    page.on("console", (msg) => {
      logs.push(msg.text());
    });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(
      () => Boolean((window as any).voiceMeshManager),
      {
        timeout: 10000,
      },
    );

    const result = await page.evaluate(async () => {
      const vmm = (window as any).voiceMeshManager;
      if (!vmm) throw new Error("voiceMeshManager 未挂载到 window");

      let fallbackTriggered = false;
      const unbindFallback = vmm.onFallbackNeeded(() => {
        fallbackTriggered = true;
      });

      vmm.setContext("usr_mesh_tester_a");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await vmm.startVoiceMesh("ch_voice_mesh", "guild_p2p_test", stream, [
        "usr_mesh_tester_b",
      ]);

      // 网关权威同步：B 已不在当前语音频道，当前成员列表为空
      vmm.updateChannelMembers([]);

      // 此时对已离房的 B 尝试调度重试（模拟原生 disconnected 事件触发）
      vmm.scheduleHolePunchRetry?.("usr_mesh_tester_b");

      // 验证单人留守时显式尝试降级
      vmm.triggerFallbackToSFU("测试离线后降级拦截");

      unbindFallback();

      return {
        memberCount: vmm.getOtherMemberCount(),
        fallbackTriggered,
        isMeshActive: vmm.getIsMeshActive(),
      };
    });

    expect(result.memberCount).toBe(0);
    expect(result.fallbackTriggered).toBe(false);
    expect(result.isMeshActive).toBe(true);

    // 验证日志中明确记录拦截了降级
    const hasInterceptLog = logs.some((l) =>
      l.includes("拦截 SFU 降级回退，保持 P2P 引擎待命"),
    );
    expect(hasInterceptLog).toBe(true);
  });

  test("旧频道的离开信令不会关闭新频道中的同一对端", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).voiceMeshManager));

    const counts = await page.evaluate(async () => {
      const mesh = (window as any).voiceMeshManager;
      mesh.setContext("usr_mesh_tester_a");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await mesh.startVoiceMesh("ch_voice_mesh", "guild_p2p_test", stream, [
        "usr_mesh_tester_b",
      ]);
      await mesh.handleVoiceSignal({
        guildId: "guild_p2p_test",
        channelId: "previous_voice_channel",
        senderId: "usr_mesh_tester_b",
        streamOwnerId: "usr_mesh_tester_b",
        type: "VOICE_LEAVE",
      });
      const afterStaleSignal = mesh.getOtherMemberCount();
      await mesh.handleVoiceSignal({
        guildId: "guild_p2p_test",
        channelId: "ch_voice_mesh",
        senderId: "usr_mesh_tester_b",
        streamOwnerId: "usr_mesh_tester_b",
        type: "VOICE_LEAVE",
      });
      return {
        afterStaleSignal,
        afterCurrentSignal: mesh.getOtherMemberCount(),
      };
    });

    expect(counts).toEqual({ afterStaleSignal: 1, afterCurrentSignal: 0 });
  });

  test("私信通话离开信令定向发送给对端并携带 callId", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).voiceMeshManager));

    const leaveSignals = await page.evaluate(async () => {
      const mesh = (window as any).voiceMeshManager;
      mesh.setContext("usr_mesh_tester_a");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await mesh.startVoiceMesh(
        "dm_voice",
        "",
        stream,
        ["usr_mesh_tester_b"],
        "call_1",
      );
      const sent: Array<{ callId?: string; targetId?: string; type: string }> =
        [];
      mesh.sendSignal = (signal: (typeof sent)[number]) => sent.push(signal);
      mesh.broadcastLeaveSignal();
      mesh.stopAll();
      return sent;
    });

    expect(leaveSignals).toEqual([
      expect.objectContaining({
        callId: "call_1",
        targetId: "usr_mesh_tester_b",
        type: "VOICE_LEAVE",
      }),
    ]);
  });
});
