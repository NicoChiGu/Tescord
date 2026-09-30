import assert from "node:assert/strict";
import path from "node:path";
import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type { UpdateManifest } from "@tescord/types";
import {
  compareUpdateVersions,
  isValidUpdateVersion,
  validateUpdateArchive,
  getUpdateReleaseTag,
  isUpdateHostSupported,
} from "../apps/desktop/src/updater/archive-security.js";

const staging = path.resolve("test-updater-staging-validation");
const makeArchive = (...names: string[]) => {
  const zip = new AdmZip();
  for (const name of names) zip.addFile(name, Buffer.from("test"));
  return zip;
};

const valid = makeArchive("index.html", "assets/app.js");
assert.equal(validateUpdateArchive(valid, staging).length, 2);

const rejectName = (name: string) => {
  const zip = makeArchive("index.html", "asset.bin");
  zip.getEntries()[1].entryName = name;
  assert.throws(() => validateUpdateArchive(zip, staging));
};
for (const name of [
  "../escape",
  "/absolute",
  "C:/drive",
  "a\\escape",
  "CON",
  "a/../index.html",
  "a//b",
  "file.txt:stream",
]) {
  rejectName(name);
}

const symlink = makeArchive("index.html", "link");
symlink.getEntries()[1].header.attr = (0o120777 * 65536) >>> 0;
assert.throws(() => validateUpdateArchive(symlink, staging), /symlink/);
assert.throws(
  () => validateUpdateArchive(makeArchive("asset.js"), staging),
  /index.html/,
);
const duplicate = makeArchive("index.html", "one");
duplicate.getEntries()[1].entryName = "INDEX.HTML";
assert.throws(() => validateUpdateArchive(duplicate, staging), /Duplicate/);
const oversized = makeArchive("index.html");
oversized.getEntries()[0].header.size = 251 * 1024 * 1024;
assert.throws(() => validateUpdateArchive(oversized, staging), /too large/);

assert.equal(compareUpdateVersions("1.10.0", "1.9.9"), 1);
assert.equal(compareUpdateVersions("1.10.0-beta.2", "1.10.0-beta.11"), -1);
assert.equal(compareUpdateVersions("1.10.0", "1.10.0-beta.11"), 1);
assert.equal(isValidUpdateVersion("1.10.0-beta.2"), true);
assert.equal(isValidUpdateVersion("1.10.0-.."), false);
assert.equal(isValidUpdateVersion("01.10.0"), false);
assert.equal(isValidUpdateVersion("1.10.0-beta.01"), false);

assert.equal(
  getUpdateReleaseTag({ version: "0.3.0", releaseTag: "0.3.0" }),
  "0.3.0",
);
assert.equal(
  getUpdateReleaseTag({ version: "0.3.0", releaseTag: "v0.3.0" }),
  "v0.3.0",
);
assert.equal(getUpdateReleaseTag({ version: "0.3.0" }), "v0.3.0");
for (const releaseTag of [
  "v0.2.0",
  "0.3.0/../escape",
  "../0.3.0",
  "V0.3.0",
  "",
  "0.3.0?token=1",
]) {
  assert.throws(() => getUpdateReleaseTag({ version: "0.3.0", releaseTag }));
}
assert.equal(isUpdateHostSupported("0.2.9", "0.3.0"), false);
assert.equal(isUpdateHostSupported("0.3.0", "0.3.0"), true);
assert.equal(isUpdateHostSupported("0.3.0-beta.1", "0.3.0"), false);

