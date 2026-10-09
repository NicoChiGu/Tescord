import { test, expect } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { createMultiplayerRoom } from "./helpers/encrypted-multiplayer";
import { getUserDisplayName } from "../apps/web/src/utils/userDisplay";

test("voice moderation rejects forged, expired, unauthorized, revoked and banned actors", async ({
  request,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const password = "VoiceModerationRegression123";
  const registration = await request.post("/api/auth/register", {
    data: {
      username: `voice_owner_${suffix}`,
      email: `voice_${suffix}@example.invalid`,
      password,
    },
  });
  expect(registration.ok()).toBe(true);
  const owner = (await registration.json()) as {
    accessToken: string;
    user: { id: string; username: string };
  };
  const creation = await request.post("/api/guilds", {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { name: `Voice moderation ${suffix}` },
  });
  expect(creation.ok()).toBe(true);
  const guild = (await creation.json()) as { id: string };
  const path = `/api/guilds/${guild.id}/members/usr_test_bob/disconnect-voice`;
  const post = (token?: string) =>
    request.post(path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  expect((await post()).status()).toBe(401);
  expect((await post("forged.jwt.value")).status()).toBe(401);
  const [header, payload] = owner.accessToken.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const expiredPayload = Buffer.from(JSON.stringify(claims)).toString(
    "base64url",
  );
  const signature = createHmac(
    "sha256",
    "tescord-e2e-only-signed-token-test-secret-2026",
  )
    .update(`${header}.${expiredPayload}`)
    .digest("base64url");
  expect(
    (await post(`${header}.${expiredPayload}.${signature}`)).status(),
  ).toBe(401);
  const alice = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: "alice@tescord.local",
      password: "alicepassword123",
    },
  });
  expect(alice.ok()).toBe(true);
  expect((await post((await alice.json()).accessToken)).status()).toBe(403);
  const admin = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  expect(admin.ok()).toBe(true);
  const adminToken = (await admin.json()).accessToken as string;
  const protectedOwner = await request.post(
    `/api/guilds/${guild.id}/members/${owner.user.id}/disconnect-voice`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  expect(protectedOwner.status()).toBe(403);
  expect((await protectedOwner.json()).code).toBe("CANNOT_MANAGE_MEMBER");
  expect((await post(owner.accessToken)).status()).toBe(400);
  const changed = await request.post("/api/auth/change-password", {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { currentPassword: password, newPassword: `${password}Changed` },
  });
  expect(changed.ok()).toBe(true);
  expect((await post(owner.accessToken)).status()).toBe(401);
  const relogin = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: owner.user.username,
      password: `${password}Changed`,
    },
  });
  expect(relogin.ok()).toBe(true);
  const activeToken = (await relogin.json()).accessToken as string;
  const ban = await request.patch(`/api/admin/users/${owner.user.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { isBanned: true },
  });
  expect(ban.ok()).toBe(true);
  expect((await post(activeToken)).status()).toBe(401);
});

test("owner can cancel or confirm a real voice disconnect and the member can rejoin", async ({
  browser,
  request,
}, info) => {
  test.setTimeout(180000);
  const room = await createMultiplayerRoom(
    browser,
    request,
    info,
    2,
    "p2p_mesh",
  );
  const [owner, member] = room.endpoints;
  try {
    await room.join(member);
    await room.firstReady(member);
    const label = owner.page
      .locator("div.pl-6.pr-2.py-1.space-y-1")
      .getByText(getUserDisplayName(member.session.user), { exact: true })
      .first();
    await expect(label).toBeVisible();
    await label.click({ button: "right" });
    await owner.page
      .getByRole("menuitem", { name: "断开语音连接", exact: true })
      .click();
    const dialog = owner.page.getByRole("dialog");
    await expect(
      dialog.getByText("将成员移出语音频道", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      member.page
        .getByRole("button", { name: "断开连接", exact: true })
        .first(),
    ).toBeVisible();
    await label.click({ button: "right" });
    await owner.page
      .getByRole("menuitem", { name: "断开语音连接", exact: true })
      .click();
    const response = owner.page.waitForResponse(
      (r) =>
        r
          .url()
          .endsWith(`/members/${member.session.user.id}/disconnect-voice`) &&
        r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "断开连接", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(
      member.page
        .getByRole("button", { name: "断开连接", exact: true })
        .first(),
    ).not.toBeVisible();
    await expect(
      member.page.locator('[data-testid="voice-transfer-notice"]'),
    ).not.toBeVisible();
    await room.join(member);
    await room.firstReady(member);
    expect(room.errors).toEqual([]);
  } finally {
    await room.cleanup();
  }
});
