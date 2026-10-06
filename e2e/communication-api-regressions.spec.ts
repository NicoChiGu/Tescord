import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { PermissionFlags, type MessagePage } from "@tescord/types";
import sharp from "../apps/server/node_modules/sharp";

const password = "CommunicationRegressionPassword123";
interface Account {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function account(
  request: APIRequestContext,
  label: string,
): Promise<Account> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const response = await request.post("/api/auth/register", {
    data: {
      username: `${label}_${suffix}`,
      email: `${label}_${suffix}@example.invalid`,
      password,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<Account>;
}
async function guild(request: APIRequestContext, owner: Account) {
  const result = await request.post("/api/guilds", {
    headers: auth(owner.accessToken),
    data: { name: `communication-${Date.now()}` },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return (await result.json()) as { id: string };
}
async function invite(
  request: APIRequestContext,
  guildId: string,
  owner: Account,
  member: Account,
) {
  const response = await request.post(`/api/guilds/${guildId}/invites`, {
    headers: auth(owner.accessToken),
    data: { maxUses: 1, maxAge: 3600, forceNew: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { code } = (await response.json()) as { code: string };
  const join = await request.post(`/api/invites/${code}/join`, {
    headers: auth(member.accessToken),
  });
  expect(join.ok(), await join.text()).toBeTruthy();
}
function expired(token: string): string {
  const [header, body] = token.split(".");
  const claims = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  claims.exp = Math.floor(Date.now() / 1000) - 60;
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac(
    "sha256",
    "tescord-e2e-only-signed-token-test-secret-2026",
  )
    .update(`${header}.${encoded}`)
    .digest("base64url");
  return `${header}.${encoded}.${signature}`;
}
async function gifFixture(): Promise<Buffer> {
  const frames = Buffer.alloc(8 * 8 * 2 * 4);
  for (let pixel = 0; pixel < 64; pixel++) {
    frames.set([255, 0, 0, 255], pixel * 4);
    frames.set([0, 255, 0, 255], (64 + pixel) * 4);
  }
  return sharp(frames, {
    raw: { width: 8, height: 16, channels: 4, pageHeight: 8 },
  })
    .gif({ delay: [40, 90], loop: 2 })
    .toBuffer();
}
async function upload(
  request: APIRequestContext,
  owner: Account,
  guildId: string,
  bytes: Buffer,
) {
  const response = await request.post("/api/attachments/presigned-url", {
    headers: auth(owner.accessToken),
    data: {
      fileName: `communication-${Date.now()}.gif`,
      fileSize: bytes.length,
      mimeType: "image/gif",
      purpose: "guild-icon",
      guildId,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const grant = (await response.json()) as {
    uploadUrl: string;
    fileUrl: string;
  };
  const stored = await request.put(grant.uploadUrl, {
    headers: { ...auth(owner.accessToken), "Content-Type": "image/gif" },
    data: bytes,
  });
  expect(stored.ok(), await stored.text()).toBeTruthy();
  return grant;
}

test("GIF processing validates source ownership, grants, current authority and session state", async ({
  request,
}) => {
  test.setTimeout(60000);
  const owner = await account(request, "icon_owner");
  const manager = await account(request, "icon_manager");
  const target = await guild(request, owner);
  const ownerHeaders = auth(owner.accessToken);
  const managerHeaders = auth(manager.accessToken);
  await invite(request, target.id, owner, manager);
  const roleResponse = await request.post(`/api/guilds/${target.id}/roles`, {
    headers: ownerHeaders,
    data: { name: "icon-manager", permissions: PermissionFlags.MANAGE_GUILD },
  });
  expect(roleResponse.ok(), await roleResponse.text()).toBeTruthy();
  const role = (await roleResponse.json()) as { id: string };
  const assign = await request.patch(
    `/api/guilds/${target.id}/members/${manager.user.id}`,
    { headers: ownerHeaders, data: { roleIds: [role.id] } },
  );
  expect(assign.ok(), await assign.text()).toBeTruthy();
  const bytes = await gifFixture();
  const own = await upload(request, owner, target.id, bytes);
  const foreign = await upload(request, manager, target.id, bytes);
  const endpoint = (action: string) =>
    `/api/guilds/${target.id}/icon/${action}`;
  try {
    for (const action of ["metadata", "preview", "process"]) {
      const data = { fileUrl: own.fileUrl, output: "frame", frame: 1 };
      for (const headers of [
        undefined,
        auth("malformed"),
        auth(`${owner.accessToken.slice(0, -5)}abcde`),
        auth(expired(owner.accessToken)),
      ]) {
        const denied = await request.post(endpoint(action), { headers, data });
        expect(denied.status(), await denied.text()).toBe(401);
      }
      const ownerReadingForeign = await request.post(endpoint(action), {
        headers: ownerHeaders,
        data: { ...data, fileUrl: foreign.fileUrl },
      });
      expect(ownerReadingForeign.status()).toBe(403);
      const managerReadingOwner = await request.post(endpoint(action), {
        headers: managerHeaders,
        data,
      });
      expect(managerReadingOwner.status()).toBe(403);
    }
    expect((await request.get(own.fileUrl)).status()).toBe(404);
    for (const fileUrl of [
      "http://127.0.0.1:3101/health",
      "https://example.invalid/image.gif",
      own.fileUrl.replace("/public-assets/", "/uploads/"),
      `${own.fileUrl}?forged=1`,
      `${own.fileUrl}/../other.gif`,
    ]) {
      expect(
        (
          await request.post(endpoint("metadata"), {
            headers: ownerHeaders,
            data: { fileUrl },
          })
        ).status(),
      ).toBe(403);
    }
    const metadata = await request.post(endpoint("metadata"), {
      headers: ownerHeaders,
      data: { fileUrl: own.fileUrl },
    });
    expect(metadata.ok(), await metadata.text()).toBeTruthy();
    expect(await metadata.json()).toEqual({
      width: 8,
      height: 8,
      frames: 2,
      delays: [40, 90],
    });
    const preview = await request.post(endpoint("preview"), {
      headers: ownerHeaders,
      data: { fileUrl: own.fileUrl, frame: 1 },
    });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    expect(preview.headers()["cache-control"]).toBe("no-store");
    const decoded = await sharp(await preview.body())
      .ensureAlpha()
      .extract({ left: 2, top: 2, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([...decoded]).toEqual([0, 255, 0, 255]);
    for (const data of [
      { fileUrl: own.fileUrl, frame: -1 },
      { fileUrl: own.fileUrl, frame: 2 },
      {
        fileUrl: own.fileUrl,
        output: "frame",
        crop: { left: -1, top: 0, size: 8 },
      },
      { fileUrl: own.fileUrl, output: "unknown" },
    ]) {
      const rejected = await request.post(
        endpoint(data.output ? "process" : "preview"),
        { headers: ownerHeaders, data },
      );
      expect(rejected.status(), await rejected.text()).toBe(400);
      expect((await rejected.json()).code).toBe("INVALID_PARAMS");
    }
    const processed = await request.post(endpoint("process"), {
      headers: ownerHeaders,
      data: {
        fileUrl: own.fileUrl,
        output: "animated",
        crop: { left: 0, top: 0, size: 8 },
      },
    });
    expect(processed.ok(), await processed.text()).toBeTruthy();
    const result = (await processed.json()) as {
      fileUrl: string;
      mimeType: string;
      metadata: {
        width: number;
        height: number;
        frames: number;
        delays: number[];
      };
    };
    expect(result.metadata).toEqual({
      width: 512,
      height: 512,
      frames: 2,
      delays: [40, 90],
    });
    expect(result.mimeType).toBe("image/gif");
    expect((await request.get(result.fileUrl)).status()).toBe(404);
    const bind = await request.patch(`/api/guilds/${target.id}`, {
      headers: ownerHeaders,
      data: { iconUrl: result.fileUrl },
    });
    expect(bind.ok(), await bind.text()).toBeTruthy();
    const publicIcon = await request.get(result.fileUrl);
    expect(publicIcon.ok(), await publicIcon.text()).toBeTruthy();
    expect(
      (await sharp(await publicIcon.body(), { animated: true }).metadata())
        .pages,
    ).toBe(2);
    const staticIcon = await request.get(`${result.fileUrl}?static=1`);
    expect(staticIcon.ok(), await staticIcon.text()).toBeTruthy();
    expect(staticIcon.headers()["content-type"]).toContain("image/png");
    const staticPixel = await sharp(await staticIcon.body())
      .ensureAlpha()
      .extract({ left: 256, top: 256, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([...staticPixel]).toEqual([255, 0, 0, 255]);
    expect((await request.get(`${own.fileUrl}?static=1`)).status()).toBe(404);
    expect(
      (
        await request.post(endpoint("metadata"), {
          headers: ownerHeaders,
          data: { fileUrl: result.fileUrl },
        })
      ).status(),
    ).toBe(403);
    const removed = await request.patch(
      `/api/guilds/${target.id}/members/${manager.user.id}`,
      { headers: ownerHeaders, data: { roleIds: [] } },
    );
    expect(removed.ok(), await removed.text()).toBeTruthy();
    expect(
      (
        await request.post(endpoint("metadata"), {
          headers: managerHeaders,
          data: { fileUrl: foreign.fileUrl },
        })
      ).status(),
    ).toBe(403);
    const restore = await request.patch(
      `/api/guilds/${target.id}/members/${manager.user.id}`,
      { headers: ownerHeaders, data: { roleIds: [role.id] } },
    );
    expect(restore.ok(), await restore.text()).toBeTruthy();
    const revoked = await request.post("/api/auth/logout", {
      data: { refreshToken: manager.refreshToken },
    });
    expect(revoked.status()).toBe(204);
    expect(
      (
        await request.post(endpoint("metadata"), {
          headers: managerHeaders,
          data: { fileUrl: foreign.fileUrl },
        })
      ).status(),
    ).toBe(401);
    const relogin = await request.post("/api/auth/login", {
      data: { emailOrUsername: manager.user.username, password },
    });
    expect(relogin.ok(), await relogin.text()).toBeTruthy();
    const active = (await relogin.json()) as Account;
    const adminResponse = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Jackey", password: "adminpassword123" },
    });
    expect(adminResponse.ok(), await adminResponse.text()).toBeTruthy();
    const admin = (await adminResponse.json()) as Account;
    const banned = await request.patch(`/api/admin/users/${manager.user.id}`, {
      headers: auth(admin.accessToken),
      data: { isBanned: true },
    });
    expect(banned.ok(), await banned.text()).toBeTruthy();
    expect(
      (
        await request.post(endpoint("metadata"), {
          headers: auth(active.accessToken),
          data: { fileUrl: foreign.fileUrl },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await request.delete(`/api/guilds/${target.id}/pending-icon`, {
      headers: ownerHeaders,
      data: { fileUrl: own.fileUrl },
    });
    await request.delete(`/api/guilds/${target.id}`, { headers: ownerHeaders });
  }
});

test("message pages preserve >100 history, both cursors, strict queries and participant boundaries", async ({
  request,
}) => {
  test.setTimeout(60000);
  const databasePath = resolve(
    process.cwd(),
    "apps/server/prisma/tescord-playwright.sqlite",
  );
  expect(basename(databasePath)).toBe("tescord-playwright.sqlite");
  expect(existsSync(databasePath)).toBe(true);
  const serverRequire = createRequire(
    resolve(process.cwd(), "apps/server/package.json"),
  );
  const { PrismaClient } = serverRequire("@prisma/client") as {
    PrismaClient: typeof import("../apps/server/node_modules/@prisma/client").PrismaClient;
  };
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } },
  });
  const owner = await account(request, "history_owner");
  const recipient = await account(request, "history_member");
  const outsider = await account(request, "history_outside");
  const target = await guild(request, owner);
  const headers = auth(owner.accessToken);
  const channelResponse = await request.post(
    `/api/guilds/${target.id}/channels`,
    { headers, data: { name: "history-pages", type: "TEXT" } },
  );
  expect(channelResponse.ok(), await channelResponse.text()).toBeTruthy();
  const textChannel = (await channelResponse.json()) as { id: string };
  const channels = [textChannel.id];
  try {
    for (const type of ["DM", "GROUP_DM"]) {
      const channel = await prisma.channel.create({
        data: {
          type,
          name: type === "GROUP_DM" ? "history group" : "history dm",
          recipients: {
            create: [{ userId: owner.user.id }, { userId: recipient.user.id }],
          },
        },
      });
      channels.push(channel.id);
    }
    for (const channelId of channels) {
      await prisma.message.createMany({
        data: Array.from({ length: 150 }, (_, index) => ({
          channelId,
          authorId: owner.user.id,
          content: `history-${index + 1}`,
          sequence: index + 1,
        })),
      });
      await prisma.channel.update({
        where: { id: channelId },
        data: { nextMessageSequence: 150 },
      });
      const endpoint = `/api/channels/${channelId}/messages`;
      const latest = await request.get(`${endpoint}?format=page&limit=100`, {
        headers,
      });
      expect(latest.ok(), await latest.text()).toBeTruthy();
      const page = (await latest.json()) as MessagePage;
      expect(page.messages).toHaveLength(100);
      expect(page.messages[0].sequence).toBe(51);
      expect(page.messages[99].sequence).toBe(150);
      expect(page.before).toBe(51);
      expect(page.after).toBe(150);
      expect(page.hasOlder).toBe(true);
      expect(page.hasNewer).toBe(false);
      const older = (await (
        await request.get(`${endpoint}?format=page&before=51&limit=50`, {
          headers,
        })
      ).json()) as MessagePage;
      expect(older.messages.map((message) => message.sequence)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 1),
      );
      expect(older.hasOlder).toBe(false);
      expect(older.hasNewer).toBe(true);
      const newer = (await (
        await request.get(`${endpoint}?format=page&after=50&limit=50`, {
          headers,
        })
      ).json()) as MessagePage;
      expect(newer.messages.map((message) => message.sequence)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 51),
      );
      expect(newer.hasOlder).toBe(true);
      expect(newer.hasNewer).toBe(true);
      const oldResponse = await request.get(`${endpoint}?limit=10&before=51`, {
        headers,
      });
      expect(Array.isArray(await oldResponse.json())).toBe(true);
      for (const query of [
        "before=1x",
        "after=-1",
        "after=1.2",
        "before=2147483648",
        "before=1&after=2",
        "before=1&before=1",
        "after=1&after=1",
        "limit=10&limit=10",
        "limit=0",
        "limit=101",
        "limit=1x",
        "format=array",
      ]) {
        const invalid = await request.get(`${endpoint}?${query}`, { headers });
        expect(invalid.status(), query).toBe(400);
        expect((await invalid.json()).code).toBe("INVALID_PARAMS");
      }
      const beforeAll = (await (
        await request.get(`${endpoint}?format=page&before=0`, { headers })
      ).json()) as MessagePage;
      expect(beforeAll.messages).toHaveLength(0);
      expect(beforeAll.hasNewer).toBe(true);
      expect(beforeAll.after).toBe(0);
      const afterAll = (await (
        await request.get(`${endpoint}?format=page&after=2147483647`, {
          headers,
        })
      ).json()) as MessagePage;
      expect(afterAll.messages).toHaveLength(0);
      expect(afterAll.hasOlder).toBe(true);
      expect(afterAll.before).toBe(2147483647);
      for (const deniedHeaders of [
        undefined,
        auth("malformed"),
        auth(`${owner.accessToken.slice(0, -5)}abcde`),
        auth(expired(owner.accessToken)),
      ])
        expect(
          (
            await request.get(`${endpoint}?format=page`, {
              headers: deniedHeaders,
            })
          ).status(),
        ).toBe(401);
      expect(
        (
          await request.get(`${endpoint}?format=page`, {
            headers: auth(outsider.accessToken),
          })
        ).status(),
      ).toBe(403);
      if (channelId !== textChannel.id)
        expect(
          (
            await request.get(`${endpoint}?format=page`, {
              headers: auth(recipient.accessToken),
            })
          ).ok(),
        ).toBeTruthy();
    }
    const revoke = await request.post("/api/auth/logout", {
      data: { refreshToken: recipient.refreshToken },
    });
    expect(revoke.status()).toBe(204);
    expect(
      (
        await request.get(`/api/channels/${channels[1]}/messages?format=page`, {
          headers: auth(recipient.accessToken),
        })
      ).status(),
    ).toBe(401);
    const recipientLogin = await request.post("/api/auth/login", {
      data: { emailOrUsername: recipient.user.username, password },
    });
    expect(recipientLogin.ok(), await recipientLogin.text()).toBeTruthy();
    const activeRecipient = (await recipientLogin.json()) as Account;
    const adminLogin = await request.post("/api/auth/login", {
      data: { emailOrUsername: "Jackey", password: "adminpassword123" },
    });
    expect(adminLogin.ok(), await adminLogin.text()).toBeTruthy();
    const admin = (await adminLogin.json()) as Account;
    const ban = await request.patch(`/api/admin/users/${recipient.user.id}`, {
      headers: auth(admin.accessToken),
      data: { isBanned: true },
    });
    expect(ban.ok(), await ban.text()).toBeTruthy();
    for (const channelId of channels)
      expect(
        (
          await request.get(`/api/channels/${channelId}/messages?format=page`, {
            headers: auth(activeRecipient.accessToken),
          })
        ).status(),
      ).toBe(401);
  } finally {
    await prisma.channel.deleteMany({
      where: { id: { in: channels.slice(1) } },
    });
    await prisma.$disconnect();
    await request.delete(`/api/guilds/${target.id}`, { headers });
  }
});
