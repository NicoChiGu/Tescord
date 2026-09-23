import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

test("Gateway rejects forged identity and cross-guild voice signaling", async ({
  page,
  request,
}) => {
  const login = async (name: string, password: string) => {
    const response = await request.post("/api/auth/login", {
      data: { emailOrUsername: name, password },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).accessToken as string;
  };
  const adminToken = await login("Jackey", "adminpassword123");
  const aliceToken = await login("Alice", "alicepassword123");
  const parts = adminToken.split(".");
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  );
  payload.sub = "usr_test_alice";
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;
  await page.goto("/");
  const result = await page.evaluate(
    async ({ adminToken, aliceToken, forged }) => {
      const open = (token: string) =>
        new Promise<{ socket: WebSocket; events: any[] }>((resolve) => {
          const socket = new WebSocket(`wss://${location.host}/gateway`);
          const events: any[] = [];
          socket.onopen = () =>
            socket.send(JSON.stringify({ op: 2, d: { token } }));
          socket.onmessage = (event) => {
            const packet = JSON.parse(event.data);
            events.push(packet);
            if (packet.t === "READY" || packet.op === 9)
              resolve({ socket, events });
          };
          socket.onclose = () => resolve({ socket, events });
        });
      const bad = await open(forged);
      bad.socket.close();
      const admin = await open(adminToken);
      const alice = await open(aliceToken);
      const before = admin.events.length;
      alice.socket.send(
        JSON.stringify({
          op: 4,
          d: {
            guildId: "gld_default_01",
            channelId: "chn_default_voice_01",
            selfMute: false,
            selfDeaf: false,
            selfVideo: false,
            streaming: false,
          },
        }),
      );
      alice.socket.send(
        JSON.stringify({
          op: 0,
          t: "P2P_SIGNAL",
          d: {
            channelId: "chn_default_voice_01",
            targetId: "usr_default_admin",
            type: "offer",
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      admin.socket.close();
      alice.socket.close();
      return {
        forgedReady: bad.events.some((event) => event.t === "READY"),
        forgedRejected: bad.events.some((event) => event.op === 9),
        aliceReady: alice.events.some((event) => event.t === "READY"),
        leaked: admin.events
          .slice(before)
          .some(
            (event) =>
              event.t === "P2P_SIGNAL" ||
              (event.t === "VOICE_STATE_UPDATE" &&
                event.d?.userId === "usr_test_alice"),
          ),
      };
    },
    { adminToken, aliceToken, forged },
  );
  expect(result.forgedReady).toBe(false);
  expect(result.forgedRejected).toBe(true);
  expect(result.aliceReady).toBe(true);
  expect(result.leaked).toBe(false);
});

test("HTTP and Gateway reject missing, expired, revoked and banned sessions", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const password = "SecurityTestPassword123";
  const registration = await request.post("/api/auth/register", {
    data: {
      username: `security_${suffix}`,
      email: `security_${suffix}@example.invalid`,
      password,
    },
  });
  expect(registration.ok()).toBeTruthy();
  const registered = (await registration.json()) as {
    accessToken: string;
    user: { id: string };
  };
  const token = registered.accessToken;
  const [header, payloadPart] = token.split(".");
  const expiredClaims = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf8"),
  );
  expiredClaims.exp = Math.floor(Date.now() / 1000) - 60;
  const expiredPayload = Buffer.from(JSON.stringify(expiredClaims)).toString(
    "base64url",
  );
  const signature = createHmac(
    "sha256",
    "tescord-e2e-only-signed-token-test-secret-2026",
  )
    .update(`${header}.${expiredPayload}`)
    .digest("base64url");
  const expiredToken = `${header}.${expiredPayload}.${signature}`;
  expect((await request.get("/api/auth/me")).status()).toBe(401);
  expect(
    (
      await request.get("/api/auth/me", {
        headers: { Authorization: `Bearer ${expiredToken}` },
      })
    ).status(),
  ).toBe(401);
  const changed = await request.post("/api/auth/change-password", {
    headers: { Authorization: `Bearer ${token}` },
    data: { currentPassword: password, newPassword: `${password}Changed` },
  });
  expect(changed.ok()).toBeTruthy();
  expect(
    (
      await request.get("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(401);
  const relogin = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: `security_${suffix}`,
      password: `${password}Changed`,
    },
  });
  expect(relogin.ok()).toBeTruthy();
  const activeToken = ((await relogin.json()) as { accessToken: string })
    .accessToken;
  const adminLogin = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  const adminToken = ((await adminLogin.json()) as { accessToken: string })
    .accessToken;
  const ban = await request.patch(`/api/admin/users/${registered.user.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { isBanned: true },
  });
  expect(ban.ok(), await ban.text()).toBeTruthy();
  expect(
    (
      await request.get("/api/auth/me", {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/");
  const websocketResult = await page.evaluate(
    async (tokens) => {
      const results: boolean[] = [];
      for (const token of tokens) {
        const accepted = await new Promise<boolean>((resolve) => {
          const socket = new WebSocket(`wss://${location.host}/gateway`);
          socket.onopen = () =>
            socket.send(JSON.stringify({ op: 2, d: { token } }));
          socket.onmessage = (event) => {
            const packet = JSON.parse(event.data);
            if (packet.t === "READY" || packet.op === 9) {
              socket.close();
              resolve(packet.t === "READY");
            }
          };
          socket.onclose = () => resolve(false);
        });
        results.push(accepted);
      }
      return results;
    },
    ["", expiredToken, token, activeToken],
  );
  expect(websocketResult).toEqual([false, false, false, false]);
});

