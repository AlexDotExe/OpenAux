/**
 * Admin endpoint to skip the current track and advance the queue.
 * Logs a SKIP_SONG admin action when crowd control mode is active.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findRequestById } from '@/lib/db/requests';
import { advanceToNextSong } from '@/lib/services/sessionService';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string; requestId: string }> },
) {
  const { venueId, requestId } = await params;
  const body = await req.json();
  const { adminPassword } = body;

  // Validate admin auth
  const venue = await findVenueById(venueId);
  if (!venue || venue.adminPassword !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate request exists
  const request = await findRequestById(requestId);
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  // Log admin action when crowd control mode is active
  if (venue.crowdControlEnabled) {
    await prisma.adminAction.create({
      data: {
        venueId,
        sessionId: request.sessionId,
        actionType: 'SKIP_SONG',
        targetRequestId: requestId,
        metadata: { title: request.song.title, artist: request.song.artist },
      },
    });
  }

  // Advance queue, marking current request as skipped
  const result = await advanceToNextSong(request.sessionId, requestId, true);

  return NextResponse.json(result);
}
