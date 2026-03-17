import { prisma } from './prisma';
import { UserSession } from '@prisma/client';

/**
 * DB Access Layer - UserSessions
 * Manages per-user participation records for a session, including expiry tracking.
 */

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

function newExpiresAt(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS);
}

/**
 * Join or rejoin a user session.
 * Creates a new UserSession if none exists; otherwise marks it as active and refreshes expiry.
 */
export async function joinOrRejoinUserSession(userId: string, sessionId: string): Promise<UserSession> {
  const now = new Date();
  const expiresAt = newExpiresAt();

  return prisma.userSession.upsert({
    where: { userId_sessionId: { userId, sessionId } },
    create: {
      userId,
      sessionId,
      joinedAt: now,
      lastActiveAt: now,
      expiresAt,
      isExpired: false,
    },
    update: {
      lastActiveAt: now,
      expiresAt,
      isExpired: false,
    },
  });
}

/**
 * Reset the activity timer for a user session.
 * Called whenever the user performs an action (vote, song request, etc.).
 * No-ops gracefully if the UserSession record does not exist.
 */
export async function updateUserSessionActivity(userId: string, sessionId: string): Promise<void> {
  const now = new Date();
  const expiresAt = newExpiresAt();

  await prisma.userSession.updateMany({
    where: { userId, sessionId, isExpired: false },
    data: { lastActiveAt: now, expiresAt },
  });
}

/**
 * Get the UserSession record for a user in a session.
 * Lazily marks the record as expired if expiresAt has passed.
 */
export async function getUserSession(userId: string, sessionId: string): Promise<UserSession | null> {
  const record = await prisma.userSession.findUnique({
    where: { userId_sessionId: { userId, sessionId } },
  });

  if (!record) return null;

  // Lazily mark as expired if the expiry time has passed and not already marked
  if (!record.isExpired && record.expiresAt < new Date()) {
    return prisma.userSession.update({
      where: { userId_sessionId: { userId, sessionId } },
      data: { isExpired: true },
    });
  }

  return record;
}
