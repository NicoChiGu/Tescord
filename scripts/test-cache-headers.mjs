import assert from "node:assert/strict";
// Import the TypeScript source through the package's tsx runner so this test
// never validates a stale or pre-existing dist build.
import { server } from "../apps/server/src/index.ts";

async function main() {
  console.log("=== 开始验证静态资源与附件错误响应防 CDN 缓存标头 ===");

  await server.ready();

  // 测试用例 1：请求不存在的 public-assets 图片
  console.log("用例 1: GET /public-assets/nonexistent-test.png (404)");
  const res1 = await server.inject({
    method: "GET",
    url: "/public-assets/nonexistent-test.png",
  });

  assert.equal(res1.statusCode, 404, "状态码应为 404");
  assert.equal(
    res1.headers["cache-control"],
    "no-store, no-cache, must-revalidate, max-age=0",
    "Cache-Control 必须为 no-store 防负向缓存",
  );
  assert.equal(
    res1.headers["cloudflare-cdn-cache-control"],
    "no-store",
    "Cloudflare-CDN-Cache-Control 必须为 no-store",
  );
  assert.equal(
    res1.headers["cdn-cache-control"],
    "no-store",
    "CDN-Cache-Control 必须为 no-store",
  );
  assert.equal(res1.headers["pragma"], "no-cache", "Pragma 必须为 no-cache");
  assert.deepEqual(
    JSON.parse(res1.payload),
    { error: "资源不存在" },
    "响应体应为资源不存在",
  );
  console.log("✓ 用例 1 通过：404 响应头包含所有防 Cloudflare 负向缓存指令！");

  // 测试用例 2：请求非图片类型的非法 public-assets
  console.log("用例 2: GET /public-assets/malicious.sh (404)");
  const res2 = await server.inject({
    method: "GET",
    url: "/public-assets/malicious.sh",
  });

  assert.equal(res2.statusCode, 404, "非图片扩展名应被拒绝为 404");
  assert.equal(
    res2.headers["cache-control"],
    "no-store, no-cache, must-revalidate, max-age=0",
    "非法扩展名必须返回 no-store",
  );
  assert.equal(
    res2.headers["cloudflare-cdn-cache-control"],
    "no-store",
    "Cloudflare-CDN-Cache-Control 必须为 no-store",
  );
  console.log("✓ 用例 2 通过：非法扩展名安全拒绝且防缓存！");

  // 测试用例 3：未授权访问私有附件 /attachments/:fileName (403)
  console.log("用例 3: GET /attachments/some-attachment.png (403)");
  const res3 = await server.inject({
    method: "GET",
    url: "/attachments/some-attachment.png",
  });

  assert.equal(res3.statusCode, 403, "缺少授权凭证应返回 403");
  assert.equal(
    res3.headers["cache-control"],
    "no-store, no-cache, must-revalidate, max-age=0",
    "403 错误必须设置 no-store 防止 CDN 错误缓存",
  );
  assert.equal(
    res3.headers["cloudflare-cdn-cache-control"],
    "no-store",
    "403 错误必须设置 Cloudflare-CDN-Cache-Control: no-store",
  );
  console.log("✓ 用例 3 通过：私有附件 403 错误防 CDN 缓存保护生效！");

  // 测试用例 4：校验 404 响应头不遗留任何旧的 max-age
  assert.ok(
    !res1.headers["cache-control"].includes("max-age=86400"),
    "404 响应头绝对不能包含旧的 max-age=86400",
  );
  console.log("✓ 用例 4 通过：彻底确认 404 绝不附带正向强缓存！");

  console.log("\n🎉 所有缓存防负向污染测试用例 100% 通过！");
  await server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 验证测试失败:", err);
  server.close().finally(() => process.exit(1));
});
