export async function fetchVerifiedAsset(
  url: URL,
  expectedSha256: string,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model asset unavailable: ${url.pathname}`);
  const bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== expectedSha256)
    throw new Error(`Model asset checksum mismatch: ${url.pathname}`);
  return bytes;
}
