import { config } from "dotenv";
config();

async function runVerification() {
  console.log("🧪 开始 Phase 2 (2.1 & 2.2) 核心端到端功能验证...");
  const baseUrl = "http://localhost:3001";

  // 1. 检查后端健康状态
  const healthRes = await fetch(`${baseUrl}/health`);
  if (!healthRes.ok) throw new Error("Health check failed");
  console.log("✅ 1. 服务健康检查通过");

  // 2. 登录预设管理员账号
  console.log("🔑 2. 测试预设管理员登录 (admin@tescord.local)...");
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: "admin@tescord.local",
      password: "adminpassword123",
    }),
  });
  if (!adminLoginRes.ok) {
    const err = await adminLoginRes.text();
    throw new Error(`Admin login failed: ${err}`);
  }
  const adminTokens = await adminLoginRes.json();
  console.log("✅ 2. 管理员登录成功，获取到 Access Token 与 Refresh Token:", {
    user: adminTokens.user.username,
    hasAccessToken: !!adminTokens.accessToken,
    hasRefreshToken: !!adminTokens.refreshToken,
  });

  // 3. 测试受保护接口 GET /api/auth/me
  console.log("🛡️ 3. 测试携带 JWT 请求 /api/auth/me...");
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${adminTokens.accessToken}` },
  });
  if (!meRes.ok) throw new Error("GET /api/auth/me failed");
  const meData = await meRes.json();
  if (meData.email !== "admin@tescord.local")
    throw new Error("User data mismatch");
  console.log("✅ 3. 受保护路由鉴权通过，当前用户:", meData.username);

  // 4. 注册新用户
  const testUser = {
    username: `tester_${Date.now().toString().slice(-4)}`,
    email: `tester_${Date.now().toString().slice(-4)}@tescord.local`,
    password: "password_tester_123",
  };
  console.log("📝 4. 测试新用户注册:", testUser.username);
  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testUser),
  });
  if (!registerRes.ok) {
    const err = await registerRes.text();
    throw new Error(`Register failed: ${err}`);
  }
  const userTokens = await registerRes.json();
  console.log(
    "✅ 4. 新用户注册成功并自动获取双令牌:",
    userTokens.user.username,
  );

  // 5. 测试双令牌无感刷新 POST /api/auth/refresh
  console.log("🔄 5. 测试 Refresh Token 轮换与刷新...");
  const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: userTokens.refreshToken }),
  });
  if (!refreshRes.ok) {
    const err = await refreshRes.text();
    throw new Error(`Token refresh failed: ${err}`);
  }
  const refreshedTokens = await refreshRes.json();
  console.log("✅ 5. Refresh Token 成功轮换，已签发新令牌对");

  // 6. 测试个人资料更新 PATCH /api/users/@me
  console.log("🎨 6. 测试修改个人状态与签名...");
  const updateRes = await fetch(`${baseUrl}/api/users/@me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${refreshedTokens.accessToken}`,
    },
    body: JSON.stringify({
      customStatus: "正在执行自动化集成测试 🚀",
      bio: "自动化测试特命专员",
      status: "DND",
    }),
  });
  if (!updateRes.ok) {
    const err = await updateRes.text();
    throw new Error(`Update profile failed: ${err}`);
  }
  const updatedUser = await updateRes.json();
  if (updatedUser.status !== "DND") throw new Error("Status update mismatch");
  console.log("✅ 6. 个人资料与 Presence 状态更新成功:", {
    status: updatedUser.status,
    customStatus: updatedUser.customStatus,
  });

  // 7. 测试公会数据查询与成员持久化
  console.log("🏰 7. 测试公会列表与成员关系...");
  const guildsRes = await fetch(`${baseUrl}/api/guilds`);
  const guilds = await guildsRes.json();
  if (!guilds || guilds.length === 0) throw new Error("No guilds found");
  console.log(
    `✅ 7. 成功获取公会: ${guilds[0].name}, 拥有频道数: ${guilds[0].channels.length}, 成员数: ${guilds[0].members.length}`,
  );

  // 8. 测试频道发信与持久化
  const channel = guilds[0].channels[0];
  console.log(`💬 8. 测试在频道 [${channel.name}] 发送持久化消息...`);
  const sendMsgRes = await fetch(
    `${baseUrl}/api/channels/${channel.id}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Hello from ${userTokens.user.username}! 本消息已持久化至 SQLite 数据库。`,
        authorId: userTokens.user.id,
      }),
    },
  );
  if (!sendMsgRes.ok) throw new Error("Send message failed");
  const createdMsg = await sendMsgRes.json();
  console.log("✅ 8. 消息创建成功，ID:", createdMsg.id);

  // 9. 查询消息流验证落库
  const getMsgsRes = await fetch(
    `${baseUrl}/api/channels/${channel.id}/messages`,
  );
  const messages = await getMsgsRes.json();
  const exists = messages.some((m: any) => m.id === createdMsg.id);
  if (!exists) throw new Error("Created message not found in history");
  console.log(
    `✅ 9. 历史消息流校验成功，当前频道共有 ${messages.length} 条已落库消息`,
  );

  console.log("\n🎉 ==========================================");
  console.log("🎉 阶段二 (Phase 2 - 2.1 & 2.2) 全部 9 项验证 100% 通过！");
  console.log("🎉 ==========================================\n");
}

runVerification().catch((err) => {
  console.error("❌ 验证失败:", err);
  process.exit(1);
});
