-- Add registration invite persistence to the PostgreSQL production schema.
ALTER TABLE "User" ADD COLUMN "registeredWithInviteCode" TEXT;

CREATE TABLE "RegistrationInvite" (
    "code" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegistrationInvite_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "RegistrationInvite_createdById_idx" ON "RegistrationInvite"("createdById");
CREATE INDEX "RegistrationInvite_isRevoked_idx" ON "RegistrationInvite"("isRevoked");

ALTER TABLE "User" ADD CONSTRAINT "User_registeredWithInviteCode_fkey"
    FOREIGN KEY ("registeredWithInviteCode") REFERENCES "RegistrationInvite"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RegistrationInvite" ADD CONSTRAINT "RegistrationInvite_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
