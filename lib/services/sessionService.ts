/**
 * Session Service
 * Business logic for venue sessions (live nights).
 */

import { createSession, endSession, findActiveSession, updateEnergyLevel, findSessionById } from '../db/sessions';
import { recordPlayback } from '../db/playback';
import { updateRequestStatus } from '../db/requests';
import { selectNextSong, ScoredRequest } from './virtualDjEngine';
import { recalculateReputation } from './userService';
import { getStreamingServiceForVenue } from './streaming';
import { invalidateQueueCache } from './queueCache';
import { Session } from '@prisma/client';

export async function startSession(venueId: string): Promise<Session> {
  return createSession(venueId);
}

export async function stopSession(sessionId: string): Promise<Session> {
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
): Promise<PlayResult> {
  if (currentRequestId) {
    await updateRequestStatus(currentRequestId, wasSkipped ? 'SKIPPED' : 'PLAYED');

    // Recalculate reputation for the requester
    const { prisma } = await import('../db/prisma');
    const req = await prisma.songRequest.findUnique({
      where: { id: currentRequestId },
      select: { userId: true, songId: true, voteWeight: true, isPreloaded: true },
    });
    if (req) {
      await recordPlayback({
        sessionId,
        songId: req.songId,
        crowdScore: req.voteWeight,
      });
      // Skip reputation update for playlist pre-loaded songs (no real user to credit)
      if (req.userId && !req.isPreloaded) {
        recalculateReputation(req.userId).catch(console.error);
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
          await service.play(song.spotifyId);
          result.trackId = song.spotifyId;

          // Pre-queue the next 2-3 songs for smooth auto-advance
          if (service.addToQueue) {
            console.log('[advanceToNextSong] Queuing upcoming songs for auto-advance');

            // Get the ranked queue to find the next songs
            const { getRankedQueue } = await import('./virtualDjEngine');
            const queue = await getRankedQueue(sessionId);

            // Queue the next 2 songs (queue[0] is now playing, so start at index 1)
            for (let i = 1; i < Math.min(3, queue.length); i++) {
              const upcomingSong = queue[i];
              const upcomingSongData = await prisma.song.findUnique({
                where: { id: upcomingSong.songId },
                select: { spotifyId: true },
              });

              if (upcomingSongData?.spotifyId) {
                await service.addToQueue(upcomingSongData.spotifyId).catch((err) => {
                  console.error(`[advanceToNextSong] Failed to queue song ${i}:`, err);
                });
                console.log(`[advanceToNextSong] Queued upcoming song at position ${i}: ${upcomingSong.title}`);
              }
            }
          }
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
