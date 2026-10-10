import { PrismaClient } from "@prisma/client";
import { AdminGcResult, AdminStorageStats } from "@tescord/types";
import { prisma } from "../db.js";
import { StorageService, storageService } from "./storage.service.js";

export class StorageGcService {
  private lastGcTimestamp: number | null = null;
  private gcTimer: NodeJS.Timeout | null = null;
  private isGcRunning = false;

  constructor(
    private prisma: PrismaClient,
    private storageService: StorageService,
  ) {}

  public async getStorageStats(): Promise<AdminStorageStats> {
    // 1. 统计有效关联附件 (messageId IS NOT NULL)
    const activeAgg = await this.prisma.attachment.aggregate({
      where: { messageId: { not: null } },
      _sum: { fileSize: true, previewSize: true },
      _count: true,
    });
    const activeAttachmentBytes =
      (activeAgg._sum.fileSize || 0) + (activeAgg._sum.previewSize || 0);
    const activeAttachmentCount = activeAgg._count;

    // 2. 统计已解绑待回收附件 (messageId IS NULL)
    const orphanedAgg = await this.prisma.attachment.aggregate({
      where: { messageId: null },
      _sum: { fileSize: true, previewSize: true },
      _count: true,
    });
    const orphanedAttachmentBytes =
      (orphanedAgg._sum.fileSize || 0) + (orphanedAgg._sum.previewSize || 0);
    const orphanedAttachmentCount = orphanedAgg._count;

    // 3. 统计物理存储对象
    const allObjects = await this.storageService.listAllStoredObjects();
    const totalUsedBytes =
      allObjects.length > 0
        ? allObjects.reduce((acc, item) => acc + item.size, 0)
        : activeAttachmentBytes + orphanedAttachmentBytes;

    // 4. 计算草稿孤儿文件（存在于物理存储中，但在数据库 Attachment 中无对应记录）
    const referencedKeys = await this.getAllReferencedFileKeys();
    let orphanedDraftBytes = 0;
    let orphanedDraftCount = 0;

    for (const obj of allObjects) {
      if (!referencedKeys.has(obj.key)) {
        orphanedDraftBytes += obj.size;
        orphanedDraftCount++;
      }
    }

    return {
      totalUsedBytes,
      activeAttachmentBytes,
      activeAttachmentCount,
      orphanedAttachmentBytes,
      orphanedAttachmentCount,
      orphanedDraftBytes,
      orphanedDraftCount,
      lastGcTimestamp: this.lastGcTimestamp,
    };
  }

  public async runGc(options?: {
    gracePeriodMs?: number;
  }): Promise<AdminGcResult> {
    if (this.isGcRunning) {
      throw new Error("垃圾回收任务正在运行中，请勿重复触发");
    }

    this.isGcRunning = true;
    const startTime = Date.now();
    const gracePeriodMs = options?.gracePeriodMs ?? 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - gracePeriodMs);

    let deletedAttachmentRecords = 0;
    let deletedPhysicalFiles = 0;
    let freedBytes = 0;

