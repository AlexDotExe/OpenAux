/**
 * Streaming Service Factory
 * Creates the appropriate streaming service based on venue configuration.
 */

import { prisma } from '@/lib/db/prisma';
import { StreamingService, OAuthTokens } from './types';
import { SpotifyService } from './spotify';
import { YouTubeService } from './youtube';

export function createStreamingService(
  serviceName: 'spotify' | 'youtube',
  tokens: OAuthTokens,
  venueId: string,
): StreamingService {
  switch (serviceName) {
    case 'spotify':
      return new SpotifyService(tokens, venueId);
    case 'youtube':
      return new YouTubeService(tokens, venueId);
    default:
      throw new Error(`Unknown streaming service: ${serviceName}`);
  }
}

export async function getStreamingServiceForVenue(venueId: string): Promise<StreamingService | null> {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: {
      streamingService: true,
      oauthAccessToken: true,
      oauthRefreshToken: true,
      oauthTokenExpiresAt: true,
      oauthScope: true,
    },
  });

  if (
    !venue?.streamingService ||
    !venue.oauthAccessToken ||
    !venue.oauthRefreshToken ||
    !venue.oauthTokenExpiresAt
  ) {
    return null;
  }

  const tokens: OAuthTokens = {
    accessToken: venue.oauthAccessToken,
    refreshToken: venue.oauthRefreshToken,
    expiresAt: venue.oauthTokenExpiresAt,
    scope: venue.oauthScope ?? undefined,
  };

  return createStreamingService(
    venue.streamingService as 'spotify' | 'youtube',
    tokens,
    venueId,
  );
}

export type { StreamingService, StreamingTrack, SearchResult, PlaybackState, OAuthTokens } from './types';
