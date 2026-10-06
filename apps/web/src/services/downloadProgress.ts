import type { DownloadProgress } from "@tescord/types";

/** Counts response body bytes; compressed Content-Length is not a decoded total. */
export async function readDownload(
  response: Response,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
  stallMs = 30_000,
): Promise<ArrayBuffer> {
  const length = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding");
  const total =
    Number.isSafeInteger(length) &&
    length > 0 &&
    (!encoding || encoding === "identity")
      ? length
      : undefined;
  let loaded = 0;
  let lastReport = 0;
  const emit = (force = false) => {
    if (force || performance.now() - lastReport >= 100) {
      lastReport = performance.now();
      onProgress?.({
        loaded,
        total: total && loaded <= total ? total : undefined,
        phase: "downloading",
      });
    }
  };
  emit(true);
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    signal?.throwIfAborted();
    loaded = bytes.byteLength;
    emit(true);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Download stalled"));
            void reader.cancel().catch(() => {});
          }, stallMs);
        }),
      ]).finally(() => clearTimeout(timer));
      signal?.throwIfAborted();
      if (result.done) break;
      chunks.push(result.value);
      loaded += result.value.byteLength;
      emit();
    }
    emit(true);
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
