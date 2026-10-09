import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = `tescord-real-media-${randomUUID()}.sqlite`;
const databasePath = resolve(root, "apps/server/prisma", name);
const cleanupToken = randomUUID();
const output = resolve(
  root,
  "test-results/multiplayer-real",
  name.slice("tescord-real-media-".length, -".sqlite".length),
);
await mkdir(output, { recursive: true });
// The command owns only this fresh UUID database. Never read DATABASE_URL from .env.
let status = 1;
try {
  const args = [
    "exec",
    "playwright",
    "test",
    "--config",
    "playwright.multiplayer-real.config.ts",
    ...process.argv.slice(2),
  ];
  // Run the pnpm JS entry directly on Windows: .cmd + shell loses quoted grep
  // arguments and permits shell interpretation of user-supplied regexes.
  const pnpmEntry = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "node_modules/pnpm/bin/pnpm.mjs"),
  ].find((path) => path && /pnpm\.(mjs|cjs)$/.test(path) && existsSync(path));
  if (process.platform === "win32" && !pnpmEntry)
    throw new Error(
      "Run with pnpm node scripts/run-real-multiplayer.mjs so npm_execpath identifies pnpm",
    );
  const run = async (commandArgs, env = {}) => {
    const child = spawn(
      process.platform === "win32" ? process.execPath : "pnpm",
      process.platform === "win32" ? [pnpmEntry, ...commandArgs] : commandArgs,
      {
        cwd: root,
        env: {
          ...process.env,
          TESCORD_REAL_MEDIA_DATABASE: name,
          TESCORD_REAL_MEDIA_CLEANUP_TOKEN: cleanupToken,
          ...env,
        },
        stdio: "inherit",
      },
    );
    return new Promise((resolveStatus, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolveStatus(code ?? 1));
    });
  };
  const buildStatus = process.argv.includes("--list")
    ? 0
    : await run(
        [
          "--filter",
          "@tescord/web",
          "exec",
          "vite",
          "build",
          "--outDir",
          "build/real-media",
        ],
        { VITE_VOICE_ENGINE: "cloudflare_realtime" },
      );
  status = buildStatus === 0 ? await run(args) : buildStatus;
} finally {
  const cleanup = [];
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const path = databasePath + suffix;
    await rm(path, { force: true });
    cleanup.push(path);
  }
  await writeFile(
    resolve(output, "isolated-database-cleanup.json"),
    JSON.stringify(
      { databasePath, removed: cleanup, exitCode: status },
      null,
      2,
    ),
  );
}
process.exitCode = status;
