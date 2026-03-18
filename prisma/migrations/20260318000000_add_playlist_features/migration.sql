-- AlterTable: Add isPreloaded flag to SongRequest
ALTER TABLE "SongRequest" ADD COLUMN "isPreloaded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add playlist settings to Venue
ALTER TABLE "Venue" ADD COLUMN "activePlaylistId" TEXT;
ALTER TABLE "Venue" ADD COLUMN "playlistPriority" BOOLEAN NOT NULL DEFAULT false;
