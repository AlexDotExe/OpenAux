import { prisma } from './prisma';
import { User, UserSession } from '@prisma/client';

/**
 * DB Access Layer - Users
 * Thin layer over Prisma; no business logic here.
 */

export async function findUserByFingerprint(deviceFingerprint: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { deviceFingerprint } });
}

export async function createUser(deviceFingerprint: string): Promise<User> {
  return prisma.user.create({ data: { deviceFingerprint } });
}

export async function findOrCreateUser(deviceFingerprint: string): Promise<User> {
  const existing = await findUserByFingerprint(deviceFingerprint);
  if (existing) return existing;
  return createUser(deviceFingerprint);
}

export async function updateUserReputation(userId: string, reputationScore: number): Promise<User> {
  // influenceWeight is a capped, normalized version of reputationScore
  // Scaling path: replace this formula with a more sophisticated model
  const influenceWeight = Math.max(0.1, Math.min(3.0, reputationScore));
  return prisma.user.update({
    where: { id: userId },
    data: { reputationScore, influenceWeight },
  });
}

const USER_SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export async function findUserSession(userId: string, sessionId: string): Promise<UserSession | null> {
  return prisma.userSession.findUnique({ where: { userId_sessionId: { userId, sessionId } } });
}

export async function updateUserSessionLastRequest(userId: string, sessionId: string): Promise<void> {
  const now = new Date();
  await prisma.userSession.upsert({
    where: { userId_sessionId: { userId, sessionId } },
    update: { lastRequestAt: now, lastActiveAt: now },
    create: {
      userId,
      sessionId,
      lastRequestAt: now,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + USER_SESSION_EXPIRY_MS),
    },
  });
}
