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

// ── Auth-specific queries ──────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export async function findUserByAuthToken(authToken: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { authToken } });
}

export async function findUserByInstagramId(instagramId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { instagramId } });
}

export async function findUserBySpotifyUserId(spotifyUserId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { spotifyUserId } });
}

export interface CreateAuthUserParams {
  email?: string;
  passwordHash?: string;
  displayName?: string;
  authProvider: string;
  authToken: string;
  instagramId?: string;
  spotifyUserId?: string;
}

export async function createAuthUser(params: CreateAuthUserParams): Promise<User> {
  return prisma.user.create({
    data: {
      email: params.email,
      passwordHash: params.passwordHash,
      displayName: params.displayName,
      authProvider: params.authProvider,
      authToken: params.authToken,
      instagramId: params.instagramId,
      spotifyUserId: params.spotifyUserId,
    },
  });
}

export async function updateUserAuthToken(userId: string, authToken: string | null): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: { authToken },
  });
}

/**
 * Find or create a user via OAuth (Instagram or Spotify).
 * Returns the user and whether they were newly created.
 */
export async function findOrCreateOAuthUser(params: {
  instagramId?: string;
  spotifyUserId?: string;
  email?: string;
  displayName?: string;
  authProvider: string;
  authToken: string;
}): Promise<User> {
  // Try to find existing user by OAuth ID or email
  let existing: User | null = null;
  if (params.instagramId) {
    existing = await findUserByInstagramId(params.instagramId);
  } else if (params.spotifyUserId) {
    existing = await findUserBySpotifyUserId(params.spotifyUserId);
  }
  if (!existing && params.email) {
    existing = await findUserByEmail(params.email);
  }

  if (existing) {
    // Update OAuth fields and rotate auth token
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        authToken: params.authToken,
        instagramId: params.instagramId ?? existing.instagramId,
        spotifyUserId: params.spotifyUserId ?? existing.spotifyUserId,
        email: params.email ?? existing.email,
        displayName: existing.displayName ?? params.displayName,
        authProvider: params.authProvider,
      },
    });
  }

  return createAuthUser(params);
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

export async function updateUserDisplayName(userId: string, displayName: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: { displayName },
  });
}

/**
 * Find or create a system user for a venue, used for playlist-preloaded song requests.
 * The device fingerprint is scoped to the venue so system requests are distinguishable.
 */
export async function findOrCreateSystemUser(venueId: string): Promise<User> {
  return findOrCreateUser(`system:${venueId}`);
}
