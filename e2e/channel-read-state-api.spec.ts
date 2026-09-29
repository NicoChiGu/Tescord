import { expect, test } from "@playwright/test";

test("guild read cursor persists, never rewinds, and rejects unauthorized callers", async ({
  request,
}) => {
  const login = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const adminHeaders = { Authorization: `Bearer ${accessToken}` };
  const channelId = "chn_default_text_01";
  const path = `/api/channels/${channelId}/read`;

  expect((await request.post(path)).status()).toBe(401);
  expect(
    (
      await request.post(path, {
        headers: { Authorization: "Bearer forged.jwt.value" },
      })
    ).status(),
  ).toBe(401);

  const normalLogin = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: "alice@tescord.local",
      password: "alicepassword123",
    },
  });
  expect(normalLogin.ok()).toBeTruthy();
  const normalToken = ((await normalLogin.json()) as { accessToken: string })
    .accessToken;
  const normalHeaders = { Authorization: `Bearer ${normalToken}` };
  const denied = await request.post(path, { headers: normalHeaders });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).code).toBe("FORBIDDEN");
  expect(
    (
      await request.post("/api/guilds/gld_default_01/ack", {
        headers: normalHeaders,
      })
    ).status(),
  ).toBe(403);

  const malformed = await request.post(path, {
    headers: adminHeaders,
    data: { lastReadSequence: "100" },
  });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).code).toBe("INVALID_PARAMS");

  for (let i = 0; i < 2; i++) {
    const sent = await request.post(`/api/channels/${channelId}/messages`, {
      headers: adminHeaders,
      data: { content: `read cursor regression ${i}` },
    });
    expect(sent.ok()).toBeTruthy();
  }

  const guilds = await request.get("/api/guilds", { headers: adminHeaders });
  expect(guilds.ok()).toBeTruthy();
  const textChannel = (await guilds.json())
    .find((guild: { id: string }) => guild.id === "gld_default_01")
    .channels.find((channel: { id: string }) => channel.id === channelId);
  const currentSequence = textChannel.lastReadSequence as number;
  expect(currentSequence).toBeGreaterThanOrEqual(2);

  const oldAck = await request.post(path, {
    headers: adminHeaders,
    data: { lastReadSequence: currentSequence - 1 },
  });
  expect(oldAck.ok()).toBeTruthy();
  expect((await oldAck.json()).lastReadSequence).toBe(currentSequence);

  const guildAck = await request.post("/api/guilds/gld_default_01/ack", {
    headers: adminHeaders,
  });
  expect(guildAck.ok()).toBeTruthy();
  const guildAckBody = await guildAck.json();
  expect(guildAckBody.updatedChannels).toContainEqual({
    channelId,
    lastReadSequence: currentSequence,
  });

  const reloaded = await request.get("/api/guilds", { headers: adminHeaders });
  const reloadedChannel = (await reloaded.json())
    .find((guild: { id: string }) => guild.id === "gld_default_01")
    .channels.find((channel: { id: string }) => channel.id === channelId);
  expect(reloadedChannel.lastReadSequence).toBe(currentSequence);
  expect(reloadedChannel.unreadCount).toBe(0);
});
