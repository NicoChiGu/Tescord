import { test, expect } from "@playwright/test";

test("Cloudflare media endpoints reject anonymous and forged channel/session operations", async ({ page, request }) => {
  await page.goto("/");
  const token = await page.evaluate(() => localStorage.getItem("tescord_access_token") || sessionStorage.getItem("tescord_access_token"));
  expect(token).toBeTruthy();
  const anonTurn = await request.get("/api/cloudflare-realtime/ice-servers");
  expect(anonTurn.status()).toBe(401);
  const anonLegacyTurn = await request.get("/api/network/ice-servers");
  expect(anonLegacyTurn.status()).toBe(401);
  const anonCreate = await request.post("/api/cloudflare-realtime/session/new", { data: { channelId: "missing" } });
  expect(anonCreate.status()).toBe(401);

  const headers = { Authorization: `Bearer ${token}` };
  const invalidChannel = await request.post("/api/cloudflare-realtime/session/new", { headers, data: { channelId: "missing" } });
  expect(invalidChannel.status()).toBe(403);
  const noChannel = await request.post("/api/cloudflare-realtime/session/new", { headers, data: {} });
  expect(noChannel.status()).toBe(403);

  const forgedPublish = await request.post("/api/cloudflare-realtime/tracks/publish", { headers, data: { channelId: "missing", sessionId: "forged", sessionDescription: { type: "offer", sdp: "v=0" }, tracks: [] } });
  expect(forgedPublish.status()).toBe(403);
  const forgedSubscribe = await request.post("/api/cloudflare-realtime/tracks/subscribe", { headers, data: { channelId: "missing", sessionId: "forged", tracks: [] } });
  expect(forgedSubscribe.status()).toBe(403);
  const forgedReady = await request.post("/api/cloudflare-realtime/tracks/ready", { headers, data: { sessionId: "forged" } });
  expect(forgedReady.status()).toBe(403);
  const forgedLeave = await request.post("/api/cloudflare-realtime/session/leave", { headers, data: { sessionId: "forged" } });
  expect(forgedLeave.status()).toBe(403);
});
