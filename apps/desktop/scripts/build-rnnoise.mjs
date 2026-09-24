import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js");
const electronVersion = require("electron/package.json").version;
const result = spawnSync(process.execPath, [nodeGyp, "rebuild", "--directory",
  path.join(root, "native/rnnoise"), "--runtime=electron", `--target=${electronVersion}`,
  "--dist-url=https://electronjs.org/headers"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
