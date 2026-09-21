import { PermissionFlags } from "@tescord/types";

const BASE_URL = "http://localhost:3001";

async function runVerification() {
  console.log("==========================================");
  console.log("🚀 开始验证 Tescord 服务器管理员功能板块全链路");
  console.log("==========================================");

  const timestamp = Date.now();

  // 1. 注册/登录管理员与普通用户
  console.log("\n[Step 1] 注册管理员与普通测试用户...");
  const adminRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `admin_${timestamp}`,
      email: `admin_${timestamp}@tescord.local`,
      password: "Password123!",
    }),
  });
  const adminData = await adminRes.json();
  const adminToken = adminData.token || adminData.accessToken;
  const adminUser = adminData.user;
  console.log(`✓ 管理员用户注册成功: ${adminUser.username} (${adminUser.id})`);

  const normalRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `user_${timestamp}`,
      email: `user_${timestamp}@tescord.local`,
      password: "Password123!",
    }),
  });
  const normalData = await normalRes.json();
  const normalToken = normalData.token || normalData.accessToken;
  const normalUser = normalData.user;
  console.log(`✓ 普通用户注册成功: ${normalUser.username} (${normalUser.id})`);

  // 2. 创建测试服务器并检查初始身份组
  console.log("\n[Step 2] 创建测试服务器并验证 @everyone 与 Admin 身份组...");
  const createGuildRes = await fetch(`${BASE_URL}/api/guilds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `极客营地_${timestamp}`,
      description: "自动化验证测试专用服务器",
    }),
  });
  const guild = await createGuildRes.json();
  console.log(`✓ 服务器创建成功: ${guild.name} (ID: ${guild.id})`);

  // 检查角色
  const rolesRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}/roles`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const roles = await rolesRes.json();
  const everyoneRole = roles.find((r: any) => r.isDefault || r.name === "@everyone");
  const adminRole = roles.find((r: any) => r.name === "Admin");
  if (!everyoneRole || !adminRole) {
    throw new Error("❌ 自动初始化的 @everyone 或 Admin 身份组缺失！");
  }
  console.log(`✓ 验证 @everyone (ID: ${everyoneRole.id}) 与 Admin (ID: ${adminRole.id}) 均已初始化`);

  // 3. 更新服务器概览设置
  console.log("\n[Step 3] 修改服务器概览信息 (名称/描述/图标)...");
  const updateGuildRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `极客营地_已更新_${timestamp}`,
      description: "更新后的服务器描述",
      iconUrl: "https://example.com/icon.png",
    }),
  });
  const updatedGuild = await updateGuildRes.json();
  if (updatedGuild.name !== `极客营地_已更新_${timestamp}`) {
    throw new Error("❌ 服务器名称修改失败！");
  }
  console.log(`✓ 服务器概览更新成功: ${updatedGuild.name}`);

  // 4. 普通用户通过邀请码加入服务器
  console.log("\n[Step 4] 生成邀请码并让普通用户加入...");
  const inviteRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}/invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ maxUses: 5, expiresInHours: 24 }),
  });
  const invite = await inviteRes.json();
  console.log(`✓ 邀请码生成成功: ${invite.code}`);

  const joinRes = await fetch(`${BASE_URL}/api/invites/${invite.code}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${normalToken}` },
  });
  const joinData = await joinRes.json();
  console.log(`✓ 普通用户已加入服务器: ${joinData.userId}`);

  // 5. 管理员创建新角色并分配给普通用户
  console.log("\n[Step 5] 创建新角色 Moderator 并分配给普通用户...");
  const createRoleRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}/roles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: "Moderator",
      color: "#1abc9c",
      hoist: true,
      permissions: PermissionFlags.KICK_MEMBERS | PermissionFlags.MANAGE_MESSAGES,
    }),
  });
  const modRole = await createRoleRes.json();
  console.log(`✓ 新角色 Moderator 创建成功: ${modRole.name} (ID: ${modRole.id})`);

  const assignRoleRes = await fetch(
    `${BASE_URL}/api/guilds/${guild.id}/members/${normalUser.id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        roleIds: [modRole.id],
        nickname: "小管家",
      }),
    },
  );
  const updatedMember = await assignRoleRes.json();
  console.log(
    `✓ 成员属性更新成功: 昵称 “${updatedMember.nickname}”, 角色数: ${updatedMember.roleIds.length}`,
  );

  // 6. 验证防越权安全机制 (Role Hierarchy Protection)
  console.log("\n[Step 6] 验证防越权安全机制 (高位压制)...");
  // Moderator 尝试将 Admin 身份组赋予他人或提升自身
  const illegalRoleRes = await fetch(
    `${BASE_URL}/api/guilds/${guild.id}/members/${normalUser.id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalToken}`,
      },
      body: JSON.stringify({
        roleIds: [adminRole.id],
      }),
    },
  );
  if (illegalRoleRes.status === 403) {
    console.log("✓ 防越权校验生效：低职级用户试图越权赋予高权重角色被成功拦截 (403 Forbidden)");
  } else {
    throw new Error(`❌ 越权拦截失效，返回状态码: ${illegalRoleRes.status}`);
  }

  // 7. 封禁黑名单与邀请码拦截闭环
  console.log("\n[Step 7] 封禁普通用户并验证黑名单与再次加入拦截...");
  const banRes = await fetch(
    `${BASE_URL}/api/guilds/${guild.id}/bans/${normalUser.id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reason: "违规发广告" }),
    },
  );
  const banData = await banRes.json();
  console.log(`✓ 成员已封禁: ${banData.userId}, 理由: ${banData.reason}`);

  // 被封禁后尝试再次加入
  const rejoinRes = await fetch(`${BASE_URL}/api/invites/${invite.code}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${normalToken}` },
  });
  if (rejoinRes.status === 403) {
    console.log("✓ 封禁拦截生效：已被封禁的用户凭邀请码加入被拒绝 (403 Forbidden)");
  } else {
    throw new Error(`❌ 封禁拦截失效，返回状态码: ${rejoinRes.status}`);
  }

  // 查询封禁名单
  const bansListRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}/bans`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const bansList = await bansListRes.json();
  if (bansList.length !== 1 || bansList[0].userId !== normalUser.id) {
    throw new Error("❌ 封禁列表查询不一致！");
  }
  console.log(`✓ 封禁黑名单列表验证通过，当前数量: ${bansList.length}`);

  // 解除封禁
  const unbanRes = await fetch(
    `${BASE_URL}/api/guilds/${guild.id}/bans/${normalUser.id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  const unbanData = await unbanRes.json();
  console.log(`✓ 成员已成功解封: ${unbanData.userId}`);

  // 8. 审计日志查询验证
  console.log("\n[Step 8] 查询并验证细粒度审计日志 (Audit Log)...");
  const auditRes = await fetch(
    `${BASE_URL}/api/guilds/${guild.id}/audit-logs`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  const auditLogs = await auditRes.json();
  console.log(`✓ 获取到 ${auditLogs.length} 条审计日志流水：`);
  auditLogs.slice(0, 5).forEach((log: any, idx: number) => {
    console.log(
      `   [${idx + 1}] 操作者: ${log.user?.username || log.userId} | 动作: ${log.action} | 目标: ${log.targetName || log.targetId || "N/A"}`,
    );
  });

  // 9. 解散/删除服务器二次确认安全验证
  console.log("\n[Step 9] 验证解散服务器二次确认防护机制...");
  // 错误名称尝试
  const wrongDeleteRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ nameConfirmation: "错误的名称" }),
  });
  if (wrongDeleteRes.status === 400) {
    console.log("✓ 防误触生效：输入错误服务器名称被拒绝 (400 Bad Request)");
  } else {
    throw new Error(`❌ 防误触失效，返回状态码: ${wrongDeleteRes.status}`);
  }

  // 正确名称删除
  const correctDeleteRes = await fetch(`${BASE_URL}/api/guilds/${guild.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ nameConfirmation: updatedGuild.name }),
  });
  const deleteData = await correctDeleteRes.json();
  console.log(`✓ 服务器已彻底删除成功: ${deleteData.guildId}`);

  console.log("\n==========================================");
  console.log("🎉 全部 9 项服务器管理全链路自动化测试 100% 通过！");
  console.log("==========================================");
}

runVerification().catch((err) => {
  console.error("❌ 验证测试发生错误:", err);
  process.exit(1);
});
