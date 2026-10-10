-- CreateTable
CREATE TABLE "PermissionOverwrite" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "categoryId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "allow" INTEGER NOT NULL DEFAULT 0,
    "deny" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionOverwrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionOverwrite_guildId_idx" ON "PermissionOverwrite"("guildId");

-- CreateIndex
CREATE INDEX "PermissionOverwrite_channelId_idx" ON "PermissionOverwrite"("channelId");

-- CreateIndex
CREATE INDEX "PermissionOverwrite_categoryId_idx" ON "PermissionOverwrite"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionOverwrite_channelId_targetType_targetId_key" ON "PermissionOverwrite"("channelId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionOverwrite_categoryId_targetType_targetId_key" ON "PermissionOverwrite"("categoryId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "PermissionOverwrite" ADD CONSTRAINT "PermissionOverwrite_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionOverwrite" ADD CONSTRAINT "PermissionOverwrite_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionOverwrite" ADD CONSTRAINT "PermissionOverwrite_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChannelCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
