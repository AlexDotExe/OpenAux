import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, findVenueById } from '@/lib/db/venues';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const adminPassword = req.headers.get('x-admin-password') ?? '';

    if (!await verifyAdminToken(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const service = await getStreamingServiceForVenue(venueId);
    if (!service) {
      return NextResponse.json({ error: 'No streaming service connected' }, { status: 404 });
    }

    if (!service.getUserPlaylists) {
      return NextResponse.json({ error: 'Playlist listing not supported' }, { status: 400 });
    }
    const result = await service.getUserPlaylists();

    return NextResponse.json({
      playlists: result.playlists,
      serviceName: venue.streamingService,
    });
  } catch (error) {
    console.error('[GET /api/admin/:venueId/streaming/playlists]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
