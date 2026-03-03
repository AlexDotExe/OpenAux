import { prisma } from './prisma';
import { Song } from '@prisma/client';

/**
 * DB Access Layer - Songs
 */

export async function findSongById(id: string): Promise<Song | null> {
  return prisma.song.findUnique({ where: { id } });
}

export async function findSongBySpotifyId(spotifyId: string): Promise<Song | null> {
  return prisma.song.findUnique({ where: { spotifyId } });
}

export async function findOrCreateSong(data: {
  spotifyId?: string;
  title: string;
  artist: string;
  bpm?: number;
  genreTags?: string[];
}): Promise<Song> {
  if (data.spotifyId) {
    const existing = await findSongBySpotifyId(data.spotifyId);
    if (existing) return existing;
  }
  return prisma.song.create({ data });
}

export async function searchSongs(query: string): Promise<Song[]> {
  return prisma.song.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { artist: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 20,
  });
}

export async function listSongs(): Promise<Song[]> {
  return prisma.song.findMany({ orderBy: { createdAt: 'desc' } });
}
