/**
 * Admin endpoint to skip current track and immediately play a specific request
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { findRequestById, updateRequestStatus } from '@/lib/db/requests';
import { findSessionById } from '@/lib/db/sessions';
import { advanceToNextSong } from '@/lib/services/sessionService';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string; requestId: string }> },
) {
  const { venueId, requestId } = await params;
  const body = await req.json();
  const { adminPassword, currentRequestId } = body;

  // Validate admin auth
  if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const venue = await findVenueById(venueId);

  // Validate request exists and is PENDING or APPROVED
  const request = await findRequestById(requestId);
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  // Only PENDING and APPROVED songs can be played (APPROVED means currently playing or queued)
  if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
    return NextResponse.json(
      { error: `Cannot play request with status ${request.status}. Only PENDING or APPROVED requests can be played.` },
      { status: 400 },
    );
  }

  // Prevent "playing" a song that's already the current song
  if (currentRequestId && requestId === currentRequestId) {
    return NextResponse.json(
      { error: 'This song is already playing' },
      { status: 400 },
    );
  }

  // Get session
  const session = await findSessionById(request.sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // If current request ID provided, skip it (admin-initiated)
  if (currentRequestId) {
    await advanceToNextSong(request.sessionId, currentRequestId, true, true);
  }

  // Get song data
  const song = await prisma.song.findUnique({
    where: { id: request.songId },
    select: { spotifyId: true, youtubeId: true, title: true, artist: true },
  });

  if (!song) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
  }

  // Mark request as APPROVED first
  await updateRequestStatus(requestId, 'APPROVED');

  // Get streaming service
  const service = await getStreamingServiceForVenue(venueId);
  if (!service) {
    return NextResponse.json(
      { error: 'No streaming service connected' },
      { status: 400 },
    );
  }

  try {
    let trackId: string | null = null;

    // Determine track ID based on service type
    if (service.name === 'spotify' && song.spotifyId) {
      // Playback is handled by the embedded player on the admin frontend
      trackId = song.spotifyId;
      // Keep as APPROVED - will be marked PLAYED when embedded player ends via onEnded callback
    } else if (service.name === 'youtube' && song.youtubeId) {
      // YouTube playback is client-side; just return the ID
      trackId = song.youtubeId;
      // Keep as APPROVED - will be marked PLAYED when video ends via onEnded callback
    } else {
      return NextResponse.json(
        { error: `Song not available on ${service.name}` },
        { status: 400 },
      );
    }

    // Note: Songs are now marked as PLAYED by the onEnded callback from the embedded players,
    // not immediately here, so they remain visible in the queue while playing

    // Log admin override action when crowd control mode is active
    if (venue?.crowdControlEnabled) {
      await prisma.adminAction.create({
        data: {
          venueId,
          sessionId: session.id,
          actionType: 'OVERRIDE_QUEUE',
          targetRequestId: requestId,
          metadata: { action: 'play_now', title: song.title, artist: song.artist },
        },
      });
    }

    return NextResponse.json({
      ok: true,
      nowPlaying: {
        requestId,
        title: song.title,
        artist: song.artist,
        trackId,
      },
      service: service.name,
    });
  } catch (error) {
    console.error('[POST /api/admin/[venueId]/requests/[requestId]/play-now] Error:', error);
    return NextResponse.json(
      { error: 'Failed to trigger playback' },
      { status: 500 },
    );
  }
}
