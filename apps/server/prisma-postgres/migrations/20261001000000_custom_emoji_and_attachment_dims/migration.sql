-- AlterTable
ALTER TABLE "Attachment"
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER;

-- CreateTable
CREATE TABLE "CustomEmoji" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "animated" BOOLEAN NOT NULL DEFAULT false,
  "guildId" TEXT,
  "userId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomEmoji_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomEmoji_guildId_idx" ON "CustomEmoji"("guildId");

-- CreateIndex
CREATE INDEX "CustomEmoji_userId_idx" ON "CustomEmoji"("userId");

-- AddForeignKey
ALTER TABLE "CustomEmoji"
  ADD CONSTRAINT "CustomEmoji_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomEmoji"
  ADD CONSTRAINT "CustomEmoji_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
