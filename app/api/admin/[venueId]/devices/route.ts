import { NextRequest, NextResponse } from 'next/server';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';
import { SpotifyService } from '@/lib/services/streaming/spotify';

/**
 * GET: Lists available Spotify devices for the venue
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const service = await getStreamingServiceForVenue(venueId);

    if (!service || service.name !== 'spotify') {
      return NextResponse.json({ error: 'Spotify not connected' }, { status: 404 });
    }

    const devices = await (service as SpotifyService).getDevices();
    return NextResponse.json({ devices });
  } catch (error) {
    console.error('[GET /api/admin/:venueId/devices]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
