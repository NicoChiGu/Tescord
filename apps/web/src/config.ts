// 环境与服务端连接地址配置 (支持 Web 代理与 Electron 本地 file:// 协议)
export const isFileProtocol =
  typeof window !== "undefined" && window.location.protocol === "file:";

// API 基础路径：支持环境变量注入 -> Electron file:// 回退 -> 浏览器同源相对路径 (经 Vite 代理)
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (isFileProtocol ? "http://localhost:3001" : "");

// WebSocket Gateway 地址
export const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL ||
  (isFileProtocol
    ? "ws://localhost:3001/gateway"
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host || "localhost:3000"}/gateway`);

/**
 * 智能自愈服务端静态文件/上传链接：
 * 若在非 Electron 浏览器环境下收到形如 http://localhost:3001/... 的地址，
 * 自动剥离协议与主机前缀转为相对路径，使得局域网设备通过 Vite 代理 (/uploads, /api) 同源加载与直传，
 * 避免局域网外部设备向自身 localhost 发起无效请求。
 */
export function resolveServerUrl(url: string | undefined | null): string {
  if (!url) return "";
  if (isFileProtocol) return url;

  // 如果是本地开发后端地址 (localhost:3001 或 127.0.0.1:3001)，转为相对路径走 Vite 代理
  const localBackendRegex =
    /^https?:\/\/(localhost|127\.0\.0\.1):3001(\/.*)?$/i;
  const match = url.match(localBackendRegex);
  if (match) {
    return match[2] || "/";
  }

  // 如果是 MinIO (localhost:9000 或 127.0.0.1:9000)，转为 /minio 相对路径走 Vite 代理，杜绝 HTTPS 混合内容与跨域错误
  const minioRegex = /^https?:\/\/(localhost|127\.0\.0\.1):9000(\/.*)?$/i;
  const minioMatch = url.match(minioRegex);
  if (minioMatch) {
    return `/minio${minioMatch[2] || "/"}`;
  }

  // 如果是外部设备在局域网下访问其他宿主机 MinIO
  if (typeof window !== "undefined" && window.location.hostname) {
    const currentHost = window.location.hostname;
    if (currentHost !== "localhost" && currentHost !== "127.0.0.1") {
      return url.replace(
        /\/\/(localhost|127\.0\.0\.1):9000/i,
        `//${currentHost}:9000`,
      );
    }
  }

  return url;
}

/**
 * 智能自愈 LiveKit SFU 媒体服务地址：
 * 1. 优先支持环境变量 VITE_LIVEKIT_URL；
 * 2. 如果页面运行在 HTTPS 下，由于现代浏览器 Mixed Content 策略阻止 ws:// 明文连接，
 *    自动映射为当前宿主机的 wss://${window.location.host}，由 Vite 开发代理透传 /rtc 与 /twirp；
 * 3. 如果运行在普通局域网 HTTP 下且目标为 localhost，则自动替换为当前访问的宿主机 IP。
 */
export function resolveLiveKitUrl(rawUrl: string | undefined | null): string {
  if (import.meta.env.VITE_LIVEKIT_URL) {
    return import.meta.env.VITE_LIVEKIT_URL;
  }
  if (!rawUrl) return "ws://localhost:7880";
  if (isFileProtocol) return rawUrl;

  if (typeof window !== "undefined" && window.location) {
    const isHttps = window.location.protocol === "https:";
    const host = window.location.host;
    const hostname = window.location.hostname;

    // 当页面为 HTTPS 时，将 localhost:7880 映射至 Vite 开发代理的同源 WSS 信令端口
    if (isHttps) {
      if (/localhost:7880|127\.0\.0\.1:7880/i.test(rawUrl)) {
        return `wss://${host}`;
      }
      // 如果是非 localhost 且为 ws:，升级为 wss: 避免混合内容拦截
      if (rawUrl.startsWith("ws://")) {
        return rawUrl.replace(/^ws:\/\//, "wss://");
      }
    }

    // 普通 HTTP 局域网访问模式：将 localhost/127.0.0.1 替换为实际宿主机 IP
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return rawUrl.replace(/\/\/(localhost|127\.0\.0\.1):/i, `//${hostname}:`);
    }
  }

  return rawUrl;
}
