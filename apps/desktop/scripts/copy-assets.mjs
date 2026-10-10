import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const copy = (source, destination) =>
  fs.copyFileSync(path.join(root, source), path.join(root, destination));
fs.mkdirSync(path.join(root, "dist/updater"), { recursive: true });
fs.mkdirSync(path.join(root, "dist/audio"), { recursive: true });
fs.mkdirSync(path.join(root, "dist/screenshot"), { recursive: true });
copy("src/updater/splash.html", "dist/updater/splash.html");
copy("src/screenshot/screenshot.html", "dist/screenshot/screenshot.html");
copy("src/audio/native-inference.mjs", "dist/audio/native-inference.mjs");
copy("../../packages/audio-dsp/dtln-core.mjs", "dist/audio/dtln-core.mjs");
copy("../../packages/audio-dsp/dfn3-core.mjs", "dist/audio/dfn3-core.mjs");
copy("native/rnnoise/build/Release/rnnoise.node", "dist/audio/rnnoise.node");
copy("native/rnnoise/COPYING", "dist/audio/RNNOISE-COPYING");
if (process.platform === "win32")
  copy(
    "native/loopback/build/Release/loopback.node",
    "dist/audio/loopback.node",
  );