    try {
      // 阶段 1：清理已解绑超过缓冲期的附件 (messageId IS NULL)
      const orphanedAttachments = await this.prisma.attachment.findMany({
        where: {
          messageId: null,
          createdAt: { lt: cutoff },
        },
        select: {
          id: true,
          url: true,
          previewUrl: true,
          fileSize: true,
          previewSize: true,
        },
      });

      for (const att of orphanedAttachments) {
        const fileKey = this.storageService.extractFileKeyFromUrl(att.url);
        if (fileKey) {
          const removed = await this.storageService.deleteStoredFile(fileKey);
          if (removed) {
            deletedPhysicalFiles++;
            freedBytes += att.fileSize;
          }
        }

        if (att.previewUrl) {
          const previewKey = this.storageService.extractFileKeyFromUrl(
            att.previewUrl,
          );
          if (previewKey) {
            const removed =
              await this.storageService.deleteStoredFile(previewKey);
            if (removed) {
              deletedPhysicalFiles++;
              freedBytes += att.previewSize || 0;
            }
          }
        }
      }

      if (orphanedAttachments.length > 0) {
        const deleteRes = await this.prisma.attachment.deleteMany({
          where: {
            id: { in: orphanedAttachments.map((a) => a.id) },
          },
        });
        deletedAttachmentRecords = deleteRes.count;
      }

      // 阶段 2：扫描并物理清理上传后放弃发送的草稿孤儿文件
      const allObjects = await this.storageService.listAllStoredObjects();
      const referencedKeys = await this.getAllReferencedFileKeys();

      for (const obj of allObjects) {
        // 仅处理修改时间超过安全缓冲期且无任何数据库引用的文件
        if (obj.lastModified < cutoff && !referencedKeys.has(obj.key)) {
          const removed = await this.storageService.deleteStoredFile(obj.key);
          if (removed) {
            deletedPhysicalFiles++;
            freedBytes += obj.size;
          }
        }
      }

      this.lastGcTimestamp = Date.now();
      const durationMs = Date.now() - startTime;

      console.log(
        `[StorageGcService] GC completed in ${durationMs}ms: ` +
          `deletedRecords=${deletedAttachmentRecords}, deletedFiles=${deletedPhysicalFiles}, ` +
          `freedBytes=${freedBytes} (${(freedBytes / (1024 * 1024)).toFixed(2)} MB)`,
      );

      return {
        success: true,
        deletedAttachmentRecords,
        deletedPhysicalFiles,
        freedBytes,
        durationMs,
        executedAt: this.lastGcTimestamp,
      };
    } finally {
      this.isGcRunning = false;
    }
  }

  public startDailySchedule(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(async () => {
      try {
        await this.runGc();
      } catch (err) {
        console.warn("[StorageGcService] Scheduled GC run failed:", err);
      }
    }, intervalMs);
    this.gcTimer.unref();
  }

  public stopDailySchedule(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  private async getAllReferencedFileKeys(): Promise<Set<string>> {
    const keys = new Set<string>();

    // 1. 所有 Attachment 的原图与缩略图
    const attachments = await this.prisma.attachment.findMany({
      select: { url: true, previewUrl: true },
    });
    for (const a of attachments) {
      const k = this.storageService.extractFileKeyFromUrl(a.url);
      if (k) keys.add(k);
      if (a.previewUrl) {
        const pk = this.storageService.extractFileKeyFromUrl(a.previewUrl);
        if (pk) keys.add(pk);
      }
    }

    // 2. 所有 User 的头像与横幅
    const users = await this.prisma.user.findMany({
      select: { avatarUrl: true, bannerUrl: true },
    });
    for (const u of users) {
      if (u.avatarUrl) {
        const k = this.storageService.extractFileKeyFromUrl(u.avatarUrl);
        if (k) keys.add(k);
      }
      if (u.bannerUrl) {
        const k = this.storageService.extractFileKeyFromUrl(u.bannerUrl);
        if (k) keys.add(k);
      }
    }

    // 3. 所有 Guild 的图标
    const guilds = await this.prisma.guild.findMany({
      select: { iconUrl: true },
    });
    for (const g of guilds) {
      if (g.iconUrl) {
        const k = this.storageService.extractFileKeyFromUrl(g.iconUrl);
        if (k) keys.add(k);
      }
    }

    // 4. 所有 CustomEmoji 的图片
    const emojis = await this.prisma.customEmoji.findMany({
      select: { imageUrl: true },
    });
    for (const e of emojis) {
      if (e.imageUrl) {
        const k = this.storageService.extractFileKeyFromUrl(e.imageUrl);
        if (k) keys.add(k);
      }
    }

    return keys;
  }
}

export const storageGcService = new StorageGcService(prisma, storageService);