test("private attachments reject direct reads and invalid signatures; webhook uses its signature gate", async ({
  request,
}) => {
  const login = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  const token = (await login.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const grantResponse = await request.post("/api/attachments/presigned-url", {
    headers,
    data: {
      fileName: "private-note.txt",
      fileSize: 6,
      mimeType: "text/plain",
      channelId: "chn_default_text_01",
    },
  });
  expect(grantResponse.ok()).toBeTruthy();
  const grant = await grantResponse.json();
  const wrongSize = await request.put(grant.uploadUrl, {
    headers: { ...headers, "Content-Type": "text/plain" },
    data: Buffer.from("short"),
  });
  expect(wrongSize.status()).toBe(403);
  const upload = await request.put(grant.uploadUrl, {
    headers: { ...headers, "Content-Type": "text/plain" },
    data: Buffer.from("secret"),
  });
  expect(upload.ok()).toBeTruthy();
  const direct = await request.get(grant.fileUrl);
  expect(direct.status()).toBe(404);
  const unsigned = await request.get(
    `/attachments/${encodeURIComponent(grant.fileKey)}`,
  );
  expect(unsigned.status()).toBe(403);
  const wrongChannel = await request.post(
    "/api/channels/chn_default_text_02/messages",
    {
      headers,
      data: {
        content: "cross-channel attachment",
        attachments: [
          {
            url: grant.fileUrl,
            fileName: "private-note.txt",
            fileSize: 6,
            mimeType: "text/plain",
          },
        ],
      },
    },
  );
  expect(wrongChannel.status()).toBe(403);
  const messageResponse = await request.post(
    "/api/channels/chn_default_text_01/messages",
    {
      headers,
      data: {
        content: "private file",
        attachments: [
          {
            url: grant.fileUrl,
            fileName: "private-note.txt",
            fileSize: 6,
            mimeType: "text/plain",
          },
        ],
      },
    },
  );
  expect(messageResponse.ok()).toBeTruthy();
  const message = await messageResponse.json();
  const signedUrl = message.attachments?.[0]?.url as string;
  expect(signedUrl).toContain("/attachments/");
  const signed = await request.get(signedUrl);
  expect(signed.status()).toBe(200);
  expect(await signed.text()).toBe("secret");
  const tampered = new URL(signedUrl);
  tampered.searchParams.set("signature", "tampered");
  expect((await request.get(tampered.toString())).status()).toBe(403);
  const expired = new URL(signedUrl);
  const expiredAt = Math.floor(Date.now() / 1000) - 60;
  expired.searchParams.set("expires", String(expiredAt));
  expired.searchParams.set(
    "signature",
    createHmac("sha256", "tescord-e2e-only-upload-signing-test-secret-2026")
      .update(`download:${grant.fileKey}:chn_default_text_01:${expiredAt}`)
      .digest("base64url"),
  );
  expect((await request.get(expired.toString())).status()).toBe(403);
  const unsafeGrant = await request.post("/api/attachments/presigned-url", {
    headers,
    data: {
      fileName: "payload.svg",
      fileSize: 6,
      mimeType: "image/svg+xml",
      channelId: "chn_default_text_01",
    },
  });
  expect(unsafeGrant.ok()).toBe(false);
  const oversizeGrant = await request.post("/api/attachments/presigned-url", {
    headers,
    data: {
      fileName: "large.bin",
      fileSize: 51 * 1024 * 1024,
      mimeType: "application/octet-stream",
      channelId: "chn_default_text_01",
    },
  });
  expect(oversizeGrant.ok()).toBe(false);
  const aliceLogin = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Alice", password: "alicepassword123" },
  });
  const aliceToken = (await aliceLogin.json()).accessToken as string;
  const unauthorizedGrant = await request.post(
    "/api/attachments/presigned-url",
    {
      headers: { Authorization: `Bearer ${aliceToken}` },
      data: {
        fileName: "unauthorized.txt",
        fileSize: 6,
        mimeType: "text/plain",
        channelId: "chn_default_text_01",
      },
    },
  );
  expect(unauthorizedGrant.status()).toBe(403);
  const webhook = await request.post("/api/livekit/webhook", {
    headers: { "Content-Type": "application/webhook+json" },
    data: "{}",
  });
  expect(webhook.status()).toBe(400);
});
