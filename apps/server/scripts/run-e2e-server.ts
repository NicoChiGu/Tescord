import { existsSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";
import { ErrorCode } from "@tescord/types";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const realMedia = process.env.TESCORD_REAL_MEDIA === "1";
const databaseName = realMedia
  ? process.env.TESCORD_REAL_MEDIA_DATABASE
  : "tescord-playwright.sqlite";
if (
  !databaseName ||
  (realMedia &&
    !/^tescord-real-media-[a-f0-9-]{36}\.sqlite$/.test(databaseName))
)
  throw new Error("Real media tests require a unique isolated database name");
const databasePath = resolve(serverRoot, "prisma", databaseName);
const port = realMedia ? 3102 : 3101;
if (realMedia) {
  const { config } = await import("dotenv");
  config({ path: resolve(serverRoot, "../../.env") });
  for (const key of [
    "CLOUDFLARE_CALLS_APP_ID",
    "CLOUDFLARE_CALLS_APP_SECRET",
    "CLOUDFLARE_CALLS_TURN_KEY_ID",
    "CLOUDFLARE_CALLS_TURN_API_TOKEN",
  ]) {
    const value = process.env[key]?.trim();
    if (!value || /^(e2e-|replace|changeme|example)/i.test(value))
      throw new Error(`Missing real media configuration: ${key}`);
  }
  process.env.VOICE_ENGINE = "cloudflare_realtime";
}

await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
});
if (realMedia && existsSync(databasePath))
  throw new Error("Refusing to overwrite an existing real-media test database");
if (existsSync(databasePath)) unlinkSync(databasePath);
process.env.DATABASE_URL = `file:./${databaseName}`;
process.env.DATABASE_PROVIDER = "sqlite";
process.env.PORT = String(port);
process.env.HOST = "127.0.0.1";
process.env.SERVER_BASE_URL = realMedia
  ? "https://localhost:4174"
  : "https://localhost:4173";
process.env.NODE_ENV = "development";
process.env.IS_E2E = "true";
process.env.ALLOW_FILE_ORIGIN = "true";
process.env.JWT_SECRET = "tescord-e2e-only-signed-token-test-secret-2026";
process.env.UPLOAD_SIGNING_SECRET =
  "tescord-e2e-only-upload-signing-test-secret-2026";
process.env.STORAGE_MODE = "local";
process.env.REDIS_URL = "";
process.env.CLOUDFLARE_CALLS_APP_ID ??= "e2e-sfu-app";
process.env.CLOUDFLARE_CALLS_APP_SECRET ??= "e2e-sfu-secret-never-used";
process.env.CLOUDFLARE_CALLS_TURN_KEY_ID ??= "e2e-turn-key";
process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN ??= "e2e-turn-token-never-used";

// `prisma db push` currently crashes in the Windows schema engine on this host.
// Generate the same new-database DDL, then apply each statement through Prisma's
// query engine so the Playwright database remains isolated from dev.db.
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma");
const generate = spawnSync(
  process.execPath,
  [prismaCli, "generate", "--schema", "prisma/schema.prisma"],
  { cwd: serverRoot, env: process.env, encoding: "utf8" },
);
if (generate.status !== 0) {
  const lockedEngine = /EPERM:.*query_engine-windows\.dll\.node/i.test(
    generate.stderr,
  );
  const generatedClient = resolve(
    dirname(require.resolve("@prisma/client")),
    "../../.prisma/client/index.d.ts",
  );
  if (!lockedEngine || !existsSync(generatedClient))
    throw new Error(
      `Failed to generate SQLite test client: ${generate.stderr}`,
    );
  console.warn(
    "[e2e] Prisma engine is locked by another process; using the existing generated client.",
  );
}
const diff = spawnSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ],
  { cwd: serverRoot, env: process.env, encoding: "utf8" },
);
if (diff.status !== 0 || !diff.stdout) {
  throw new Error(
    `无法生成隔离测试库结构: ${diff.stderr || "unknown schema engine error"}`,
  );
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const statements = diff.stdout
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement && !/^--\s*This is an empty migration/i.test(statement),
    );
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
} finally {
  await prisma.$disconnect();
}

const { prisma: appPrisma, seedInitialData } = await import("../src/db.js");
await seedInitialData();
await appPrisma.user.update({
  where: { id: "usr_default_admin" },
  data: { role: "SUPER_ADMIN" },
});
const { server, start } = await import("../src/index.js");
if (realMedia) {
  const cleanupToken = process.env.TESCORD_REAL_MEDIA_CLEANUP_TOKEN;
  if (!cleanupToken || !/^[a-f0-9-]{36}$/.test(cleanupToken))
    throw new Error("Real media cleanup requires a fresh runner token");
  const { cloudflareRealtimeService } =
    await import("../src/services/cloudflare-realtime.service.js");
  server.post("/__e2e/media/drain", async (request, reply) => {
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip) ||
      request.headers.authorization !== `Bearer ${cleanupToken}`
    )
      return reply.code(403).send({ code: ErrorCode.FORBIDDEN });
    await cloudflareRealtimeService.drainTeardowns();
    return { drained: true };
  });
}
await start();

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // Fastify's close hooks drain remote SFU teardown requests before the
    // isolated database and process disappear.
    await server.close();
    await appPrisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("[e2e] Graceful shutdown failed", error);
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
