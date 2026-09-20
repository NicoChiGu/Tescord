import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

/**
 * 数据库初始化种子数据 (自愈引导)
 * 当数据库为空时，自动创建默认管理员、默认服务器与默认频道，保证即开即用
 */
export async function seedInitialData(): Promise<void> {
  try {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      console.log("🌱 首次启动，开始初始化系统默认种子数据...");

      // 1. 创建默认管理员用户 (admin / adminpassword123)
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
        },
      });

      // 2. 创建默认服务器 (Guild)
      const guild = await prisma.guild.create({
        data: {
          id: "gld_default_01",
          name: "Tescord 极客总部",
          iconUrl: "https://api.dicebear.com/7.x/identicon/svg?seed=Tescord",
          ownerId: admin.id,
        },
      });

      // 3. 创建管理员角色 (权限为全部位掩码组合)
      const adminRole = await prisma.role.create({
        data: {
          id: "role_admin_01",
          guildId: guild.id,
          name: "管理员",
          color: "#f43f5e",
          hoist: true,
          position: 1,
          permissions: 0x7fffffff, // 拥有全部权限
        },
      });

      // 4. 创建默认成员关系
      await prisma.guildMember.create({
        data: {
          guildId: guild.id,
          userId: admin.id,
          nickname: "Jackey (Admin)",
          roleIds: JSON.stringify([adminRole.id]),
        },
      });

      // 5. 创建默认文字与语音频道
      const textChannel = await prisma.channel.create({
        data: {
          id: "chn_default_text_01",
          guildId: guild.id,
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
          name: "crypto-vault",
          type: "TEXT",
          topic: "端到端加密专属测试信道",
          position: 2,
          isE2EE: true,
        },
      });

      // 6. 插入欢迎消息
      await prisma.message.create({
        data: {
          id: "msg_welcome_01",
          channelId: textChannel.id,
          authorId: admin.id,
          content:
            "🎉 欢迎加入 **Tescord**！本项目基于纯粹离线自治哲学，支持本地持久化、端到端加密与高质量实时音视频通话。",
        },
      });

      console.log(
        "✅ 系统基础种子数据注入完成！管理员账号: admin@tescord.local / adminpassword123",
      );
    }

    // 7. 确保测试用户存在 (Alice & Bob 幂等初始化，纯净无公会)
    const testSalt = await bcrypt.genSalt(10);

    const existingAlice = await prisma.user.findUnique({
      where: { email: "alice@tescord.local" },
    });
    if (!existingAlice) {
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
        },
      });
      console.log("👤 测试用户 Alice 注入完成: alice@tescord.local / alicepassword123");
    }

    const existingBob = await prisma.user.findUnique({
      where: { email: "bob@tescord.local" },
    });
    if (!existingBob) {
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
        },
      });
      console.log("👤 测试用户 Bob 注入完成: bob@tescord.local / bobpassword123");
    }
  } catch (error) {
    console.error("❌ 初始化种子数据异常:", error);
  }
}
