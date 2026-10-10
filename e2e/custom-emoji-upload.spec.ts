import { test, expect } from "@playwright/test";
import type { CustomEmoji, PresignedUploadResponse } from "@tescord/types";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("personal emoji upload renders and deletion revokes public access", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const token = await page.evaluate(() =>
    localStorage.getItem("tescord_e2e_access_token"),
  );
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };
  let emoji: CustomEmoji | undefined;
  try {
    await page.getByTestId("user-settings-gear-btn").click();
    await page.getByTestId("tab-emojis-btn").click();
    const name = `emoji_${Date.now().toString(36)}`;
    await page.getByTestId("user-emoji-file-input").setInputFiles({
      name: `${name}.png`,
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByPlaceholder("my_sticker").fill(name);
    const presign = page.waitForResponse(
      (response) =>
        response.url().includes("/api/attachments/presigned-url") &&
        response.request().method() === "POST",
    );
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/users/me/emojis") &&
        response.request().method() === "POST",
    );
    await page
      .locator("form")
      .filter({ has: page.getByPlaceholder("my_sticker") })
      .locator('button[type="submit"]')
      .click();
    const grantResponse = await presign;
    expect(grantResponse.status()).toBe(200);
    const grant = (await grantResponse.json()) as PresignedUploadResponse;
    expect(grant.fileUrl).toContain("/public-assets/");
    const response = await created;
    expect(response.status()).toBe(200);
    emoji = (await response.json()) as CustomEmoji;
    expect(emoji.name).toBe(name);
    await expect(page.getByText(`:${name}:`, { exact: true })).toBeVisible();
    const asset = await request.get(emoji.imageUrl);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["cache-control"]).toBe("no-store");
    expect(asset.headers()["cloudflare-cdn-cache-control"]).toBe("no-store");
    expect(asset.headers()["cdn-cache-control"]).toBe("no-store");
    expect((await asset.body()).subarray(0, 8)).toEqual(png.subarray(0, 8));
    await expect(page.locator(`img[src="${emoji.imageUrl}"]`)).toHaveJSProperty(
      "naturalWidth",
      1,
    );
    expect(errors).toEqual([]);
  } finally {
    if (emoji) {
      expect(
        (
          await request.delete(`/api/users/me/emojis/${emoji.id}`, { headers })
        ).status(),
      ).toBe(200);
      expect((await request.get(emoji.imageUrl)).status()).toBe(404);
    }
  }
});

test("emoji upload rejects invalid sessions, grants, bytes and ownership", async ({
  request,
}) => {
  const login = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Jackey", password: "adminpassword123" },
  });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const data = {
    fileName: "security_emoji.png",
    fileSize: png.length,
    mimeType: "image/png",
    purpose: "custom-emoji",
  };
  for (const auth of [undefined, "Bearer forged.invalid.token"]) {
    expect(
      (
        await request.post("/api/attachments/presigned-url", {
          headers: auth ? { Authorization: auth } : {},
          data,
        })
      ).status(),
    ).toBe(401);
  }
  for (const invalid of [
    { ...data, fileName: "bad.exe", mimeType: "application/x-msdownload" },
    { ...data, fileSize: 1024 * 1024 + 1 },
  ])
    expect(
      (
        await request.post("/api/attachments/presigned-url", {
          headers,
          data: invalid,
        })
      ).status(),
    ).toBe(400);
  const result = await request.post("/api/attachments/presigned-url", {
    headers,
    data,
  });
  expect(result.status()).toBe(200);
  const grant = (await result.json()) as PresignedUploadResponse;
  expect((await request.get(grant.fileUrl)).status()).toBe(404);
  expect(
    (
      await request.put(grant.uploadUrl, {
        headers: { ...headers, "Content-Type": "image/png" },
        data: Buffer.alloc(png.length),
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await request.put(grant.uploadUrl, {
        headers: { ...headers, "Content-Type": "image/png" },
        data: png.subarray(1),
      })
    ).status(),
  ).toBe(403);
  const tampered = new URL(grant.uploadUrl);
  tampered.searchParams.set("signature", "forged");
  expect(
    (
      await request.put(tampered.href, {
        headers: { ...headers, "Content-Type": "image/png" },
        data: png,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put(grant.uploadUrl, {
        headers: { ...headers, "Content-Type": "image/png" },
        data: png,
      })
    ).status(),
  ).toBe(200);
  expect((await request.get(grant.fileUrl)).status()).toBe(404);
  const normalLogin = await request.post("/api/auth/login", {
    data: { emailOrUsername: "Alice", password: "alicepassword123" },
  });
  const normal = (await normalLogin.json()) as { accessToken: string };
  const otherHeaders = { Authorization: `Bearer ${normal.accessToken}` };
  expect(
    (
      await request.post("/api/users/me/emojis", {
        headers: otherHeaders,
        data: { name: "stolen_emoji", imageUrl: grant.fileUrl },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/attachments/presigned-url", {
        headers: otherHeaders,
        data: { ...data, guildId: "gld_default_01" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/guilds/gld_default_01/emojis", {
        headers,
        data: { name: "wrong_scope", imageUrl: grant.fileUrl },
      })
    ).status(),
  ).toBe(400);
  const created = await request.post("/api/users/me/emojis", {
    headers,
    data: { name: "security_emoji", imageUrl: grant.fileUrl },
  });
  expect(created.status()).toBe(200);
  const emoji = (await created.json()) as CustomEmoji;
  try {
    expect(
      (
        await request.post("/api/users/me/emojis", {
          headers,
          data: { name: "reused_emoji", imageUrl: grant.fileUrl },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.delete(`/api/users/me/emojis/${emoji.id}`, {
          headers: otherHeaders,
        })
      ).status(),
    ).toBe(404);
    expect((await request.get(grant.fileUrl)).status()).toBe(200);
  } finally {
    expect(
      (
        await request.delete(`/api/users/me/emojis/${emoji.id}`, { headers })
      ).status(),
    ).toBe(200);
    expect((await request.get(grant.fileUrl)).status()).toBe(404);
  }
});
