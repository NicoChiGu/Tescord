import assert from "node:assert/strict";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  compareUpdateVersions,
  isValidUpdateVersion,
  validateUpdateArchive,
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

console.log(
  "PASS updater archive and version validation: safe paths, symlink, duplicate, missing entry, oversized, semver order",
);
