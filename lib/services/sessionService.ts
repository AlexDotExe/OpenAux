/**
 * Session Service
 * Business logic for venue sessions (live nights).
 */

import { createSession, endSession, findActiveSession, updateEnergyLevel } from '../db/sessions';
import { recordPlayback } from '../db/playback';
import { updateRequestStatus } from '../db/requests';
import { selectNextSong, ScoredRequest } from './virtualDjEngine';
import { recalculateReputation } from './userService';
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
}

/**
 * Advance to the next song:
 * 1. Mark current request as PLAYED
 * 2. Record playback history
 * 3. Recalculate requester reputation
 * 4. Select next track via DJ engine
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
      select: { userId: true, songId: true, voteWeight: true },
    });
    if (req) {
      await recordPlayback({
        sessionId,
        songId: req.songId,
        crowdScore: req.voteWeight,
      });
      // Fire and forget reputation update
      recalculateReputation(req.userId).catch(console.error);
    }
  }

  const next = await selectNextSong(sessionId);
  if (next) {
    await updateRequestStatus(next.requestId, 'APPROVED');
  }

  return { nowPlaying: next };
}

// Re-export for convenience
export { findActiveSession };
