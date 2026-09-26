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
    "Usage: tsx scripts/migrate-attachment-preview-sqlite.ts --db <absolute-existing-sqlite-file> [--apply]",
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
// Prisma accepts absolute SQLite paths with forward slashes on Windows and Linux.
const url = `file:${dbPath.replace(/\\/g, "/")}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const columns = [
  ["previewUrl", "TEXT"],
  ["previewSize", "INTEGER"],
  ["previewWidth", "INTEGER"],
  ["previewHeight", "INTEGER"],
] as const;

try {
  const before = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'PRAGMA table_info("Attachment")',
  );
  if (!before.some((column) => column.name === "id"))
    throw new Error("Attachment table is missing");
  const missing = columns.filter(
    ([name]) => !before.some((column) => column.name === name),
  );
  console.log(`${apply ? "Apply" : "Dry run"}: ${dbPath}`);
  console.log(
    missing.length
      ? missing
          .map(
            ([name, type]) =>
              `ALTER TABLE "Attachment" ADD COLUMN "${name}" ${type};`,
          )
          .join("\n")
      : "Attachment preview columns already exist; no changes needed.",
  );
  if (apply && missing.length) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("Attachment")',
      );
      for (const [name, type] of columns) {
        if (!current.some((column) => column.name === name)) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE "Attachment" ADD COLUMN "${name}" ${type}`,
          );
        }
      }
    });
    const after = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'PRAGMA table_info("Attachment")',
    );
    if (
      !columns.every(([name]) => after.some((column) => column.name === name))
    ) {
      throw new Error("Attachment preview migration verification failed");
    }
    console.log("Attachment preview migration: PASS");
  }
} finally {
  await prisma.$disconnect();
}
