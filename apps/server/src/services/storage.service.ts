import { Client as MinioClient } from "minio";
import path from "path";
import fs from "fs";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import sharp from "sharp";
import {
  PresignedUploadRequest,
  PresignedUploadResponse,
} from "@tescord/types";

export class StorageService {
  private minioClient: MinioClient | null = null;
  private bucketName: string;
  private isMinioAvailable = false;
  private uploadsDir: string;
  private baseUrl: string;
  private uploadGrants = new Map<
    string,
    {
      userId: string;
      fileUrl: string;
      fileSize: number;
      mimeType: string;
      expiresAt: number;
      claimed: boolean;
      uploaded: boolean;
      purpose: "attachment" | "guild-icon";
      channelId?: string;
      guildId?: string;
      preview?: { url: string; size: number; width: number; height: number };
    }
  >();
  private activePreviewJobs = 0;
  private previewWaiters: Array<() => void> = [];

  constructor() {
    this.bucketName = process.env.MINIO_BUCKET || "tescord-assets";
    this.uploadsDir = path.resolve(process.cwd(), "uploads");
    this.baseUrl = process.env.SERVER_BASE_URL || "http://localhost:3001";

    // 保证本地 uploads 目录存在
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }

    // 初始化 MinIO 尝试连接
    const endPoint = process.env.MINIO_ENDPOINT || "localhost";
    const port = parseInt(process.env.MINIO_PORT || "9000", 10);
    const useSSL = process.env.MINIO_USE_SSL === "true";
    const accessKey = process.env.MINIO_ACCESS_KEY || "minioadmin";
    const secretKey = process.env.MINIO_SECRET_KEY || "minioadmin";

