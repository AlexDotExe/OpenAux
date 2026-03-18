/**
 * API Route: Venue Playlist Management
 * GET  /api/admin/[venueId]/playlists - List all playlists for a venue
 * POST /api/admin/[venueId]/playlists - Create a new playlist
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { listPlaylists, createPlaylist } from '@/lib/db/playlists';

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const adminPassword = req.headers.get('x-admin-password') ?? '';
    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    if (!await verifyAdminToken(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const playlists = await listPlaylists(venueId);
    return NextResponse.json({ playlists });
  } catch (err) {
    console.error('[GET /api/admin/:venueId/playlists]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, name } = body;

    if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const playlist = await createPlaylist(venueId, name.trim());
    return NextResponse.json({ playlist }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/:venueId/playlists]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
