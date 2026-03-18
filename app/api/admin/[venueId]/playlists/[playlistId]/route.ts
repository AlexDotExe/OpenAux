/**
 * API Route: Single Playlist Management
 * GET    /api/admin/[venueId]/playlists/[playlistId] - Get a playlist with its songs
 * PUT    /api/admin/[venueId]/playlists/[playlistId] - Rename a playlist
 * DELETE /api/admin/[venueId]/playlists/[playlistId] - Delete a playlist
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findPlaylistById, updatePlaylist, deletePlaylist } from '@/lib/db/playlists';

interface RouteContext {
  params: Promise<{ venueId: string; playlistId: string }>;
}

async function verifyAdmin(venueId: string, adminPassword: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { venueId, playlistId } = await context.params;
    const playlist = await findPlaylistById(playlistId);
    if (!playlist || playlist.venueId !== venueId) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }
    return NextResponse.json({ playlist });
  } catch (err) {
    console.error('[GET /api/admin/:venueId/playlists/:playlistId]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { venueId, playlistId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, name } = body;

    if (!await verifyAdmin(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const existing = await findPlaylistById(playlistId);
    if (!existing || existing.venueId !== venueId) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    const playlist = await updatePlaylist(playlistId, name.trim());
    return NextResponse.json({ playlist });
  } catch (err) {
    console.error('[PUT /api/admin/:venueId/playlists/:playlistId]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { venueId, playlistId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword } = body;

    if (!await verifyAdmin(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existing = await findPlaylistById(playlistId);
    if (!existing || existing.venueId !== venueId) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    await deletePlaylist(playlistId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/admin/:venueId/playlists/:playlistId]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
