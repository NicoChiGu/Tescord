import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Pin the local Vite certificate before Chromium creates multiple contexts.
 * Per-context certificate overrides can repeatedly restart concurrent requests.
 * This exception applies only to this public key, not arbitrary TLS servers.
 */
export function localHttpsCertificateArgument(): string {
  const certificate = new X509Certificate(
    readFileSync(resolve("apps/web/node_modules/.vite/basic-ssl/_cert.pem")),
  );
  if (
    !Number.isFinite(Date.parse(certificate.validTo)) ||
    Date.parse(certificate.validTo) <= Date.now()
  )
    throw new Error(
      "Run pnpm build to prepare a valid local HTTPS certificate before E2E",
    );
  const fingerprint = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  return `--ignore-certificate-errors-spki-list=${fingerprint}`;
}
