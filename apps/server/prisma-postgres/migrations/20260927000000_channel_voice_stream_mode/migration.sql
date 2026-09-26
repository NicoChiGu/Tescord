-- Existing channels keep the SFU behavior until an owner changes either mode.
ALTER TABLE "Channel"
  ADD COLUMN "voiceMode" TEXT NOT NULL DEFAULT 'sfu',
  ADD COLUMN "streamMode" TEXT NOT NULL DEFAULT 'sfu';
