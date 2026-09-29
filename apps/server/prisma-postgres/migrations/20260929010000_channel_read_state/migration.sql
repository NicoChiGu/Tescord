CREATE TABLE "ChannelReadState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "guildId" TEXT,
  "lastReadSequence" INTEGER NOT NULL DEFAULT 0,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ChannelReadState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelReadState_userId_channelId_key" ON "ChannelReadState"("userId", "channelId");
CREATE INDEX "ChannelReadState_userId_guildId_idx" ON "ChannelReadState"("userId", "guildId");
CREATE INDEX "ChannelReadState_channelId_idx" ON "ChannelReadState"("channelId");

ALTER TABLE "ChannelReadState"
  ADD CONSTRAINT "ChannelReadState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelReadState"
  ADD CONSTRAINT "ChannelReadState_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
