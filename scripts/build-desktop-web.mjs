import { spawnSync } from "node:child_process";
import { resolveServerConfig } from "./resolve-server-config.mjs";

const config = resolveServerConfig();

const extraEnv = {
  BUILD_TARGET: "desktop",
  VITE_VOICE_ENGINE: config.voiceEngine,
};

if (config.serverUrl) {
  console.log(
    `[BuildDesktopWeb] 🎯 注入固化服务器地址: ${config.serverUrl} | 网关: ${config.gatewayUrl} (来源: ${config.source})`,
  );
  extraEnv.VITE_API_URL = config.serverUrl;
} else {
  console.log(
    `[BuildDesktopWeb] ℹ️ 未指定自定义服务器地址，将默认连接本地开发/自宿主服务 (http://localhost:3001)`,
  );
}
if (config.gatewayUrl) extraEnv.VITE_GATEWAY_URL = config.gatewayUrl;
if (config.livekitUrl) extraEnv.VITE_LIVEKIT_URL = config.livekitUrl;
if (config.webUrl || config.serverUrl) extraEnv.VITE_PUBLIC_URL = config.webUrl || config.serverUrl;

const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "turbo", "run", "build", "--filter=@tescord/web..."],
  {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
