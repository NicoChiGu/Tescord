import { existsSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const databasePath = fileURLToPath(
  new URL("../prisma/tescord-playwright.sqlite", import.meta.url),
);

await new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(3101, "127.0.0.1", () => probe.close(() => resolve()));
});
if (existsSync(databasePath)) unlinkSync(databasePath);
process.env.DATABASE_URL = "file:./tescord-playwright.sqlite";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.PORT = "3101";
process.env.HOST = "127.0.0.1";
process.env.SERVER_BASE_URL = "https://localhost:4173";
process.env.NODE_ENV = "development";
process.env.IS_E2E = "true";
process.env.JWT_SECRET = "tescord-e2e-only-signed-token-test-secret-2026";
process.env.UPLOAD_SIGNING_SECRET =
  "tescord-e2e-only-upload-signing-test-secret-2026";
process.env.STORAGE_MODE = "local";
process.env.REDIS_URL = "";

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
const { start } = await import("../src/index.js");
await start();
