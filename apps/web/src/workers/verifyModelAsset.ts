import type { ModelLoadProgress } from "@tescord/types";
import { readDownload } from "../services/downloadProgress.js";

export async function fetchVerifiedAsset(
  url: URL,
  expectedSha256: string,
  onProgress: (progress: ModelLoadProgress) => void = (progress) =>
    self.postMessage({ type: "PROGRESS", progress }),
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const cacheKey = new URL(url);
  cacheKey.searchParams.set("tescord-sha256", expectedSha256);
  let cache: Cache | undefined;
  try {
    cache = await caches.open("tescord-verified-models-v1");
  } catch {
    /* file:// has no CacheStorage */
  }
  signal?.throwIfAborted();
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (!cached)
    onProgress({ asset: url.pathname, loaded: 0, phase: "downloading" });
  const response = cached || (await fetch(url, { signal }));
  if (!response.ok) throw new Error(`Model asset unavailable: ${url.pathname}`);
  const bytes = cached
    ? await response.arrayBuffer()
    : await readDownload(
        response,
        (progress) => onProgress({ ...progress, asset: url.pathname }),
        signal,
      );
  onProgress({
    asset: url.pathname,
    loaded: bytes.byteLength,
    total: bytes.byteLength,
    phase: "verifying",
  });
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== expectedSha256) {
    await cache?.delete(cacheKey);
    throw new Error(`Model asset checksum mismatch: ${url.pathname}`);
  }
  signal?.throwIfAborted();
  await cache
    ?.put(
      cacheKey,
      new Response(bytes, {
        headers: { "content-length": String(bytes.byteLength) },
      }),
    )
    .catch(() => {});
  onProgress({
    asset: url.pathname,
    loaded: bytes.byteLength,
    total: bytes.byteLength,
    phase: "initializing",
  });
  return bytes;
}
