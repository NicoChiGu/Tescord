import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@tescord/web", "build"],
  {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, BUILD_TARGET: "desktop" },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
