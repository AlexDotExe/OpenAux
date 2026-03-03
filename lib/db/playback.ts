import { prisma } from './prisma';
import { PlaybackHistory } from '@prisma/client';

/**
 * DB Access Layer - Playback History
 */

export async function recordPlayback(data: {
  sessionId: string;
  songId: string;
  crowdScore?: number;
}): Promise<PlaybackHistory> {
  return prisma.playbackHistory.create({
    data: { ...data, crowdScore: data.crowdScore ?? 0 },
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
