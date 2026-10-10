import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CustomEmoji,
  Guild,
  PresignedUploadResponse,
} from "@tescord/types";

test("public personal and guild emoji lifecycle with signed upload boundaries", async ({
  request,
}) => {
  const marker = process.env.TESCORD_ACCEPTANCE_MARKER || "";
  if (!/^[a-f0-9]{10}$/.test(marker))
    throw new Error("Exact acceptance marker required");
  const manifestPath = resolve("test-results/cloudflare-target/resources.json");
  const resources = JSON.parse(await readFile(manifestPath, "utf8")) as {
    marker: string;
    adminUserId: string;
    guildId?: string;
    emojiFileKeys?: string[];
  };
  expect(resources.marker).toBe(marker);
  const login = await request.post("/api/auth/login", {
    data: {
      emailOrUsername: `AcceptanceAdmin_${marker}`,
      password: process.env.TESCORD_ACCEPTANCE_ADMIN_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  const session = (await login.json()) as {
    accessToken: string;
    user: { id: string };
  };
  expect(session.user.id).toBe(resources.adminUserId);
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const guildResponse = await request.post("/api/guilds", {
    headers,
    data: { name: `Cloudflare acceptance ${marker}` },
  });
  expect(guildResponse.status()).toBe(200);
  const guild = (await guildResponse.json()) as Guild;
  resources.guildId = guild.id;
  resources.emojiFileKeys = [];
  await writeFile(manifestPath, JSON.stringify(resources, null, 2));
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  for (const scope of ["personal", "guild"] as const) {
    const endpoint =
      scope === "guild"
        ? `/api/guilds/${guild.id}/emojis`
        : "/api/users/me/emojis";
    const data = {
      fileName: `${scope}_${marker}.png`,
      fileSize: bytes.length,
      mimeType: "image/png",
      purpose: "custom-emoji",
      ...(scope === "guild" ? { guildId: guild.id } : {}),
    };
    expect(
      (await request.post("/api/attachments/presigned-url", { data })).status(),
    ).toBe(401);
    const result = await request.post("/api/attachments/presigned-url", {
      headers,
      data,
    });
    expect(result.status()).toBe(200);
    const grant = (await result.json()) as PresignedUploadResponse;
    resources.emojiFileKeys.push(grant.fileKey);
    await writeFile(manifestPath, JSON.stringify(resources, null, 2));
    const tampered = new URL(grant.uploadUrl);
    tampered.searchParams.set("signature", "invalid");
    expect(
      (
        await request.put(tampered.href, {
          headers: { ...headers, "Content-Type": "image/png" },
          data: bytes,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.put(grant.uploadUrl, {
          headers: { ...headers, "Content-Type": "image/png" },
          data: bytes,
        })
      ).status(),
    ).toBe(200);
    expect((await request.get(grant.fileUrl)).status()).toBe(404);
    const created = await request.post(endpoint, {
      headers,
      data: { name: `${scope}_${marker}`, imageUrl: grant.fileUrl },
    });
    expect(created.status()).toBe(200);
    const emoji = (await created.json()) as CustomEmoji;
    try {
      const asset = await request.get(grant.fileUrl);
      expect(asset.status()).toBe(200);
      expect(asset.headers()["cache-control"]).toBe("no-store");
      expect(asset.headers()["cloudflare-cdn-cache-control"]).toBe("no-store");
      expect(await asset.body()).toEqual(bytes);
      expect(
        (
          await request.post(endpoint, {
            headers,
            data: { name: `again_${marker}`, imageUrl: grant.fileUrl },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await request.get(`/uploads/${encodeURIComponent(grant.fileKey)}`)
        ).status(),
      ).toBe(404);
    } finally {
      expect(
        (await request.delete(`${endpoint}/${emoji.id}`, { headers })).status(),
      ).toBe(200);
      expect((await request.get(grant.fileUrl)).status()).toBe(404);
    }
  }
});
