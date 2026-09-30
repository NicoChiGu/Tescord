import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import type { AttachmentAccessResponse, Message } from "@tescord/types";

// All fixtures are created through the isolated Playwright backend's real APIs.
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const password = "InlineAttachmentTestPassword123";
type Session = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
};
type Fixture = {
  guildId: string;
  guildName: string;
  channelId: string;
  fileUrl: string;
  fileName: string;
  signedUrl: string;
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(
  request: APIRequestContext,
  name = "Jackey",
  secret = "adminpassword123",
): Promise<Session> {
  const response = await request.post("/api/auth/login", {
    data: { emailOrUsername: name, password: secret },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<Session>;
}

async function register(request: APIRequestContext): Promise<Session> {
  const username = `inline_${randomUUID().slice(0, 8)}`;
  const response = await request.post("/api/auth/register", {
    data: { username, email: `${username}@example.invalid`, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<Session>;
}

async function createFixture(
  request: APIRequestContext,
  token: string,
): Promise<Fixture> {
  const headers = auth(token);
  const guildName = `inline-${randomUUID().slice(0, 8)}`;
  const guildResponse = await request.post("/api/guilds", {
    headers,
    data: { name: guildName, locale: "en-US" },
  });
  expect(guildResponse.ok(), await guildResponse.text()).toBeTruthy();
  const guildId = ((await guildResponse.json()) as { id: string }).id;
  const channelResponse = await request.get(`/api/guilds/${guildId}/channels`, {
    headers,
  });
  expect(channelResponse.ok(), await channelResponse.text()).toBeTruthy();
  const channels = (await channelResponse.json()) as Array<{
    id: string;
    type: string;
  }>;
  const channelId = channels.find((channel) => channel.type === "TEXT")!.id;
  expect(channelId).toBeTruthy();
  const grantResponse = await request.post("/api/attachments/presigned-url", {
    headers,
    data: {
      fileName: `inline-${randomUUID().slice(0, 8)}.png`,
      fileSize: image.length,
      mimeType: "image/png",
      channelId,
    },
  });
  expect(grantResponse.ok(), await grantResponse.text()).toBeTruthy();
  const grant = (await grantResponse.json()) as {
    uploadUrl: string;
    fileUrl: string;
  };
  const uploaded = await request.put(grant.uploadUrl, {
    headers: { ...headers, "Content-Type": "image/png" },
    data: image,
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const bound = await request.post(`/api/channels/${channelId}/messages`, {
    headers,
    data: {
      content: "real inline attachment source",
      attachments: [
        {
          url: grant.fileUrl,
          fileName: "source.png",
          fileSize: image.length,
          mimeType: "image/png",
        },
      ],
    },
  });
  expect(bound.ok(), await bound.text()).toBeTruthy();
  const message = (await bound.json()) as Message;
  const signedUrl = message.attachments[0].url;
  const fileUrl = new URL(signedUrl).pathname;
  return {
    guildId,
    guildName,
    channelId,
    fileUrl,
    fileName: decodeURIComponent(fileUrl.split("/").pop()!),
    signedUrl,
  };
}

async function deleteFixture(
  request: APIRequestContext,
  fixture: Fixture,
  token: string,
) {
  const response = await request.delete(`/api/guilds/${fixture.guildId}`, {
    headers: auth(token),
    data: { nameConfirmation: fixture.guildName },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

// Mint a genuinely expired capability using only the documented isolated test
// signing secret and fields in a real grant; no private StorageService reflection.
function expiredDownload(signedUrl: string): string {
  const url = new URL(signedUrl);
  const p = url.searchParams;
  const expires = Math.floor(Date.now() / 1000) - 60;
  p.set("expires", String(expires));
  const fileKey = decodeURIComponent(url.pathname.split("/").pop()!);
  const payload = `download:${fileKey}:${p.get("channelId")}:${expires}:${p.get("variant")}:${p.get("download")}:${p.get("userId")}:${p.get("sessionId")}:${p.get("sessionVersion")}`;
  p.set(
    "signature",
    createHmac("sha256", "tescord-e2e-only-upload-signing-test-secret-2026")
      .update(payload)
      .digest("base64url"),
  );
  return url.toString();
}

async function enterChannel(page: Page, fixture: Fixture) {
  await page.goto("/");
  const guild = page.getByRole("button", {
    name: fixture.guildName,
    exact: true,
  });
  await expect(guild).toBeVisible({ timeout: 15_000 });
  await guild.click();
  await page.getByRole("button", { name: "general", exact: true }).click();
  await expect(
    page.locator(`[data-channel-id="${fixture.channelId}"]`).last(),
  ).toBeVisible();
}

async function sendInlineMessage(page: Page, fixture: Fixture) {
  const text = `inline-preview ${fixture.fileUrl}`;
  const sent = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/channels/${fixture.channelId}/messages`,
  );
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.fill(text);
  await composer.press("Enter");
  const response = await sent;
  expect(response.ok(), await response.text()).toBeTruthy();
  const message = (await response.json()) as Message;
  const row = page.locator(`#message-${message.id}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

test.describe("Real inline attachment previews and authenticated renewal", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const token = localStorage.getItem("tescord_e2e_access_token");
      if (token) localStorage.setItem("tescord_access_token", token);
    });
  });

  test("a real uploaded relative image link renders pixels and both link and image open Lightbox", async ({
    page,
    request,
  }) => {
    const admin = await login(request);
    const fixture = await createFixture(request, admin.accessToken);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await enterChannel(page, fixture);
      const row = await sendInlineMessage(page, fixture);
      const thumbnail = row.locator(`img[alt="${fixture.fileName}"]`);
      await expect(thumbnail).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() =>
          thumbnail.evaluate(
            (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const currentUrl = page.url();
      await row.locator(`a[href="${fixture.fileUrl}"]`).click();
      const dialog = page.getByRole("dialog", {
        name: `预览 ${fixture.fileName}`,
      });
      await expect(dialog).toBeVisible();
      await expect
        .poll(() =>
          dialog
            .locator("img")
            .evaluate(
              (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
            ),
        )
        .toBe(true);
      expect(page.url()).toBe(currentUrl);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await thumbnail.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      const messageId = (await row.getAttribute("id"))!.replace(
        /^message-/,
        "",
      );
      const removed = await request.delete(
        `/api/channels/${fixture.channelId}/messages/${messageId}`,
        { headers: auth(admin.accessToken) },
      );
      expect(removed.ok()).toBeTruthy();
      await expect(row).not.toBeVisible();
      // Repeating the same text after the first renderer unmounts must not
      // reuse a cached link callback bound to that old message component.
      const replacement = await sendInlineMessage(page, fixture);
      await replacement.locator(`a[href="${fixture.fileUrl}"]`).click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]);
    } finally {
      await deleteFixture(request, fixture, admin.accessToken);
    }
  });

  test("a genuinely expired GET returns 403, then one real access renewal restores decoded pixels", async ({
    page,
    request,
  }) => {
    const admin = await login(request);
    const fixture = await createFixture(request, admin.accessToken);
    let accessRequests = 0;
    const mediaStatuses: number[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        new URL(response.url()).pathname === fixture.fileUrl &&
        response.request().method() === "GET"
      )
        mediaStatuses.push(response.status());
    });
    // Keep the real access endpoint and image bytes. Only age the first grant
    // so the production rejection/renewal path runs against the actual backend.
    await page.route("**/api/attachments/access", async (route) => {
      const body = route.request().postDataJSON() as { fileUrls?: string[] };
      if (!body.fileUrls?.includes(fixture.fileUrl)) return route.continue();
      accessRequests++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (accessRequests !== 1) return route.fulfill({ response });
      const data = (await response.json()) as AttachmentAccessResponse;
      const item = data.fileUrls!.find(
        (entry) => entry.fileUrl === fixture.fileUrl,
      )!;
      item.url = expiredDownload(item.url);
      if (item.previewUrl) item.previewUrl = expiredDownload(item.previewUrl);
      await route.fulfill({
        response,
        body: JSON.stringify(data),
        contentType: "application/json",
      });
    });
    try {
      await enterChannel(page, fixture);
      const row = await sendInlineMessage(page, fixture);
      const thumbnail = row.locator(`img[alt="${fixture.fileName}"]`);
      await expect(thumbnail).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() =>
          thumbnail.evaluate(
            (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await expect.poll(() => accessRequests).toBe(2);
      await page.waitForTimeout(500);
      expect(accessRequests).toBe(2);
      expect(mediaStatuses.filter((status) => status === 403)).toHaveLength(1);
      expect(mediaStatuses.at(-1)).toBe(200);
      expect(errors).toEqual([]);
      await test.info().attach("real-renewal-request-counts", {
        body: JSON.stringify({ accessRequests, mediaStatuses }),
        contentType: "application/json",
      });
    } finally {
      await deleteFixture(request, fixture, admin.accessToken);
    }
  });
});

test("URL access enforces current identity, ownership and strict signed GET expiry", async ({
  request,
}) => {
  const owner = await register(request);
  const outsider = await register(request);
  const admin = await login(request);
  const fixture = await createFixture(request, owner.accessToken);
  let cleanupToken = owner.accessToken;
  let ownerBanned = false;
  const renewal = (token?: string, fileUrl = fixture.fileUrl) =>
    request.post("/api/attachments/access", {
      headers: token ? auth(token) : {},
      data: { fileUrls: [fileUrl] },
    });
  try {
    expect((await renewal()).status()).toBe(401);
    const [header, claimsPart, signature] = owner.accessToken.split(".");
    const forgedToken = `${header}.${claimsPart}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
    expect((await renewal(forgedToken)).status()).toBe(401);
    const claims = JSON.parse(
      Buffer.from(claimsPart, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.exp = Math.floor(Date.now() / 1000) - 60;
    const expiredClaims = Buffer.from(JSON.stringify(claims)).toString(
      "base64url",
    );
    const expiredJwt = `${header}.${expiredClaims}.${createHmac("sha256", "tescord-e2e-only-signed-token-test-secret-2026").update(`${header}.${expiredClaims}`).digest("base64url")}`;
    expect((await renewal(expiredJwt)).status()).toBe(401);
    expect((await renewal(outsider.accessToken)).status()).toBe(403);
    const noGrant = await renewal(
      owner.accessToken,
      "/attachments/not-bound-to-any-message.png",
    );
    expect(noGrant.status()).toBe(404);
    for (const invalid of [
      "https://untrusted.example/attachments/image.png",
      "/attachments/%E0%A4%A.png",
      "/attachments/%2e%2e%2fsecret.png",
    ]) {
      expect(
        (await renewal(owner.accessToken, invalid)).status(),
        invalid,
      ).toBe(400);
    }
    expect((await request.get(fixture.fileUrl)).status()).toBe(403);
    const tampered = new URL(fixture.signedUrl);
    tampered.searchParams.set("signature", "tampered");
    expect((await request.get(tampered.toString())).status()).toBe(403);
    const expired = expiredDownload(fixture.signedUrl);
    expect((await request.get(expired)).status()).toBe(403);
    // A URL is an object reference, not an access grant: only a currently
    // authorized JWT may replace the expired capability.
    const fresh = await renewal(
      owner.accessToken,
      new URL(expired).pathname + new URL(expired).search,
    );
    expect(fresh.status(), await fresh.text()).toBe(200);
    const body = (await fresh.json()) as AttachmentAccessResponse;
    expect(body.fileUrls).toHaveLength(1);
    expect(body.fileUrls![0].expiresAt).toBeGreaterThan(Date.now());
    const downloaded = await request.get(body.fileUrls![0].url);
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(image);

    const inviteResponse = await request.post(
      `/api/guilds/${fixture.guildId}/invites`,
      {
        headers: auth(owner.accessToken),
        data: { maxUses: 1, maxAge: 3600, forceNew: true },
      },
    );
    expect(inviteResponse.ok(), await inviteResponse.text()).toBeTruthy();
    const invite = (await inviteResponse.json()) as { code: string };
    const joined = await request.post(`/api/invites/${invite.code}/join`, {
      headers: auth(outsider.accessToken),
    });
    expect(joined.ok(), await joined.text()).toBeTruthy();
    const memberAccess = await renewal(outsider.accessToken);
    expect(memberAccess.status(), await memberAccess.text()).toBe(200);
    const memberUrl = ((await memberAccess.json()) as AttachmentAccessResponse)
      .fileUrls![0].url;
    expect((await request.get(memberUrl)).status()).toBe(200);
    const removed = await request.delete(
      `/api/guilds/${fixture.guildId}/members/${outsider.user.id}`,
      { headers: auth(owner.accessToken) },
    );
    expect(removed.ok(), await removed.text()).toBeTruthy();
    expect((await renewal(outsider.accessToken)).status()).toBe(403);
    expect((await request.get(memberUrl)).status()).toBe(403);

    const logout = await request.post("/api/auth/logout", {
      data: { refreshToken: owner.refreshToken },
    });
    expect(logout.ok(), await logout.text()).toBeTruthy();
    expect((await renewal(owner.accessToken)).status()).toBe(401);
    expect((await request.get(body.fileUrls![0].url)).status()).toBe(403);
    const active = await login(request, owner.user.username, password);
    cleanupToken = active.accessToken;
    const ban = await request.patch(`/api/admin/users/${owner.user.id}`, {
      headers: auth(admin.accessToken),
      data: { isBanned: true },
    });
    expect(ban.ok(), await ban.text()).toBeTruthy();
    ownerBanned = true;
    expect((await renewal(active.accessToken)).status()).toBe(401);
    expect((await request.get(fixture.signedUrl)).status()).toBe(403);
  } finally {
    if (ownerBanned) {
      const unban = await request.patch(`/api/admin/users/${owner.user.id}`, {
        headers: auth(admin.accessToken),
        data: { isBanned: false },
      });
      expect(unban.ok(), await unban.text()).toBeTruthy();
    }
    cleanupToken = (await login(request, owner.user.username, password))
      .accessToken;
    await deleteFixture(request, fixture, cleanupToken);
  }
});
