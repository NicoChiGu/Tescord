import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, "..");

export function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        env[key] = val;
      }
    }
    return env;
  } catch (err) {
    console.warn(
      `[ResolveServerConfig] 读取 env 文件异常 ${envPath}:`,
      err.message,
    );
    return {};
  }
}

export function loadJsonFile(jsonPath) {
  if (!fs.existsSync(jsonPath)) return {};
  try {
    const content = fs.readFileSync(jsonPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.warn(
      `[ResolveServerConfig] 解析 JSON 文件异常 ${jsonPath}:`,
      err.message,
    );
    return {};
  }
}

/**
 * 将 HTTP/HTTPS 服务端基础地址推导为对应的 WebSocket Gateway 地址
 * @param {string} serverUrl
 * @returns {string}
 */
export function deriveGatewayUrl(serverUrl) {
  if (!serverUrl) return "";
  try {
    const parsed = new URL(serverUrl);
    const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    const basePath = parsed.pathname.replace(/\/+$/, "");
    return `${wsProtocol}//${parsed.host}${basePath}/gateway`;
  } catch {
    const wsPrefix = serverUrl.startsWith("https://") ? "wss://" : "ws://";
    const cleaned = serverUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `${wsPrefix}${cleaned}/gateway`;
  }
}

/**
 * 统一解析桌面端编译期配置的服务器地址
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {string} [options.desktopDir]
 * @returns {{
 *   serverUrl: string,
 *   gatewayUrl: string,
 *   livekitUrl: string,
 *   source: string
 * }}
 */
export function resolveServerConfig(options = {}) {
  const rootDir = options.rootDir || defaultRootDir;
  const desktopDir =
    options.desktopDir || path.resolve(rootDir, "apps/desktop");

  let serverUrl = "";
  let gatewayUrl = "";
  let livekitUrl = "";
  let source = "default (http://localhost:3001)";

  // 1. 命令行/进程环境变量（最高优先级）
  if (process.env.TESCORD_SERVER_URL || process.env.VITE_API_URL) {
    serverUrl = (
      process.env.TESCORD_SERVER_URL || process.env.VITE_API_URL
    ).trim();
    gatewayUrl = (
      process.env.TESCORD_GATEWAY_URL ||
      process.env.VITE_GATEWAY_URL ||
      ""
    ).trim();
    livekitUrl = (
      process.env.TESCORD_LIVEKIT_URL ||
      process.env.VITE_LIVEKIT_URL ||
      ""
    ).trim();
    source = process.env.TESCORD_SERVER_URL
      ? "process.env.TESCORD_SERVER_URL"
      : "process.env.VITE_API_URL";
  }

  // 2. 检查 apps/desktop/desktop.config.json
  if (!serverUrl) {
    const desktopConfigPath = path.resolve(desktopDir, "desktop.config.json");
    const desktopConfig = loadJsonFile(desktopConfigPath);
    if (desktopConfig.serverUrl || desktopConfig.apiUrl) {
      serverUrl = (desktopConfig.serverUrl || desktopConfig.apiUrl).trim();
      gatewayUrl = (desktopConfig.gatewayUrl || "").trim();
      livekitUrl = (desktopConfig.livekitUrl || "").trim();
      source = "apps/desktop/desktop.config.json";
    }
  }

  // 3. 检查 apps/desktop/.env
  if (!serverUrl) {
    const desktopEnvPath = path.resolve(desktopDir, ".env");
    const desktopEnv = loadEnvFile(desktopEnvPath);
    if (desktopEnv.TESCORD_SERVER_URL || desktopEnv.VITE_API_URL) {
      serverUrl = (
        desktopEnv.TESCORD_SERVER_URL || desktopEnv.VITE_API_URL
      ).trim();
      gatewayUrl = (
        desktopEnv.TESCORD_GATEWAY_URL ||
        desktopEnv.VITE_GATEWAY_URL ||
        ""
      ).trim();
      livekitUrl = (
        desktopEnv.TESCORD_LIVEKIT_URL ||
        desktopEnv.VITE_LIVEKIT_URL ||
        ""
      ).trim();
      source = "apps/desktop/.env";
    }
  }

  // 4. 检查根目录 .env
  if (!serverUrl) {
    const rootEnvPath = path.resolve(rootDir, ".env");
    const rootEnv = loadEnvFile(rootEnvPath);
    if (rootEnv.TESCORD_SERVER_URL || rootEnv.VITE_API_URL) {
      serverUrl = (rootEnv.TESCORD_SERVER_URL || rootEnv.VITE_API_URL).trim();
      gatewayUrl = (
        rootEnv.TESCORD_GATEWAY_URL ||
        rootEnv.VITE_GATEWAY_URL ||
        ""
      ).trim();
      livekitUrl = (
        rootEnv.TESCORD_LIVEKIT_URL ||
        rootEnv.VITE_LIVEKIT_URL ||
        ""
      ).trim();
      source = "根目录 .env";
    }
  }

  // 规范化处理
  if (serverUrl) {
    serverUrl = serverUrl.replace(/\/+$/, "");
    if (!gatewayUrl) {
      gatewayUrl = deriveGatewayUrl(serverUrl);
    } else {
      gatewayUrl = gatewayUrl.replace(/\/+$/, "");
    }
  }

  return {
    serverUrl,
    gatewayUrl,
    livekitUrl,
    source,
  };
}
