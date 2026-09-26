import type { Page } from "@playwright/test";

export async function installConnectedLiveKitStub(
  page: Page,
  identity: string,
) {
  await page.route("**/api/livekit/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "ui-media-adapter-token",
        url: "wss://localhost:7880",
      }),
    }),
  );
  await page.evaluate((localIdentity) => {
    const service = (window as any).__livekitService;
    if (!service) throw new Error("LiveKit test surface is unavailable");
    service.joinRoom = async (
      _url: string,
      _token: string,
      roomName: string,
    ) => {
      service.isConnected = true;
      service.currentRoomName = roomName;
      service.networkStatsMap.set(localIdentity, {
        identity: localIdentity,
        rtt: 24,
        jitter: 3,
        packetLoss: 0,
        bitrate: 64,
        quality: "excellent",
        timestamp: Date.now(),
      });
      service.onNetworkStatsChangedCallbacks.forEach(
        (callback: (stats: Map<string, unknown>) => void) =>
          callback(service.networkStatsMap),
      );
      service.setConnectionStatus("connected");
      return true;
    };
    service.leaveRoom = async () => {
      service.isConnected = false;
      service.currentRoomName = null;
      service.networkStatsMap.clear();
      service.setConnectionStatus("disconnected");
    };
  }, identity);
}
