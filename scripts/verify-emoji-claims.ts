import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

async function main() {
  const originalCwd = process.cwd();
  const workspace = mkdtempSync(join(tmpdir(), "tescord-emoji-claims-"));
  process.chdir(workspace);
  try {
    const { StorageService } =
      await import("../apps/server/src/services/storage.service.js");
    const storage = new StorageService();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    for (const guildId of [undefined, "guild-owner"]) {
      const grant = await storage.getPresignedUploadUrl(
        {
          fileName: "claim.png",
          fileSize: png.length,
          mimeType: "image/png",
          purpose: "custom-emoji",
          guildId,
        },
        "owner",
      );
      const key = decodeURIComponent(
        new URL(grant.fileUrl).pathname.slice("/public-assets/".length),
      );
      const signed = new URL(grant.uploadUrl);
      assert.equal(
        storage.verifyLocalUpload(
          key,
          "owner",
          Number(signed.searchParams.get("expires")),
          signed.searchParams.get("signature")!,
        ),
        true,
      );
      const expired = Math.floor(Date.now() / 1000) - 60;
      const signature = createHmac(
        "sha256",
        process.env.UPLOAD_SIGNING_SECRET ||
          process.env.JWT_SECRET ||
          "development-upload-secret",
      )
        .update(`${key}:owner:${expired}`)
        .digest("base64url");
      assert.equal(
        storage.verifyLocalUpload(key, "owner", expired, signature),
        false,
      );
      assert.equal(
        storage.verifyLocalUpload(
          key,
          "owner",
          Number(signed.searchParams.get("expires")),
          "tampered",
        ),
        false,
      );
      assert.equal(storage.resolveLocalUploadPath("../outside.png"), null);
      await storage.storeObject(key, png);
      assert.equal(
        storage.claimCustomEmoji("foreign", grant.fileUrl, guildId),
        false,
      );
      assert.equal(
        storage.claimCustomEmoji(
          "owner",
          grant.fileUrl,
          guildId ? undefined : "foreign-guild",
        ),
        false,
      );
      assert.equal(
        storage.claimCustomEmoji("owner", grant.fileUrl, guildId),
        true,
      );
      storage.releaseCustomEmojiClaim("foreign", grant.fileUrl, guildId);
      assert.equal(
        storage.claimCustomEmoji("owner", grant.fileUrl, guildId),
        false,
      );
      storage.releaseCustomEmojiClaim("owner", grant.fileUrl, guildId);
      assert.equal(
        storage.claimCustomEmoji("owner", grant.fileUrl, guildId),
        true,
      );
      await storage.removePublicAsset(grant.fileUrl);
      assert.equal(existsSync(join(workspace, "uploads", key)), false);
      assert.equal(
        storage.claimCustomEmoji("owner", grant.fileUrl, guildId),
        false,
      );
    }
    console.log(
      "PASS: 22 emoji signature, expiry, traversal, scope, compensation, replay and physical deletion assertions",
    );
  } finally {
    process.chdir(originalCwd);
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
