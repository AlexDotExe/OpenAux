import { prisma } from './prisma';
import { Venue } from '@prisma/client';

/**
 * DB Access Layer - Venues
 */

export async function findVenueById(id: string): Promise<Venue | null> {
  return prisma.venue.findUnique({ where: { id } });
}

export async function findVenueByAdminUsername(adminUsername: string): Promise<Venue | null> {
  return prisma.venue.findUnique({ where: { adminUsername } });
}

export async function listVenues(): Promise<Venue[]> {
  return prisma.venue.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createVenue(data: {
  name: string;
  adminUsername: string;
  adminPassword: string;
  genreProfile?: object;
  bpmRange?: object;
  energyCurveProfile?: object;
  streamingService?: string;
}): Promise<Venue> {
  return prisma.venue.create({ data });
}

export async function getVenueBlacklist(venueId: string): Promise<string[]> {
  const blacklist = await prisma.blacklist.findMany({
    where: { venueId },
    select: { songId: true },
  });
  return blacklist.map((b) => b.songId);
}

export async function blacklistSong(venueId: string, songId: string): Promise<void> {
  await prisma.blacklist.upsert({
    where: { venueId_songId: { venueId, songId } },
    update: {},
    create: { venueId, songId },
  });
}

export async function updateVenueOAuthTokens(
  venueId: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope?: string;
    streamingService: string;
    connectedAccountName?: string | null;
    connectedAccountEmail?: string | null;
  },
): Promise<Venue> {
  return prisma.venue.update({
    where: { id: venueId },
    data: {
      oauthAccessToken: tokens.accessToken,
      oauthRefreshToken: tokens.refreshToken,
      oauthTokenExpiresAt: tokens.expiresAt,
      oauthScope: tokens.scope ?? null,
      streamingService: tokens.streamingService,
      connectedAccountName: tokens.connectedAccountName ?? null,
      connectedAccountEmail: tokens.connectedAccountEmail ?? null,
    },
  });
}

export async function clearVenueOAuthTokens(venueId: string): Promise<Venue> {
  return prisma.venue.update({
    where: { id: venueId },
    data: {
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthTokenExpiresAt: null,
      oauthScope: null,
      streamingService: null,
      connectedAccountName: null,
      connectedAccountEmail: null,
    },
  });
}

export async function updateVenueSettings(
  venueId: string,
  settings: {
    defaultBoostPrice?: number;
    maxSongRepeatsPerHour?: number;
    maxSongsPerUser?: number;
    monetizationEnabled?: boolean;
    smartMonetizationEnabled?: boolean;
    suggestionModeEnabled?: boolean;
    crowdControlEnabled?: boolean;
  },
): Promise<Venue> {
  return prisma.venue.update({
    where: { id: venueId },
    data: settings,
  });
}
