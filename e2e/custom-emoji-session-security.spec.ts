import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import type { PresignedUploadResponse } from "@tescord/types";

test("emoji grants reject expired, revoked, banned and foreign sessions", async ({
  request,
}) => {
  const email = `emoji_session_${Date.now()}@example.invalid`;
  const password = "EmojiSessionSecurity123";
  const registered = await request.post("/api/auth/register", {
    data: { email, username: `emoji_session_${Date.now()}`, password },
  });
  expect(registered.ok()).toBeTruthy();
  const owner = (await registered.json()) as {
    accessToken: string;
    user: { id: string };
  };
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const metadata = {
    fileName: "session_emoji.png",
    fileSize: bytes.length,
    mimeType: "image/png",
    purpose: "custom-emoji",
  };
  const [header, payloadPart, signature] = owner.accessToken.split(".");
  const claims = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf8"),
  ) as { exp: number };
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const expired = `${header}.${payload}.${createHmac("sha256", "tescord-e2e-only-signed-token-test-secret-2026").update(`${header}.${payload}`).digest("base64url")}`;
  const forged = `${header}.${payloadPart}.${signature.slice(0, -4)}AAAA`;
  for (const token of [expired, forged]) {
    expect(
      (
        await request.post("/api/attachments/presigned-url", {
          headers: { Authorization: `Bearer ${token}` },
          data: metadata,
        })
      ).status(),
    ).toBe(401);
  }
  const grantResponse = await request.post("/api/attachments/presigned-url", {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: metadata,
  });
  expect(grantResponse.status()).toBe(200);
  const grant = (await grantResponse.json()) as PresignedUploadResponse;
  const deniedPut = async (token?: string, expectedStatus = 401) => {
    expect(
      (
        await request.put(grant.uploadUrl, {
          headers: {
            "Content-Type": "image/png",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          data: bytes,
        })
      ).status(),
    ).toBe(expectedStatus);
  };
  await deniedPut();
  await deniedPut(expired);
  await deniedPut(forged);
  const adminLogin = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  const admin = (await adminLogin.json()) as { accessToken: string };
  await deniedPut(admin.accessToken, 403);
  expect(
    (
      await request.post("/api/auth/change-password", {
        headers: { Authorization: `Bearer ${owner.accessToken}` },
        data: { currentPassword: password, newPassword: `${password}Changed` },
      })
    ).status(),
  ).toBe(200);
  await deniedPut(owner.accessToken);
  expect(
    (
      await request.post("/api/attachments/presigned-url", {
        headers: { Authorization: `Bearer ${owner.accessToken}` },
        data: metadata,
      })
    ).status(),
  ).toBe(401);
  const login = await request.post("/api/auth/login", {
    data: { emailOrUsername: email, password: `${password}Changed` },
  });
  const active = (await login.json()) as { accessToken: string };
  expect(
    (
      await request.patch(`/api/admin/users/${owner.user.id}`, {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { isBanned: true },
      })
    ).status(),
  ).toBe(200);
  await deniedPut(active.accessToken);
  expect(
    (
      await request.post("/api/attachments/presigned-url", {
        headers: { Authorization: `Bearer ${active.accessToken}` },
        data: metadata,
      })
    ).status(),
  ).toBe(401);
  expect((await request.get(grant.fileUrl)).status()).toBe(404);
});
