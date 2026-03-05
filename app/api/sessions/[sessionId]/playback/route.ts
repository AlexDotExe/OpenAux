/**
 * Public playback endpoint - allows users to see what's currently playing
 * No authentication required (read-only data)
 */

import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';

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
    return NextResponse.json({ playback: null });
  }

  try {
    const playback = await service.getPlaybackState();
    return NextResponse.json({ playback });
  } catch (error) {
    console.error('[GET /api/sessions/[sessionId]/playback] Error:', error);
    return NextResponse.json({ playback: null });
  }
}
