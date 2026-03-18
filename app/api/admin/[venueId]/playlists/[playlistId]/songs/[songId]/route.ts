/**
 * API Route: Remove a Song from a Playlist
 * DELETE /api/admin/[venueId]/playlists/[playlistId]/songs/[songId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/db/venues';
import { findPlaylistById, removeSongFromPlaylist } from '@/lib/db/playlists';

interface RouteContext {
  params: Promise<{ venueId: string; playlistId: string; songId: string }>;
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { venueId, playlistId, songId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword } = body;

    if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const playlist = await findPlaylistById(playlistId);
    if (!playlist || playlist.venueId !== venueId) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    await removeSongFromPlaylist(playlistId, songId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/admin/:venueId/playlists/:playlistId/songs/:songId]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
