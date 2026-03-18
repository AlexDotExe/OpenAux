import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/db/venues';
import { getStreamingServiceForVenue } from '@/lib/services/streaming';

/**
 * GET: Returns current playback state
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
    const service = await getStreamingServiceForVenue(venueId);
    if (!service) {
      return NextResponse.json({ error: 'No streaming service connected' }, { status: 404 });
    }

    const state = await service.getPlaybackState();
    return NextResponse.json({ playback: state });
  } catch (error) {
    console.error('[GET /api/admin/:venueId/playback]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST: Play/pause/skip/resume commands
 * Body: { action: 'play' | 'pause' | 'resume' | 'skip', trackId?: string, deviceId?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json();
    const { adminPassword, action, trackId, deviceId } = body;

    if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = await getStreamingServiceForVenue(venueId);
    if (!service) {
      return NextResponse.json({ error: 'No streaming service connected' }, { status: 404 });
    }

    switch (action) {
      case 'play':
        if (!trackId) {
          return NextResponse.json({ error: 'trackId required for play' }, { status: 400 });
        }
        await service.play(trackId, deviceId);
        break;
      case 'pause':
        await service.pause();
        break;
      case 'resume':
        await service.resume();
        break;
      case 'skip':
        await service.skip();
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/playback]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
