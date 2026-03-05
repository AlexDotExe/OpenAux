import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findActiveSession } from '@/lib/db/sessions';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const venue = await findVenueById(venueId);
    if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

    const activeSession = await findActiveSession(venueId);

    // Never expose tokens to the client
    const { oauthAccessToken, oauthRefreshToken, oauthTokenExpiresAt, oauthScope, adminPassword, ...safeVenue } = venue;

    return NextResponse.json({
      venue: safeVenue,
      activeSession,
      streamingService: venue.streamingService ?? null,
      isStreamingConnected: !!(venue.oauthAccessToken && venue.oauthRefreshToken),
      connectedAccountName: venue.connectedAccountName ?? null,
      connectedAccountEmail: venue.connectedAccountEmail ?? null,
    });
  } catch (error) {
    console.error('[GET /api/venues/:venueId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
