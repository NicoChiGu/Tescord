import { Client as MinioClient } from "minio";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
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
  ): Promise<PresignedUploadResponse> {
    const ext = path.extname(req.fileName) || "";
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

        return {
          uploadUrl,
          fileUrl,
          fileKey,
        };
      } catch (err) {
        console.warn(
          "[StorageService] 生成 MinIO 预签名失败，降级为本地存储:",
          err,
        );
      }
    }

    // 本地存储模式降级
    const uploadUrl = `${this.baseUrl}/api/attachments/upload/${encodeURIComponent(fileKey)}`;
    const fileUrl = `${this.baseUrl}/uploads/${encodeURIComponent(fileKey)}`;

    return {
      uploadUrl,
      fileUrl,
      fileKey,
    };
  }
}

export const storageService = new StorageService();
