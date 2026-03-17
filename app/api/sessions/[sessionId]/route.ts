import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { getRankedQueue } from '@/lib/services/virtualDjEngine';
import { findVenueById } from '@/lib/db/venues';
import { findPendingSuggestions } from '@/lib/db/requests';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const session = await findSessionById(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // getRankedQueue internally fetches venue, so we can fetch both in parallel
    // but we still need venue name for response
    const [queue, venue] = await Promise.all([
      getRankedQueue(sessionId),
      findVenueById(session.venueId),
    ]);

    const suggestionModeEnabled = venue?.suggestionModeEnabled ?? false;

    // When suggestion mode is enabled, include pending suggestions so users can track their own
    const pendingSuggestions = suggestionModeEnabled
      ? await findPendingSuggestions(sessionId)
      : [];

    // Note: Removed playback history from polling endpoint
    // It's rarely used and expensive to fetch. Can add a separate endpoint if needed.

    return NextResponse.json({
      session,
      queue,
      venueName: venue?.name || 'Unknown Venue',
      suggestionModeEnabled,
      pendingSuggestions: pendingSuggestions.map(s => ({
        requestId: s.id,
        title: s.song.title,
        artist: s.song.artist,
        userId: s.userId,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error('[GET /api/sessions/:sessionId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
