import { prisma } from './prisma';
import { Venue } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export interface SponsorSongInfo {
  id: string;
  songId: string;
  promotionText: string | null;
  isAnthem: boolean;
  promotionDurationMinutes: number;
  isActive: boolean;
  song: {
    id: string;
    title: string;
    artist: string;
    albumArtUrl: string | null;
    spotifyId: string | null;
    youtubeId: string | null;
  };
}

/**
 * DB Access Layer - Venues
 */

export async function findVenueById(id: string): Promise<Venue | null> {
  return prisma.venue.findUnique({ where: { id } });
}

export async function findVenueByAdminUsername(adminUsername: string): Promise<Venue | null> {
  return prisma.venue.findFirst({ where: { adminUsername } });
}

export async function findVenueByAdminSpotifyId(adminSpotifyId: string): Promise<Venue | null> {
  return prisma.venue.findUnique({ where: { adminSpotifyId } });
}

export async function findVenueByAdminGoogleId(adminGoogleId: string): Promise<Venue | null> {
  return prisma.venue.findUnique({ where: { adminGoogleId } });
}

/**
 * Verify an admin credential against a venue.
 * Accepts either the legacy adminPassword or the OAuth-issued adminAuthToken.
 */
export async function verifyAdminToken(venueId: string, token: string): Promise<boolean> {
  if (!token) return false;
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  const v = venue as unknown as { adminPassword?: string | null; adminAuthToken?: string | null };
  return (v.adminPassword != null && token === v.adminPassword) ||
         (v.adminAuthToken != null && token === v.adminAuthToken);
}

/**
 * Rotate the admin auth token for a venue.
 * Called after every successful OAuth sign-in.
 */
export async function rotateAdminAuthToken(venueId: string): Promise<string> {
  const token = uuidv4();
  await prisma.venue.update({ where: { id: venueId }, data: { adminAuthToken: token } });
  return token;
}

export async function listVenues(): Promise<Venue[]> {
  return prisma.venue.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createVenue(data: {
  name: string;
  adminUsername?: string;
  adminPassword?: string;
  adminSpotifyId?: string;
  adminGoogleId?: string;
  adminAuthToken?: string;
  defaultBoostPrice?: number;
  maxSongRepeatsPerHour?: number;
  maxSongsPerUser?: number;
  monetizationEnabled?: boolean;
  smartMonetizationEnabled?: boolean;
  suggestionModeEnabled?: boolean;
  crowdControlEnabled?: boolean;
  genreProfile?: object;
  bpmRange?: object;
  energyCurveProfile?: object;
  streamingService?: string;
  oauthAccessToken?: string;
  oauthRefreshToken?: string | null;
  oauthTokenExpiresAt?: Date;
  oauthScope?: string | null;
  connectedAccountName?: string | null;
  connectedAccountEmail?: string | null;
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
    refreshToken?: string | null;
    expiresAt: Date;
    scope?: string | null;
    streamingService: string;
    connectedAccountName?: string | null;
    connectedAccountEmail?: string | null;
  },
): Promise<Venue> {
  return prisma.venue.update({
    where: { id: venueId },
    data: {
      oauthAccessToken: tokens.accessToken,
      oauthRefreshToken: tokens.refreshToken ?? undefined,
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

export async function updateVenueAdminOAuth(
  venueId: string,
  data: {
    adminSpotifyId?: string | null;
    adminGoogleId?: string | null;
    adminAuthToken?: string | null;
  },
): Promise<Venue> {
  return prisma.venue.update({
    where: { id: venueId },
    data,
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
    activePlaylistId?: string | null;
    playlistPriority?: boolean;
  },
): Promise<Venue> {
  return prisma.venue.update({
    where: { id: venueId },
    data: settings,
  });
}

export async function getSponsorSongsForVenue(venueId: string): Promise<SponsorSongInfo[]> {
  return prisma.sponsorSong.findMany({
    where: { venueId, isActive: true },
    include: {
      song: {
        select: {
          id: true,
          title: true,
          artist: true,
          albumArtUrl: true,
          spotifyId: true,
          youtubeId: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function upsertSponsorSong(
  venueId: string,
  songId: string,
  data: {
    promotionText?: string | null;
    promotionDurationMinutes?: number;
    isAnthem?: boolean;
    isActive?: boolean;
  },
): Promise<SponsorSongInfo> {
  return prisma.sponsorSong.upsert({
    where: { venueId_songId: { venueId, songId } },
    update: data,
    create: { venueId, songId, ...data },
    include: {
      song: {
        select: {
          id: true,
          title: true,
          artist: true,
          albumArtUrl: true,
          spotifyId: true,
          youtubeId: true,
        },
      },
    },
  });
}

export async function deleteSponsorSong(venueId: string, songId: string): Promise<void> {
  await prisma.sponsorSong.delete({
    where: { venueId_songId: { venueId, songId } },
  });
}
