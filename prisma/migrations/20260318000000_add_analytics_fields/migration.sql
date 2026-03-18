-- AlterTable: Add analytics counters to Session
ALTER TABLE "Session" ADD COLUMN "totalSongsPlayed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "peakActiveUsers" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Add skip initiator and venueId to PlaybackHistory
ALTER TABLE "PlaybackHistory" ADD COLUMN "venueId" TEXT;
ALTER TABLE "PlaybackHistory" ADD COLUMN "skipInitiatedByAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlaybackHistory" ADD COLUMN "skipInitiatedByUserId" TEXT;

-- AlterTable: Add requestId (boost payment linkage) to Payment
ALTER TABLE "Payment" ADD COLUMN "requestId" TEXT;

-- CreateIndex: Time-based indexes for PlaybackHistory
CREATE INDEX "PlaybackHistory_playedAt_idx" ON "PlaybackHistory"("playedAt");
CREATE INDEX "PlaybackHistory_venueId_playedAt_idx" ON "PlaybackHistory"("venueId", "playedAt");

-- CreateIndex: Time-based index for Vote
CREATE INDEX "Vote_createdAt_idx" ON "Vote"("createdAt");

-- CreateIndex: Time-based indexes for Payment
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE INDEX "Payment_venueId_createdAt_idx" ON "Payment"("venueId", "createdAt");

-- AddForeignKey: venueId on PlaybackHistory
ALTER TABLE "PlaybackHistory" ADD CONSTRAINT "PlaybackHistory_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: requestId on Payment
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SongRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
