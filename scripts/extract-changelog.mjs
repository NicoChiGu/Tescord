#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 提取指定版本（如 v0.2.0）的更新日志正文
 * 供 GitHub Actions Release 使用。若未收录则优雅 fallback 到最近 git commits。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const changelogPath = path.join(rootDir, "CHANGELOG.md");

function extractFromChangelog(targetTag) {
  if (!fs.existsSync(changelogPath)) return null;
  const content = fs.readFileSync(changelogPath, "utf-8");
  const cleanVersion = targetTag.replace(/^v/i, "").trim();

  // 匹配 ## [v0.2.0] 或 ## [0.2.0] 或 ## v0.2.0 或 ## 0.2.0
  const headerRegex = new RegExp(
    `^##\\s+\\[?v?${cleanVersion.replace(/\./g, "\\.")}\\]?.*$`,
    "m"
  );
  const match = headerRegex.exec(content);
  if (!match) return null;

  const startIndex = match.index + match[0].length;
  // 截取到下一个 ## 标题或文件结束
  const nextHeaderRegex = /^##\s+/m;
  const restContent = content.slice(startIndex);
  const nextMatch = nextHeaderRegex.exec(restContent);

  const section = nextMatch
    ? restContent.slice(0, nextMatch.index)
    : restContent;

  return section.trim();
}

function fallbackGitLog(targetTag) {
  try {
    // 获取上一个 tag 到当前 tag 的 commit 日志
    const prevTag = execSync("git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo ''", {
      encoding: "utf-8",
    }).trim();

    const range = prevTag ? `${prevTag}..HEAD` : "-n 15";
    const log = execSync(`git log ${range} --pretty=format:"* %s (%h)"`, {
      encoding: "utf-8",
    }).trim();

    if (log) {
      return `### 变更与提交日志 (Auto-generated commits)\n\n${log}`;
    }
  } catch {
    // 忽略异常
  }
  return `### 🚀 版本发布 ${targetTag}\n\n欢迎使用 Tescord ${targetTag}！请查阅相关更新说明。`;
}

function main() {
  const targetTag = (process.argv[2] || process.env.GITHUB_REF_NAME || "v0.1.0").trim();
  const extracted = extractFromChangelog(targetTag);

  if (extracted) {
    console.log(extracted);
    return;
  }

  // Fallback
  console.log(fallbackGitLog(targetTag));
}

main();
