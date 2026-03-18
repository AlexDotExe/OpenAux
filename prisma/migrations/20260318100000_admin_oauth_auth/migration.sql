-- AlterTable: make adminUsername and adminPassword optional, add OAuth fields
ALTER TABLE "Venue" ALTER COLUMN "adminUsername" DROP NOT NULL;
ALTER TABLE "Venue" ALTER COLUMN "adminPassword" DROP NOT NULL;
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "adminAuthToken" TEXT;
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "adminSpotifyId" TEXT;
ALTER TABLE "Venue" ADD COLUMN IF NOT EXISTS "adminGoogleId" TEXT;

-- CreateIndex: unique constraints for new fields
-- Note: PostgreSQL allows multiple NULLs in a UNIQUE index, so nullable uniques work correctly.
CREATE UNIQUE INDEX IF NOT EXISTS "Venue_adminAuthToken_key" ON "Venue"("adminAuthToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Venue_adminSpotifyId_key" ON "Venue"("adminSpotifyId");
CREATE UNIQUE INDEX IF NOT EXISTS "Venue_adminGoogleId_key" ON "Venue"("adminGoogleId");
