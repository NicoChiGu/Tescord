import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
let base = "HEAD";
if (process.env.CI) {
  const branch = process.env.GITHUB_BASE_REF;
  try {
    base = branch ? git("merge-base", `origin/${branch}`, "HEAD") : "HEAD^";
  } catch {
    base = "HEAD^";
  }
}
let names = [];
try {
  names = git("diff", "--name-only", "--diff-filter=ACMR", base, "--").split(/\r?\n/);
} catch {
  names = git("ls-files").split(/\r?\n/);
}
if (!process.env.CI) {
  names.push(...git("ls-files", "--others", "--exclude-standard").split(/\r?\n/));
}
const files = [...new Set(names.filter((name) =>
  /\.(ts|tsx|js|jsx|json|md)$/.test(name) &&
  !/^(playwright-report|test-results|apps\/web\/public\/models)\//.test(name) &&
  existsSync(name)))];
if (files.length === 0) {
  console.log("No changed Prettier files");
  process.exit(0);
}
const prettier = fileURLToPath(new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url));
const result = spawnSync(process.execPath, [prettier, "--check", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
