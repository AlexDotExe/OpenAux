/**
 * GET /api/admin/[venueId]/queue-history
 *
 * Returns all song requests for the active session (PLAYED, SKIPPED, PENDING, APPROVED)
 * ordered chronologically for the admin queue history view.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { findActiveSession } from '@/lib/db/sessions';
import { findAllSessionRequests } from '@/lib/db/requests';

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
    if (!(await verifyAdminToken(venueId, adminPassword))) {
      return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
    }

    const session = await findActiveSession(venueId);
    if (!session) {
      return NextResponse.json({ history: [] });
    }

    const requests = await findAllSessionRequests(session.id);

    return NextResponse.json({
      history: requests.map((r) => ({
        requestId: r.id,
        songId: r.song.id,
        title: r.song.title,
        artist: r.song.artist,
        status: r.status,
        spotifyId: r.song.spotifyId,
        youtubeId: r.song.youtubeId,
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error('[GET /api/admin/[venueId]/queue-history]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
