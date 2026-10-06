import { tGlobal } from "../i18n/index.js";
import {
  GatewayEvents,
  type Attachment,
  type AttachmentAccessResponse,
  type DownloadProgress,
} from "@tescord/types";
import { API_BASE, resolveServerUrl } from "../config.js";
import { gatewayClient } from "./gateway.js";
import { useAuthStore } from "../stores/useAuthStore.js";

type Access = {
  id: string;
  url: string;
  previewUrl?: string;
  downloadUrl?: string;
  expiresAt: number;
};

type CachedBlob = { blob: Blob; size: number };

const accessCache = new Map<string, Access>();
const accessRequests = new Map<string, Promise<Access>>();
const blobCache = new Map<string, CachedBlob>();
const blobRequests = new Map<string, Promise<Blob>>();
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
let cachedBytes = 0;
let activeUserId: string | undefined;
let cacheGeneration = 0;

function clearCache() {
  cacheGeneration++;
  accessCache.clear();
  blobCache.clear();
  cachedBytes = 0;
}

useAuthStore.subscribe((state) => {
  const nextId = state.user?.id;
  if (nextId !== activeUserId || !state.isAuthenticated) clearCache();
  activeUserId = nextId;
});

for (const event of [
  GatewayEvents.GUILD_MEMBER_REMOVE,
  GatewayEvents.GUILD_MEMBER_UPDATE,
  GatewayEvents.GUILD_DELETE,
  GatewayEvents.GUILD_ROLE_UPDATE,
  GatewayEvents.GUILD_ROLE_DELETE,
  GatewayEvents.GUILD_BAN_ADD,
  GatewayEvents.CHANNEL_UPDATE,
  GatewayEvents.CHANNEL_DELETE,
  GatewayEvents.DM_CHANNEL_DELETE,
  GatewayEvents.ACCOUNT_SESSION_REVOKED,
]) {
  gatewayClient.on(event, clearCache);
}

function cacheKey(attachment: Attachment, variant: "preview" | "original") {
  const userId = useAuthStore.getState().user?.id || "guest";
  return `${API_BASE}|${userId}|${attachment.id}|${variant}`;
}

function rememberBlob(key: string, blob: Blob) {
  if (blob.size > MAX_CACHE_BYTES) return;
  const previous = blobCache.get(key);
  if (previous) cachedBytes -= previous.size;
  blobCache.delete(key);
  blobCache.set(key, { blob, size: blob.size });
  cachedBytes += blob.size;
  while (cachedBytes > MAX_CACHE_BYTES) {
    const oldest = blobCache.keys().next().value;
    if (!oldest) break;
    cachedBytes -= blobCache.get(oldest)!.size;
    blobCache.delete(oldest);
  }
}

function readBlob(key: string): Blob | undefined {
  const entry = blobCache.get(key);
  if (!entry) return undefined;
  blobCache.delete(key);
  blobCache.set(key, entry);
  return entry.blob;
}

