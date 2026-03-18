import { prisma } from './prisma';
import { SponsorSong } from '@prisma/client';

/**
 * DB Access Layer - Sponsor Songs & Promotions
 */

export type SponsorSongWithSong = SponsorSong & {
  song: {
    id: string;
    title: string;
    artist: string;
    albumArtUrl: string | null;
    spotifyId: string | null;
    youtubeId: string | null;
  };
};

export async function getSponsorSongs(venueId: string): Promise<SponsorSongWithSong[]> {
  return prisma.sponsorSong.findMany({
    where: { venueId },
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
    orderBy: { createdAt: 'desc' },
  });
}

export async function createSponsorSong(data: {
  venueId: string;
  songId: string;
  promotionText?: string;
  promotionDurationMinutes?: number;
  isAnthem?: boolean;
}): Promise<SponsorSong> {
  return prisma.sponsorSong.create({ data });
}

export async function updateSponsorSong(
  id: string,
  data: {
    promotionText?: string | null;
    promotionDurationMinutes?: number;
    isActive?: boolean;
    isAnthem?: boolean;
  },
): Promise<SponsorSong> {
  return prisma.sponsorSong.update({ where: { id }, data });
}

export async function deleteSponsorSong(id: string): Promise<void> {
  await prisma.sponsorSong.delete({ where: { id } });
}

/**
 * Find a sponsor song entry by venue + song ID (used when a song plays to check
 * whether promotion activation should fire).
 */
export async function findSponsorSongByVenueAndSong(
  venueId: string,
  songId: string,
): Promise<SponsorSong | null> {
  return prisma.sponsorSong.findUnique({
    where: { venueId_songId: { venueId, songId } },
  });
}

/**
 * Activate a sponsor song's promotion: sets promotionActivatedAt to now,
 * promotionExpiresAt to now + durationMinutes, and increments activationCount.
 */
export async function activateSponsorPromotion(id: string, durationMinutes: number): Promise<SponsorSong> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
  return prisma.sponsorSong.update({
    where: { id },
    data: {
      promotionActivatedAt: now,
      promotionExpiresAt: expiresAt,
      activationCount: { increment: 1 },
    },
  });
}

/**
 * Get the currently active promotion for a venue (if any promotion has not yet expired).
 */
export async function getActivePromotion(venueId: string): Promise<SponsorSongWithSong | null> {
  const now = new Date();
  return prisma.sponsorSong.findFirst({
    where: {
      venueId,
      isActive: true,
      promotionExpiresAt: { gt: now },
    },
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
    orderBy: { promotionActivatedAt: 'desc' },
  });
}
