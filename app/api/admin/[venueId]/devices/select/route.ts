import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, findVenueById } from '@/lib/db/venues';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';
import { SpotifyService } from '@/lib/services/streaming/spotify';
import { prisma } from '@/lib/db/prisma';

/**
 * GET: Return the currently selected Spotify device ID for this venue
 */
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

    return NextResponse.json({ deviceId: venue.spotifyDeviceId ?? null });
  } catch (error) {
    console.error('[GET /api/admin/:venueId/devices/select]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST: Save selected device ID and transfer playback to it
 * Body: { adminPassword, deviceId }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json();
    const { adminPassword, deviceId } = body;

    if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!deviceId || typeof deviceId !== 'string') {
      return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
    }

    // Save the selected device to the venue
    await prisma.venue.update({
      where: { id: venueId },
      data: { spotifyDeviceId: deviceId },
    });

    // Transfer playback to the selected device
    const service = await getStreamingServiceForVenue(venueId);
    if (service && service.name === 'spotify') {
      await (service as SpotifyService).transferPlayback(deviceId);
    }

    return NextResponse.json({ ok: true, deviceId });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/devices/select]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
