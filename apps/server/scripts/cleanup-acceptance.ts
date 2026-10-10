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
  dmChannelId?: string;
  emojiFileKeys?: string[];
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
    )
      throw new Error("Test channel ownership check failed");
  }
  if (resources.guildInviteCodes?.length) {
    const invites = await prisma.invite.findMany({
      where: { code: { in: resources.guildInviteCodes } },
      select: { code: true, guildId: true, inviterId: true },
    });
    if (
      invites.length !== resources.guildInviteCodes.length ||
      invites.some(
        (invite) =>
          invite.guildId !== resources.guildId || invite.inviterId !== adminId,
      )
    )
      throw new Error("Test guild invite ownership check failed");
  }

  const dmId = resources.dmChannelId;
  const dmUserIds = [resources.aliceUserId, resources.bobUserId];
  if (dmId) {
    if (dmUserIds.some((id) => !id) || dmUserIds[0] === dmUserIds[1])
      throw new Error("Both exact DM test user IDs are required");
    const dm = await prisma.channel.findUnique({
      where: { id: dmId },
      select: {
        id: true,
        type: true,
        name: true,
        guildId: true,
        dmKey: true,
        recipients: { select: { userId: true } },
      },
    });
    const expectedRecipients = [resources.aliceUserId!, resources.bobUserId!];
    if (
      !dm ||
      dm.type !== "DM" ||
      dm.name !== "direct-message" ||
      dm.guildId !== null ||
      dm.dmKey !== [...expectedRecipients].sort().join(":") ||
      dm.recipients.length !== 2 ||
      new Set(dm.recipients.map((recipient) => recipient.userId)).size !== 2 ||
      dm.recipients.some(
        (recipient) => !expectedRecipients.includes(recipient.userId),
      )
    )
      throw new Error("Test DM identity and recipient check failed");
    const unrelatedDmMessages = await prisma.message.count({
      where: { channelId: dmId, authorId: { notIn: expectedRecipients } },
    });
    if (unrelatedDmMessages)
      throw new Error("Test DM has messages from an unrelated user");
  }

  const mediaKeyEnvelopes = await prisma.mediaKeyEnvelope.findMany({
    where: {
      OR: [
        { senderId: { in: ids } },
        { recipientId: { in: ids } },
        ...(dmId ? [{ channelId: dmId }] : []),
      ],
    },
    select: { id: true, channelId: true, senderId: true, recipientId: true },
  });
  if (
    mediaKeyEnvelopes.some(
      (item) =>
        item.channelId !== dmId ||
        !dmUserIds.includes(item.senderId) ||
        !dmUserIds.includes(item.recipientId),
    )
  )
    throw new Error("Test accounts have media keys outside the exact DM");

  const [
    memberships,
    ownedGuilds,
    createdInvites,
    createdGuildInvites,
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
    prisma.invite.findMany({
      where: { inviterId: { in: ids } },
      select: { code: true, guildId: true },
    }),
    prisma.message.count({
      where: {
        authorId: { in: ids },
        channelId: { not: dmId || "__none__" },
        channel: { guildId: { not: resources.guildId || "__none__" } },
      },
    }),
    prisma.channelRecipient.findMany({
      where: { userId: { in: ids } },
      select: { channelId: true },
    }),
  ]);
  if (
    memberships.some((item) => item.guildId !== resources.guildId) ||
    ownedGuilds.some((item) => item.id !== resources.guildId) ||
    createdInvites.some(
      (item) => item.code !== resources.registrationInviteCode,
    ) ||
    createdGuildInvites.some(
      (item) =>
        item.guildId !== resources.guildId ||
        !resources.guildInviteCodes?.includes(item.code),
    ) ||
    externalMessages ||
    dmRecipients.some((recipient) => recipient.channelId !== dmId) ||
    (dmId && dmRecipients.length !== 2)
  )
    throw new Error(
      "Test account has resources outside the exact test guild; cleanup refused",
    );

  const emojiFileKeys = resources.emojiFileKeys || [];
  if (
    emojiFileKeys.length > 2 ||
    new Set(emojiFileKeys).size !== emojiFileKeys.length ||
    emojiFileKeys.some(
      (key) =>
        !new RegExp(
          `^[0-9]{13}-[a-f0-9]{8}-(personal|guild)_${marker}\\.png$`,
        ).test(key),
    )
  )
    throw new Error(
      "Emoji object keys do not match the exact acceptance marker",
    );
  if (emojiFileKeys.length) {
    const urls = emojiFileKeys.map(
      (key) =>
        `${process.env.SERVER_BASE_URL}/public-assets/${encodeURIComponent(key)}`,
    );
    const emojis = await prisma.customEmoji.findMany({
      where: { imageUrl: { in: urls } },
    });
    if (
      emojis.some(
        (emoji) =>
          emoji.createdById !== adminId ||
          (emoji.guildId !== null && emoji.guildId !== resources.guildId) ||
          (emoji.userId !== null && emoji.userId !== adminId),
      )
    )
      throw new Error(
        "Emoji object has references outside the exact test resources",
      );
    const { storageService } =
      await import("../src/services/storage.service.js");
    await storageService.init();
    for (const url of urls) {
      await storageService.removePublicAsset(url);
      try {
        await storageService.statObject(url);
        throw new Error("Emoji object remains after deletion");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          (error.code === "NoSuchKey" ||
            error.code === "NotFound" ||
            error.code === "ENOENT")
        ))
          throw error;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (dmId) {
      await tx.mediaKeyEnvelope.deleteMany({ where: { channelId: dmId } });
      await tx.channel.delete({ where: { id: dmId } });
    }
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

  const [
    remainingUsers,
    remainingGuild,
    remainingInvite,
    remainingChannels,
    remainingGuildInvites,
    remainingDm,
    remainingDmRecipients,
    remainingMediaKeys,
  ] = await Promise.all([
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
      ? prisma.invite.count({
          where: { code: { in: resources.guildInviteCodes } },
        })
      : 0,
    dmId ? prisma.channel.count({ where: { id: dmId } }) : 0,
    prisma.channelRecipient.count({ where: { userId: { in: ids } } }),
    prisma.mediaKeyEnvelope.count({
      where: {
        OR: [
          { senderId: { in: ids } },
          { recipientId: { in: ids } },
          ...(dmId ? [{ channelId: dmId }] : []),
        ],
      },
    }),
  ]);
  if (
    remainingUsers ||
    remainingGuild ||
    remainingInvite ||
    remainingChannels ||
    remainingGuildInvites ||
    remainingDm ||
    remainingDmRecipients ||
    remainingMediaKeys
  )
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
      remainingDm,
      remainingDmRecipients,
      remainingMediaKeys,
      deletedEmojiObjects: emojiFileKeys.length,
      remainingEmojiObjects: 0,
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
