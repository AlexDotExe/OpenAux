import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { startSession, stopSession, findActiveSession } from '@/lib/services/sessionService';
import { findPlaylistById } from '@/lib/db/playlists';
import { findOrCreateSystemUser } from '@/lib/db/users';
import { prisma } from '@/lib/db/prisma';

/**
 * Admin-only: Start or end a session for a venue.
 * Protected by admin token check (accepts legacy adminPassword or OAuth adminAuthToken).
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, action } = body;

    const isAdmin = await verifyAdmin(adminPassword ?? '', venueId);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (action === 'start') {
      const session = await startSession(venueId);

      // Auto-load the active playlist into the queue as pre-loaded song requests
      const venue = await findVenueById(venueId);
      if (venue?.activePlaylistId) {
        const playlist = await findPlaylistById(venue.activePlaylistId);
        if (playlist && playlist.venueId === venueId && playlist.songs.length > 0) {
          const systemUser = await findOrCreateSystemUser(venueId);

          // Fetch all existing pending/approved requests for this session in one query
          const existingRequests = await prisma.songRequest.findMany({
            where: { sessionId: session.id, status: { in: ['PENDING', 'APPROVED'] } },
            select: { songId: true },
          });
          const existingSongIds = new Set(existingRequests.map((r) => r.songId));

          const songsToAdd = playlist.songs.filter((ps) => !existingSongIds.has(ps.songId));
          if (songsToAdd.length > 0) {
            await prisma.songRequest.createMany({
              data: songsToAdd.map((ps) => ({
                sessionId: session.id,
                songId: ps.songId,
                userId: systemUser.id,
                isPreloaded: true,
              })),
            });
          }
        }
      }

      return NextResponse.json(session, { status: 201 });
    }

    if (action === 'end') {
      const active = await findActiveSession(venueId);
      if (!active) return NextResponse.json({ error: 'No active session' }, { status: 404 });
      const session = await stopSession(active.id);
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: 'action must be start or end' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/session]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
