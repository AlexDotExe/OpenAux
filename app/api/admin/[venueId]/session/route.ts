import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { startSession, stopSession, findActiveSession } from '@/lib/services/sessionService';
import { findPlaylistById } from '@/lib/db/playlists';
import { findOrCreateSystemUser } from '@/lib/db/users';
import { prisma } from '@/lib/db/prisma';

/**
 * Admin-only: Start or end a session for a venue.
 * Protected by simple password check (POC only).
 *
 * Scaling Path: Replace with proper JWT/session-based admin auth.
 */
async function verifyAdmin(adminPassword: string, venueId: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

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
          for (const ps of playlist.songs) {
            // Skip if this song is already in the queue (e.g. from a prior partial load)
            const existing = await prisma.songRequest.findFirst({
              where: { sessionId: session.id, songId: ps.songId, status: { in: ['PENDING', 'APPROVED'] } },
            });
            if (!existing) {
              await prisma.songRequest.create({
                data: {
                  sessionId: session.id,
                  songId: ps.songId,
                  userId: systemUser.id,
                  isPreloaded: true,
                },
              });
            }
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
