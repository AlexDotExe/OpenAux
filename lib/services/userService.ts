/**
 * User Service
 * Business logic for user identity and reputation management.
 *
 * Scaling Path:
 * - Reputation recalculation can be moved to a background job (see stubs/reputationJob.ts)
 * - Progressive auth (phone/OAuth) can be added without schema changes
 */

import { findOrCreateUser, updateUserReputation, updateUserDisplayName } from '../db/users';
import { User } from '@prisma/client';

export async function getOrCreateUserByFingerprint(deviceFingerprint: string): Promise<User> {
  return findOrCreateUser(deviceFingerprint);
}

/**
 * Recalculate user reputation based on their song request approval rate.
 *
 * Formula: reputation = approvedCount / totalRequests * baseWeight
 * This is called after a song is played or skipped.
 *
 * Future: move to background job, add ML scoring
 */
export async function recalculateReputation(userId: string): Promise<User> {
  const { prisma } = await import('../db/prisma');
  const stats = await prisma.songRequest.groupBy({
    by: ['status'],
    where: { userId },
    _count: true,
  });

  const total = stats.reduce((sum, s) => sum + s._count, 0);
  const approved = stats.find((s) => s.status === 'PLAYED')?._count ?? 0;

  let newScore = 1.0;
  if (total > 5) {
    // Only adjust reputation after enough data
    const approvalRate = approved / total;
    // Score range: 0.2 to 2.5
    newScore = 0.2 + approvalRate * 2.3;
  }

  return updateUserReputation(userId, newScore);
}

/**
 * Apply a reputation score penalty when a user's boosted song was refunded without being played.
 *
 * The penalty is scaled by the song's uniqueness: a song that had fewer concurrent requests
 * (i.e. only this user wanted it) carries a larger penalty, because the user was trying to
 * push a song nobody else in the crowd was interested in.
 *
 * uniquenessScore = 1 / totalSessionRequestsForSong (capped at 1.0)
 * penalty = BASE_PENALTY * uniquenessScore
 *
 * The result is subtracted from the user's current reputationScore and clamped to the valid range.
 */
export async function applyRefundScorePenalty(
  userId: string,
  songId: string,
  sessionId: string,
): Promise<User> {
  const { prisma } = await import('../db/prisma');

  // Count how many distinct users requested this song in the same session (proxy for popularity)
  const requestCount = await prisma.songRequest.count({
    where: { sessionId, songId },
  });

  // Uniqueness: inverse of request count — a song only one person asked for scores 1.0
  const uniquenessScore = 1.0 / Math.max(1, requestCount);

  const BASE_PENALTY = 0.15;
  const penalty = BASE_PENALTY * uniquenessScore;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { reputationScore: true } });
  const currentScore = user?.reputationScore ?? 1.0;

  // Clamp new score to the valid range [0.2, 2.5]
  const newScore = Math.max(0.2, Math.min(2.5, currentScore - penalty));

  return updateUserReputation(userId, newScore);
}

/**
 * Set or update the user's DJ display name.
 * The display name is shown in "DJ [Name] is playing..." on the now playing screen.
 */
export async function setDisplayName(userId: string, displayName: string): Promise<User> {
  return updateUserDisplayName(userId, displayName);
}
