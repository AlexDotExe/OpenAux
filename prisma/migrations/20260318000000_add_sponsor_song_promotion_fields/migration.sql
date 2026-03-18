-- AddColumn promotionActivatedAt to SponsorSong
ALTER TABLE "SponsorSong" ADD COLUMN "promotionActivatedAt" TIMESTAMP(3);

-- AddColumn promotionExpiresAt to SponsorSong
ALTER TABLE "SponsorSong" ADD COLUMN "promotionExpiresAt" TIMESTAMP(3);

-- AddColumn activationCount to SponsorSong
ALTER TABLE "SponsorSong" ADD COLUMN "activationCount" INTEGER NOT NULL DEFAULT 0;
