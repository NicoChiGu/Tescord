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
import {
  compareUpdateVersions,
  isValidUpdateVersion,
  validateUpdateArchive,
  getUpdateReleaseTag,
  isUpdateHostSupported,
} from "./archive-security.js";

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
    this.currentVersionFile = path.join(
      this.updatesRootDir,
      "current-version.json",
    );
    this.ensureDirectory();
  }

  private safeVersionDir(version: string): string {
    if (!isValidUpdateVersion(version)) {
      throw new Error("Invalid update version");
    }
    return path.join(this.updatesRootDir, `web-v${version}`);
  }

  private validateManifest(manifest: UpdateManifest): void {
    this.safeVersionDir(manifest.version);
    getUpdateReleaseTag(manifest);
    if (
      manifest.webPackageUrl !== `tescord-web-v${manifest.version}.zip` ||
      !/^[a-fA-F0-9]{64}$/.test(manifest.webPackageSha256 || "")
    ) {
      throw new Error("Invalid signed update package metadata");
    }
    if (manifest.minHostVersion) this.safeVersionDir(manifest.minHostVersion);
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
  public getActiveWebEntry(): {
    version: string;
    indexPath: string;
    isFromUpdate: boolean;
  } {
    const defaultDistPath = app.isPackaged
      ? path.join(process.resourcesPath, "web/dist/index.html")
      : path.join(__dirname, "../../../web/dist/index.html");
    const hostVersion = this.getHostVersion();

    try {
      if (fs.existsSync(this.currentVersionFile)) {
        const record = JSON.parse(
          fs.readFileSync(this.currentVersionFile, "utf-8"),
        ) as VersionRecord;
        if (
          record &&
          record.webDistPath &&
          path.resolve(record.webDistPath) ===
            this.safeVersionDir(record.version) &&
          fs.existsSync(record.webDistPath)
        ) {
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
      console.warn(
        "⚠️ [UpdateManager] 读取增量更新版本记录异常，回退内置资源:",
        err,
      );
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
      gitRepo: BUILD_CONFIG.IS_UPDATER_ENABLED
        ? BUILD_CONFIG.REPO_FULL_NAME
        : null,
      preferredProxy: BUILD_CONFIG.PRIMARY_GH_PROXY,
      customProxy: ProxyManager.getInstance().getCustomProxy(),
      lastCheckedAt: this.cachedCheckResult?.manifest?.releaseDate,
    };
  }

  /**
   * 检查远端 Releases 更新
   */
  public async checkForUpdates(): Promise<UpdateCheckResult> {
    this.latestManifest = null;
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

      console.log(
        `🔍 [UpdateManager] 正在通过 gh-proxy 探测更新清单: ${rawManifestUrl}`,
      );
      const response = await proxyManager.fetchWithFallback(rawManifestUrl, {
        timeoutMs: 6000,
        maxBytes: 1024 * 1024,
      });
      const signatureResponse = await proxyManager.fetchWithFallback(
        `${rawManifestUrl}.sig`,
        { timeoutMs: 6000, maxBytes: 1024 },
      );
      const publicKey = crypto.createPublicKey({
        key: Buffer.from(
          BUILD_CONFIG.UPDATE_SIGNING_PUBLIC_KEY_BASE64,
          "base64",
        ),
        format: "der",
        type: "spki",
      });
      const signature = Buffer.from(
        signatureResponse.data.toString("utf8").trim(),
        "base64",
      );
      if (
        publicKey.asymmetricKeyType !== "ed25519" ||
        signature.length !== 64 ||
        !crypto.verify(null, response.data, publicKey, signature)
      ) {
        throw new Error("Update manifest signature verification failed");
      }
      const manifest = JSON.parse(
        response.data.toString("utf-8"),
      ) as UpdateManifest;
      this.validateManifest(manifest);

      this.latestManifest = manifest;

      // 判定是否需要升级原生宿主壳
      const isHostUpdateRequired = Boolean(
        manifest.minHostVersion &&
        compareUpdateVersions(manifest.minHostVersion, hostVersion) > 0,
      );

      // 判定是否有新版 Web Bundle 增量包
      const hasWebUpdate =
        compareUpdateVersions(manifest.version, active.version) > 0;
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
    onProgress?: (progress: UpdateProgress) => void,
  ): Promise<{ success: boolean; newVersion: string; error?: string }> {
    if (!this.latestManifest) {
      const check = await this.checkForUpdates();
      if (!check.hasUpdate || !check.manifest) {
        return { success: false, newVersion: "", error: "没有可用的更新" };
      }
    }

    const manifest = this.latestManifest!;

    // 组装增量包下载地址
    this.validateManifest(manifest);
    if (
      !isUpdateHostSupported(this.getHostVersion(), manifest.minHostVersion)
    ) {
      console.warn("[UpdateManager] HOST_UPDATE_REQUIRED");
      return { success: false, newVersion: "" };
    }
    const proxyManager = ProxyManager.getInstance();
    const releaseTag = getUpdateReleaseTag(manifest);
    const rawPackageUrl = `https://github.com/${BUILD_CONFIG.REPO_FULL_NAME}/releases/download/${releaseTag}/${manifest.webPackageUrl}`;

    this.currentState = "downloading";
    this.broadcastProgress(
      { state: "downloading", percent: 5, transferredBytes: 0, totalBytes: 0 },
      onProgress,
    );

    try {
      console.log(`⬇️ [UpdateManager] 正在下载 Web 增量包: ${rawPackageUrl}`);
      const downloadRes = await proxyManager.fetchWithFallback(rawPackageUrl, {
        timeoutMs: 30000,
        maxBytes: 50 * 1024 * 1024,
      });
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
        onProgress,
      );

      if (zipBuffer.length > 50 * 1024 * 1024)
        throw new Error("Update package is too large");
      const actualSha256 = crypto
        .createHash("sha256")
        .update(zipBuffer)
        .digest("hex");
      if (
        actualSha256.toLowerCase() !== manifest.webPackageSha256.toLowerCase()
      ) {
        throw new Error("Update package SHA256 verification failed");
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
        onProgress,
      );

      const targetVersionDir = this.safeVersionDir(manifest.version);
      const stagingDir = fs.mkdtempSync(
        path.join(this.updatesRootDir, "staging-"),
      );
      const zip = new AdmZip(zipBuffer);
      try {
        const entries = validateUpdateArchive(zip, stagingDir);
        for (const { entry, outputPath } of entries) {
          if (entry.isDirectory) fs.mkdirSync(outputPath, { recursive: true });
          else {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            const data = entry.getData();
            if (data.length !== entry.header.size)
              throw new Error("Update entry size mismatch");
            fs.writeFileSync(outputPath, data, { flag: "wx" });
          }
        }
        // Enforce the native boundary again before replacing any installed data.
        if (
          !isUpdateHostSupported(this.getHostVersion(), manifest.minHostVersion)
        )
          throw new Error("HOST_UPDATE_REQUIRED");
        const backupDir = fs.existsSync(targetVersionDir)
          ? fs.mkdtempSync(path.join(this.updatesRootDir, "backup-"))
          : null;
        if (backupDir) {
          fs.rmdirSync(backupDir);
          fs.renameSync(targetVersionDir, backupDir);
        }
        try {
          fs.renameSync(stagingDir, targetVersionDir);
          const record: VersionRecord = {
            version: manifest.version,
            webDistPath: targetVersionDir,
            appliedAt: new Date().toISOString(),
          };
          const tempRecord = `${this.currentVersionFile}.tmp`;
          fs.writeFileSync(tempRecord, JSON.stringify(record, null, 2), "utf8");
          fs.renameSync(tempRecord, this.currentVersionFile);
          if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
        } catch (error) {
          if (fs.existsSync(targetVersionDir))
            fs.rmSync(targetVersionDir, { recursive: true, force: true });
          if (backupDir && fs.existsSync(backupDir))
            fs.renameSync(backupDir, targetVersionDir);
          throw error;
        }
      } finally {
        if (fs.existsSync(stagingDir))
          fs.rmSync(stagingDir, { recursive: true, force: true });
      }

      // 校验解压后 index.html 入口是否存在
      const entryFile = path.join(targetVersionDir, "index.html");
      if (!fs.existsSync(entryFile)) {
        throw new Error("解压失败：未在增量包中找到 index.html 入口文件");
      }

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
        onProgress,
      );

      console.log(
        `🎉 [UpdateManager] Web 增量更新已成功就绪: v${manifest.version}`,
      );
      return { success: true, newVersion: manifest.version };
    } catch (err: any) {
      this.currentState = "error";
      this.broadcastProgress(
        {
          state: "error",
          percent: 0,
          transferredBytes: 0,
          totalBytes: 0,
          error: err.message,
        },
        onProgress,
      );
      console.error("❌ [UpdateManager] 增量包下载解压失败:", err);
      return { success: false, newVersion: "", error: err.message };
    }
  }

  private broadcastProgress(
    progress: UpdateProgress,
    callback?: (progress: UpdateProgress) => void,
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
        .filter((name) => {
          try {
            return path.basename(this.safeVersionDir(name.slice(5))) === name;
          } catch {
            return false;
          }
        })
        .sort((left, right) =>
          compareUpdateVersions(right.slice(5), left.slice(5)),
        );

      // 无论目录名排序如何，始终保留当前激活版本和最近的一个历史版本。
      const currentDir = `web-v${currentVersion}`;
      const previousDir = versionDirs.find((name) => name !== currentDir);
      const keep = new Set([currentDir, previousDir]);
      const toDelete = versionDirs.filter((name) => !keep.has(name));
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
