import { test, expect } from "@playwright/test";

test("Gateway accepts stream kick only from the active stream owner", async ({
  page,
  request,
}) => {
  const login = async (name: string, password: string) => {
    const response = await request.post("/api/auth/login", {
      data: { emailOrUsername: name, password },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return ((await response.json()) as { accessToken: string }).accessToken;
  };
  const hostToken = await login("Jackey", "adminpassword123");
  const viewerToken = await login("Alice", "alicepassword123");
  const inviteResponse = await request.post(
    "/api/guilds/gld_default_01/invites",
    {
      headers: { Authorization: `Bearer ${hostToken}` },
      data: { maxUses: 1, maxAge: 600 },
    },
  );
  expect(inviteResponse.ok(), await inviteResponse.text()).toBeTruthy();
  const { code } = (await inviteResponse.json()) as { code: string };
  const joinResponse = await request.post(`/api/invites/${code}/join`, {
    headers: { Authorization: `Bearer ${viewerToken}` },
  });
  expect(joinResponse.ok(), await joinResponse.text()).toBeTruthy();

  await page.goto("/");
  const result = await page.evaluate(
    async ({ hostToken, viewerToken }) => {
      const open = (token: string) =>
        new Promise<{ socket: WebSocket; events: any[] }>((resolve) => {
          const socket = new WebSocket(`wss://${location.host}/gateway`);
          const events: any[] = [];
          socket.onopen = () =>
            socket.send(JSON.stringify({ op: 2, d: { token } }));
          socket.onmessage = (message) => {
            const event = JSON.parse(message.data);
            events.push(event);
            if (event.t === "READY") resolve({ socket, events });
          };
        });
      const host = await open(hostToken);
      const viewer = await open(viewerToken);
      const channelId = "chn_default_voice_01";
      const guildId = "gld_default_01";
      for (const client of [host, viewer]) {
        client.socket.send(
          JSON.stringify({
            op: 4,
            d: {
              guildId,
              channelId,
              mediaEncryptionVersion: 3,
              selfMute: false,
              selfDeaf: false,
              selfVideo: false,
              streaming: true,
            },
          }),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      const sendKick = (
        socket: WebSocket,
        streamOwnerId: string,
        targetId: string,
      ) => {
        socket.send(
          JSON.stringify({
            op: 0,
            t: "P2P_SIGNAL",
            d: {
              guildId,
              channelId,
              senderId: "forged",
              streamOwnerId,
              targetId,
              type: "STREAM_KICK",
            },
          }),
        );
      };
      sendKick(viewer.socket, "usr_default_admin", "usr_default_admin");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const forgedDelivered = host.events.some(
        (event) => event.t === "P2P_SIGNAL" && event.d?.type === "STREAM_KICK",
      );
      sendKick(host.socket, "usr_default_admin", "usr_test_alice");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const ownerDelivered = viewer.events.some(
        (event) =>
          event.t === "P2P_SIGNAL" &&
          event.d?.type === "STREAM_KICK" &&
          event.d?.senderId === "usr_default_admin",
      );
      host.socket.close();
      viewer.socket.close();
      return { forgedDelivered, ownerDelivered };
    },
    { hostToken, viewerToken },
  );
  expect(result.forgedDelivered).toBe(false);
  expect(result.ownerDelivered).toBe(true);
});
