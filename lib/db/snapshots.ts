import { prisma } from './prisma';
import { ActiveUserSnapshot } from '@prisma/client';
import { updatePeakActiveUsers } from './sessions';

/**
 * DB Access Layer - Active User Snapshots
 * Records point-in-time active user counts and updates the session peak.
 */

/**
 * Record the current active user count for a session and update Session.peakActiveUsers
 * if this count exceeds the stored peak.
 */
export async function recordActiveUserSnapshot(
  venueId: string,
  sessionId: string,
  activeCount: number,
): Promise<ActiveUserSnapshot> {
  const [snapshot] = await Promise.all([
    prisma.activeUserSnapshot.create({
      data: { venueId, sessionId, activeCount },
    }),
    updatePeakActiveUsers(sessionId, activeCount),
  ]);
  return snapshot;
}

/**
 * Count currently active (non-expired) users in a session.
 */
export async function countActiveUsersInSession(sessionId: string): Promise<number> {
  return prisma.userSession.count({
    where: { sessionId, isExpired: false, expiresAt: { gte: new Date() } },
  });
}
