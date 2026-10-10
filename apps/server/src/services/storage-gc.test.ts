import assert from "node:assert/strict";
import { test } from "node:test";
import { StorageGcService } from "./storage-gc.service.js";

test("StorageGcService: 仅清理超过缓冲期的解绑附件，保护正常附件与缓冲期草稿", async () => {
  const deletedFiles: string[] = [];
  const deletedDbIds: string[] = [];

  const now = Date.now();
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

  // 模拟附件数据
  const mockAttachments = [
    {
      id: "att-active",
      messageId: "msg-123",
      createdAt: twoDaysAgo,
      url: "http://localhost:3001/uploads/active.png",
      previewUrl: "http://localhost:3001/uploads/active.png.preview.webp",
      fileSize: 1024,
      previewSize: 256,
    },
    {
      id: "att-recent-unbound",
      messageId: null,
      createdAt: tenMinutesAgo, // 刚删除10分钟，未超24h缓冲期
      url: "http://localhost:3001/uploads/recent.png",
      previewUrl: null,
      fileSize: 2048,
      previewSize: 0,
    },
    {
      id: "att-expired-unbound",
      messageId: null,
      createdAt: twoDaysAgo, // 超过24h缓冲期
      url: "http://localhost:3001/uploads/expired.png",
      previewUrl: "http://localhost:3001/uploads/expired.png.preview.webp",
      fileSize: 4096,
      previewSize: 512,
    },
  ];

  const mockPrisma: any = {
    attachment: {
      findMany: async ({ where }: any) => {
        return mockAttachments.filter((a) => {
          if (where?.messageId === null && a.messageId !== null) return false;
          if (where?.createdAt?.lt && a.createdAt >= where.createdAt.lt)
            return false;
          return true;
        });
      },
      deleteMany: async ({ where }: any) => {
        const ids = where.id.in as string[];
        deletedDbIds.push(...ids);
        return { count: ids.length };
      },
      aggregate: async ({ where }: any) => {
        const filtered = mockAttachments.filter((a) =>
          where?.messageId === null
            ? a.messageId === null
            : a.messageId !== null,
        );
        const sumFile = filtered.reduce((acc, a) => acc + a.fileSize, 0);
        const sumPrev = filtered.reduce(
          (acc, a) => acc + (a.previewSize || 0),
          0,
        );
        return {
          _sum: { fileSize: sumFile, previewSize: sumPrev },
          _count: filtered.length,
        };
      },
    },
    user: { findMany: async () => [] },
    guild: { findMany: async () => [] },
    customEmoji: { findMany: async () => [] },
  };

  const mockStorageService: any = {
    extractFileKeyFromUrl: (url: string) => url.split("/").pop() || null,
    deleteStoredFile: async (key: string) => {
      deletedFiles.push(key);
      return true;
    },
    listAllStoredObjects: async () => [
      { key: "active.png", size: 1024, lastModified: twoDaysAgo },
      { key: "active.png.preview.webp", size: 256, lastModified: twoDaysAgo },
      { key: "recent.png", size: 2048, lastModified: tenMinutesAgo },
      { key: "expired.png", size: 4096, lastModified: twoDaysAgo },
      {
        key: "expired.png.preview.webp",
        size: 512,
        lastModified: twoDaysAgo,
      },
      {
        key: "abandoned-draft.png",
        size: 8192,
        lastModified: twoDaysAgo, // 超过24h的废弃草稿
      },
      {
        key: "new-draft.png",
        size: 1024,
        lastModified: tenMinutesAgo, // 正在编辑中的新草稿
      },
    ],
  };

  const gcService = new StorageGcService(mockPrisma, mockStorageService);

  // 1. 测试统计查询
  const stats = await gcService.getStorageStats();
  assert.equal(stats.activeAttachmentCount, 1);
  assert.equal(stats.activeAttachmentBytes, 1024 + 256);
  assert.equal(stats.orphanedAttachmentCount, 2);
  assert.equal(stats.orphanedAttachmentBytes, 2048 + 4096 + 512);
  assert.equal(stats.orphanedDraftCount, 2); // abandoned-draft.png 和 new-draft.png

  // 2. 执行垃圾回收
  const result = await gcService.runGc();
  assert.equal(result.success, true);
  assert.equal(result.deletedAttachmentRecords, 1); // 仅 att-expired-unbound 被删除
  assert.deepEqual(deletedDbIds, ["att-expired-unbound"]);

  // 3. 验证物理文件删除
  // 应该删除：expired.png, expired.png.preview.webp, abandoned-draft.png
  // 严禁删除：active.png, recent.png (未超缓冲期), new-draft.png (未超缓冲期)
  assert.ok(deletedFiles.includes("expired.png"));
  assert.ok(deletedFiles.includes("expired.png.preview.webp"));
  assert.ok(deletedFiles.includes("abandoned-draft.png"));
  assert.ok(!deletedFiles.includes("active.png"));
  assert.ok(!deletedFiles.includes("recent.png"));
  assert.ok(!deletedFiles.includes("new-draft.png"));

  // 4. 验证释放总字节数
  // 4096 (expired) + 512 (expired preview) + 8192 (abandoned draft) = 12800
  assert.equal(result.freedBytes, 4096 + 512 + 8192);
});

test("StorageGcService: 运行中并发保护", async () => {
  const mockPrisma: any = {
    attachment: {
      findMany: async () => {
        // 模拟慢速查询
        await new Promise((r) => setTimeout(r, 50));
        return [];
      },
    },
    user: { findMany: async () => [] },
    guild: { findMany: async () => [] },
    customEmoji: { findMany: async () => [] },
  };

  const mockStorageService: any = {
    listAllStoredObjects: async () => [],
    extractFileKeyFromUrl: () => null,
    deleteStoredFile: async () => true,
  };

  const gcService = new StorageGcService(mockPrisma, mockStorageService);

  const firstPromise = gcService.runGc();
  await assert.rejects(
    async () => {
      await gcService.runGc();
    },
    { message: "垃圾回收任务正在运行中，请勿重复触发" },
  );

  await firstPromise;
});
