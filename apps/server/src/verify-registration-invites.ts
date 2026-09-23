import { prisma } from "./db.js";

const BASE_URL = "http://localhost:3001";

async function runVerification() {
  console.log("==========================================");
  console.log("🛡️ 开始全站注册策略与邀请码全链路安全验证");
  console.log("==========================================");

  const timestamp = Date.now();
  let passedAssertions = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.error(`❌ 断言失败: ${msg}`);
      throw new Error(`Assertion failed: ${msg}`);
    }
    passedAssertions++;
    console.log(`  ✓ ${msg}`);
  }

  // 确保初始状态：恢复系统默认设置
  await prisma.systemSetting.upsert({
    where: { key: "allow_registration" },
    update: { value: "true" },
    create: { key: "allow_registration", value: "true" },
  });
  await prisma.systemSetting.upsert({
    where: { key: "require_invite_code" },
    update: { value: "false" },
    create: { key: "require_invite_code", value: "false" },
  });

  // 1. 验证公开注册策略端点
  console.log("\n[Step 1] 验证公开注册状态接口 GET /api/auth/registration-status ...");
  const statusRes = await fetch(`${BASE_URL}/api/auth/registration-status`);
  assert(statusRes.ok, "公开端点应返回 200 OK");
  const statusData = await statusRes.json();
  assert(statusData.allowRegistration === true, "初始状态下 allowRegistration 应为 true");
  assert(statusData.requireInviteCode === false, "初始状态下 requireInviteCode 应为 false");

  // 2. 注册普通测试账号
  console.log("\n[Step 2] 注册并登录普通用户，验证免邀请码自由注册与权限隔离...");
  const normalRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `normal_${timestamp}`,
      email: `normal_${timestamp}@test.local`,
      password: "password123",
    }),
  });
  assert(normalRes.ok, "未开启邀请码强制时，普通用户应可直接免邀请码注册");
  const normalData = await normalRes.json();
  const normalToken = normalData.accessToken || normalData.token;

  // 3. 负向越权测试：普通用户访问超管邀请码接口
  console.log("\n[Step 3] 负向越权安全测试：普通用户访问超管管理端点...");
  const forbiddenListRes = await fetch(`${BASE_URL}/api/admin/registration-invites`, {
    headers: { Authorization: `Bearer ${normalToken}` },
  });
  assert(forbiddenListRes.status === 403, "普通用户访问 GET /api/admin/registration-invites 应返回 403 Forbidden");

  const forbiddenCreateRes = await fetch(`${BASE_URL}/api/admin/registration-invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalToken}`,
    },
    body: JSON.stringify({ note: "非法生成", maxUses: 1 }),
  });
  assert(forbiddenCreateRes.status === 403, "普通用户访问 POST /api/admin/registration-invites 应返回 403 Forbidden");

  // 4. 创建超级管理员账号
  console.log("\n[Step 4] 提权超级管理员并验证超管身份鉴权...");
  const adminRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `superadmin_${timestamp}`,
      email: `superadmin_${timestamp}@test.local`,
      password: "password123",
    }),
  });
  const adminData = await adminRes.json();
  const adminId = adminData.user.id;
  // 直接通过数据库提权为 SUPER_ADMIN
  await prisma.user.update({
    where: { id: adminId },
    data: { role: "SUPER_ADMIN" },
  });
  // 重新登录获取带有新角色的 Token
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: `superadmin_${timestamp}`,
      password: "password123",
    }),
  });
  const loginData = await loginRes.json();
  const adminToken = loginData.accessToken || loginData.token;
  assert(loginData.user.role === "SUPER_ADMIN", "超管登录返回的角色应为 SUPER_ADMIN");

  // 5. 超管配置开启“强制邀请码准入”
  console.log("\n[Step 5] 超级管理员在控制台开启“强制要求注册邀请码”...");
  const updateSettingRes = await fetch(`${BASE_URL}/api/admin/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ requireInviteCode: true }),
  });
  assert(updateSettingRes.ok, "超管更新设置应返回 200 OK");
  const updatedSetting = await updateSettingRes.json();
  assert(updatedSetting.requireInviteCode === true, "系统设置中的 requireInviteCode 应变为 true");

  const checkStatusRes = await fetch(`${BASE_URL}/api/auth/registration-status`);
  const checkStatus = await checkStatusRes.json();
  assert(checkStatus.requireInviteCode === true, "公开端点应同步反映 requireInviteCode: true");

  // 6. 负向测试：未携带邀请码注册被阻断
  console.log("\n[Step 6] 负向测试：开启邀请码强制后，未填邀请码注册应被拒绝...");
  const noInviteRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `noinvite_${timestamp}`,
      email: `noinvite_${timestamp}@test.local`,
      password: "password123",
    }),
  });
  assert(noInviteRes.status === 400, "未填邀请码注册应返回 400 Bad Request");
  const noInviteErr = await noInviteRes.json();
  assert(noInviteErr.error.includes("邀请码"), "错误信息应提示邀请码准入相关");

  // 7. 负向测试：携带虚假伪造邀请码注册被阻断
  console.log("\n[Step 7] 负向测试：填入伪造/不存在的邀请码注册应被拒绝...");
  const fakeInviteRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `fakeinvite_${timestamp}`,
      email: `fakeinvite_${timestamp}@test.local`,
      password: "password123",
      inviteCode: "FAKE-NON-EXISTENT-CODE",
    }),
  });
  assert(fakeInviteRes.status === 400, "伪造邀请码注册应返回 400");
  const fakeErr = await fakeInviteRes.json();
  assert(fakeErr.error.includes("无效或不存在"), "应明确提示邀请码无效或不存在");

  // 8. 超管生成单次使用邀请码
  console.log("\n[Step 8] 超管生成单次有效邀请码 (maxUses: 1)...");
  const createInviteRes = await fetch(`${BASE_URL}/api/admin/registration-invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      note: "单次内测邀请码",
      maxUses: 1,
      expiresInDays: 7,
    }),
  });
  assert(createInviteRes.ok, "超管创建邀请码应成功");
  const inviteData = await createInviteRes.json();
  const inviteCode1 = inviteData.code;
  assert(Boolean(inviteCode1), `生成的邀请码应非空，实际生成: ${inviteCode1}`);
  assert(inviteData.maxUses === 1, "最大使用次数应为 1");
  assert(inviteData.uses === 0, "当前使用次数应为 0");

  // 9. 使用该单次邀请码成功注册新用户
  console.log("\n[Step 9] 用户填入有效单次邀请码注册新用户...");
  const validRegisterRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `invited_user_${timestamp}`,
      email: `invited_${timestamp}@test.local`,
      password: "password123",
      inviteCode: inviteCode1,
    }),
  });
  assert(validRegisterRes.ok, "使用有效邀请码应成功注册并返回 200 OK");
  const validUserData = await validRegisterRes.json();
  assert(Boolean(validUserData.accessToken), "注册成功应返回有效 accessToken");

  // 验证数据库中邀请码核销状态与递增
  const dbInvite = await prisma.registrationInvite.findUnique({
    where: { code: inviteCode1 },
  });
  assert(dbInvite?.uses === 1, "数据库中邀请码核销次数 uses 应原子递增至 1");

  // 10. 负向测试：再次使用已被消耗完毕的单次邀请码
  console.log("\n[Step 10] 负向测试：再次使用已被用尽的单次邀请码注册...");
  const exhaustedRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `exhausted_user_${timestamp}`,
      email: `exhausted_${timestamp}@test.local`,
      password: "password123",
      inviteCode: inviteCode1,
    }),
  });
  assert(exhaustedRes.status === 400, "已用尽邀请码再次注册应返回 400");
  const exhaustedErr = await exhaustedRes.json();
  assert(exhaustedErr.error.includes("上限"), "应提示使用次数已达上限");

  // 11. 超管生成自定义邀请码并作废
  console.log("\n[Step 11] 超管创建自定义邀请码并进行作废/恢复生命周期管理...");
  const customCode = `VIP-${timestamp.toString().slice(-6)}`;
  const customCreateRes = await fetch(`${BASE_URL}/api/admin/registration-invites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      customCode,
      note: "特权邀请码",
      maxUses: 5,
    }),
  });
  assert(customCreateRes.ok, "创建自定义邀请码应成功");

  // 作废该邀请码
  const revokeRes = await fetch(`${BASE_URL}/api/admin/registration-invites/${customCode}/revoke`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ isRevoked: true }),
  });
  assert(revokeRes.ok, "作废邀请码操作应成功");
  const revokedData = await revokeRes.json();
  assert(revokedData.isRevoked === true, "isRevoked 应为 true");

  // 负向测试：使用已作废邀请码注册
  const tryRevokedRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `revoked_user_${timestamp}`,
      email: `revoked_${timestamp}@test.local`,
      password: "password123",
      inviteCode: customCode,
    }),
  });
  assert(tryRevokedRes.status === 400, "使用已作废邀请码注册应被拒绝");
  const tryRevokedErr = await tryRevokedRes.json();
  assert(tryRevokedErr.error.includes("作废"), "应提示邀请码已被作废");

  // 恢复激活邀请码
  const restoreRes = await fetch(`${BASE_URL}/api/admin/registration-invites/${customCode}/revoke`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ isRevoked: false }),
  });
  assert(restoreRes.ok, "恢复激活邀请码应成功");

  // 恢复后成功注册
  const restoredRegisterRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `restored_user_${timestamp}`,
      email: `restored_${timestamp}@test.local`,
      password: "password123",
      inviteCode: customCode,
    }),
  });
  assert(restoredRegisterRes.ok, "恢复激活后应可成功注册");

  // 12. 负向测试：关闭系统注册总开关
  console.log("\n[Step 12] 负向测试：关闭注册总开关 (allow_registration: false) 后阻断一切注册...");
  await fetch(`${BASE_URL}/api/admin/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ allowRegistration: false }),
  });

  const blockedRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `blocked_user_${timestamp}`,
      email: `blocked_${timestamp}@test.local`,
      password: "password123",
      inviteCode: customCode,
    }),
  });
  assert(blockedRes.status === 400, "注册总开关关闭时注册应返回 400");
  const blockedErr = await blockedRes.json();
  assert(blockedErr.error.includes("暂停"), "应提示暂停新用户注册");

  // 13. 清理环境并恢复设置
  console.log("\n[Step 13] 恢复系统设置至初始自由注册状态...");
  await fetch(`${BASE_URL}/api/admin/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ allowRegistration: true, requireInviteCode: false }),
  });

  console.log("\n==========================================");
  console.log(`🎉 全部安全与业务断言 100% 通过！共完成 ${passedAssertions} 项严密断言！`);
  console.log("==========================================");
}

runVerification().catch((err) => {
  console.error("❌ 验证运行异常:", err);
  process.exit(1);
});