    try {
      this.minioClient = new MinioClient({
        endPoint,
        port,
        useSSL,
        accessKey,
        secretKey,
      });
    } catch (err) {
      console.warn(
        "[StorageService] MinIO 客户端初始化失败，切换为本地存储模式:",
        err,
      );
      this.minioClient = null;
    }
  }

  /**
   * 异步检查 MinIO 服务健康状态并初始化 Bucket
   */
  public async init(): Promise<void> {
    if (!this.minioClient) {
      this.isMinioAvailable = false;
      if (process.env.NODE_ENV === "production")
        throw new Error("MinIO is required in production");
      return;
    }

    try {
      // 检查 MinIO 是否可用，超时 1500ms，避免本地开发阻塞
      const checkPromise = this.minioClient.bucketExists(this.bucketName);
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("MinIO connection timeout")), 1500),
      );

      const exists = await Promise.race([checkPromise, timeoutPromise]);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, "us-east-1");
        console.log(
          `[StorageService] 成功创建 MinIO Bucket: ${this.bucketName}`,
        );
      }
      this.isMinioAvailable = true;
      console.log(
        `[StorageService] MinIO 存储服务已就绪 (Bucket: ${this.bucketName})`,
      );
    } catch (err: any) {
      this.isMinioAvailable = false;
      if (process.env.NODE_ENV === "production") throw err;
      console.log(
        "[StorageService] MinIO 服务未就绪或未启动，启用本地 uploads/ 静默容灾模式",
      );
    }
  }

  public getMode(): "minio" | "local" {
    return this.isMinioAvailable ? "minio" : "local";
  }

  public getUploadsDir(): string {
    return this.uploadsDir;
  }

  /**
   * 获取预签名上传链接 (支持 MinIO 直传与本地静默直传)
   */
  public async getPresignedUploadUrl(
    req: PresignedUploadRequest,
    userId: string,
  ): Promise<PresignedUploadResponse> {
    if (process.env.NODE_ENV === "production" && !this.isMinioAvailable) {
      throw new Error("MinIO is unavailable");
    }
    if (req.purpose === "guild-icon" && !req.guildId)
      throw new Error("guildId is required");
    if (req.purpose !== "guild-icon" && !req.channelId)
      throw new Error("channelId is required");
    const maxUploadBytes = Number(
      process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024,
    );
    if (
      !Number.isSafeInteger(req.fileSize) ||
      req.fileSize <= 0 ||
      req.fileSize > maxUploadBytes
    ) {
      throw new Error(`文件大小必须在 1 到 ${maxUploadBytes} 字节之间`);
    }
    const blockedTypes = new Set([
      "text/html",
      "image/svg+xml",
      "application/xhtml+xml",
      "application/javascript",
      "application/x-msdownload",
      "application/x-sh",
      "application/x-bat",
      "application/x-msdos-program",
      "application/x-executable",
    ]);
    if (blockedTypes.has((req.mimeType || "").toLowerCase())) {
      throw new Error("该文件类型不能作为附件上传");
    }
    const ext = path.extname(req.fileName) || "";
    if (
      new Set([
        ".html",
        ".htm",
        ".svg",
        ".js",
        ".mjs",
        ".xhtml",
        ".xml",
        ".exe",
        ".bat",
        ".cmd",
        ".sh",
        ".vbs",
        ".msi",
        ".ps1",
        ".com",
        ".scr",
      ]).has(ext.toLowerCase())
    ) {
      throw new Error("该文件扩展名属于高危脚本或程序，禁止作为附件上传");
    }
    const safeName = path
      .basename(req.fileName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileKey = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}${ext}`;

    // Upload through the authenticated API so size and MIME grants are enforced
    // before bytes reach either local storage or the private MinIO bucket.
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
    const signature = this.signLocalUpload(fileKey, userId, expiresAt);
    const uploadUrl = `${this.baseUrl}/api/attachments/upload/${encodeURIComponent(fileKey)}?expires=${expiresAt}&signature=${encodeURIComponent(signature)}`;
    const fileUrl =
      req.purpose === "guild-icon"
        ? `${this.baseUrl}/public-assets/${encodeURIComponent(fileKey)}`
        : `${this.baseUrl}/uploads/${encodeURIComponent(fileKey)}`;

    const response = {
      uploadUrl,
      fileUrl,
      fileKey,
      requiresAuth: true,
    };
    this.rememberGrant(fileKey, userId, fileUrl, req);
    return response;
  }

  public claimAttachment(
    userId: string,
    channelId: string,
    input: {
      url?: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
    },
  ): {
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    preview?: { url: string; size: number; width: number; height: number };
  } | null {
    const candidate = String(input.url || "").trim();
    if (!candidate) return null;

    let fileKey = "";
    let candidatePathname = "";
    try {
      const parsed = new URL(candidate, this.baseUrl);
      candidatePathname = parsed.pathname;
      fileKey = decodeURIComponent(candidatePathname.split("/").pop() || "");
    } catch {
      return null;
    }

    if (!fileKey || path.basename(fileKey) !== fileKey) {
      return null;
    }

    const grant = this.uploadGrants.get(fileKey);
    if (
      !grant ||
      grant.purpose !== "attachment" ||
      !grant.uploaded ||
      grant.claimed ||
      grant.userId !== userId ||
      grant.channelId !== channelId ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }

    if (
      Number(input.fileSize) !== grant.fileSize ||
      String(input.mimeType) !== grant.mimeType
    ) {
      return null;
    }

    // 验证路径合法性：支持完整绝对 URL 或相对路径 (/uploads/... 或 /bucket/...)
    let grantPathname = "";
    try {
      grantPathname = new URL(grant.fileUrl, this.baseUrl).pathname;
    } catch {
      grantPathname = "";
    }

    const isUrlMatch =
      candidate === grant.fileUrl ||
      candidatePathname === grantPathname ||
      decodeURIComponent(candidatePathname).endsWith(`/${fileKey}`);

    if (!isUrlMatch) {
      return null;
    }

    grant.claimed = true;
    return {
      url: grant.fileUrl,
      fileName: path.basename(String(input.fileName || fileKey)).slice(0, 255),
      fileSize: grant.fileSize,
      mimeType: grant.mimeType,
      preview: grant.preview,
    };
  }

  public claimPublicAsset(
    userId: string,
    guildId: string,
    fileUrl: string,
  ): boolean {
    let key: string;
    try {
      const url = new URL(fileUrl, this.baseUrl);
      if (
        url.origin !== new URL(this.baseUrl).origin ||
        !url.pathname.startsWith("/public-assets/")
      )
        return false;
      key = decodeURIComponent(url.pathname.slice("/public-assets/".length));
    } catch {
      return false;
    }
    const grant = this.uploadGrants.get(key);
    if (
      !grant ||
      !grant.uploaded ||
      grant.claimed ||
      grant.expiresAt < Date.now() ||
      grant.userId !== userId ||
      grant.guildId !== guildId ||
      grant.purpose !== "guild-icon" ||
      grant.fileUrl !== fileUrl ||
      !grant.mimeType.startsWith("image/")
    )
      return false;
    grant.claimed = true;
    return true;
  }

  public releasePublicAssetClaim(
    userId: string,
    guildId: string,
    fileUrl: string,
  ): void {
    const key = this.getPublicAssetKey(fileUrl);
    if (!key) return;
    const grant = this.uploadGrants.get(key);
    if (
      grant?.claimed &&
      grant.userId === userId &&
      grant.guildId === guildId &&
      grant.fileUrl === fileUrl &&
      grant.purpose === "guild-icon"
    ) {
      grant.claimed = false;
    }
  }

  public isPendingPublicAsset(fileKey: string): boolean {
    const grant = this.uploadGrants.get(fileKey);
    return Boolean(
      grant &&
      grant.uploaded &&
      grant.purpose === "guild-icon" &&
      grant.expiresAt >= Date.now(),
    );
  }

  public async discardPendingPublicAsset(
    userId: string,
    guildId: string,
    fileUrl: string,
  ): Promise<boolean> {
    const key = this.getPublicAssetKey(fileUrl);
    if (!key) return false;
    const grant = this.uploadGrants.get(key);
    if (
      !grant ||
      !grant.uploaded ||
      grant.claimed ||
      grant.userId !== userId ||
      grant.guildId !== guildId ||
      grant.purpose !== "guild-icon" ||
      grant.fileUrl !== fileUrl
    )
      return false;

    await this.removeStoredObject(key);
    this.uploadGrants.delete(key);
    return true;
  }

  public async removePublicAsset(fileUrl: string): Promise<void> {
    const key = this.getPublicAssetKey(fileUrl);
    if (!key) return;
    await this.removeStoredObject(key);
    this.uploadGrants.delete(key);
  }

  private getPublicAssetKey(fileUrl: string): string | null {
    try {
      const url = new URL(fileUrl, this.baseUrl);
      if (
        url.origin !== new URL(this.baseUrl).origin ||
        !url.pathname.startsWith("/public-assets/")
      )
        return null;
      const key = decodeURIComponent(
        url.pathname.slice("/public-assets/".length),
      );
      return this.resolveLocalUploadPath(key) ? key : null;
    } catch {
      return null;
    }
  }

  private async removeStoredObject(fileKey: string): Promise<void> {
    if (this.isMinioAvailable && this.minioClient) {
      await this.minioClient.removeObject(this.bucketName, fileKey);
      return;
    }
    const filePath = this.resolveLocalUploadPath(fileKey);
    if (!filePath) throw new Error("Invalid public asset path");
    await fs.promises.rm(filePath, { force: true });
  }

  public verifyLocalUpload(
    fileKey: string,
    userId: string,
    expiresAt: number,
    signature: string,
  ): boolean {
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
    const expected = this.signLocalUpload(fileKey, userId, expiresAt);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }

  public resolveLocalUploadPath(fileKey: string): string | null {
    if (!fileKey || path.basename(fileKey) !== fileKey) return null;
    const resolved = path.resolve(this.uploadsDir, fileKey);
    const root = `${path.resolve(this.uploadsDir)}${path.sep}`;
    return resolved.startsWith(root) ? resolved : null;
  }

  public async createDownloadUrl(
    fileUrl: string,
    channelId: string,
    scope: { userId: string; sessionId: string; sessionVersion: number },
    variant: "original" | "preview" = "original",
    download = false,
  ): Promise<string> {
    const fileKey = decodeURIComponent(
      new URL(fileUrl).pathname.split("/").pop() || "",
    );
    if (!fileKey || path.basename(fileKey) !== fileKey)
      throw new Error("非法附件对象键");
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const signature = this.signDownload(
      fileKey,
      channelId,
      expiresAt,
      variant,
      download,
      scope,
    );
    return `${this.baseUrl}/attachments/${encodeURIComponent(fileKey)}?channelId=${encodeURIComponent(channelId)}&expires=${expiresAt}&variant=${variant}&download=${download ? "1" : "0"}&userId=${encodeURIComponent(scope.userId)}&sessionId=${encodeURIComponent(scope.sessionId)}&sessionVersion=${scope.sessionVersion}&signature=${encodeURIComponent(signature)}`;
  }

  public getDownloadExpiry(): number {
    // Report a conservative bound when URLs were minted across a second boundary.
    return (Math.floor(Date.now() / 1000) + 5 * 60 - 1) * 1000;
  }

  public verifyUploadMetadata(
    fileKey: string,
    userId: string,
    size: number,
    contentType: string | undefined,
  ): boolean {
    const grant = this.uploadGrants.get(fileKey);
    return Boolean(
      grant &&
      !grant.claimed &&
      !grant.uploaded &&
      grant.expiresAt >= Date.now() &&
      grant.userId === userId &&
      grant.fileSize === size &&
      grant.mimeType === contentType,
    );
  }

  public getUploadGrantScope(
    fileKey: string,
    userId: string,
  ): {
    purpose: "attachment" | "guild-icon";
    channelId?: string;
    guildId?: string;
  } | null {
    const grant = this.uploadGrants.get(fileKey);
    if (
      !grant ||
      grant.userId !== userId ||
      grant.claimed ||
      grant.uploaded ||
      grant.expiresAt < Date.now()
    ) {
      return null;
    }
    return {
      purpose: grant.purpose,
      channelId: grant.channelId,
      guildId: grant.guildId,
    };
  }

  public async storeObject(fileKey: string, bytes: Buffer): Promise<void> {
    const grant = this.uploadGrants.get(fileKey);
    if (!grant || grant.claimed || grant.uploaded)
      throw new Error("Upload grant is not active");
    if (this.isMinioAvailable && this.minioClient) {
      await this.minioClient.putObject(
        this.bucketName,
        fileKey,
        bytes,
        bytes.length,
        { "Content-Type": grant.mimeType },
      );
    } else {
      if (process.env.NODE_ENV === "production")
        throw new Error("MinIO is unavailable");
      const filePath = this.resolveLocalUploadPath(fileKey);
      if (!filePath) throw new Error("Invalid upload path");
      await fs.promises.writeFile(filePath, bytes, { flag: "wx" });
    }
    grant.uploaded = true;
    if (
      grant.purpose === "attachment" &&
      /^(image\/jpeg|image\/png|image\/webp|image\/avif)$/i.test(grant.mimeType)
    ) {
      try {
        await this.withPreviewSlot(async () => {
          const pipeline = sharp(bytes, {
            limitInputPixels: 40_000_000,
            failOn: "error",
          }).rotate();
          const metadata = await pipeline.metadata();
          if (!metadata.width || !metadata.height) return;
          const output = await pipeline
            .resize({
              width: 1920,
              height: 1920,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 82 })
            .toBuffer({ resolveWithObject: true });
          if (output.data.length >= bytes.length) return;
          const previewKey = `${fileKey}.preview.webp`;
          try {
            if (this.isMinioAvailable && this.minioClient) {
              await this.minioClient.putObject(
                this.bucketName,
                previewKey,
                output.data,
                output.data.length,
                { "Content-Type": "image/webp" },
              );
            } else {
              const previewPath = this.resolveLocalUploadPath(previewKey);
              if (!previewPath) return;
              await fs.promises.writeFile(previewPath, output.data, {
                flag: "wx",
              });
            }
          } catch (error) {
            // A failed write can leave a partial local file or remote object.
            await this.removePreviewObject(previewKey).catch((cleanupError) =>
              console.warn(
                "[StorageService] Preview cleanup failed:",
                cleanupError,
              ),
            );
            throw error;
          }
          grant.preview = {
            url: `${this.baseUrl}/uploads/${encodeURIComponent(previewKey)}`,
            size: output.data.length,
            width: output.info.width,
            height: output.info.height,
          };
        });
      } catch (error) {
        console.warn(
          "[StorageService] Image preview generation failed:",
          error,
        );
      }
    }
  }

  private async removePreviewObject(previewKey: string): Promise<void> {
    if (this.isMinioAvailable && this.minioClient) {
      await this.minioClient.removeObject(this.bucketName, previewKey);
      return;
    }
    const previewPath = this.resolveLocalUploadPath(previewKey);
    if (!previewPath) throw new Error("Invalid preview path");
    await fs.promises.rm(previewPath, { force: true });
  }

  private async withPreviewSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activePreviewJobs >= 2) {
      await new Promise<void>((resolve) => this.previewWaiters.push(resolve));
    } else {
      this.activePreviewJobs++;
    }
    try {
      return await task();
    } finally {
      const next = this.previewWaiters.shift();
      if (next) next();
      else this.activePreviewJobs--;
    }
  }

  public async openObject(fileUrl: string): Promise<NodeJS.ReadableStream> {
    const fileKey = decodeURIComponent(
      new URL(fileUrl, this.baseUrl).pathname.split("/").pop() || "",
    );
    const localPath = this.resolveLocalUploadPath(fileKey);
    if (!localPath) throw new Error("Invalid object key");
    if (process.env.NODE_ENV !== "production" && fs.existsSync(localPath)) {
      return fs.createReadStream(localPath);
    }
    if (!this.isMinioAvailable || !this.minioClient)
      throw new Error("MinIO is unavailable");
    return this.minioClient.getObject(this.bucketName, fileKey);
  }

  public async statObject(
    fileUrl: string,
  ): Promise<{ size: number; etag: string }> {
    const fileKey = decodeURIComponent(
      new URL(fileUrl, this.baseUrl).pathname.split("/").pop() || "",
    );
    const localPath = this.resolveLocalUploadPath(fileKey);
    if (!localPath) throw new Error("Invalid object key");
    if (process.env.NODE_ENV !== "production" && fs.existsSync(localPath)) {
      const stat = await fs.promises.stat(localPath);
      return {
        size: stat.size,
        etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      };
    }
    if (!this.isMinioAvailable || !this.minioClient)
      throw new Error("MinIO is unavailable");
    const stat = await this.minioClient.statObject(this.bucketName, fileKey);
    return { size: stat.size, etag: `"${stat.etag}"` };
  }

  public async openObjectRange(
    fileUrl: string,
    offset: number,
    length: number,
  ): Promise<NodeJS.ReadableStream> {
    const fileKey = decodeURIComponent(
      new URL(fileUrl, this.baseUrl).pathname.split("/").pop() || "",
    );
    const localPath = this.resolveLocalUploadPath(fileKey);
    if (!localPath) throw new Error("Invalid object key");
    if (process.env.NODE_ENV !== "production" && fs.existsSync(localPath)) {
      return fs.createReadStream(localPath, {
        start: offset,
        end: offset + length - 1,
      });
    }
    if (!this.isMinioAvailable || !this.minioClient)
      throw new Error("MinIO is unavailable");
    return this.minioClient.getPartialObject(
      this.bucketName,
      fileKey,
      offset,
      length,
    );
  }

  public verifyDownload(
    fileKey: string,
    channelId: string,
    expiresAt: number,
    signature: string,
    scope: { userId: string; sessionId: string; sessionVersion: number },
    variant: "original" | "preview" = "original",
    download = false,
  ): boolean {
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < Math.floor(Date.now() / 1000) ||
      !scope.userId ||
      !scope.sessionId ||
      !Number.isSafeInteger(scope.sessionVersion) ||
      scope.sessionVersion < 0
    )
      return false;
    const expected = this.signDownload(
      fileKey,
      channelId,
      expiresAt,
      variant,
      download,
      scope,
    );
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }

  private signLocalUpload(
    fileKey: string,
    userId: string,
    expiresAt: number,
  ): string {
    const secret =
      process.env.UPLOAD_SIGNING_SECRET ||
      process.env.JWT_SECRET ||
      "development-upload-secret";
    return createHmac("sha256", secret)
      .update(`${fileKey}:${userId}:${expiresAt}`)
      .digest("base64url");
  }

  private signDownload(
    fileKey: string,
    channelId: string,
    expiresAt: number,
    variant: "original" | "preview",
    download: boolean,
    scope: { userId: string; sessionId: string; sessionVersion: number },
  ): string {
    const secret =
      process.env.UPLOAD_SIGNING_SECRET ||
      process.env.JWT_SECRET ||
      "development-upload-secret";
    return createHmac("sha256", secret)
      .update(
        `download:${fileKey}:${channelId}:${expiresAt}:${variant}:${download ? 1 : 0}:${scope.userId}:${scope.sessionId}:${scope.sessionVersion}`,
      )
      .digest("base64url");
  }

  private rememberGrant(
    fileKey: string,
    userId: string,
    fileUrl: string,
    req: PresignedUploadRequest,
  ): void {
    this.uploadGrants.set(fileKey, {
      userId,
      fileUrl,
      fileSize: req.fileSize,
      mimeType: req.mimeType,
      expiresAt: Date.now() + 20 * 60_000,
      claimed: false,
      uploaded: false,
      purpose: req.purpose || "attachment",
      channelId: req.channelId,
      guildId: req.guildId,
    });
  }
}

export const storageService = new StorageService();
