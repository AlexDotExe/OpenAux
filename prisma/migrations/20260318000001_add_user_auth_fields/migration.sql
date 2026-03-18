-- AlterTable: make deviceFingerprint nullable and add auth fields to User
ALTER TABLE "User" ALTER COLUMN "deviceFingerprint" DROP NOT NULL;

ALTER TABLE "User"
ADD COLUMN "email"         TEXT,
ADD COLUMN "passwordHash"  TEXT,
ADD COLUMN "instagramId"   TEXT,
ADD COLUMN "spotifyUserId" TEXT,
ADD COLUMN "authProvider"  TEXT,
ADD COLUMN "authToken"     TEXT;

-- CreateIndex: unique constraints for auth fields (NULLs are distinct in PostgreSQL)
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_instagramId_key" ON "User"("instagramId");
CREATE UNIQUE INDEX "User_spotifyUserId_key" ON "User"("spotifyUserId");
CREATE UNIQUE INDEX "User_authToken_key" ON "User"("authToken");

-- CreateIndex: performance indexes
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "User_authToken_idx" ON "User"("authToken");
