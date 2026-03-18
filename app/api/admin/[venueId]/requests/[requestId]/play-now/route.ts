/**
 * Admin endpoint to skip current track and immediately play a specific request
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
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
  const venue = await findVenueById(venueId);
  if (!venue || venue.adminPassword !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate request exists and is PENDING
  const request = await findRequestById(requestId);
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  if (request.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Cannot play request with status ${request.status}. Only PENDING requests can be played.` },
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

    // Trigger playback based on service type
    if (service.name === 'spotify' && song.spotifyId) {
      await service.play(song.spotifyId);
      trackId = song.spotifyId;
    } else if (service.name === 'youtube' && song.youtubeId) {
      // YouTube playback is client-side; just return the ID
      trackId = song.youtubeId;
    } else {
      return NextResponse.json(
        { error: `Song not available on ${service.name}` },
        { status: 400 },
      );
    }

    // Mark as PLAYED immediately after playback starts
    await updateRequestStatus(requestId, 'PLAYED');

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
