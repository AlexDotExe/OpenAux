import { prisma } from './prisma';
import { PlaybackHistory } from '@prisma/client';

/**
 * DB Access Layer - Playback History
 */

export async function recordPlayback(data: {
  sessionId: string;
  songId: string;
  crowdScore?: number;
  venueId?: string;
  skipInitiatedByAdmin?: boolean;
  skipInitiatedByUserId?: string;
}): Promise<PlaybackHistory> {
  return prisma.playbackHistory.create({
    data: {
      sessionId: data.sessionId,
      songId: data.songId,
      crowdScore: data.crowdScore ?? 0,
      venueId: data.venueId,
      skipInitiatedByAdmin: data.skipInitiatedByAdmin ?? false,
      skipInitiatedByUserId: data.skipInitiatedByUserId,
    },
  });
}

export async function getRecentlyPlayedSongIds(
  sessionId: string,
  limit = 10,
): Promise<string[]> {
  const history = await prisma.playbackHistory.findMany({
    where: { sessionId },
    orderBy: { playedAt: 'desc' },
    take: limit,
    select: { songId: true },
  });
  return history.map((h) => h.songId);
}

export async function updateSkipRate(playbackId: string, skipRate: number): Promise<void> {
  await prisma.playbackHistory.update({ where: { id: playbackId }, data: { skipRate } });
}

export async function getPlaybackHistory(sessionId: string): Promise<PlaybackHistory[]> {
  return prisma.playbackHistory.findMany({
    where: { sessionId },
    orderBy: { playedAt: 'desc' },
    include: { song: true },
  });
}

export async function getSongPlayCountInLastHour(
  sessionId: string,
  songId: string,
): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.playbackHistory.count({
    where: {
      sessionId,
      songId,
      playedAt: { gte: oneHourAgo },
    },
  });
}

/**
 * Batch version: Get play counts for multiple songs in one query
 * Returns a Map of songId -> count
 */
export async function getBatchSongPlayCountsInLastHour(
  sessionId: string,
  songIds: string[],
): Promise<Map<string, number>> {
  if (songIds.length === 0) return new Map();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const results = await prisma.playbackHistory.groupBy({
    by: ['songId'],
    where: {
      sessionId,
      songId: { in: songIds },
      playedAt: { gte: oneHourAgo },
    },
    _count: { songId: true },
  });

  const countMap = new Map<string, number>();
  results.forEach(r => countMap.set(r.songId, r._count.songId));

  // Ensure all songIds are in the map (even if count is 0)
  songIds.forEach(id => {
    if (!countMap.has(id)) countMap.set(id, 0);
  });

  return countMap;
}
