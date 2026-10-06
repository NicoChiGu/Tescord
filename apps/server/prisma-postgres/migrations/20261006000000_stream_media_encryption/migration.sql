-- Additive migration: existing DM envelopes remain intact. Contexts restart after deploy.
CREATE TABLE "StreamMediaKeyEnvelope" (
  "id" TEXT NOT NULL, "contextId" TEXT NOT NULL, "membershipVersion" TEXT NOT NULL,
  "channelId" TEXT NOT NULL, "streamId" TEXT NOT NULL, "keyId" INTEGER NOT NULL,
  "senderId" TEXT NOT NULL, "senderDeviceId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL, "recipientDeviceId" TEXT NOT NULL,
  "envelopeJson" TEXT NOT NULL, "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StreamMediaKeyEnvelope_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StreamMediaKeyEnvelope_contextId_membershipVersion_keyId_re_key"
ON "StreamMediaKeyEnvelope"("contextId", "membershipVersion", "keyId", "recipientId", "recipientDeviceId");
CREATE INDEX "StreamMediaKeyEnvelope_contextId_membershipVersion_recipien_idx"
ON "StreamMediaKeyEnvelope"("contextId", "membershipVersion", "recipientId", "recipientDeviceId");
CREATE INDEX "StreamMediaKeyEnvelope_expiresAt_idx" ON "StreamMediaKeyEnvelope"("expiresAt");
