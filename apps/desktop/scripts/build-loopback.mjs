import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform !== "win32") process.exit(0);
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [
    require.resolve("node-gyp/bin/node-gyp.js"),
    "rebuild",
    "--directory",
    path.join(root, "native/loopback"),
    "--runtime=electron",
    `--target=${require("electron/package.json").version}`,
    "--dist-url=https://electronjs.org/headers",
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
