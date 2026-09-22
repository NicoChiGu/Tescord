import { Client as MinioClient } from "minio";
import path from "path";
import fs from "fs";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
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
  private uploadGrants = new Map<string, {
    userId: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
    expiresAt: number;
    claimed: boolean;
  }>();

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
    const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
    if (!Number.isSafeInteger(req.fileSize) || req.fileSize <= 0 || req.fileSize > maxUploadBytes) {
      throw new Error(`文件大小必须在 1 到 ${maxUploadBytes} 字节之间`);
    }
    const blockedTypes = new Set([
      "text/html",
      "image/svg+xml",
      "application/xhtml+xml",
      "application/javascript",
    ]);
    if (blockedTypes.has((req.mimeType || "").toLowerCase())) {
      throw new Error("该文件类型不能作为附件上传");
    }
    const ext = path.extname(req.fileName) || "";
    if (new Set([".html", ".htm", ".svg", ".js", ".mjs", ".xhtml", ".xml"]).has(ext.toLowerCase())) {
      throw new Error("该文件扩展名不能作为附件上传");
    }
    const safeName = path
      .basename(req.fileName, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileKey = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}${ext}`;

    if (this.isMinioAvailable && this.minioClient) {
      try {
        // 生成 15 分钟有效期的 PUT 预签名 URL
        const uploadUrl = await this.minioClient.presignedPutObject(
          this.bucketName,
          fileKey,
          15 * 60,
        );
        const endPoint = process.env.MINIO_ENDPOINT || "localhost";
        const port = process.env.MINIO_PORT || "9000";
        const protocol =
          process.env.MINIO_USE_SSL === "true" ? "https" : "http";
        const fileUrl = `${protocol}://${endPoint}:${port}/${this.bucketName}/${fileKey}`;

        const response = {
          uploadUrl,
          fileUrl,
          fileKey,
        };
        this.rememberGrant(fileKey, userId, fileUrl, req);
        return response;
      } catch (err) {
        console.warn(
          "[StorageService] 生成 MinIO 预签名失败，降级为本地存储:",
          err,
        );
      }
    }

    // 本地存储模式降级
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
    const signature = this.signLocalUpload(fileKey, userId, expiresAt);
    const uploadUrl = `${this.baseUrl}/api/attachments/upload/${encodeURIComponent(fileKey)}?expires=${expiresAt}&signature=${encodeURIComponent(signature)}`;
    const fileUrl = `${this.baseUrl}/uploads/${encodeURIComponent(fileKey)}`;

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
    input: { url?: string; fileName?: string; fileSize?: number; mimeType?: string },
  ): { url: string; fileName: string; fileSize: number; mimeType: string } | null {
    const candidate = String(input.url || "");
    let fileKey = "";
    try {
      const parsed = new URL(candidate);
      fileKey = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    } catch {
      return null;
    }
    const grant = this.uploadGrants.get(fileKey);
    if (!grant || grant.claimed || grant.userId !== userId || grant.expiresAt < Date.now()) return null;
    if (candidate !== grant.fileUrl || Number(input.fileSize) !== grant.fileSize || String(input.mimeType) !== grant.mimeType) return null;
    grant.claimed = true;
    return {
      url: grant.fileUrl,
      fileName: path.basename(String(input.fileName || fileKey)).slice(0, 255),
      fileSize: grant.fileSize,
      mimeType: grant.mimeType,
    };
  }

  public verifyLocalUpload(
    fileKey: string,
    userId: string,
    expiresAt: number,
    signature: string,
  ): boolean {
    if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
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

  public async createDownloadUrl(fileUrl: string, channelId: string): Promise<string> {
    const fileKey = decodeURIComponent(new URL(fileUrl).pathname.split("/").pop() || "");
    if (!fileKey || path.basename(fileKey) !== fileKey) throw new Error("非法附件对象键");
    if (this.isMinioAvailable && this.minioClient && fileUrl.includes(`/${this.bucketName}/`)) {
      return this.minioClient.presignedGetObject(this.bucketName, fileKey, 5 * 60);
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
    const signature = this.signDownload(fileKey, channelId, expiresAt);
    return `${this.baseUrl}/attachments/${encodeURIComponent(fileKey)}?channelId=${encodeURIComponent(channelId)}&expires=${expiresAt}&signature=${encodeURIComponent(signature)}`;
  }

  public verifyDownload(fileKey: string, channelId: string, expiresAt: number, signature: string): boolean {
    if (!Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
    const expected = this.signDownload(fileKey, channelId, expiresAt);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private signLocalUpload(fileKey: string, userId: string, expiresAt: number): string {
    const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.JWT_SECRET || "development-upload-secret";
    return createHmac("sha256", secret)
      .update(`${fileKey}:${userId}:${expiresAt}`)
      .digest("base64url");
  }

  private signDownload(fileKey: string, channelId: string, expiresAt: number): string {
    const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.JWT_SECRET || "development-upload-secret";
    return createHmac("sha256", secret)
      .update(`download:${fileKey}:${channelId}:${expiresAt}`)
      .digest("base64url");
  }

  private rememberGrant(fileKey: string, userId: string, fileUrl: string, req: PresignedUploadRequest): void {
    this.uploadGrants.set(fileKey, {
      userId,
      fileUrl,
      fileSize: req.fileSize,
      mimeType: req.mimeType,
      expiresAt: Date.now() + 20 * 60_000,
      claimed: false,
    });
  }
}

export const storageService = new StorageService();
