/**
 * API Route: Playlist Song Management
 * POST /api/admin/[venueId]/playlists/[playlistId]/songs
 *   - Add a song to a playlist (finds or creates the Song record first)
 *   - Optionally reorder all songs via { orderedSongIds: string[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findPlaylistById, addSongToPlaylist, reorderPlaylistSongs } from '@/lib/db/playlists';
import { findOrCreateSong } from '@/lib/db/songs';

interface RouteContext {
  params: Promise<{ venueId: string; playlistId: string }>;
}

async function verifyAdmin(venueId: string, adminPassword: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { venueId, playlistId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, song, orderedSongIds } = body;

    if (!await verifyAdmin(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const playlist = await findPlaylistById(playlistId);
    if (!playlist || playlist.venueId !== venueId) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    // Reorder mode: update positions for all songs
    if (orderedSongIds) {
      if (!Array.isArray(orderedSongIds)) {
        return NextResponse.json({ error: 'orderedSongIds must be an array' }, { status: 400 });
      }
      await reorderPlaylistSongs(playlistId, orderedSongIds);
      const updated = await findPlaylistById(playlistId);
      return NextResponse.json({ playlist: updated });
    }

    // Add song mode
    if (!song || typeof song !== 'object') {
      return NextResponse.json({ error: 'song is required' }, { status: 400 });
    }
    if (!song.title || !song.artist) {
      return NextResponse.json({ error: 'song.title and song.artist are required' }, { status: 400 });
    }

    // Find or create the Song record
    const songRecord = await findOrCreateSong({
      title: song.title,
      artist: song.artist,
      spotifyId: song.spotifyId ?? undefined,
      youtubeId: song.youtubeId ?? undefined,
      albumArtUrl: song.albumArtUrl ?? undefined,
      durationMs: song.durationMs ?? undefined,
    });

    await addSongToPlaylist(playlistId, songRecord.id);
    const updated = await findPlaylistById(playlistId);
    return NextResponse.json({ playlist: updated }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/:venueId/playlists/:playlistId/songs]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
