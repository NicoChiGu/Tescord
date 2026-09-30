import path from "node:path";
import AdmZip from "adm-zip";
import type { UpdateManifest } from "@tescord/types";

export function getUpdateReleaseTag(
  manifest: Pick<UpdateManifest, "version" | "releaseTag">,
): string {
  if (
    typeof manifest.version !== "string" ||
    !isValidUpdateVersion(manifest.version)
  )
    throw new Error("Invalid update version");
  const releaseTag =
    manifest.releaseTag === undefined
      ? `v${manifest.version}`
      : manifest.releaseTag;
  if (releaseTag !== manifest.version && releaseTag !== `v${manifest.version}`)
    throw new Error("Invalid signed release tag");
  return releaseTag;
}

export function isUpdateHostSupported(
  hostVersion: string,
  minHostVersion: string,
): boolean {
  if (
    !isValidUpdateVersion(hostVersion) ||
    !isValidUpdateVersion(minHostVersion)
  )
    throw new Error("Invalid update host version");
  return compareUpdateVersions(hostVersion, minHostVersion) >= 0;
}

export interface ValidatedUpdateEntry {
  entry: AdmZip.IZipEntry;
  outputPath: string;
}

export function isValidUpdateVersion(version: string): boolean {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (
    !match ||
    !match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part)))
  )
    return false;
  return !match[4]
    ?.split(".")
    .some(
      (part) =>
        /^\d+$/.test(part) &&
        (!/^(0|[1-9]\d*)$/.test(part) || !Number.isSafeInteger(Number(part))),
    );
}

export function compareUpdateVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, "").trim();
  const clean2 = v2.replace(/^v/i, "").trim();
  const [core1, ...pre1Parts] = clean1.split("-");
  const [core2, ...pre2Parts] = clean2.split("-");
  const pre1 = pre1Parts.join("-");
  const pre2 = pre2Parts.join("-");
  const parts1 = core1.split(".").map(Number);
  const parts2 = core2.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  if (!pre1 && pre2) return 1;
  if (pre1 && !pre2) return -1;
  if (!pre1 || !pre2) return 0;
  const identifiers1 = pre1.split(".");
  const identifiers2 = pre2.split(".");
  for (let i = 0; i < Math.max(identifiers1.length, identifiers2.length); i++) {
    const left = identifiers1[i];
    const right = identifiers2[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) {
      const difference = Number(left) - Number(right);
      if (difference) return Math.sign(difference);
    } else if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    } else {
      const difference = left.localeCompare(right);
      if (difference) return Math.sign(difference);
    }
  }
  return 0;
}

export function validateUpdateArchive(
  zip: AdmZip,
  stagingDir: string,
): ValidatedUpdateEntry[] {
  const entries = zip.getEntries();
  if (entries.length === 0 || entries.length > 5000)
    throw new Error("Invalid update entry count");
  const seen = new Set<string>();
  const validated: ValidatedUpdateEntry[] = [];
  let totalSize = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    const parts = name.replace(/\/$/, "").split("/");
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      /[\x00-\x1f:]/.test(name) ||
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.[^/]*)?$/i.test(part),
      )
    ) {
      throw new Error("Unsafe update archive entry");
    }
    if (((entry.header.attr >>> 16) & 0o170000) === 0o120000) {
      throw new Error("Update archive contains a symlink");
    }
    if (!Number.isSafeInteger(entry.header.size) || entry.header.size < 0) {
      throw new Error("Invalid update entry size");
    }
    totalSize += entry.header.size;
    if (totalSize > 250 * 1024 * 1024)
      throw new Error("Update archive is too large");
    const key = parts.join("/").toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate update archive path");
    seen.add(key);
    const outputPath = path.resolve(stagingDir, ...parts);
    if (!outputPath.startsWith(`${path.resolve(stagingDir)}${path.sep}`)) {
      throw new Error("Unsafe update archive path");
    }
    validated.push({ entry, outputPath });
  }
  if (
    !validated.some(
      ({ entry }) => !entry.isDirectory && entry.entryName === "index.html",
    )
  ) {
    throw new Error("Update archive has no index.html");
  }
  return validated;
}
