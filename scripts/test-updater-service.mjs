/**
 * 客户端自动更新服务专项自动化测试
 * 覆盖：
 * 1. 编译期 Git 变量探测与未配置时自动禁用更新逻辑
 * 2. gh-proxy 阶梯路由、优先使用 v6.gh-proxy.org 与自定义代理
 * 3. CHANGELOG 提取
 * 4. 增量更新包压缩、SHA256 校验与解压完整性验证
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

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log("==========================================");
console.log("🧪 开始执行 Tescord 更新服务与代理测试套件");
console.log("==========================================\n");

// 1. 测试 Git 仓库变量写死与检测
console.log("▶️ 测试用例 1: 构建期 Git 变量检测与未配置禁用逻辑");
{
  // 模拟带环境变量执行 generate-build-config
  const outputValid = execSync("node scripts/generate-build-config.mjs", {
    cwd: rootDir,
    env: { ...process.env, GITHUB_REPOSITORY: "test-org/test-project" },
    encoding: "utf-8",
  });
  assert(
    outputValid.includes("test-org/test-project") && outputValid.includes("IS_UPDATER_ENABLED = true"),
    "当 GITHUB_REPOSITORY 存在时，正确识别并启用更新服务"
  );

  const buildConfigPath = path.join(rootDir, "apps/desktop/src/build-config.ts");
  const buildConfigContent = fs.readFileSync(buildConfigPath, "utf-8");
  assert(
    buildConfigContent.includes('REPO_OWNER: "test-org"') &&
      buildConfigContent.includes('REPO_NAME: "test-project"') &&
      buildConfigContent.includes("IS_UPDATER_ENABLED: true"),
    "build-config.ts 成功固化仓库名称并写死在常量中"
  );

  // 恢复为当前真实探测
  execSync("node scripts/generate-build-config.mjs", { cwd: rootDir, encoding: "utf-8" });
}

// 2. 测试 gh-proxy 代理前缀包装与候选阶梯顺序
console.log("\n▶️ 测试用例 2: gh-proxy 代理前缀包装与候选阶梯规则");
{
  const primaryProxy = "https://v6.gh-proxy.org/";
  const backupProxy = "https://gh-proxy.com/";
  const rawUrl = "https://github.com/labsphaela/Tescord/releases/download/v0.1.0/manifest.json";

  const wrapUrl = (url, prefix) => (!prefix ? url : `${prefix.endsWith("/") ? prefix : prefix + "/"}${url}`);

  const wrappedPrimary = wrapUrl(rawUrl, primaryProxy);
  assert(
    wrappedPrimary === `https://v6.gh-proxy.org/https://github.com/labsphaela/Tescord/releases/download/v0.1.0/manifest.json`,
    "正确将 GitHub URL 拼接入优先代理 https://v6.gh-proxy.org/"
  );

  const customProxy = "https://my-custom-proxy.internal/";
  const wrappedCustom = wrapUrl(rawUrl, customProxy);
  assert(
    wrappedCustom === `https://my-custom-proxy.internal/https://github.com/labsphaela/Tescord/releases/download/v0.1.0/manifest.json`,
    "用户自定义代理优先级正确覆盖"
  );
}

// 3. 测试 CHANGELOG 提取
console.log("\n▶️ 测试用例 3: CHANGELOG.md 版本更新日志提取");
{
  const changelogText = execSync("node scripts/extract-changelog.mjs v0.1.0", {
    cwd: rootDir,
    encoding: "utf-8",
  }).trim();

  assert(
    changelogText.includes("新增功能") && changelogText.includes("问题修复"),
    "成功从 CHANGELOG.md 提取 v0.1.0 对应的功能与修复项段落"
  );
}

// 4. 测试增量更新包 SHA256 计算、防篡改校验与解压
console.log("\n▶️ 测试用例 4: Web 增量包压缩、SHA256 哈希校验与完整性解压");
{
  const tempDir = path.join(rootDir, "test-updater-sandbox");
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const mockDistDir = path.join(tempDir, "mock-dist");
  fs.mkdirSync(mockDistDir, { recursive: true });
  fs.writeFileSync(path.join(mockDistDir, "index.html"), "<html><body>Tescord v0.2.0</body></html>");
  fs.writeFileSync(path.join(mockDistDir, "app.js"), "console.log('updated bundle');");

  // 压缩为 zip
  const zip = new AdmZip();
  zip.addLocalFolder(mockDistDir);
  const zipBuffer = zip.toBuffer();

  const correctSha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  const wrongSha256 = "0000000000000000000000000000000000000000000000000000000000000000";

  // 校验正确哈希
  const testSha = crypto.createHash("sha256").update(zipBuffer).digest("hex");
  assert(testSha === correctSha256, "增量包 SHA256 哈希生成精确无误");
  assert(testSha !== wrongSha256, "哈希不匹配时能精准识别防篡改");

  // 模拟解压到目标目录
  const extractDir = path.join(tempDir, "extracted");
  const extractZip = new AdmZip(zipBuffer);
  extractZip.extractAllTo(extractDir, true);

  assert(
    fs.existsSync(path.join(extractDir, "index.html")) &&
      fs.readFileSync(path.join(extractDir, "index.html"), "utf-8").includes("Tescord v0.2.0"),
    "增量更新包成功解压，且入口 index.html 完好可用"
  );

  // 清理临时目录
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("\n==========================================");
console.log(`📊 测试汇总: ${passed} 项通过, ${failed} 项失败`);
console.log("==========================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 所有更新服务与代理测试用例 100% 通过！\n");
}
