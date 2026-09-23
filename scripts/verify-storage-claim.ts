import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StorageService } from "../apps/server/src/services/storage.service.js";

const previousCwd = process.cwd();
const testDir = mkdtempSync(path.join(tmpdir(), "tescord-storage-claim-"));
process.chdir(testDir);

async function run() {
  console.log("=== 开始执行 StorageService.claimAttachment 专项健壮性测试 ===");

  const storageService = new StorageService();
  const userId = "user-123";
  const channelId = "channel-123";

  // 1. 模拟生成上传预签名授权
  const presign = await storageService.getPresignedUploadUrl(
    {
      fileName: "test-attachment.png",
      fileSize: 1024,
      mimeType: "image/png",
      channelId,
    },
    userId,
  );

  console.log("生成的 presign 结果:", presign);
  assert.ok(presign.fileUrl, "应生成 fileUrl");
  assert.ok(presign.fileKey, "应生成 fileKey");
  await storageService.storeObject(presign.fileKey, Buffer.alloc(1024));

  // 2. 测试场景 A：标准绝对 URL 认领
  const claimAbsolute = storageService.claimAttachment(userId, channelId, {
    url: presign.fileUrl,
    fileName: "test-attachment.png",
    fileSize: 1024,
    mimeType: "image/png",
  });
  assert.ok(claimAbsolute, "标准绝对 URL 应当认领成功");
  assert.strictEqual(
    claimAbsolute.url,
    presign.fileUrl,
    "返回的 URL 必须是标准化的原始 URL",
  );
  assert.strictEqual(claimAbsolute.fileSize, 1024);
  assert.strictEqual(claimAbsolute.mimeType, "image/png");
  console.log("✔ 场景 A：标准绝对 URL 认领通过");

  // 3. 测试场景 B：防重放（已认领的凭证不可二次认领）
  const replayClaim = storageService.claimAttachment(userId, channelId, {
    url: presign.fileUrl,
    fileName: "test-attachment.png",
    fileSize: 1024,
    mimeType: "image/png",
  });
  assert.strictEqual(replayClaim, null, "已核销凭证二次认领必须返回 null");
  console.log("✔ 场景 B：防重放二次认领拦截通过");

  // 4. 测试场景 C：相对路径认领（前端由 resolveServerUrl 转换为相对路径如 /uploads/...）
  const presign2 = await storageService.getPresignedUploadUrl(
    {
      fileName: "screen_capture.jpg",
      fileSize: 2048,
      mimeType: "image/jpeg",
      channelId,
    },
    userId,
  );
  const relativeUrl = `/uploads/${encodeURIComponent(presign2.fileKey)}`;
  await storageService.storeObject(presign2.fileKey, Buffer.alloc(2048));
  const claimRelative = storageService.claimAttachment(userId, channelId, {
    url: relativeUrl,
    fileName: "screen_capture.jpg",
    fileSize: 2048,
    mimeType: "image/jpeg",
  });
  assert.ok(claimRelative, "相对路径 URL 应当兼容并认领成功");
  assert.strictEqual(
    claimRelative.url,
    presign2.fileUrl,
    "返回的 URL 必须自愈为服务端的规范 URL",
  );
  console.log("✔ 场景 C：相对路径 URL 认领通过");

  // 5. 测试场景 D：反向代理 / 局域网 Host 差异认领（如从 localhost:3001 代理为 192.168.1.5:3000）
  const presign3 = await storageService.getPresignedUploadUrl(
    {
      fileName: "document.pdf",
      fileSize: 4096,
      mimeType: "application/pdf",
      channelId,
    },
    userId,
  );
  const proxyUrl = `http://192.168.1.5:3000/uploads/${encodeURIComponent(presign3.fileKey)}`;
  await storageService.storeObject(presign3.fileKey, Buffer.alloc(4096));
  const claimProxy = storageService.claimAttachment(userId, channelId, {
    url: proxyUrl,
    fileName: "document.pdf",
    fileSize: 4096,
    mimeType: "application/pdf",
  });
  assert.ok(claimProxy, "反向代理不同 Host 应当成功识别并认领");
  assert.strictEqual(claimProxy.url, presign3.fileUrl);
  console.log("✔ 场景 D：反向代理不同 Host 认领通过");

  // 6. 测试场景 E：跨用户安全拦截
  const presign4 = await storageService.getPresignedUploadUrl(
    {
      fileName: "private.txt",
      fileSize: 512,
      mimeType: "text/plain",
      channelId,
    },
    userId,
  );
  const claimOtherUser = storageService.claimAttachment(
    "user-evil",
    channelId,
    {
      url: presign4.fileUrl,
      fileName: "private.txt",
      fileSize: 512,
      mimeType: "text/plain",
    },
  );
  assert.strictEqual(claimOtherUser, null, "非本人凭证必须被严格拒绝");
  console.log("✔ 场景 E：跨用户非法认领拦截通过");

  await storageService.storeObject(presign4.fileKey, Buffer.alloc(512));
  const claimOtherChannel = storageService.claimAttachment(
    userId,
    "other-channel",
    {
      url: presign4.fileUrl,
      fileName: "private.txt",
      fileSize: 512,
      mimeType: "text/plain",
    },
  );
  assert.strictEqual(claimOtherChannel, null, "跨频道凭证必须被严格拒绝");
  console.log("✔ 场景 F：跨频道非法认领拦截通过");

  // 7. 测试场景 G：文件大小/MIME 类型篡改拦截
  const claimTampered = storageService.claimAttachment(userId, channelId, {
    url: presign4.fileUrl,
    fileName: "private.txt",
    fileSize: 999999, // 篡改大小
    mimeType: "text/plain",
  });
  assert.strictEqual(claimTampered, null, "篡改文件大小必须被严格拒绝");
  console.log("✔ 场景 G：元数据篡改拦截通过");

  // 8. 测试场景 H：路径穿越与非法 key 拦截
  const claimTraversal = storageService.claimAttachment(userId, channelId, {
    url: "/uploads/../../etc/passwd",
    fileName: "passwd",
    fileSize: 512,
    mimeType: "text/plain",
  });
  assert.strictEqual(claimTraversal, null, "路径穿越必须被拒绝");
  console.log("✔ 场景 H：路径穿越防御通过");

  console.log("\n🎉 所有 8 项测试全部 100% 通过！");
}

run()
  .catch((err) => {
    console.error("❌ 测试失败:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.chdir(previousCwd);
    rmSync(testDir, { recursive: true, force: true });
  });
