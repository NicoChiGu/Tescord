import "../src/env.js";
import readline from "readline";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

function askQuestion(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("==================================================");
  console.log("🛡️  Tescord 生产环境管理员初始化与配置脚本");
  console.log("==================================================");

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
使用方式:
  1. 命令行直接传参:
     pnpm admin:create <username> <email> <password>
     示例: pnpm admin:create sysadmin sysadmin@example.com SecretPass123

  2. 交互式控制台引导:
     pnpm admin:create
`);
    process.exit(0);
  }

  let username = process.argv[2]?.trim();
  let email = process.argv[3]?.trim();
  let password = process.argv[4]?.trim();

  // 若未通过命令行参数完整提供，启用交互式控制台引导
  if (!username || !email || !password) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      if (!username) {
        username = await askQuestion(rl, "👉 请输入超级管理员用户名 (例如: admin): ");
      }
      if (!email) {
        email = await askQuestion(rl, "👉 请输入管理员电子邮箱 (例如: admin@example.com): ");
      }
      if (!password) {
        password = await askQuestion(rl, "👉 请输入密码 (长度至少 6 位): ");
      }
    } finally {
      rl.close();
    }
  }

  // 基础校验
  if (!username || username.length < 2) {
    console.error("❌ 错误：用户名长度至少需 2 个字符。");
    process.exit(1);
  }

  if (!email || !email.includes("@") || !email.includes(".")) {
    console.error("❌ 错误：请输入有效的电子邮箱地址。");
    process.exit(1);
  }

  if (!password || password.length < 6) {
    console.error("❌ 错误：管理员密码长度至少需要 6 个字符。");
    process.exit(1);
  }

  email = email.toLowerCase();

  // 检查是否已有该用户名或邮箱的用户
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { email }],
    },
  });

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  if (existingUser) {
    console.log(`ℹ️ 检测到已存在匹配账号【${existingUser.username}】(${existingUser.email})，正在提升为超级管理员并更新密码...`);

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: existingUser.id },
        data: {
          role: "SUPER_ADMIN",
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      });

      // 注销该用户现存的所有活跃 Refresh Token 确保安全
      await tx.refreshToken.deleteMany({
        where: { userId: user.id },
      });

      await tx.platformAuditLog.create({
        data: {
          actorId: user.id,
          action: "ADMIN_INIT_SCRIPT_UPDATE",
          targetType: "USER",
          targetId: user.id,
          detailsJson: JSON.stringify({
            username: user.username,
            email: user.email,
            previousRole: existingUser.role,
          }),
        },
      });

      return user;
    });

    console.log("==================================================");
    console.log(`✅ 成功更新并提升超级管理员！`);
    console.log(`- 用户名: ${updated.username}`);
    console.log(`- 邮箱:   ${updated.email}`);
    console.log(`- 角色:   SUPER_ADMIN`);
    console.log(`- 会话:   已废除历史会话，请使用新密码重新登录。`);
    console.log("==================================================");
    process.exit(0);
  }

  // 创建全新超级管理员
  const newAdmin = await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        username,
        email,
        passwordHash,
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`,
        status: "ONLINE",
        customStatus: "系统超级管理员 🛡️",
        bio: "Tescord 系统超级管理员",
        role: "SUPER_ADMIN",
        sessionVersion: 0,
      },
    });

    // 检查是否已有公会，若无则初始化首个默认公会
    const guildCount = await tx.guild.count();
    if (guildCount === 0) {
      const guild = await tx.guild.create({
        data: {
          name: "官方公会",
          iconUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}`,
          isPublic: true,
          ownerId: admin.id,
        },
      });

      await tx.channel.create({
        data: {
          guildId: guild.id,
          name: "综合闲聊",
          type: "TEXT",
          position: 0,
        },
      });

      await tx.channel.create({
        data: {
          guildId: guild.id,
          name: "公共语音",
          type: "VOICE",
          position: 1,
        },
      });

      await tx.guildMember.create({
        data: {
          guildId: guild.id,
          userId: admin.id,
        },
      });
    }

    await tx.platformAuditLog.create({
      data: {
        actorId: admin.id,
        action: "ADMIN_INIT_SCRIPT_CREATE",
        targetType: "USER",
        targetId: admin.id,
        detailsJson: JSON.stringify({
          username: admin.username,
          email: admin.email,
        }),
      },
    });

    return admin;
  });

  console.log("==================================================");
  console.log(`🎉 首次超级管理员账号创建成功！`);
  console.log(`- 用户名: ${newAdmin.username}`);
  console.log(`- 邮箱:   ${newAdmin.email}`);
  console.log(`- 权限:   SUPER_ADMIN (全系统最高特权)`);
  console.log("==================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 创建超级管理员账号失败:", err);
  process.exit(1);
});
