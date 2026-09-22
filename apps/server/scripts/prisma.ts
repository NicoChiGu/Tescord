import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import "../src/env.js";

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma");
const result = spawnSync(
  process.execPath,
  [prismaCli, ...process.argv.slice(2)],
  {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
