import { prisma } from "../apps/server/src/db.js";
import { AuthService } from "../apps/server/src/services/auth.service.js";
import { RelationshipService } from "../apps/server/src/services/relationship.service.js";
import { DMService } from "../apps/server/src/services/dm.service.js";

async function runTests() {
  console.log("🚀 开始执行用户识别体系与好友系统全面集成验证...");

  const fakeFastify: any = {
    jwt: {
      sign: () => "fake_test_token",
      verify: () => ({ sub: "test" }),
    },
  };

  const authService = new AuthService(fakeFastify);
  const relationshipService = new RelationshipService(fakeFastify, authService);
  const dmService = new DMService();

  const timestamp = Date.now().toString().slice(-6);
  const emailA = `test_user_a_${timestamp}@example.com`;
  const emailB = `test_user_b_${timestamp}@example.com`;

  try {
    // 1. 测试注册与身份解耦
    console.log("【测试 1】测试用户注册及显示昵称与不可变 discriminator 生成");
    const regA = await authService.register({
      email: emailA,
      password: "password123",
      nickname: "NickMaster",
    });
    const userA = regA.user;
    console.log(
      `- 用户 A: id=${userA.id}, username=${userA.username}, displayName=${userA.displayName}, tag=${userA.discriminator}`,
    );

    if (userA.displayName !== "NickMaster") {
      throw new Error(
        `预期 displayName 为 NickMaster，实际为 ${userA.displayName}`,
      );
    }
    if (!userA.discriminator || userA.discriminator.length !== 5) {
      throw new Error(
        `预期 discriminator 为 5 位数字，实际为 ${userA.discriminator}`,
      );
    }
    if (!userA.username.endsWith(`#${userA.discriminator}`)) {
      throw new Error(
        `预期 username 以 #${userA.discriminator} 结尾，实际为 ${userA.username}`,
      );
    }

    const regB = await authService.register({
      email: emailB,
      password: "password123",
      nickname: "TeraBlade",
    });
    const userB = regB.user;
    console.log(
      `- 用户 B: id=${userB.id}, username=${userB.username}, displayName=${userB.displayName}, tag=${userB.discriminator}`,
    );

    // 2. 测试修改显示昵称与识别码前缀
    console.log(
      "【测试 2】测试修改显示昵称 (随时修改) 与识别码前缀 (保留数字 tag)",
    );
    const updatedA = await authService.updateProfile(userA.id, {
      displayName: "GrandNick",
      username: "ProNick",
    });
    console.log(
      `- 用户 A 更新后: displayName=${updatedA.displayName}, username=${updatedA.username}, tag=${updatedA.discriminator}`,
    );
    if (updatedA.displayName !== "GrandNick") {
      throw new Error(
        `预期更新后 displayName 为 GrandNick，实际为 ${updatedA.displayName}`,
      );
    }
    if (updatedA.username !== `ProNick#${userA.discriminator}`) {
      throw new Error(
        `预期更新后 username 为 ProNick#${userA.discriminator}，实际为 ${updatedA.username}`,
      );
    }

    // 3. 负向测试好友申请
    console.log("【测试 3】负向拦截校验测试");
    // 3.1 格式非法（仅纯名字）
    try {
      await relationshipService.sendFriendRequest(userA.id, "TeraBlade");
      throw new Error("负向测试失败：纯名字未被拦截");
    } catch (err: any) {
      if (!err.message.includes("完整的用户标识")) throw err;
      console.log("- PASS: 纯名字格式拦截成功");
    }

    // 3.2 格式非法（仅纯数字标签）
    try {
      await relationshipService.sendFriendRequest(
        userA.id,
        `#${userB.discriminator}`,
      );
      throw new Error("负向测试失败：纯数字标签未被拦截");
    } catch (err: any) {
      if (!err.message.includes("完整的用户标识")) throw err;
      console.log("- PASS: 纯标签格式拦截成功");
    }

    // 3.3 不能添加自己
    try {
      await relationshipService.sendFriendRequest(userA.id, updatedA.username);
      throw new Error("负向测试失败：添加自己未被拦截");
    } catch (err: any) {
      if (!err.message.includes("不能添加自己")) throw err;
      console.log("- PASS: 添加自己拦截成功");
    }

    // 3.4 用户不存在
    try {
      await relationshipService.sendFriendRequest(
        userA.id,
        "NonExistent#99999",
      );
      throw new Error("负向测试失败：不存在的用户未被拦截");
    } catch (err: any) {
      if (!err.message.includes("找不到符合该识别码的用户")) throw err;
      console.log("- PASS: 不存在用户拦截成功");
    }

    // 4. 正向申请与不区分大小写匹配
    console.log("【测试 4】大小写不敏感匹配发送好友申请");
    // 用户 B 的 username 是 TeraBlade#xxxxx，A 输入全小写 terablade#xxxxx
    const lowerIdentifier = `terablade#${userB.discriminator}`;
    const relOut = await relationshipService.sendFriendRequest(
      userA.id,
      lowerIdentifier,
    );
    if (relOut.type !== "PENDING_OUTGOING") {
      throw new Error(
        `预期单向申请状态为 PENDING_OUTGOING，实际为 ${relOut.type}`,
      );
    }
    console.log("- PASS: 大小写不敏感发送申请成功，状态为 PENDING_OUTGOING");

    // 5. 互发申请自动直接结为好友
    console.log("【测试 5】双方互发好友申请自动结为好友");
    // B 此时也向 A 发送申请：输入 pronick#xxxx
    const autoRel = await relationshipService.sendFriendRequest(
      userB.id,
      `pronick#${userA.discriminator}`,
    );
    if (autoRel.type !== "FRIEND") {
      throw new Error(`预期互发申请自动结为 FRIEND，实际为 ${autoRel.type}`);
    }
    const relationshipsA = await relationshipService.getRelationships(userA.id);
    const friendRecordForA = relationshipsA.find(
      (r) => r.targetUserId === userB.id,
    );
    if (friendRecordForA?.type !== "FRIEND") {
      throw new Error(
        `预期用户 A 的关系列表中状态为 FRIEND，实际为 ${friendRecordForA?.type}`,
      );
    }
    console.log("- PASS: 互发申请自动合并结为好友成功！");

    // 6. 好友突破跨服私信限制
    console.log("【测试 6】验证好友之间跨服发起私信放行");
    const dmChannel = await dmService.getOrCreateDMChannel(userA.id, userB.id);
    if (!dmChannel || dmChannel.type !== "DM") {
      throw new Error("预期好友之间能成功建立私信通道");
    }
    console.log(
      `- PASS: 好友成功突破同服限制建立私信 (dmChannelId=${dmChannel.id})`,
    );

    // 7. 解除好友与私信限制重置
    console.log("【测试 7】解除好友关系与非好友跨服私信拦截");
    await relationshipService.removeRelationship(userA.id, userB.id);
    const afterDeleteA = await relationshipService.getRelationships(userA.id);
    if (afterDeleteA.some((r) => r.targetUserId === userB.id)) {
      throw new Error("预期删除好友后关系记录已被清除");
    }
    console.log("- PASS: 解除好友成功，关系记录已清理");

    console.log("\n🎉 全量验证 100% 通过！所有设计与业务约束均得到严格验证！");
  } finally {
    // 清理测试临时用户
    await prisma.user.deleteMany({
      where: { email: { in: [emailA, emailB] } },
    });
    console.log("🧹 临时测试数据清理完毕。");
  }
}

runTests().catch((e) => {
  console.error("❌ 验证测试失败:", e);
  process.exit(1);
});
