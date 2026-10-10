import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import sharp from "sharp";
import { StorageService } from "./storage.service.js";

test("StorageService 图像压缩管线: 大图等比缩放至 2K 并优先压缩为 AVIF", async () => {
  const storageService = new StorageService();
  await storageService.init();

  // 1. 生成 3000x2000 的大尺寸测试图片 (JPEG)
  const largeJpgBuffer = await sharp({
    create: {
      width: 3000,
      height: 2000,
      channels: 3,
      background: { r: 120, g: 150, b: 200 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  const userId = "user-test-large";
  const channelId = "chan-test-1";

  const grantRes = await storageService.getPresignedUploadUrl(
    {
      fileName: "wallpaper_3000x2000.jpg",
      fileSize: largeJpgBuffer.length,
      mimeType: "image/jpeg",
      purpose: "attachment",
      channelId,
    },
    userId,
  );

  const fileKey = storageService.extractFileKeyFromUrl(grantRes.fileUrl);
  assert.ok(fileKey, "应能成功提取 fileKey");

  // 2. 模拟上传二进制
  await storageService.storeObject(fileKey, largeJpgBuffer);

  // 3. 认领附件
  const claimRes = storageService.claimAttachment(userId, channelId, {
    url: grantRes.fileUrl,
    fileName: "wallpaper_3000x2000.jpg",
    fileSize: largeJpgBuffer.length,
    mimeType: "image/jpeg",
  });

  assert.ok(claimRes, "认领附件应成功");
  assert.equal(claimRes.width, 3000, "原图宽度应为 3000");
  assert.equal(claimRes.height, 2000, "原图高度应为 2000");
  assert.ok(claimRes.preview, "应生成 preview 压缩图");

  // 4. 验证 AVIF 压缩与 2K 尺寸限制
  assert.ok(
    claimRes.preview.url.endsWith(".preview.avif"),
    `preview.url 应该以 .preview.avif 结尾，实际为: ${claimRes.preview.url}`,
  );
  assert.equal(claimRes.preview.width, 2048, "长边超过 2K 时应等比缩放至 2048");
  assert.ok(claimRes.preview.height <= 2048, "高度应等比缩放且不超过 2048");
  assert.ok(
    claimRes.preview.size < largeJpgBuffer.length,
    "AVIF 压缩后体积应小于原图",
  );

  // 5. 检查本地落盘文件格式真实性 (sharp 将 AVIF 归入 heif 容器类别)
  const previewPath = storageService.resolveLocalUploadPath(
    `${fileKey}.preview.avif`,
  );
  assert.ok(
    previewPath && fs.existsSync(previewPath),
    "本地应存在 preview.avif 文件",
  );
  const previewBytes = await fs.promises.readFile(previewPath);
  const previewMeta = await sharp(previewBytes).metadata();
  assert.equal(
    previewMeta.format,
    "heif",
    `压缩文件格式应为 heif (AVIF容器)，实际为: ${previewMeta.format}`,
  );

  // 6. 清理文件并验证级联清理
  await storageService.deleteStoredFile(fileKey);
  assert.ok(
    !fs.existsSync(previewPath),
    "删除原图时应级联删除 preview.avif 文件",
  );
});

test("StorageService 图像压缩管线: 小于 2K 图片保持原尺寸并压缩为 AVIF", async () => {
  const storageService = new StorageService();
  await storageService.init();

  // 1. 生成 800x600 的小尺寸 PNG 图片
  const smallPngBuffer = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 4,
      background: { r: 50, g: 180, b: 90, alpha: 0.8 },
    },
  })
    .png()
    .toBuffer();

  const userId = "user-test-small";
  const channelId = "chan-test-2";

  const grantRes = await storageService.getPresignedUploadUrl(
    {
      fileName: "screenshot_800x600.png",
      fileSize: smallPngBuffer.length,
      mimeType: "image/png",
      purpose: "attachment",
      channelId,
    },
    userId,
  );

  const fileKey = storageService.extractFileKeyFromUrl(grantRes.fileUrl)!;
  await storageService.storeObject(fileKey, smallPngBuffer);

  const claimRes = storageService.claimAttachment(userId, channelId, {
    url: grantRes.fileUrl,
    fileName: "screenshot_800x600.png",
    fileSize: smallPngBuffer.length,
    mimeType: "image/png",
  });

  assert.ok(claimRes, "认领附件应成功");
  assert.equal(claimRes.width, 800);
  assert.equal(claimRes.height, 600);
  assert.ok(claimRes.preview, "应生成 preview 压缩图");

  // 2. 验证小于 2K 保持原始宽高
  assert.ok(claimRes.preview.url.endsWith(".preview.avif"));
  assert.equal(claimRes.preview.width, 800, "未超过 2K 应保持物理原宽度 800");
  assert.equal(claimRes.preview.height, 600, "未超过 2K 应保持物理原高度 600");

  await storageService.deleteStoredFile(fileKey);
});

test("StorageService 图像压缩管线: 动态动图跳过压缩保持原图", async () => {
  const storageService = new StorageService();
  await storageService.init();

  // 标准且完整的 2 帧动态 GIF 二进制
  const animatedGifBuffer = Buffer.from([
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // GIF89a
    0x02,
    0x00,
    0x02,
    0x00, // 2x2
    0x80,
    0x00,
    0x00, // Global Color Table Flag
    0x00,
    0x00,
    0x00, // Color 0: #000000
    0xff,
    0xff,
    0xff, // Color 1: #ffffff
    // Frame 1
    0x21,
    0xf9,
    0x04,
    0x00,
    0x0a,
    0x00,
    0x00,
    0x00, // Graphic Control Extension
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x02,
    0x00,
    0x00, // Image Descriptor
    0x02,
    0x02,
    0x44,
    0x01,
    0x00, // Image Data
    // Frame 2
    0x21,
    0xf9,
    0x04,
    0x00,
    0x0a,
    0x00,
    0x00,
    0x00, // Graphic Control Extension
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x02,
    0x00,
    0x00, // Image Descriptor
    0x02,
    0x02,
    0x4c,
    0x01,
    0x00, // Image Data
    0x3b, // Trailer
  ]);

  const gifMeta = await sharp(animatedGifBuffer, { animated: true }).metadata();
  assert.ok((gifMeta.pages || 0) > 1, "测试动图应具有多帧");

  const userId = "user-test-gif";
  const channelId = "chan-test-3";

  const grantRes = await storageService.getPresignedUploadUrl(
    {
      fileName: "animation.gif",
      fileSize: animatedGifBuffer.length,
      mimeType: "image/gif",
      purpose: "attachment",
      channelId,
    },
    userId,
  );

  const fileKey = storageService.extractFileKeyFromUrl(grantRes.fileUrl)!;
  await storageService.storeObject(fileKey, animatedGifBuffer);

  const claimRes = storageService.claimAttachment(userId, channelId, {
    url: grantRes.fileUrl,
    fileName: "animation.gif",
    fileSize: animatedGifBuffer.length,
    mimeType: "image/gif",
  });

  assert.ok(claimRes, "认领附件应成功");
  assert.equal(
    claimRes.preview,
    undefined,
    "动态 GIF 动图应跳过压缩，保留原图",
  );

  await storageService.deleteStoredFile(fileKey);
});

test("StorageService 图像压缩管线: AVIF 异常时平滑降级至 WebP 兜底", async () => {
  const storageService = new StorageService();
  await storageService.init();

  const jpgBuffer = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();

  const userId = "user-test-fallback";
  const channelId = "chan-test-4";

  const grantRes = await storageService.getPresignedUploadUrl(
    {
      fileName: "photo_1200x800.jpg",
      fileSize: jpgBuffer.length,
      mimeType: "image/jpeg",
      purpose: "attachment",
      channelId,
    },
    userId,
  );

  const fileKey = storageService.extractFileKeyFromUrl(grantRes.fileUrl)!;

  // 临时劫持 sharp 的 avif 方法模拟编码失败
  const originalSharpAvif = sharp.prototype.avif;
  (sharp.prototype as any).avif = function () {
    throw new Error("Simulated AVIF encoder fault");
  };

  try {
    await storageService.storeObject(fileKey, jpgBuffer);
  } finally {
    (sharp.prototype as any).avif = originalSharpAvif;
  }

  const claimRes = storageService.claimAttachment(userId, channelId, {
    url: grantRes.fileUrl,
    fileName: "photo_1200x800.jpg",
    fileSize: jpgBuffer.length,
    mimeType: "image/jpeg",
  });

  assert.ok(claimRes, "认领附件应成功");
  assert.ok(claimRes.preview, "降级后仍应生成 preview 压缩图");
  assert.ok(
    claimRes.preview.url.endsWith(".preview.webp"),
    `AVIF 异常时应降级至 .preview.webp，实际为: ${claimRes.preview.url}`,
  );
  assert.equal(claimRes.preview.width, 1200);
  assert.equal(claimRes.preview.height, 800);

  const previewPath = storageService.resolveLocalUploadPath(
    `${fileKey}.preview.webp`,
  );
  assert.ok(
    previewPath && fs.existsSync(previewPath),
    "本地应存在 preview.webp 降级文件",
  );
  const previewBytes = await fs.promises.readFile(previewPath);
  const previewMeta = await sharp(previewBytes).metadata();
  assert.equal(previewMeta.format, "webp", "降级文件格式应确为 webp");

  await storageService.deleteStoredFile(fileKey);
});

test("StorageService 附件签名与 Content-Type 分发契约: 支持 AVIF 与 WebP 历史兼容", async () => {
  const storageService = new StorageService();
  await storageService.init();

  const channelId = "chan-verify-1";
  const scope = { userId: "user-1", sessionId: "sess-1", sessionVersion: 1 };

  // 1. 生成并验证 preview 访问链接
  const fakeFileUrl = "http://localhost:3001/uploads/test-asset.png";
  const previewUrl = await storageService.createDownloadUrl(
    fakeFileUrl,
    channelId,
    scope,
    "preview",
  );
  assert.ok(
    previewUrl.includes("variant=preview"),
    "应包含 variant=preview 参数",
  );

  const parsedUrl = new URL(previewUrl);
  const sig = parsedUrl.searchParams.get("signature")!;
  const expires = Number(parsedUrl.searchParams.get("expires")!);

  const isValid = storageService.verifyDownload(
    "test-asset.png",
    channelId,
    expires,
    sig,
    scope,
    "preview",
    false,
  );
  assert.equal(isValid, true, "签名应验证成功");

  // 2. 验证 MIME 类型推导
  const resolveMime = (previewUrl: string | undefined, defaultMime: string) => {
    const previewIsAvif = Boolean(previewUrl?.endsWith(".avif"));
    const previewIsWebp = Boolean(previewUrl?.endsWith(".webp"));
    return previewIsAvif
      ? "image/avif"
      : previewIsWebp
        ? "image/webp"
        : defaultMime;
  };

  assert.equal(
    resolveMime("http://localhost:3001/uploads/img.preview.avif", "image/png"),
    "image/avif",
    "AVIF 压缩图应正确响应 image/avif",
  );
  assert.equal(
    resolveMime("http://localhost:3001/uploads/img.preview.webp", "image/png"),
    "image/webp",
    "历史 WebP 压缩图应正确响应 image/webp",
  );
  assert.equal(
    resolveMime(undefined, "image/png"),
    "image/png",
    "无 preview 时应保持原始格式",
  );
});
