import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import {
  deriveGatewayUrl,
  resolveServerConfig,
} from "./resolve-server-config.mjs";

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tescord-config-"));
const desktopDir = path.join(rootDir, "apps", "desktop");
fs.mkdirSync(desktopDir, { recursive: true });
const configPath = path.join(desktopDir, "desktop.config.json");
const resolve = (env = {}) => resolveServerConfig({ rootDir, desktopDir, env });
let passed = 0;
function check(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}
try {
  check("default configuration", () => assert.equal(resolve().serverUrl, ""));
  check("Cloudflare media engine selection", () =>
    assert.equal(
      resolve({ VITE_VOICE_ENGINE: "cloudflare_realtime" }).voiceEngine,
      "cloudflare_realtime",
    ),
  );
  check("unknown media engine refused", () =>
    assert.throws(() => resolve({ VITE_VOICE_ENGINE: "unknown" })),
  );
  check("gateway protocol and subpath derivation", () =>
    assert.equal(
      deriveGatewayUrl("https://example.test/tescord/"),
      "wss://example.test/tescord/gateway",
    ),
  );
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      serverUrl: "https://config.example.test/",
      livekitUrl: "wss://media.example.test",
    }),
  );
  check("process field overrides retain file server", () => {
    const value = resolve({
      TESCORD_GATEWAY_URL: "wss://gateway.example.test/custom",
    });
    assert.equal(value.serverUrl, "https://config.example.test");
    assert.equal(value.gatewayUrl, "wss://gateway.example.test/custom");
  });
  check("process server wins", () =>
    assert.equal(
      resolve({ TESCORD_SERVER_URL: "https://process.example.test" }).serverUrl,
      "https://process.example.test",
    ),
  );
  check("malformed URL refused", () =>
    assert.throws(() => resolve({ TESCORD_SERVER_URL: "not-a-url" })),
  );
  check("non HTTP server refused", () =>
    assert.throws(() =>
      resolve({ TESCORD_SERVER_URL: "file:///tmp/index.html" }),
    ),
  );
  check("credential URL refused", () =>
    assert.throws(() =>
      resolve({ TESCORD_SERVER_URL: "https://user:secret@example.test" }),
    ),
  );
  check("invalid gateway protocol refused", () =>
    assert.throws(() =>
      resolve({ TESCORD_GATEWAY_URL: "https://gateway.example.test" }),
    ),
  );
  check("query URL refused", () =>
    assert.throws(() =>
      resolve({ TESCORD_SERVER_URL: "https://example.test?token=secret" }),
    ),
  );
  fs.writeFileSync(configPath, JSON.stringify({ serverUrl: 42 }));
  check("incorrect JSON field type refused", () =>
    assert.throws(() => resolve()),
  );
  fs.writeFileSync(configPath, "invalid-json");
  check("malformed JSON fails instead of localhost fallback", () =>
    assert.throws(() => resolve()),
  );
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const compile = (source) =>
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText;
  const dataUrl = (source) =>
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const utils = dataUrl(
    compile(
      fs.readFileSync(path.join(repoRoot, "apps/web/src/utils/url.ts"), "utf8"),
    ),
  );
  const configSource = fs
    .readFileSync(path.join(repoRoot, "apps/web/src/config.ts"), "utf8")
    .replace('"./utils/url.js"', JSON.stringify(utils));
  const originalWindow = globalThis.window;
  try {
    const loadConfig = async (location, env = {}) => {
      globalThis.window = { location: new URL(location) };
      const source = configSource.replaceAll(
        "import.meta.env",
        `(${JSON.stringify(env)})`,
      );
      return import(dataUrl(compile(source) + `\n// ${location}`));
    };
    const fixed = await loadConfig(
      "file:///app/index.html?desktopServer=https%3A%2F%2Fprivate.example.test&desktopGateway=wss%3A%2F%2Fprivate.example.test%2Fgateway&desktopLivekit=&desktopVoiceEngine=cloudflare_realtime",
      {
        VITE_API_URL: "http://localhost:3001",
        VITE_GATEWAY_URL: "ws://localhost:3001/gateway",
        VITE_LIVEKIT_URL: "ws://localhost:7880",
        VITE_VOICE_ENGINE: "livekit",
      },
    );
    check("installed host endpoint survives generic update", () => {
      assert.equal(fixed.API_BASE, "https://private.example.test");
      assert.equal(fixed.GATEWAY_URL, "wss://private.example.test/gateway");
      assert.equal(fixed.VOICE_ENGINE, "cloudflare_realtime");
      assert.equal(
        fixed.resolveLiveKitUrl("wss://dynamic.example.test"),
        "wss://dynamic.example.test",
      );
      assert.equal(
        fixed.resolveServerUrl("/public-assets/logo.png"),
        "https://private.example.test/public-assets/logo.png",
      );
    });
    const browser = await loadConfig(
      "https://app.example.test/?desktopServer=https://untrusted.example.test&desktopVoiceEngine=cloudflare_realtime",
    );
    check("HTTP browser ignores desktop configuration parameters", () => {
      assert.equal(browser.API_BASE, "");
      assert.equal(browser.GATEWAY_URL, "wss://app.example.test/gateway");
      assert.equal(browser.VOICE_ENGINE, "livekit");
    });
    const legacy = await loadConfig("file:///app/legacy.html", {
      VITE_API_URL: "http://127.0.0.1:3101",
      VITE_GATEWAY_URL: "ws://127.0.0.1:3101/gateway",
    });
    check("older host retains compiled configuration", () =>
      assert.equal(legacy.API_BASE, "http://127.0.0.1:3101"),
    );
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
  console.log(`${passed} desktop configuration checks passed`);
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
