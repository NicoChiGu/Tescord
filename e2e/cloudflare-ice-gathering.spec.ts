import { test, expect } from "@playwright/test";

test.describe("Cloudflare Realtime ICE Gathering Smart Early-Exit", () => {
  test("Immediate resolution when iceGatheringState is already complete", async ({
    page,
  }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const service = (window as any).cloudflareRealtimeService;
      if (!service) throw new Error("cloudflareRealtimeService not mounted");

      const pc = new EventTarget() as any;
      pc.iceGatheringState = "complete";
      pc.localDescription = {
        sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\na=candidate:1 1 UDP 2130706431 192.168.1.1 5000 typ host\r\n",
      };

      const startTime = performance.now();
      await service.testWaitForIceGathering(pc, {
        timeoutMs: 3000,
        debounceMs: 300,
        maxGatherTimeMs: 800,
      });
      const elapsed = performance.now() - startTime;

      return { elapsed };
    });

    expect(result.elapsed).toBeLessThan(100);
  });

  test("Early-Exit completes well under 2.5 seconds with active STUN/TURN gathering instead of waiting 10+ seconds", async ({
    page,
  }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const service = (window as any).cloudflareRealtimeService;
      if (!service) throw new Error("cloudflareRealtimeService not mounted");

      // 使用真实浏览器 WebRTC 堆栈与公网 STUN 进行候选收集
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      });

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const startTime = performance.now();
      await service.testWaitForIceGathering(pc, {
        timeoutMs: 3500,
        debounceMs: 500,
        maxGatherTimeMs: 1200,
      });
      const elapsed = performance.now() - startTime;

      const hasCandidate =
        pc.localDescription?.sdp?.includes("a=candidate:") === true;
      const sdpLength = pc.localDescription?.sdp?.length || 0;
      pc.close();

      return {
        elapsed,
        hasCandidate,
        sdpLength,
      };
    });

    // 验证核心性能：必须在 2.5 秒内完成退出（通常 500ms~1200ms），绝不允许卡 10 秒以上
    expect(result.elapsed).toBeLessThan(2500);
    expect(result.hasCandidate).toBe(true);
    expect(result.sdpLength).toBeGreaterThan(0);
  });

  test("Throws descriptive error when no candidates gathered within timeout", async ({
    page,
  }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const service = (window as any).cloudflareRealtimeService;
      if (!service) throw new Error("cloudflareRealtimeService not mounted");

      // 创建一个完全没有任何 candidate 的 dummy pc
      const pc = new EventTarget() as any;
      pc.iceGatheringState = "gathering";
      pc.localDescription = {
        sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\n",
      }; // 无 a=candidate

      let errorMsg = "";
      try {
        await service.testWaitForIceGathering(pc, {
          timeoutMs: 300,
          debounceMs: 100,
          maxGatherTimeMs: 200,
        });
      } catch (err: any) {
        errorMsg = err.message;
      }

      return { errorMsg };
    });

    expect(result.errorMsg).toMatch(
      /No ICE candidates gathered|ICE candidate gathering timed out/,
    );
  });
});
