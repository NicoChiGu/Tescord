import { GatewayEvents, type Attachment } from "@tescord/types";
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
        ? "没有权限访问此附件"
        : "附件访问凭据获取失败",
    );
  }
  const data = (await response.json()) as { attachments: Access[] };
  const access = data.attachments.find((item) => item.id === attachment.id);
  if (!access) throw new Error("附件已失效或不可访问");
  if (
    useAuthStore.getState().user?.id !== expectedUserId ||
    generation !== cacheGeneration
  ) {
    throw new Error("账号已切换，请重新加载附件");
  }
  accessCache.set(cacheKey(attachment, "original"), access);
  return access;
}

export async function getAttachmentAccess(
  attachment: Attachment,
  force = false,
): Promise<Access> {
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

export async function loadAttachmentBlob(
  attachment: Attachment,
  variant: "preview" | "original",
  signal?: AbortSignal,
): Promise<Blob> {
  const key = cacheKey(attachment, variant);
  const pending = signal ? undefined : blobRequests.get(key);
  if (pending) return pending;
  const request = (async () => {
    const generation = cacheGeneration;
    let access = await getAttachmentAccess(attachment);
    if (signal?.aborted)
      throw new DOMException("Request aborted", "AbortError");
    const cached = readBlob(key);
    if (cached) return cached;
    for (let attempt = 0; attempt < 2; attempt++) {
      const target =
        variant === "preview" ? access.previewUrl || access.url : access.url;
      const response = await fetch(resolveServerUrl(target), { signal });
      if (response.ok) {
        const blob = await response.blob();
        if (signal?.aborted)
          throw new DOMException("Request aborted", "AbortError");
        if (generation !== cacheGeneration)
          throw new Error("附件权限已变更，请重新加载");
        rememberBlob(key, blob);
        return blob;
      }
      if (
        attempt === 0 &&
        (response.status === 401 || response.status === 403)
      ) {
        access = await getAttachmentAccess(attachment, true);
        continue;
      }
      throw new Error(
        response.status === 403 ? "附件授权已失效" : "附件加载失败",
      );
    }
    throw new Error("附件加载失败");
  })().finally(() => {
    if (!signal) blobRequests.delete(key);
  });
  if (!signal) blobRequests.set(key, request);
  return request;
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

export function clearAttachmentCache() {
  clearCache();
}
