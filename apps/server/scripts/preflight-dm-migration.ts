import "../src/env.js";
import { prisma } from "../src/db.js";

async function main() {
  const [usersWithoutRole, dmChannels, orphanRecipients, sequenceCollisions] = await Promise.all([
    prisma.user.count({ where: { OR: [{ role: "" }, { role: { notIn: ["USER", "ADMIN", "SUPER_ADMIN"] } }] } }),
    prisma.channel.findMany({
      where: { type: "DM" },
      select: { id: true, dmKey: true, recipients: { select: { userId: true } }, _count: { select: { messages: true } } },
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM ChannelRecipient cr LEFT JOIN User u ON u.id = cr.userId LEFT JOIN Channel c ON c.id = cr.channelId WHERE u.id IS NULL OR c.id IS NULL`,
    prisma.$queryRaw<Array<{ channelId: string; sequence: number; count: bigint }>>`SELECT channelId, sequence, COUNT(*) AS count FROM Message GROUP BY channelId, sequence HAVING COUNT(*) > 1`,
  ]);

  const dmByPair = new Map<string, string[]>();
  const malformed: string[] = [];
  for (const channel of dmChannels) {
    const ids = channel.recipients.map((item) => item.userId).sort();
    if (ids.length !== 2) malformed.push(channel.id);
    const pair = ids.join(":");
    const entries = dmByPair.get(pair) || [];
    entries.push(channel.id);
    dmByPair.set(pair, entries);
  }
  const duplicateConversations = [...dmByPair.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([pair, channelIds]) => ({ pair, channelIds }));

  const report = {
    generatedAt: new Date().toISOString(),
    database: process.env.DATABASE_URL?.replace(/[^/\\]+$/, "<database>"),
    usersWithoutValidRole: usersWithoutRole,
    orphanRecipientCount: Number(orphanRecipients[0]?.count || 0),
    malformedDMChannels: malformed,
    duplicateConversations,
    duplicateMessageSequences: sequenceCollisions.map((item) => ({
      channelId: item.channelId,
      sequence: item.sequence,
      count: Number(item.count),
    })),
    safeToApplyUniqueConstraints:
      malformed.length === 0 &&
      duplicateConversations.length === 0 &&
      Number(orphanRecipients[0]?.count || 0) === 0 &&
      sequenceCollisions.length === 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.safeToApplyUniqueConstraints) process.exitCode = 2;
}

main().finally(() => prisma.$disconnect());
