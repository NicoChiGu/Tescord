import "../src/env.js";
import { server } from "../src/index.js";

async function main() {
  await server.ready();
  console.log("🚀 Fastify server ready for verification!");

  // 1. 测试 Jackey 管理员登录
  console.log("\n--- 测试 1: Jackey (SUPER_ADMIN) 登录与受保护接口 ---");
  const loginRes = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      emailOrUsername: "Jackey",
      password: "adminpassword123",
    },
  });

  console.log("POST /api/auth/login -> status:", loginRes.statusCode);
  if (loginRes.statusCode !== 200) {
    throw new Error(`登录失败: ${loginRes.body}`);
  }

  const { accessToken, user } = JSON.parse(loginRes.body);
  console.log("登录成功，用户:", user.username, "Token 载荷已签发");

  const protectedEndpoints = [
    { method: "GET", url: "/api/auth/me" },
    { method: "GET", url: "/api/guilds" },
    { method: "GET", url: "/api/users/@me/channels" },
    { method: "GET", url: "/api/users/@me/settings" },
  ];

  for (const ep of protectedEndpoints) {
    const res = await server.inject({
      method: ep.method as any,
      url: ep.url,
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });
    console.log(`${ep.method} ${ep.url} -> status: ${res.statusCode}`);
    if (res.statusCode !== 200) {
      throw new Error(`受保护接口调用失败: ${res.body}`);
    }
  }

  // 2. 测试 Alice (普通用户) 登录与鉴权
  console.log("\n--- 测试 2: Alice (USER) 登录与受保护接口 ---");
  const aliceLoginRes = await server.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      emailOrUsername: "alice@tescord.local",
      password: "alicepassword123",
    },
  });

  console.log(
    "POST /api/auth/login (Alice) -> status:",
    aliceLoginRes.statusCode,
  );
  if (aliceLoginRes.statusCode !== 200) {
    throw new Error(`Alice 登录失败: ${aliceLoginRes.body}`);
  }

  const aliceToken = JSON.parse(aliceLoginRes.body).accessToken;
  const aliceMeRes = await server.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: {
      authorization: `Bearer ${aliceToken}`,
    },
  });
  console.log("GET /api/auth/me (Alice) -> status:", aliceMeRes.statusCode);
  if (aliceMeRes.statusCode !== 200) {
    throw new Error(`Alice /api/auth/me 失败: ${aliceMeRes.body}`);
  }

  console.log(
    "\n🎉 所有真实鉴权链路测试全部 PASS！未再出现任何 401 会话失效问题！",
  );
  await server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 验证测试失败:", err);
  process.exit(1);
});
