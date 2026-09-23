import { existsSync, unlinkSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const prismaDir = path.resolve(serverRoot, "prisma");
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma");

const dbFiles = ["tescord.db", "dev.db"];

async function resetDb(fileName: string) {
  const dbPath = path.resolve(prismaDir, fileName);
  const bakPath = path.resolve(prismaDir, `${fileName}.bak`);

  if (existsSync(dbPath)) {
    console.log(`📦 备份旧数据库 ${fileName} -> ${fileName}.bak`);
    copyFileSync(dbPath, bakPath);
    unlinkSync(dbPath);
  }

  // 同时也清理可能的 journal/wal 文件
  for (const ext of ["-journal", "-wal", "-shm"]) {
    const journalPath = path.resolve(prismaDir, `${fileName}${ext}`);
    if (existsSync(journalPath)) unlinkSync(journalPath);
  }

  console.log(`🔨 基于 schema.prisma 生成全量 DDL 并初始化 ${fileName}...`);
  const diff = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: serverRoot, env: process.env, encoding: "utf8" }
  );

  if (diff.status !== 0 || !diff.stdout) {
    throw new Error(`无法生成全量 DDL: ${diff.stderr || "unknown schema engine error"}`);
  }

  process.env.DATABASE_URL = `file:./${fileName}`;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:./${fileName}`,
      },
    },
  });

  try {
    const statements = diff.stdout
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter((statement) => statement && !/^--\s*This is an empty migration/i.test(statement));

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }
    console.log(`✅ ${fileName} 表结构创建完成，共执行 ${statements.length} 条 DDL。`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  for (const dbName of dbFiles) {
    await resetDb(dbName);
  }

  for (const dbName of dbFiles) {
    console.log(`🌱 开始为 ${dbName} 注入种子数据...`);
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:./${dbName}`,
        },
      },
    });

    const userCount = await prisma.user.count();
    if (userCount === 0) {
      const bcrypt = (await import("bcryptjs")).default;
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash("adminpassword123", salt);

      const admin = await prisma.user.create({
        data: {
          id: "usr_default_admin",
          username: "Jackey",
          email: "admin@tescord.local",
          passwordHash,
          avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=Jackey",
          status: "ONLINE",
          customStatus: "正在打磨 Tescord 核心架构 🚀",
          bio: "Tescord 创始人 & 极客工程师",
          role: "SUPER_ADMIN",
          sessionVersion: 0,
        },
      });

      const guild = await prisma.guild.create({
        data: {
          id: "gld_default_01",
          name: "Tescord 极客总部",
          iconUrl: "https://api.dicebear.com/7.x/identicon/svg?seed=Tescord",
          ownerId: admin.id,
        },
      });

      const adminRole = await prisma.role.create({
        data: {
          id: "role_admin_01",
          guildId: guild.id,
          name: "管理员",
          color: "#f43f5e",
          hoist: true,
          position: 1,
          permissions: 0x7fffffff,
        },
      });

      await prisma.guildMember.create({
        data: {
          guildId: guild.id,
          userId: admin.id,
          nickname: "Jackey (Admin)",
          roleIds: JSON.stringify([adminRole.id]),
        },
      });

      const textCat = await prisma.channelCategory.create({
        data: {
          guildId: guild.id,
          name: "文字频道",
          position: 0,
        },
      });

      const voiceCat = await prisma.channelCategory.create({
        data: {
          guildId: guild.id,
          name: "语音频道",
          position: 1,
        },
      });

      const textChannel = await prisma.channel.create({
        data: {
          id: "chn_default_text_01",
          guildId: guild.id,
          parentId: textCat.id,
          name: "general",
          type: "TEXT",
          topic: "欢迎来到 Tescord 本地私有化即时通讯系统",
          position: 0,
        },
      });

      await prisma.channel.create({
        data: {
          id: "chn_default_voice_01",
          guildId: guild.id,
          parentId: voiceCat.id,
          name: "voice-chat",
          type: "VOICE",
          position: 1,
          bitrate: 64000,
        },
      });

      await prisma.channel.create({
        data: {
          id: "chn_default_text_02",
          guildId: guild.id,
          parentId: textCat.id,
          name: "crypto-vault",
          type: "TEXT",
          topic: "端到端加密专属测试信道",
          position: 2,
          isE2EE: true,
        },
      });

      await prisma.message.create({
        data: {
          id: "msg_welcome_01",
          channelId: textChannel.id,
          authorId: admin.id,
          content:
            "🎉 欢迎加入 **Tescord**！本项目基于纯粹离线自治哲学，支持本地持久化、端到端加密与高质量实时音视频通话。",
        },
      });

      const testSalt = await bcrypt.genSalt(10);
      await prisma.user.create({
        data: {
          id: "usr_test_alice",
          username: "Alice",
          email: "alice@tescord.local",
          passwordHash: await bcrypt.hash("alicepassword123", testSalt),
          avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=Alice",
          status: "ONLINE",
          customStatus: "纯净测试用户 A 🧪",
          bio: "Tescord 测试账号 (纯净无公会)",
          role: "USER",
          sessionVersion: 0,
        },
      });

      await prisma.user.create({
        data: {
          id: "usr_test_bob",
          username: "Bob",
          email: "bob@tescord.local",
          passwordHash: await bcrypt.hash("bobpassword123", testSalt),
          avatarUrl: "https://api.dicebear.com/7.x/bottts/svg?seed=Bob",
          status: "ONLINE",
          customStatus: "纯净测试用户 B 🧪",
          bio: "Tescord 测试账号 (纯净无公会)",
          role: "USER",
          sessionVersion: 0,
        },
      });
    }

    const checkUser = await prisma.user.findFirst({ where: { username: "Jackey" } });
    console.log(`👤 ${dbName} 管理员验证:`, {
      id: checkUser?.id,
      username: checkUser?.username,
      role: checkUser?.role,
      sessionVersion: checkUser?.sessionVersion,
    });

    await prisma.$disconnect();
  }

  console.log("✨ 数据库重置与种子注入圆满完成！");
}

main().catch((err) => {
  console.error("❌ 重置失败:", err);
  process.exit(1);
});
