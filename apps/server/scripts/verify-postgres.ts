import { PrismaClient } from "@prisma/client";

if (
  process.env.DATABASE_PROVIDER !== "postgresql" ||
  !process.env.DATABASE_URL?.includes("tescord_ci")
) {
  throw new Error("PostgreSQL verification requires the isolated CI database");
}

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
try {
  const user = await prisma.user.create({
    data: {
      username: `ci_${suffix}`,
      email: `ci_${suffix}@example.test`,
      passwordHash: "ci-only",
    },
  });
  const guild = await prisma.guild.create({
    data: { name: `CI ${suffix}`, ownerId: user.id },
  });
  const channel = await prisma.channel.create({
    data: { guildId: guild.id, name: "integration", type: "TEXT" },
  });
  const message = await prisma.message.create({
    data: {
      channelId: channel.id,
      authorId: user.id,
      content: "PostgreSQL migration test",
    },
  });
  if (
    (await prisma.message.findUnique({ where: { id: message.id } }))
      ?.content !== "PostgreSQL migration test"
  )
    throw new Error("Message relation query failed");
  console.log("PostgreSQL migration and core model relations: PASS");
} finally {
  await prisma.$disconnect();
}
