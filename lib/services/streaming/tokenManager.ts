/**
 * Token Manager
 * Handles automatic token refresh with 5-minute buffer and single-retry on 401.
 */

import { prisma } from '@/lib/db/prisma';
import { OAuthTokens } from './types';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export async function getTokensForVenue(venueId: string): Promise<OAuthTokens | null> {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: {
      oauthAccessToken: true,
      oauthRefreshToken: true,
      oauthTokenExpiresAt: true,
      oauthScope: true,
    },
  });

  if (!venue?.oauthAccessToken || !venue?.oauthRefreshToken || !venue?.oauthTokenExpiresAt) {
    return null;
  }

  return {
    accessToken: venue.oauthAccessToken,
    refreshToken: venue.oauthRefreshToken,
    expiresAt: venue.oauthTokenExpiresAt,
    scope: venue.oauthScope ?? undefined,
  };
}

export async function saveTokensForVenue(venueId: string, tokens: OAuthTokens): Promise<void> {
  await prisma.venue.update({
    where: { id: venueId },
    data: {
      oauthAccessToken: tokens.accessToken,
      oauthRefreshToken: tokens.refreshToken,
      oauthTokenExpiresAt: tokens.expiresAt,
      oauthScope: tokens.scope ?? null,
    },
  });
}

function isTokenExpiringSoon(expiresAt: Date): boolean {
  return Date.now() + TOKEN_EXPIRY_BUFFER_MS >= expiresAt.getTime();
}

/**
 * Execute a function with a valid token. Refreshes if expiring soon.
 * On 401, refreshes once and retries.
 */
export async function withValidToken<T>(
  venueId: string,
  refreshFn: (refreshToken: string) => Promise<OAuthTokens>,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  let tokens = await getTokensForVenue(venueId);
  if (!tokens) throw new Error('No OAuth tokens found for venue');

  // Refresh if expiring soon
  if (isTokenExpiringSoon(tokens.expiresAt)) {
    tokens = await refreshFn(tokens.refreshToken);
    await saveTokensForVenue(venueId, tokens);
  }

  try {
    return await fn(tokens.accessToken);
  } catch (error: unknown) {
    // Retry once on 401
    if (error instanceof Error && error.message.includes('401')) {
      tokens = await refreshFn(tokens.refreshToken);
      await saveTokensForVenue(venueId, tokens);
      return fn(tokens.accessToken);
    }
    throw error;
  }
}
