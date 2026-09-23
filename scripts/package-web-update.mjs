#!/usr/bin/env node
/**
 * 打包跨平台 Web 增量更新包及生成 manifest.json 清单
 * 供 GitHub Actions Tag 发版时生成增量更新资产
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webDistDir = path.join(rootDir, "apps/web/dist");
const outputDir = path.join(rootDir, "release");

function getVersion() {
  if (process.env.RELEASE_VERSION) {
    return process.env.RELEASE_VERSION.replace(/^v/i, "").trim();
  }
  if (process.argv[2]) {
    return process.argv[2].replace(/^v/i, "").trim();
  }
  const webPkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "apps/web/package.json"), "utf-8")
  );
  return webPkg.version || "0.1.0";
}

function getChangelog(version) {
  try {
    const output = execSync(`node ${path.join(__dirname, "extract-changelog.mjs")} v${version}`, {
      encoding: "utf-8",
    }).trim();
    return output || "";
  } catch {
    return "";
  }
}

function main() {
  if (!fs.existsSync(webDistDir)) {
    console.error(`❌ [PackageWeb] 未找到前端构建产物: ${webDistDir}，请先执行 pnpm build:web`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const version = getVersion();
  const zipFilename = `tescord-web-v${version}.zip`;
  const targetZipPath = path.join(outputDir, zipFilename);

  console.log(`📦 [PackageWeb] 正在压缩前端增量包: ${zipFilename}...`);
  const zip = new AdmZip();
  zip.addLocalFolder(webDistDir);
  zip.writeZip(targetZipPath);

  const zipBuffer = fs.readFileSync(targetZipPath);
  const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  const sizeMb = (zipBuffer.length / 1024 / 1024).toFixed(2);
  console.log(`✅ [PackageWeb] 增量包压缩完成: ${targetZipPath} (${sizeMb} MB, SHA256: ${sha256})`);

  const changelog = getChangelog(version);

  const manifest = {
    version: version,
    releaseDate: new Date().toISOString(),
    minHostVersion: "0.1.0",
    webPackageUrl: zipFilename,
    webPackageSha256: sha256,
    changelog: changelog,
    mandatory: false,
    hostInstallers: {
      windows: {
        url: `Tescord-Setup-${version}.exe`,
      },
      macOS: {
        url: `Tescord-${version}.dmg`,
      },
    },
  };

  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`📋 [PackageWeb] 已生成更新元数据清单: ${manifestPath}`);
}

main();