async function accessFetch(attachment: Attachment): Promise<Access> {
  const expectedUserId = useAuthStore.getState().user?.id;
  const generation = cacheGeneration;
  const execute = () =>
    fetch(`${API_BASE}/api/attachments/access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...useAuthStore.getState().getAuthHeaders(),
      },
      body: JSON.stringify({ attachmentIds: [attachment.id] }),
    });
  let response = await execute();
  if (
    response.status === 401 &&
    (await useAuthStore.getState().refreshAuth())
  ) {
    response = await execute();
  }
  if (!response.ok) {
    throw new Error(
      response.status === 403 || response.status === 404
        ? tGlobal("errors:FORBIDDEN")
        : tGlobal("chat:lightbox.loadFailed"),
    );
  }
  const data = (await response.json()) as { attachments: Access[] };
  const access = data.attachments.find((item) => item.id === attachment.id);
  if (!access) throw new Error(tGlobal("errors:NOT_FOUND"));
  if (
    useAuthStore.getState().user?.id !== expectedUserId ||
    generation !== cacheGeneration
  ) {
    throw new Error(tGlobal("errors:UNAUTHORIZED"));
  }
  accessCache.set(cacheKey(attachment, "original"), access);
  return access;
}

export async function getAttachmentAccess(
  attachment: Attachment,
  force = false,
): Promise<Access> {
  const isUrlId =
    typeof attachment.id === "string" &&
    (attachment.id.startsWith("http://") ||
      attachment.id.startsWith("https://") ||
      attachment.id.includes("/attachments/"));
  if (isUrlId) {
    return getUrlAccess(attachment.url || attachment.id, force);
  }

  const key = cacheKey(attachment, "original");
  if (!force) {
    const cached = accessCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  }
  const pending = accessRequests.get(key);
  if (pending) return pending;
  const request = accessFetch(attachment).finally(() =>
    accessRequests.delete(key),
  );
  accessRequests.set(key, request);
  return request;
}

export async function getUrlAccess(
  fileUrl: string,
  force = false,
): Promise<Access> {
  const userId = useAuthStore.getState().user?.id || "guest";
  const key = `${API_BASE}|${userId}|url:${fileUrl}|original`;
  if (!force) {
    const cached = accessCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  }
  const pending = accessRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const expectedUserId = useAuthStore.getState().user?.id;
    const generation = cacheGeneration;
    const execute = () =>
      fetch(`${API_BASE}/api/attachments/access`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...useAuthStore.getState().getAuthHeaders(),
        },
        body: JSON.stringify({ fileUrls: [fileUrl] }),
      });
    let response = await execute();
    if (
      response.status === 401 &&
      (await useAuthStore.getState().refreshAuth())
    ) {
      response = await execute();
    }
    if (!response.ok) {
      throw new Error(
        response.status === 403 || response.status === 404
          ? tGlobal("errors:FORBIDDEN")
          : tGlobal("chat:lightbox.loadFailed"),
      );
    }
    const data = (await response.json()) as AttachmentAccessResponse;
    const accessItem = data.fileUrls?.find((item) => item.fileUrl === fileUrl);
    if (!accessItem) throw new Error(tGlobal("errors:NOT_FOUND"));
    if (
      useAuthStore.getState().user?.id !== expectedUserId ||
      generation !== cacheGeneration
    ) {
      throw new Error(tGlobal("errors:UNAUTHORIZED"));
    }
    const access: Access = {
      id: fileUrl,
      url: accessItem.url,
      previewUrl: accessItem.previewUrl,
      downloadUrl: accessItem.downloadUrl,
      expiresAt: accessItem.expiresAt,
    };
    accessCache.set(key, access);
    return access;
  })().finally(() => accessRequests.delete(key));

  accessRequests.set(key, request);
  return request;
}

export async function loadMediaBlob(
  target: Attachment | string,
  variant: "preview" | "original" = "preview",
  signal?: AbortSignal,
  onRenewing?: () => void,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Blob> {
  const isAttachmentObj = typeof target !== "string";
  const userId = useAuthStore.getState().user?.id || "guest";
  const key = isAttachmentObj
    ? cacheKey(target, variant)
    : `${API_BASE}|${userId}|url:${target}|${variant}`;

  const pending = signal ? undefined : blobRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    const generation = cacheGeneration;
    let access = isAttachmentObj
      ? await getAttachmentAccess(target)
      : await getUrlAccess(target);

    if (signal?.aborted)
      throw new DOMException("Request aborted", "AbortError");
    const cached = readBlob(key);
    if (cached) {
      onProgress?.({ loaded: cached.size, total: cached.size, phase: "ready" });
      return cached;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const targetUrl =
        variant === "preview" ? access.previewUrl || access.url : access.url;
      const response = await fetch(resolveServerUrl(targetUrl), { signal });
      if (response.ok) {
        const sizeHeader = Number(response.headers.get("content-length"));
        const total =
          sizeHeader > 0 && !response.headers.get("content-encoding")
            ? sizeHeader
            : undefined;
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let loaded = 0;
        onProgress?.({ loaded, total, phase: "downloading" });
        let blob: Blob;
        if (response.body && onProgress) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (signal?.aborted || generation !== cacheGeneration) {
                await reader.cancel();
                throw new DOMException("Request aborted", "AbortError");
              }
              if (done) break;
              chunks.push(new Uint8Array(value));
              loaded += value.byteLength;
              onProgress({ loaded, total, phase: "downloading" });
            }
          } finally {
            reader.releaseLock();
          }
          blob = new Blob(chunks, {
            type:
              response.headers.get("content-type") ||
              "application/octet-stream",
          });
        } else {
          blob = await response.blob();
        }
        if (signal?.aborted)
          throw new DOMException("Request aborted", "AbortError");
        if (generation !== cacheGeneration)
          throw new Error(tGlobal("errors:FORBIDDEN"));
        rememberBlob(key, blob);
        onProgress?.({ loaded: blob.size, total: blob.size, phase: "ready" });
        return blob;
      }
      if (
        attempt === 0 &&
        (response.status === 401 || response.status === 403)
      ) {
        onRenewing?.();
        access = isAttachmentObj
          ? await getAttachmentAccess(target, true)
          : await getUrlAccess(target, true);
        continue;
      }
      throw new Error(
        response.status === 403
          ? tGlobal("errors:FORBIDDEN")
          : tGlobal("chat:lightbox.loadFailed"),
      );
    }
    throw new Error(tGlobal("chat:lightbox.loadFailed"));
  })().finally(() => {
    if (!signal) blobRequests.delete(key);
  });
  if (!signal) blobRequests.set(key, request);
  return request;
}

export async function loadAttachmentBlob(
  attachment: Attachment,
  variant: "preview" | "original",
  signal?: AbortSignal,
  onRenewing?: () => void,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Blob> {
  return loadMediaBlob(attachment, variant, signal, onRenewing, onProgress);
}

export async function openAttachmentDownload(attachment: Attachment) {
  const access = await getAttachmentAccess(attachment, true);
  const link = document.createElement("a");
  link.href = resolveServerUrl(access.downloadUrl || access.url);
  link.download = attachment.fileName;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Discard a resource rejected by its decoder so retry performs a fresh fetch. */
export function discardAttachmentBlob(
  attachment: Attachment,
  variant: "preview" | "original",
) {
  const key = cacheKey(attachment, variant);
  const cached = blobCache.get(key);
  if (cached) {
    cachedBytes -= cached.size;
    blobCache.delete(key);
  }
}

export function clearAttachmentCache() {
  clearCache();
}
