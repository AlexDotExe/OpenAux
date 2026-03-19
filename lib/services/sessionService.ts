/**
 * Session Service
 * Business logic for venue sessions (live nights).
 */

import { createSession, endSession, findActiveSession, updateEnergyLevel, findSessionById, incrementTotalSongsPlayed } from '../db/sessions';
import { recordPlayback } from '../db/playback';
import { updateRequestStatus } from '../db/requests';
import { selectNextSong, ScoredRequest } from './virtualDjEngine';
import { recalculateReputation } from './userService';
import { getStreamingServiceForVenue } from './streaming';
import { invalidateQueueCache } from './queueCache';
import { findSponsorSongByVenueAndSong, activateSponsorPromotion } from '../db/sponsorSongs';
import { processBoostRefund, refundUnplayedBoosts } from './refundService';
import { Session } from '@prisma/client';

export async function startSession(venueId: string): Promise<Session> {
  return createSession(venueId);
}

export async function stopSession(sessionId: string): Promise<Session> {
  // Automatically refund any unplayed boosted songs before ending the session.
  // Errors are logged but do not block the session from ending.
  refundUnplayedBoosts(sessionId).catch((err) =>
    console.error('[stopSession] Unplayed boost refund sweep failed for session', sessionId, err),
  );
  return endSession(sessionId);
}

export async function setEnergyLevel(sessionId: string, level: number): Promise<Session> {
  return updateEnergyLevel(sessionId, level);
}

export interface PlayResult {
  nowPlaying: ScoredRequest | null;
  playbackId?: string;
  trackId?: string;
  service?: 'spotify' | 'youtube';
  sponsorPromotion?: {
    promotionText: string | null;
    promotionDurationMinutes: number;
    promotionExpiresAt: Date;
    isAnthem: boolean;
  } | null;
}

/**
 * Advance to the next song:
 * 1. Mark current request as PLAYED
 * 2. Record playback history
 * 3. Recalculate requester reputation
 * 4. Select next track via DJ engine
 * 5. Trigger streaming playback if service is connected
 */
export async function advanceToNextSong(
  sessionId: string,
  currentRequestId?: string,
  wasSkipped = false,
  skipInitiatedByAdmin = false,
  skipInitiatedByUserId?: string,
): Promise<PlayResult> {
  if (currentRequestId) {
    await updateRequestStatus(currentRequestId, wasSkipped ? 'SKIPPED' : 'PLAYED');

    // Recalculate reputation for the requester
    const { prisma } = await import('../db/prisma');
    const req = await prisma.songRequest.findUnique({
      where: { id: currentRequestId },
      select: {
        userId: true,
        songId: true,
        voteWeight: true,
        isPreloaded: true,
        isBoosted: true,
        isRefundEligible: true,
        session: { select: { venueId: true } },
      },
    });
    if (req) {
      await Promise.all([
        recordPlayback({
          sessionId,
          songId: req.songId,
          crowdScore: req.voteWeight,
          venueId: req.session?.venueId,
          skipInitiatedByAdmin: wasSkipped ? skipInitiatedByAdmin : undefined,
          skipInitiatedByUserId: wasSkipped ? skipInitiatedByUserId : undefined,
        }),
        incrementTotalSongsPlayed(sessionId),
      ]);
      // Skip reputation update for playlist pre-loaded songs (no real user to credit)
      if (req.userId && !req.isPreloaded) {
        recalculateReputation(req.userId).catch(console.error);
      }
      // Issue a refund if the song was skipped and the user paid for a boost
      if (wasSkipped && req.isBoosted && req.isRefundEligible) {
        processBoostRefund(currentRequestId).catch((err) =>
          console.error('[advanceToNextSong] Boost refund failed for skipped request:', currentRequestId, err),
        );
      }
    }
  }

  const next = await selectNextSong(sessionId);
  if (!next) {
    return { nowPlaying: null };
  }

  await updateRequestStatus(next.requestId, 'APPROVED');

  // Invalidate queue cache since we just advanced to next song
  invalidateQueueCache(sessionId);

  // Trigger streaming playback
  const result: PlayResult = { nowPlaying: next };

  try {
    const session = await findSessionById(sessionId);
    if (session) {
      // Check if this song is a sponsor/anthem song and activate its promotion
      const sponsorSong = await findSponsorSongByVenueAndSong(session.venueId, next.songId);
      if (sponsorSong && sponsorSong.isActive) {
        const activated = await activateSponsorPromotion(sponsorSong.id, sponsorSong.promotionDurationMinutes);
        result.sponsorPromotion = {
          promotionText: activated.promotionText,
          promotionDurationMinutes: activated.promotionDurationMinutes,
          promotionExpiresAt: activated.promotionExpiresAt!,
          isAnthem: activated.isAnthem,
        };
        console.log(
          `[advanceToNextSong] Sponsor promotion activated for "${next.title}" — "${activated.promotionText}" for ${activated.promotionDurationMinutes} min`,
        );
      }

      const service = await getStreamingServiceForVenue(session.venueId);
      if (service) {
        result.service = service.name;

        // Look up the song to get the streaming service ID
        const { prisma } = await import('../db/prisma');
        const song = await prisma.song.findUnique({
          where: { id: next.songId },
          select: { spotifyId: true, youtubeId: true },
        });

        if (service.name === 'spotify' && song?.spotifyId) {
          // Playback is handled by the embedded player on the admin frontend
          result.trackId = song.spotifyId;
        } else if (service.name === 'youtube' && song?.youtubeId) {
          // YouTube playback is client-side; just return the ID
          result.trackId = song.youtubeId;
        }
      }
    }
  } catch (err) {
    // Don't fail the queue advance if playback fails
    console.error('[advanceToNextSong] Playback trigger failed:', err);
  }

  return result;
}

// Re-export for convenience
export { findActiveSession };
