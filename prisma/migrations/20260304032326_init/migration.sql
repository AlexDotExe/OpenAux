/*
  Warnings:

  - A unique constraint covering the columns `[youtubeId]` on the table `Song` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[adminUsername]` on the table `Venue` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `adminUsername` to the `Venue` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "albumArtUrl" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "youtubeId" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "adminUsername" TEXT NOT NULL,
ADD COLUMN     "oauthAccessToken" TEXT,
ADD COLUMN     "oauthRefreshToken" TEXT,
ADD COLUMN     "oauthScope" TEXT,
ADD COLUMN     "oauthTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "streamingService" TEXT,
ALTER COLUMN "adminPassword" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Song_youtubeId_key" ON "Song"("youtubeId");

-- CreateIndex
CREATE INDEX "Song_youtubeId_idx" ON "Song"("youtubeId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_adminUsername_key" ON "Venue"("adminUsername");

-- CreateIndex
CREATE INDEX "Venue_adminUsername_idx" ON "Venue"("adminUsername");
