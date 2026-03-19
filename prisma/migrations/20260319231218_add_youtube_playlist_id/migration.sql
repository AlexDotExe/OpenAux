-- DropIndex
DROP INDEX "Venue_adminUsername_idx";

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "youtubePlaylistId" TEXT;
