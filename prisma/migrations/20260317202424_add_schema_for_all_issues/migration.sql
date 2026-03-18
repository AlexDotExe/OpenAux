-- CreateEnum
CREATE TYPE "PlaybackSource" AS ENUM ('OPENAUX_REQUEST', 'VENUE_SELECTED', 'PLAYLIST', 'SPONSOR');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('BOOST', 'CREDIT_PURCHASE', 'PAYOUT');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('PURCHASE', 'BOOST_DEBIT', 'REFUND');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('OVERRIDE_QUEUE', 'SKIP_SONG', 'DELETE_REQUEST', 'APPROVE_SUGGESTION', 'REJECT_SUGGESTION');

-- AlterTable
ALTER TABLE "PlaybackHistory" ADD COLUMN     "skipPositionMs" INTEGER,
ADD COLUMN     "skippedAt" TIMESTAMP(3),
ADD COLUMN     "source" "PlaybackSource" NOT NULL DEFAULT 'OPENAUX_REQUEST';

-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "isExplicit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SongRequest" ADD COLUMN     "isRefundEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isRefunded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "creditBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "displayName" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "blockExplicit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedArtists" TEXT[],
ADD COLUMN     "blockedGenres" TEXT[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "crowdControlEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "revenueSharePercent" DOUBLE PRECISION NOT NULL DEFAULT 70.0,
ADD COLUMN     "suggestionModeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "venueType" TEXT,
ALTER COLUMN "defaultBoostPrice" SET DEFAULT 1.0;

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "lastRequestAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "venueId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "PaymentType" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentId" TEXT,
    "venueShareAmount" DOUBLE PRECISION,
    "platformShareAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "description" TEXT,
    "paymentId" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorSong" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "promotionText" TEXT,
    "promotionDurationMinutes" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAnthem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SponsorSong_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenuePlaylist" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenuePlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenuePlaylistSong" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "VenuePlaylistSong_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "actionType" "AdminActionType" NOT NULL,
    "targetRequestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveUserSnapshot" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveUserSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSession_sessionId_idx" ON "UserSession"("sessionId");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_userId_sessionId_key" ON "UserSession"("userId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentId_key" ON "Payment"("stripePaymentId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_venueId_idx" ON "Payment"("venueId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_type_idx" ON "Payment"("type");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");

-- CreateIndex
CREATE INDEX "SponsorSong_venueId_idx" ON "SponsorSong"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorSong_venueId_songId_key" ON "SponsorSong"("venueId", "songId");

-- CreateIndex
CREATE INDEX "VenuePlaylist_venueId_idx" ON "VenuePlaylist"("venueId");

-- CreateIndex
CREATE INDEX "VenuePlaylistSong_playlistId_idx" ON "VenuePlaylistSong"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "VenuePlaylistSong_playlistId_songId_key" ON "VenuePlaylistSong"("playlistId", "songId");

-- CreateIndex
CREATE INDEX "AdminAction_venueId_idx" ON "AdminAction"("venueId");

-- CreateIndex
CREATE INDEX "AdminAction_sessionId_idx" ON "AdminAction"("sessionId");

-- CreateIndex
CREATE INDEX "AdminAction_actionType_idx" ON "AdminAction"("actionType");

-- CreateIndex
CREATE INDEX "ActiveUserSnapshot_venueId_idx" ON "ActiveUserSnapshot"("venueId");

-- CreateIndex
CREATE INDEX "ActiveUserSnapshot_sessionId_idx" ON "ActiveUserSnapshot"("sessionId");

-- CreateIndex
CREATE INDEX "ActiveUserSnapshot_recordedAt_idx" ON "ActiveUserSnapshot"("recordedAt");

-- CreateIndex
CREATE INDEX "PlaybackHistory_source_idx" ON "PlaybackHistory"("source");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorSong" ADD CONSTRAINT "SponsorSong_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsorSong" ADD CONSTRAINT "SponsorSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePlaylist" ADD CONSTRAINT "VenuePlaylist_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePlaylistSong" ADD CONSTRAINT "VenuePlaylistSong_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "VenuePlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePlaylistSong" ADD CONSTRAINT "VenuePlaylistSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveUserSnapshot" ADD CONSTRAINT "ActiveUserSnapshot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveUserSnapshot" ADD CONSTRAINT "ActiveUserSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
