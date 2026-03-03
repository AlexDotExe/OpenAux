/**
 * User Service
 * Business logic for user identity and reputation management.
 *
 * Scaling Path:
 * - Reputation recalculation can be moved to a background job (see stubs/reputationJob.ts)
 * - Progressive auth (phone/OAuth) can be added without schema changes
 */

import { findOrCreateUser, updateUserReputation } from '../db/users';
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
