import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app, BrowserWindow } from "electron";
import AdmZip from "adm-zip";
import {
  UpdateCheckResult,
  UpdateManifest,
  UpdateProgress,
  UpdaterConfig,
  UpdaterState,
} from "@tescord/types";
import { BUILD_CONFIG } from "../build-config.js";
import { ProxyManager } from "./proxy-manager.js";

interface VersionRecord {
  version: string;
  webDistPath: string;
  appliedAt: string;
}

export class UpdateManager {
  private static instance: UpdateManager;
  private updatesRootDir: string;
  private currentVersionFile: string;
  private currentState: UpdaterState = "idle";
  private currentProgress: UpdateProgress = {
    state: "idle",
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0,
  };
  private latestManifest: UpdateManifest | null = null;
  private cachedCheckResult: UpdateCheckResult | null = null;

  private constructor() {
    this.updatesRootDir = path.join(app.getPath("userData"), "updates");
    this.currentVersionFile = path.join(this.updatesRootDir, "current-version.json");
    this.ensureDirectory();
  }

  public static getInstance(): UpdateManager {
    if (!UpdateManager.instance) {
      UpdateManager.instance = new UpdateManager();
    }
    return UpdateManager.instance;
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.updatesRootDir)) {
        fs.mkdirSync(this.updatesRootDir, { recursive: true });
      }
    } catch (err) {
      console.error("❌ [UpdateManager] 创建 updates 目录失败:", err);
    }
  }

  /**
   * 获取当前应用的原生宿主版本 (Host Version)
   */
  public getHostVersion(): string {
    return app.getVersion() || "0.1.0";
  }

  /**
   * 获取当前生效的 Web Bundle 资源路径与版本号
   */
  public getActiveWebEntry(): { version: string; indexPath: string; isFromUpdate: boolean } {
    const defaultDistPath = path.join(__dirname, "../../web/dist/index.html");
    const hostVersion = this.getHostVersion();

    try {
      if (fs.existsSync(this.currentVersionFile)) {
        const record = JSON.parse(fs.readFileSync(this.currentVersionFile, "utf-8")) as VersionRecord;
        if (record && record.webDistPath && fs.existsSync(record.webDistPath)) {
          const indexPath = path.join(record.webDistPath, "index.html");
          if (fs.existsSync(indexPath)) {
            return {
              version: record.version || hostVersion,
              indexPath,
              isFromUpdate: true,
            };
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ [UpdateManager] 读取增量更新版本记录异常，回退内置资源:", err);
    }

    return {
      version: hostVersion,
      indexPath: defaultDistPath,
      isFromUpdate: false,
    };
  }

  public getUpdaterConfig(): UpdaterConfig {
    const active = this.getActiveWebEntry();
    return {
      enabled: BUILD_CONFIG.IS_UPDATER_ENABLED,
      currentHostVersion: this.getHostVersion(),
      currentWebVersion: active.version,
      gitRepo: BUILD_CONFIG.IS_UPDATER_ENABLED ? BUILD_CONFIG.REPO_FULL_NAME : null,
      preferredProxy: BUILD_CONFIG.PRIMARY_GH_PROXY,
      customProxy: ProxyManager.getInstance().getCustomProxy(),
      lastCheckedAt: this.cachedCheckResult?.manifest?.releaseDate,
    };
  }

  /**
   * 简单语义化版本比较: v1 > v2 返回 1; v1 < v2 返回 -1; 相等返回 0
   */
  private compareSemver(v1: string, v2: string): number {
    const clean1 = (v1 || "").replace(/^v/i, "").trim();
    const clean2 = (v2 || "").replace(/^v/i, "").trim();
    const parts1 = clean1.split(".").map((n) => parseInt(n, 10) || 0);
    const parts2 = clean2.split(".").map((n) => parseInt(n, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  /**
   * 检查远端 Releases 更新
   */
  public async checkForUpdates(): Promise<UpdateCheckResult> {
    const active = this.getActiveWebEntry();
    const hostVersion = this.getHostVersion();

    // 1. 若 build 时未检测到仓库信息，更新检测不生效
    if (!BUILD_CONFIG.IS_UPDATER_ENABLED || !BUILD_CONFIG.REPO_FULL_NAME) {
      this.currentState = "disabled";
      const disabledResult: UpdateCheckResult = {
        enabled: false,
        hasUpdate: false,
        currentHostVersion: hostVersion,
        currentWebVersion: active.version,
        error: "未配置远程 GitHub 仓库，自动更新服务未启用。",
      };
      this.cachedCheckResult = disabledResult;
      return disabledResult;
    }

    this.currentState = "checking";

    try {
      const proxyManager = ProxyManager.getInstance();
      const rawManifestUrl = `https://github.com/${BUILD_CONFIG.REPO_FULL_NAME}/releases/latest/download/manifest.json`;

      console.log(`🔍 [UpdateManager] 正在通过 gh-proxy 探测更新清单: ${rawManifestUrl}`);
      const response = await proxyManager.fetchWithFallback(rawManifestUrl, { timeoutMs: 6000 });
      const manifest = JSON.parse(response.data.toString("utf-8")) as UpdateManifest;

      if (!manifest || !manifest.version) {
        throw new Error("下载的 manifest.json 缺少有效的版本信息");
      }

      this.latestManifest = manifest;

      // 判定是否需要升级原生宿主壳
      const isHostUpdateRequired = Boolean(
        manifest.minHostVersion && this.compareSemver(manifest.minHostVersion, hostVersion) > 0
      );

      // 判定是否有新版 Web Bundle 增量包
      const hasWebUpdate = this.compareSemver(manifest.version, active.version) > 0;
      const hasUpdate = isHostUpdateRequired || hasWebUpdate;

      this.currentState = hasUpdate ? "idle" : "idle";
      const result: UpdateCheckResult = {
        enabled: true,
        hasUpdate,
        currentHostVersion: hostVersion,
        currentWebVersion: active.version,
        latestVersion: manifest.version,
        isHostUpdateRequired,
        manifest,
      };

      this.cachedCheckResult = result;
      return result;
    } catch (err: any) {
      this.currentState = "error";
      console.warn("⚠️ [UpdateManager] 检查更新失败:", err.message);
      const errorResult: UpdateCheckResult = {
        enabled: true,
        hasUpdate: false,
        currentHostVersion: hostVersion,
        currentWebVersion: active.version,
        error: err.message || "检查更新失败",
      };
      this.cachedCheckResult = errorResult;
      return errorResult;
    }
  }

  /**
   * 下载并解压 Web 增量更新包
   */
  public async downloadAndApplyWebUpdate(
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<{ success: boolean; newVersion: string; error?: string }> {
    if (!this.latestManifest) {
      const check = await this.checkForUpdates();
      if (!check.hasUpdate || !check.manifest) {
        return { success: false, newVersion: "", error: "没有可用的更新" };
      }
    }

    const manifest = this.latestManifest!;
    const proxyManager = ProxyManager.getInstance();

    // 组装增量包下载地址
    let rawPackageUrl = manifest.webPackageUrl;
    if (!rawPackageUrl.startsWith("http://") && !rawPackageUrl.startsWith("https://")) {
      rawPackageUrl = `https://github.com/${BUILD_CONFIG.REPO_FULL_NAME}/releases/download/v${manifest.version}/${manifest.webPackageUrl}`;
    }

    this.currentState = "downloading";
    this.broadcastProgress(
      { state: "downloading", percent: 5, transferredBytes: 0, totalBytes: 0 },
      onProgress
    );

    try {
      console.log(`⬇️ [UpdateManager] 正在下载 Web 增量包: ${rawPackageUrl}`);
      const downloadRes = await proxyManager.fetchWithFallback(rawPackageUrl, { timeoutMs: 30000 });
      const zipBuffer = downloadRes.data;

      // 校验 SHA256 哈希
      this.currentState = "verifying";
      this.broadcastProgress(
        {
          state: "verifying",
          percent: 90,
          transferredBytes: zipBuffer.length,
          totalBytes: zipBuffer.length,
        },
        onProgress
      );

      if (manifest.webPackageSha256) {
        const actualSha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
        if (actualSha256.toLowerCase() !== manifest.webPackageSha256.toLowerCase()) {
          throw new Error(
            `增量包 SHA256 校验失败: 期望 ${manifest.webPackageSha256}, 实际 ${actualSha256}`
          );
        }
        console.log(`✅ [UpdateManager] SHA256 完整性校验通过: ${actualSha256}`);
      }

      // 解压增量包到用户目录
      this.currentState = "extracting";
      this.broadcastProgress(
        {
          state: "extracting",
          percent: 95,
          transferredBytes: zipBuffer.length,
          totalBytes: zipBuffer.length,
        },
        onProgress
      );

      const targetVersionDir = path.join(this.updatesRootDir, `web-v${manifest.version}`);
      if (fs.existsSync(targetVersionDir)) {
        fs.rmSync(targetVersionDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetVersionDir, { recursive: true });

      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(targetVersionDir, true);

      // 校验解压后 index.html 入口是否存在
      const entryFile = path.join(targetVersionDir, "index.html");
      if (!fs.existsSync(entryFile)) {
        throw new Error("解压失败：未在增量包中找到 index.html 入口文件");
      }

      // 写入版本元数据记录
      const record: VersionRecord = {
        version: manifest.version,
        webDistPath: targetVersionDir,
        appliedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.currentVersionFile, JSON.stringify(record, null, 2), "utf-8");

      // 清理旧版本，仅保留最新 2 个
      this.cleanupOldVersions(manifest.version);

      this.currentState = "ready";
      this.broadcastProgress(
        {
          state: "ready",
          percent: 100,
          transferredBytes: zipBuffer.length,
          totalBytes: zipBuffer.length,
        },
        onProgress
      );

      console.log(`🎉 [UpdateManager] Web 增量更新已成功就绪: v${manifest.version}`);
      return { success: true, newVersion: manifest.version };
    } catch (err: any) {
      this.currentState = "error";
      this.broadcastProgress(
        { state: "error", percent: 0, transferredBytes: 0, totalBytes: 0, error: err.message },
        onProgress
      );
      console.error("❌ [UpdateManager] 增量包下载解压失败:", err);
      return { success: false, newVersion: "", error: err.message };
    }
  }

  private broadcastProgress(
    progress: UpdateProgress,
    callback?: (progress: UpdateProgress) => void
  ): void {
    this.currentProgress = progress;
    if (callback) callback(progress);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("updater-progress", progress);
      }
    });
  }

  /**
   * 清理历史旧版本目录，保留当前最新与上一个版本
   */
  private cleanupOldVersions(currentVersion: string): void {
    try {
      const items = fs.readdirSync(this.updatesRootDir);
      const versionDirs = items
        .filter((name) => name.startsWith("web-v"))
        .sort()
        .reverse();

      // 保留最新的 2 个版本文件夹
      const toDelete = versionDirs.slice(2);
      for (const dirName of toDelete) {
        const fullPath = path.join(this.updatesRootDir, dirName);
        console.log(`🧹 [UpdateManager] 清理历史旧版本增量目录: ${dirName}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn("⚠️ [UpdateManager] 清理历史版本目录失败:", err);
    }
  }

  /**
   * 重启客户端以应用更新
   */
  public restartToApply(): void {
    app.relaunch();
    app.exit(0);
  }
}
