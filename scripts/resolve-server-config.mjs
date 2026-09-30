import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    env[key] = val;
  }
  return env;
}

export function loadJsonFile(jsonPath) {
  if (!fs.existsSync(jsonPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Desktop build configuration must be an object");
  return parsed;
}

function validateUrl(value, protocols, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (
    !protocols.includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      `${field} has an unsupported protocol, credentials, query or fragment`,
    );
  return parsed.href.replace(/\/+$/, "");
}

export function deriveGatewayUrl(serverUrl) {
  const normalized = validateUrl(serverUrl, ["http:", "https:"], "serverUrl");
  if (!normalized) return "";
  const parsed = new URL(normalized);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/gateway`;
  return parsed.href;
}

/** Resolve each field independently; malformed configuration fails the build. */
export function resolveServerConfig(options = {}) {
  const rootDir = options.rootDir || defaultRootDir;
  const desktopDir =
    options.desktopDir || path.resolve(rootDir, "apps/desktop");
  const processEnv = options.env || process.env;
  const desktopConfig = loadJsonFile(
    path.resolve(desktopDir, "desktop.config.json"),
  );
  const desktopEnv = loadEnvFile(path.resolve(desktopDir, ".env"));
  const rootEnv = loadEnvFile(path.resolve(rootDir, ".env"));
  const sources = [
    [processEnv, "process.env"],
    [desktopConfig, "apps/desktop/desktop.config.json"],
    [desktopEnv, "apps/desktop/.env"],
    [rootEnv, "root .env"],
  ];
  const select = (keys) => {
    for (const [values, source] of sources) {
      for (const key of keys) {
        const value = values[key];
        if (value === undefined || value === "") continue;
        if (typeof value !== "string")
          throw new Error(`${key} must be a string`);
        if (value.trim()) return { value, source: `${source}.${key}` };
      }
    }
    return { value: "", source: "default (http://localhost:3001)" };
  };
  const server = select([
    "TESCORD_SERVER_URL",
    "VITE_API_URL",
    "serverUrl",
    "apiUrl",
  ]);
  const gateway = select([
    "TESCORD_GATEWAY_URL",
    "VITE_GATEWAY_URL",
    "gatewayUrl",
  ]);
  const livekit = select([
    "TESCORD_LIVEKIT_URL",
    "VITE_LIVEKIT_URL",
    "livekitUrl",
  ]);
  const voice = select(["VITE_VOICE_ENGINE", "voiceEngine"]);
  const voiceEngine = voice.value || "livekit";
  if (voiceEngine !== "livekit" && voiceEngine !== "cloudflare_realtime")
    throw new Error("voiceEngine must be livekit or cloudflare_realtime");
  const serverUrl = validateUrl(server.value, ["http:", "https:"], "serverUrl");
  const gatewayUrl =
    validateUrl(gateway.value, ["ws:", "wss:"], "gatewayUrl") ||
    deriveGatewayUrl(serverUrl);
  const livekitUrl = validateUrl(livekit.value, ["ws:", "wss:"], "livekitUrl");
  return {
    serverUrl,
    gatewayUrl,
    livekitUrl,
    voiceEngine,
    source: server.source,
  };
}
