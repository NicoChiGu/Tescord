import assert from "node:assert/strict";
import { server } from "../apps/server/src/index.ts";
import { prisma } from "../apps/server/src/db.js";

async function main() {
  console.log("=== 开始验证 /api/custom-emojis/:id 公开访问与兜底机制 ===");
  await server.ready();

  const missingEmojiId = "cmv27pzb00054qr3kbi34zif6";

  // 用例 1: 匿名访问不存在的表情（模拟浏览器 <img> 请求或直接访问）
  console.log("用例 1: GET /api/custom-emojis/:id (无 Authorization, 默认/图片 Accept)");
  const resImage = await server.inject({
    method: "GET",
    url: `/api/custom-emojis/${missingEmojiId}`,
    headers: {
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  assert.notEqual(resImage.statusCode, 401, "不应被全局认证钩子拦截返回 401");
  assert.equal(resImage.statusCode, 404, "不存在的表情应返回 404 状态码");
  assert.ok(
    String(resImage.headers["content-type"]).includes("image/svg+xml"),
    "响应头 Content-Type 应为 image/svg+xml",
  );
  assert.equal(
    resImage.headers["cache-control"],
    "public, max-age=60",
    "应包含 60 秒短期缓存防高频回源穿透",
  );
  assert.ok(
    resImage.payload.includes("<svg") && resImage.payload.includes("</svg>"),
    "响应内容应为有效 SVG 占位图",
  );
  console.log("✓ 用例 1 通过：匿名图片请求未拦截 401，成功返回 404 SVG 占位图！");

  // 用例 2: HEAD 方法匿名访问
  console.log("用例 2: HEAD /api/custom-emojis/:id (无 Authorization)");
  const resHead = await server.inject({
    method: "HEAD",
    url: `/api/custom-emojis/${missingEmojiId}`,
  });
  assert.notEqual(resHead.statusCode, 401, "HEAD 请求不应被 401 拦截");
  assert.equal(resHead.statusCode, 404, "HEAD 请求应返回 404");
  console.log("✓ 用例 2 通过：HEAD 请求免鉴权放行！");

  // 用例 3: 匿名访问不存在的表情（显式请求 JSON）
  console.log("用例 3: GET /api/custom-emojis/:id (Accept: application/json)");
  const resJson = await server.inject({
    method: "GET",
    url: `/api/custom-emojis/${missingEmojiId}`,
    headers: {
      accept: "application/json",
    },
  });
  assert.notEqual(resJson.statusCode, 401, "JSON 请求不应返回 401");
  assert.equal(resJson.statusCode, 404, "应返回 404");
  const parsedJson = JSON.parse(resJson.payload);
  assert.equal(parsedJson.code, "EMOJI_NOT_FOUND", "错误码应为 EMOJI_NOT_FOUND");
  console.log("✓ 用例 3 通过：JSON 内容协商契约正常，返回标准 EMOJI_NOT_FOUND！");

  // 用例 4: 存在自定义表情时的匿名 302 重定向
  console.log("用例 4: GET /api/custom-emojis/:id (存在表情时匿名重定向)");
  let testUser = await prisma.user.findFirst();
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        username: "emoji_test_user",
        email: "emoji_test@example.com",
        passwordHash: "hash123",
      },
    });
  }

  const testEmoji = await prisma.customEmoji.create({
    data: {
      name: "test_smile",
      imageUrl: "http://localhost:3001/public-assets/test-smile.png",
      animated: false,
      createdById: testUser.id,
    },
  });

  try {
    const resRedirect = await server.inject({
      method: "GET",
      url: `/api/custom-emojis/${testEmoji.id}`,
    });

    assert.equal(resRedirect.statusCode, 302, "存在的表情应返回 302 重定向");
    assert.equal(
      resRedirect.headers.location,
      "http://localhost:3001/public-assets/test-smile.png",
      "重定向目标应为表情 imageUrl",
    );
    assert.equal(
      resRedirect.headers["cache-control"],
      "public, max-age=86400, stale-while-revalidate=604800",
      "应包含长缓存控制头",
    );
    console.log("✓ 用例 4 通过：存在的表情成功 302 重定向至图片地址！");
  } finally {
    await prisma.customEmoji.delete({ where: { id: testEmoji.id } });
  }

  console.log("=== 全部用例验证通过！===");
  process.exit(0);
}

main().catch((err) => {
  console.error("验证失败:", err);
  process.exit(1);
});
