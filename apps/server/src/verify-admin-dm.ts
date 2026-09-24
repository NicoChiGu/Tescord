import "./env.js";
import { prisma } from "./db.js";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3101";
const json = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { response, body: (await response.json().catch(() => ({}))) as any };
};

async function login(emailOrUsername: string, password: string) {
  const result = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername, password }),
  });
  if (!result.response.ok)
    throw new Error(`登录失败: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function runTests() {
  await prisma.user.update({
    where: { id: "usr_default_admin" },
    data: { role: "SUPER_ADMIN" },
  });
  const adminData = await login("Jackey", "adminpassword123");
  const auth = { Authorization: `Bearer ${adminData.accessToken}` };

  const forged = await json("/api/admin/overview", {
    headers: { Authorization: "Bearer forged.jwt.value" },
  });
  if (forged.response.status !== 401)
    throw new Error(`伪造令牌应返回 401，实际 ${forged.response.status}`);
  const users = await json("/api/admin/users?page=1&pageSize=2", {
    headers: auth,
  });
  if (
    !users.response.ok ||
    users.body.items?.length > 2 ||
    !users.body.pageInfo
  )
    throw new Error("管理员用户分页失败");

  const suffix = Date.now();
  const register = (name: string) =>
    json("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `${name}_${suffix}`,
        email: `${name}_${suffix}@test.local`,
        password: "password12345",
      }),
    });
  const bob = await register("BobSecure");
  const eve = await register("EveSecure");
  if (!bob.response.ok || !eve.response.ok)
    throw new Error("隔离测试账号注册失败");
  const bobAuth = { Authorization: `Bearer ${bob.body.accessToken}` };
  const eveAuth = { Authorization: `Bearer ${eve.body.accessToken}` };
  if (
    (await json("/api/admin/overview", { headers: bobAuth })).response
      .status !== 403
  )
    throw new Error("普通用户访问管理接口未返回 403");

  const dm = await json("/api/users/@me/channels", {
    method: "POST",
    headers: { ...bobAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ recipientId: adminData.user.id }),
  });
  if (!dm.response.ok)
    throw new Error(`创建 DM 失败: ${JSON.stringify(dm.body)}`);
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      json("/api/users/@me/channels", {
        method: "POST",
        headers: { ...bobAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: adminData.user.id }),
      }),
    ),
  );
  if (
    new Set(concurrent.map((item) => item.body.id)).size !== 1 ||
    concurrent[0].body.id !== dm.body.id
  )
    throw new Error("并发创建产生了重复 DM");

  const sent = await json(`/api/channels/${dm.body.id}/messages`, {
    method: "POST",
    headers: { ...bobAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "privacy boundary test" }),
  });
  if (!sent.response.ok || sent.body.sequence !== 1)
    throw new Error("DM 序号消息发送失败");
  if (
    (await json(`/api/channels/${dm.body.id}/messages`, { headers: eveAuth }))
      .response.status !== 403
  )
    throw new Error("第三方读取 DM 未被拦截");

  const read = await json(`/api/channels/${dm.body.id}/read`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ lastReadSequence: 1 }),
  });
  if (!read.response.ok || read.body.lastReadSequence !== 1)
    throw new Error("已读游标更新失败");
  const rewind = await json(`/api/channels/${dm.body.id}/read`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ lastReadSequence: 0 }),
  });
  if (!rewind.response.ok || rewind.body.lastReadSequence !== 1)
    throw new Error("已读游标发生倒退");

  const noCallToken = await json(`/api/channels/dm/${dm.body.id}/call-token`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      callId: "replayed-call",
      sessionId: "unknown-device",
    }),
  });
  if (noCallToken.response.status !== 403)
    throw new Error("无有效呼叫仍签发了媒体令牌");
  const ban = await json(`/api/admin/users/${bob.body.user.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ isBanned: true }),
  });
  if (!ban.response.ok)
    throw new Error(`封禁失败: ${JSON.stringify(ban.body)}`);
  if (
    (await json("/api/users/@me/channels", { headers: bobAuth })).response
      .status !== 401
  )
    throw new Error("封禁后旧令牌仍然有效");

  console.log(
    "PASS security-admin-dm: forged token, pagination, DM uniqueness/privacy/read cursor, call replay, session revocation",
  );
}

runTests()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
