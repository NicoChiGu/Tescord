import { prisma } from "../src/db.js";

async function main() {
  console.log("🔄 开始执行频道分类数据迁移...");
  const guilds = await prisma.guild.findMany({
    include: {
      categories: true,
      channels: true,
    },
  });

  for (const guild of guilds) {
    console.log(`正在检查公会: ${guild.name} (${guild.id})...`);
    if (guild.categories.length === 0) {
      console.log(`公会 ${guild.name} 尚未建立分类，创建默认分类...`);
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

      for (const channel of guild.channels) {
        if (!channel.parentId) {
          const targetCategoryId =
            channel.type === "VOICE" ? voiceCat.id : textCat.id;
          await prisma.channel.update({
            where: { id: channel.id },
            data: { parentId: targetCategoryId },
          });
          console.log(
            `  - 频道 [${channel.name}] (${channel.type}) -> 分类 [${
              channel.type === "VOICE" ? voiceCat.name : textCat.name
            }]`,
          );
        }
      }
    } else {
      console.log(
        `公会 ${guild.name} 已存在 ${guild.categories.length} 个分类，跳过。`,
      );
    }
  }
  console.log("✅ 频道分类迁移完成！");
}

main()
  .catch((e) => {
    console.error("迁移失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
