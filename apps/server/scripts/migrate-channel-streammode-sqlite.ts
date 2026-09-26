import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const dbOption = args.indexOf("--db");
if (
  dbOption < 0 ||
  !args[dbOption + 1] ||
  args.some((arg) => arg.startsWith("--") && !["--db", "--apply"].includes(arg))
) {
  throw new Error(
    "Usage: tsx scripts/migrate-channel-streammode-sqlite.ts --db <absolute-existing-sqlite-file> [--apply]",
  );
}
const inputPath = args[dbOption + 1];
if (
  !path.isAbsolute(inputPath) ||
  !existsSync(inputPath) ||
  !statSync(inputPath).isFile()
) {
  throw new Error("--db must name an existing absolute SQLite file");
}
const dbPath = realpathSync(inputPath);
const apply = args.includes("--apply");
const url = `file:${dbPath.replace(/\\/g, "/")}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const before = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA table_info("Channel")',
  );
  if (!before.some((column) => column.name === "id")) {
    throw new Error('Target SQLite file does not appear to contain a "Channel" table');
  }
  const hasStreamMode = before.some((column) => column.name === "streamMode");
  console.log(`[migrate-channel-streammode] Database: ${dbPath}`);
  console.log(`[migrate-channel-streammode] Column streamMode exists: ${hasStreamMode}`);

  if (!hasStreamMode) {
    if (apply) {
      console.log('[migrate-channel-streammode] Applying ALTER TABLE...');
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Channel" ADD COLUMN "streamMode" TEXT DEFAULT \'sfu\''
      );
      console.log('[migrate-channel-streammode] Applied successfully.');
    } else {
      console.log('[migrate-channel-streammode] Dry-run only. Pass --apply to execute.');
    }
  } else {
    console.log('[migrate-channel-streammode] No migration needed.');
  }
} finally {
  await prisma.$disconnect();
}
