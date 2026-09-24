import "../src/env.js";
import { prisma } from "../src/db.js";

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("❌ 请提供目标用户名，例如: pnpm admin:grant <username>");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: username.trim() }, { email: username.trim() }],
    },
  });

  if (!user) {
    console.error(`❌ 未找到用户: "${username}"`);
    process.exit(1);
  }

  if (user.role === "SUPER_ADMIN") {
    console.log(
      `ℹ️ 用户【${user.username}】已经是超级管理员，未修改封禁状态。`,
    );
    process.exit(0);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const promoted = await tx.user.update({
      where: { id: user.id },
      data: { role: "SUPER_ADMIN", sessionVersion: { increment: 1 } },
    });
    await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    await tx.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "ADMIN_GRANT_SCRIPT",
        targetType: "USER",
        targetId: user.id,
        detailsJson: JSON.stringify({
          username: user.username,
          previousRole: user.role,
        }),
      },
    });
    return promoted;
  });

  console.log(
    `✅ 成功将用户【${updated.username}】(${updated.email}) 提升为超级管理员；封禁状态保持不变，旧会话已撤销。`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
