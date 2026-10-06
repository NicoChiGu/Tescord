import { test, expect } from "@playwright/test";

test("LiveKit tokens require an authorized voice channel and identified session", async ({
  request,
}) => {
  const login = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  const token = session.accessToken as string;
  const userId = session.user.id as string;
  const headers = { Authorization: `Bearer ${token}` };

  const guildsResponse = await request.get("/api/guilds", { headers });
  expect(guildsResponse.ok()).toBeTruthy();
  const guilds = await guildsResponse.json();
  expect(guilds.length).toBeGreaterThan(0);
  const channelsResponse = await request.get(
    `/api/guilds/${guilds[0].id}/channels`,
    { headers },
  );
  expect(channelsResponse.ok()).toBeTruthy();
  const channels = await channelsResponse.json();
  const voice = channels.find(
    (channel: { type: string }) => channel.type === "VOICE",
  );
  const text = channels.find(
    (channel: { type: string }) => channel.type === "TEXT",
  );
  expect(voice).toBeTruthy();
  expect(text).toBeTruthy();
  const body = { roomName: voice.id, identity: userId };

  expect(
    (await request.post("/api/livekit/token", { data: body })).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/livekit/token", {
        headers: { Authorization: "Bearer forged" },
        data: body,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/livekit/token", {
        headers,
        data: { ...body, identity: "another-user" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/livekit/token", {
        headers,
        data: { ...body, roomName: text.id },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/livekit/token", {
        headers,
        data: { ...body, gatewaySessionId: "forged-session" },
      })
    ).status(),
  ).toBe(403);
  const allowed = await request.post("/api/livekit/token", {
    headers,
    data: body,
  });
  expect(allowed.status()).toBe(403);
  expect(await allowed.json()).toMatchObject({
    code: "MEDIA_E2EE_UNSUPPORTED",
  });
  expect((await allowed.json()).token).toBeUndefined();
});
