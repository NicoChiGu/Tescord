import type { ICEServerConfigResponse } from "@tescord/types";
import { API_BASE, VOICE_ENGINE } from "../../config.js";
import { useAuthStore } from "../../stores/useAuthStore.js";
import { apiFetch } from "../apiClient.js";

const ICE_CACHE_TTL_MS = 60 * 60 * 1000;
const ICE_FETCH_RETRY_DELAYS_MS = [0, 300, 900] as const;

// Cloudflare Realtime is an explicitly selected deployment mode. Its public
// STUN endpoint is safe as a direct-only fallback when the authenticated TURN
// credential request is temporarily unavailable. Self-hosted LiveKit/Coturn
// deployments deliberately do not gain an implicit third-party dependency.
const CLOUDFLARE_STUN_FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

let cachedIceServers: RTCIceServer[] = [];
let cachedAt = 0;
let inFlightRequest: Promise<RTCIceServer[]> | null = null;

const cloneIceServers = (servers: RTCIceServer[]): RTCIceServer[] =>
  servers.map((server) => ({
    ...server,
    urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
  }));

const isValidIceServer = (server: RTCIceServer): boolean => {
  if (!server || !server.urls) return false;
  if (typeof server.urls === "string") return server.urls.length > 0;
  return (
    Array.isArray(server.urls) && server.urls.some((url) => url.length > 0)
  );
};

const getConfiguredFallback = (): RTCIceServer[] =>
  VOICE_ENGINE === "cloudflare_realtime"
    ? cloneIceServers(CLOUDFLARE_STUN_FALLBACK)
    : [];

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

async function requestIceServers(): Promise<RTCIceServer[]> {
  let lastStatus: number | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < ICE_FETCH_RETRY_DELAYS_MS.length; attempt++) {
    const delayMs = ICE_FETCH_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) await wait(delayMs);

    try {
      const token =
        useAuthStore.getState().token ||
        sessionStorage.getItem("tescord_access_token") ||
        localStorage.getItem("tescord_access_token");
      const response = await apiFetch(`${API_BASE}/api/network/ice-servers`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      lastStatus = response.status;
      if (!response.ok) continue;

      const data = (await response.json()) as ICEServerConfigResponse;
      const servers = Array.isArray(data.iceServers)
        ? (data.iceServers as RTCIceServer[]).filter(isValidIceServer)
        : [];
      if (servers.length === 0) {
        lastError = new Error("ICE server API returned an empty configuration");
        continue;
      }

      cachedIceServers = cloneIceServers(servers);
      cachedAt = Date.now();
      return cloneIceServers(cachedIceServers);
    } catch (error) {
      lastError = error;
    }
  }

  if (cachedIceServers.length > 0) {
    console.warn(
      "[P2P ICE] Failed to refresh ICE configuration; reusing the last valid cache",
      { status: lastStatus, error: lastError },
    );
    return cloneIceServers(cachedIceServers);
  }

  const fallback = getConfiguredFallback();
  console.warn(
    fallback.length > 0
      ? "[P2P ICE] ICE API unavailable; using Cloudflare STUN direct-only fallback"
      : "[P2P ICE] ICE API unavailable and no deployment fallback is configured",
    { status: lastStatus, error: lastError },
  );
  return fallback;
}

export async function getP2PIceServers(
  forceRefresh = false,
): Promise<RTCIceServer[]> {
  if (
    !forceRefresh &&
    cachedIceServers.length > 0 &&
    Date.now() - cachedAt < ICE_CACHE_TTL_MS
  ) {
    return cloneIceServers(cachedIceServers);
  }

  if (!inFlightRequest) {
    inFlightRequest = requestIceServers().finally(() => {
      inFlightRequest = null;
    });
  }
  return cloneIceServers(await inFlightRequest);
}