// Execute the actual manager with Electron/network adapters replaced, using
// isolated update directories. No native build or active bundle is modified.
const updateRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "tescord-updater-policy-"),
);
const sourcePath = path.resolve(
  __dirname,
  "../apps/desktop/src/updater/update-manager.ts",
);
const source = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const nativeRequire = createRequire(
  path.join(__dirname, "test-updater-archive.ts"),
);
const zip = makeArchive("index.html", "assets/app.js").toBuffer();
const signedManifest: UpdateManifest = {
  version: "0.3.0",
  releaseDate: new Date().toISOString(),
  minHostVersion: "0.3.0",
  releaseTag: "0.3.0",
  webPackageUrl: "tescord-web-v0.3.0.zip",
  webPackageSha256: crypto.createHash("sha256").update(zip).digest("hex"),
};
const exerciseManager = async (
  hostVersion: string,
  releaseTag: string | undefined,
  changeHostAfterDownload = false,
) => {
  const profile = fs.mkdtempSync(path.join(updateRoot, "profile-"));
  const updates = path.join(profile, "updates");
  fs.mkdirSync(updates);
  const installedRecord = path.join(updates, "current-version.json");
  const installedEntry = path.join(updates, "installed.html");
  fs.writeFileSync(installedRecord, "installed-record-sentinel");
  fs.writeFileSync(installedEntry, "installed-entry-sentinel");
  const calls: string[] = [];
  let currentHost = hostVersion;
  const exports: Record<string, unknown> = {};
  const fakeRequire = (specifier: string): unknown => {
    if (specifier === "electron")
      return {
        app: {
          getPath: () => profile,
          getVersion: () => currentHost,
          isPackaged: false,
        },
        BrowserWindow: { getAllWindows: () => [] },
      };
    if (specifier === "../build-config.js")
      return { BUILD_CONFIG: { REPO_FULL_NAME: "owner/repo" } };
    if (specifier === "./archive-security.js")
      return {
        compareUpdateVersions,
        isValidUpdateVersion,
        validateUpdateArchive,
        getUpdateReleaseTag,
        isUpdateHostSupported,
      };
    if (specifier === "./proxy-manager.js")
      return {
        ProxyManager: {
          getInstance: () => ({
            fetchWithFallback: async (url: string) => {
              calls.push(url);
              if (changeHostAfterDownload) currentHost = "0.2.0";
              return { data: zip };
            },
          }),
        },
      };
    return nativeRequire(specifier);
  };
  vm.runInNewContext(source, {
    exports,
    require: fakeRequire,
    __dirname: path.dirname(sourcePath),
    console,
    Buffer,
    process,
  });
  const Manager = exports.UpdateManager as {
    getInstance(): {
      latestManifest: UpdateManifest;
      downloadAndApplyWebUpdate(): Promise<{ success: boolean }>;
    };
  };
  const manager = Manager.getInstance();
  manager.latestManifest = { ...signedManifest, releaseTag };
  const result = await manager.downloadAndApplyWebUpdate();
  assert.equal(
    fs.readFileSync(installedEntry, "utf8"),
    "installed-entry-sentinel",
  );
  if (!result.success)
    assert.equal(
      fs.readFileSync(installedRecord, "utf8"),
      "installed-record-sentinel",
    );
  return { result, calls };
};
async function verifyManagerPolicy(): Promise<void> {
  try {
    const oldHost = await exerciseManager("0.2.0", "0.3.0");
    assert.equal(oldHost.result.success, false);
    assert.equal(
      oldHost.calls.length,
      0,
      "old host must refuse before network or filesystem activation",
    );
    const numeric = await exerciseManager("0.3.0", "0.3.0");
    assert.equal(numeric.result.success, true);
    assert.equal(
      numeric.calls[0],
      "https://github.com/owner/repo/releases/download/0.3.0/tescord-web-v0.3.0.zip",
    );
    const prefixed = await exerciseManager("0.3.0", "v0.3.0");
    assert.equal(prefixed.result.success, true);
    assert.equal(
      prefixed.calls[0],
      "https://github.com/owner/repo/releases/download/v0.3.0/tescord-web-v0.3.0.zip",
    );
    const legacy = await exerciseManager("0.3.0", undefined);
    assert.equal(legacy.result.success, true);
    assert.equal(legacy.calls[0], prefixed.calls[0]);
    const changedHost = await exerciseManager("0.3.0", "0.3.0", true);
    assert.equal(
      changedHost.result.success,
      false,
      "activation must recheck the native boundary",
    );
  } finally {
    fs.rmSync(updateRoot, { recursive: true, force: true });
  }

  console.log(
    "PASS updater archive and release policy: safe paths, versions, numeric/v/legacy tags, old-host download refusal, activation refusal and installed-data preservation",
  );
}
verifyManagerPolicy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
