/**
 * Public playback endpoint - allows users to see what's currently playing
 * No authentication required (read-only data)
 */

import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';
import { getSponsorSongsForVenue } from '@/lib/db/venues';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // Find session
  const session = await findSessionById(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Return 404 if session is not active
  if (!session.isActive) {
    return NextResponse.json({ error: 'Session is not active' }, { status: 404 });
  }

  // Get streaming service for the venue
  const service = await getStreamingServiceForVenue(session.venueId);
  if (!service) {
    return NextResponse.json({ playback: null, requesterName: null, sponsorInfo: null });
  }

  try {
    const [playback, approvedRequest, sponsorSongs] = await Promise.all([
      service.getPlaybackState(),
      // Find the currently playing (APPROVED) request to get the requester's name.
      // The session flow ensures at most one APPROVED request at a time: advanceToNextSong
      // marks the previous request as PLAYED/SKIPPED before approving the next one.
      prisma.songRequest.findFirst({
        where: { sessionId, status: 'APPROVED' },
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      getSponsorSongsForVenue(session.venueId),
    ]);

    const requesterName = approvedRequest?.user?.displayName ?? null;

    // Check if the currently playing song is a sponsor/anthem song
    const sponsorSongMap = new Map(sponsorSongs.map((ss) => [ss.songId, ss]));
    const currentSponsorInfo = approvedRequest
      ? (sponsorSongMap.get(approvedRequest.songId) ?? null)
      : null;

    return NextResponse.json({
      playback,
      requesterName,
      sponsorInfo: currentSponsorInfo
        ? {
            promotionText: currentSponsorInfo.promotionText,
            isAnthem: currentSponsorInfo.isAnthem,
          }
        : null,
    });
  } catch (error) {
    console.error('[GET /api/sessions/[sessionId]/playback] Error:', error);
    return NextResponse.json({ playback: null, requesterName: null, sponsorInfo: null });
  }
}
