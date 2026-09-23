import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

import "../src/env.js";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

function isPrismaClientGenerated(): boolean {
  try {
    const clientEntry = require.resolve("@prisma/client");
    const prismaClientDir = path.resolve(
      clientEntry,
      "..",
      "..",
      "..",
      ".prisma",
      "client",
    );
    const dtsFile = path.resolve(prismaClientDir, "index.d.ts");
    return existsSync(dtsFile);
  } catch {
    return false;
  }
}

function runPrismaGenerate(): { success: boolean; output: string } {
  try {
    const prismaCli = require.resolve("prisma");
    const provider = process.env.DATABASE_PROVIDER;
    if (provider !== "sqlite" && provider !== "postgresql") {
      throw new Error("DATABASE_PROVIDER must be sqlite or postgresql");
    }
    const schema =
      provider === "postgresql"
        ? "prisma-postgres/schema.prisma"
        : "prisma/schema.prisma";
    const result = spawnSync(
      process.execPath,
      [prismaCli, "generate", "--schema", schema],
      {
        cwd: serverRoot,
        env: process.env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const combinedOutput =
      `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    if (result.status === 0) {
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      return { success: true, output: combinedOutput };
    }

    return { success: false, output: combinedOutput };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: msg };
  }
}

const alreadyGenerated = isPrismaClientGenerated();
const generateResult = runPrismaGenerate();

if (!generateResult.success) {
  const isWindowsLocked =
    generateResult.output.includes("EPERM") ||
    generateResult.output.includes("operation not permitted") ||
    generateResult.output.includes("query_engine-windows.dll.node");

  if (
    alreadyGenerated &&
    isWindowsLocked &&
    process.env.DATABASE_PROVIDER === "sqlite" &&
    process.env.NODE_ENV !== "production"
  ) {
    console.warn(
      "⚠️ [server:ensure-prisma] 检测到 Prisma 引擎文件被正在运行的开发服务占用（EPERM）。现存 Prisma Client 类型定义完备，继续执行构建流程...",
    );
    process.exit(0);
  }

  console.error(
    "❌ [server:ensure-prisma] Prisma generate 执行失败：\n",
    generateResult.output,
  );
  process.exit(1);
}

process.exit(0);
