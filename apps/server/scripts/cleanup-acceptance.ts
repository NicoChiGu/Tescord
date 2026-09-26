import "../src/env.js";
import { prisma } from "../src/db.js";

interface AcceptanceResources {
  marker: string;
  adminUserId?: string;
  aliceUserId?: string;
  bobUserId?: string;
  guildId?: string;
  registrationInviteCode?: string;
  channelIds?: string[];
  guildInviteCodes?: string[];
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 8192) throw new Error("Resource manifest too large");
  }
  const resources = JSON.parse(input) as AcceptanceResources;
  const marker = resources.marker;
  if (!/^[a-f0-9]{10}$/.test(marker))
    throw new Error("A ten-character acceptance marker is required");

  const identities = [
    {
      id: resources.adminUserId,
      username: `AcceptanceAdmin_${marker}`,
      email: `admin-${marker}@example.invalid`,
      role: "SUPER_ADMIN",
    },
    {
      id: resources.aliceUserId,
      username: `alice_${marker}`,
      email: `alice-${marker}@example.invalid`,
      role: "USER",
    },
    {
      id: resources.bobUserId,
      username: `bob_${marker}`,
      email: `bob-${marker}@example.invalid`,
      role: "USER",
    },
  ].filter((entry): entry is typeof entry & { id: string } => !!entry.id);
  if (!identities.length) throw new Error("No exact test account IDs supplied");
  if (new Set(identities.map((entry) => entry.id)).size !== identities.length)
    throw new Error("Duplicate account IDs in manifest");

  const ids = identities.map((entry) => entry.id);
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      registeredWithInviteCode: true,
    },
  });
  for (const entry of identities) {
    const user = users.find((item) => item.id === entry.id);
    const usernameMatches =
      entry.role === "SUPER_ADMIN"
        ? user?.username === entry.username
        : !!user &&
          new RegExp(`^${entry.username}#[0-9]{5}$`).test(user.username);
    if (
      !user ||
      !usernameMatches ||
      user.email !== entry.email ||
      user.role !== entry.role
    )
      throw new Error(`Account identity check failed for ${entry.id}`);
    if (
      entry.role === "USER" &&
      resources.registrationInviteCode &&
      user.registeredWithInviteCode !== resources.registrationInviteCode
    )
      throw new Error(`Registration invite mismatch for ${entry.id}`);
  }

  const adminId = resources.adminUserId;
  if ((resources.guildId || resources.registrationInviteCode) && !adminId)
    throw new Error("Admin ID required to verify owned resources");
  if (resources.guildId) {
    const guild = await prisma.guild.findUnique({
      where: { id: resources.guildId },
      select: { name: true, ownerId: true },
    });
    if (
      !guild ||
      guild.ownerId !== adminId ||
      guild.name !== `Cloudflare acceptance ${marker}`
    )
      throw new Error("Test guild identity check failed");
  }
  if (resources.registrationInviteCode) {
    const invite = await prisma.registrationInvite.findUnique({
      where: { code: resources.registrationInviteCode },
      select: { note: true, createdById: true },
    });
    if (
      !invite ||
      invite.createdById !== adminId ||
      invite.note !== `Cloudflare acceptance ${marker}`
    )
      throw new Error("Registration invite identity check failed");
  }
  if (resources.channelIds?.length) {
    const channels = await prisma.channel.findMany({
      where: { id: { in: resources.channelIds } },
      select: { id: true, guildId: true },
    });
    if (
      channels.length !== resources.channelIds.length ||
      channels.some((channel) => channel.guildId !== resources.guildId)
    ) throw new Error("Test channel ownership check failed");
  }
  if (resources.guildInviteCodes?.length) {
    const invites = await prisma.invite.findMany({
      where: { code: { in: resources.guildInviteCodes } },
      select: { code: true, guildId: true, inviterId: true },
    });
    if (
      invites.length !== resources.guildInviteCodes.length ||
      invites.some((invite) => invite.guildId !== resources.guildId || invite.inviterId !== adminId)
    ) throw new Error("Test guild invite ownership check failed");
  }

  const [
    memberships,
    ownedGuilds,
    createdInvites,
    externalMessages,
    dmRecipients,
  ] = await Promise.all([
    prisma.guildMember.findMany({
      where: { userId: { in: ids } },
      select: { guildId: true },
    }),
    prisma.guild.findMany({
      where: { ownerId: { in: ids } },
      select: { id: true },
    }),
    prisma.registrationInvite.findMany({
      where: { createdById: { in: ids } },
      select: { code: true },
    }),
    prisma.message.count({
      where: {
        authorId: { in: ids },
        channel: { guildId: { not: resources.guildId || "__none__" } },
      },
    }),
    prisma.channelRecipient.count({ where: { userId: { in: ids } } }),
  ]);
  if (
    memberships.some((item) => item.guildId !== resources.guildId) ||
    ownedGuilds.some((item) => item.id !== resources.guildId) ||
    createdInvites.some(
      (item) => item.code !== resources.registrationInviteCode,
    ) ||
    externalMessages ||
    dmRecipients
  )
    throw new Error(
      "Test account has resources outside the exact test guild; cleanup refused",
    );

  await prisma.$transaction(async (tx) => {
    if (resources.guildId)
      await tx.guild.delete({ where: { id: resources.guildId } });
    if (resources.registrationInviteCode)
      await tx.registrationInvite.delete({
        where: { code: resources.registrationInviteCode },
      });
    if (adminId)
      await tx.platformAuditLog.deleteMany({ where: { actorId: adminId } });
    const deleted = await tx.user.deleteMany({ where: { id: { in: ids } } });
    if (deleted.count !== ids.length)
      throw new Error("Not all exact test accounts were deleted");
  });

  const [remainingUsers, remainingGuild, remainingInvite, remainingChannels, remainingGuildInvites] = await Promise.all([
    prisma.user.count({ where: { id: { in: ids } } }),
    resources.guildId
      ? prisma.guild.count({ where: { id: resources.guildId } })
      : 0,
    resources.registrationInviteCode
      ? prisma.registrationInvite.count({
          where: { code: resources.registrationInviteCode },
        })
      : 0,
    resources.channelIds?.length
      ? prisma.channel.count({ where: { id: { in: resources.channelIds } } })
      : 0,
    resources.guildInviteCodes?.length
      ? prisma.invite.count({ where: { code: { in: resources.guildInviteCodes } } })
      : 0,
  ]);
  if (remainingUsers || remainingGuild || remainingInvite || remainingChannels || remainingGuildInvites)
    throw new Error("Cleanup verification found remaining test resources");
  process.stdout.write(
    JSON.stringify({
      marker,
      deletedAccounts: ids.length,
      deletedGuild: !!resources.guildId,
      deletedRegistrationInvite: !!resources.registrationInviteCode,
      remainingUsers,
      remainingGuild,
      remainingInvite,
      remainingChannels,
      remainingGuildInvites,
    }) + "\n",
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Acceptance cleanup failed"}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
