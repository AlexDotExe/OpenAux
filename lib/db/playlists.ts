import { prisma } from './prisma';
import { VenuePlaylist, VenuePlaylistSong } from '@prisma/client';

/**
 * DB Access Layer - Venue Playlists (#18)
 */

export type PlaylistWithSongs = VenuePlaylist & {
  songs: (VenuePlaylistSong & {
    song: {
      id: string;
      title: string;
      artist: string;
      albumArtUrl: string | null;
      durationMs: number | null;
      spotifyId: string | null;
      youtubeId: string | null;
    };
  })[];
};

export async function listPlaylists(venueId: string): Promise<VenuePlaylist[]> {
  return prisma.venuePlaylist.findMany({
    where: { venueId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findPlaylistById(playlistId: string): Promise<PlaylistWithSongs | null> {
  return prisma.venuePlaylist.findUnique({
    where: { id: playlistId },
    include: {
      songs: {
        include: {
          song: {
            select: {
              id: true,
              title: true,
              artist: true,
              albumArtUrl: true,
              durationMs: true,
              spotifyId: true,
              youtubeId: true,
            },
          },
        },
        orderBy: { position: 'asc' },
      },
    },
  }) as Promise<PlaylistWithSongs | null>;
}

export async function createPlaylist(venueId: string, name: string): Promise<VenuePlaylist> {
  return prisma.venuePlaylist.create({ data: { venueId, name } });
}

export async function updatePlaylist(playlistId: string, name: string): Promise<VenuePlaylist> {
  return prisma.venuePlaylist.update({ where: { id: playlistId }, data: { name } });
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  await prisma.venuePlaylist.delete({ where: { id: playlistId } });
}

export async function addSongToPlaylist(
  playlistId: string,
  songId: string,
): Promise<VenuePlaylistSong> {
  // Position is the next available slot
  const max = await prisma.venuePlaylistSong.aggregate({
    where: { playlistId },
    _max: { position: true },
  });
  const position = (max._max.position ?? -1) + 1;

  return prisma.venuePlaylistSong.upsert({
    where: { playlistId_songId: { playlistId, songId } },
    update: {},
    create: { playlistId, songId, position },
  });
}

export async function removeSongFromPlaylist(
  playlistId: string,
  songId: string,
): Promise<void> {
  await prisma.venuePlaylistSong.deleteMany({ where: { playlistId, songId } });
}

export async function reorderPlaylistSongs(
  playlistId: string,
  orderedSongIds: string[],
): Promise<void> {
  await Promise.all(
    orderedSongIds.map((songId, index) =>
      prisma.venuePlaylistSong.updateMany({
        where: { playlistId, songId },
        data: { position: index },
      }),
    ),
  );
}
