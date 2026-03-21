import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/db/venues';
import { updateYouTubePlaybackState } from '@/lib/services/streaming/youtube';
import { findActiveSession } from '@/lib/db/sessions';
import { setSessionNowPlaying } from '@/lib/db/sessions';
import { invalidateQueueCache } from '@/lib/services/queueCache';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json();
    const { adminPassword, state, nowPlayingRequestId } = body;

    if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!state) {
      return NextResponse.json({ error: 'state is required' }, { status: 400 });
    }

    updateYouTubePlaybackState(venueId, state);

    // Persist the currently playing requestId so the ranking engine can pin it
    if (nowPlayingRequestId !== undefined) {
      const session = await findActiveSession(venueId);
      if (session && session.nowPlayingRequestId !== nowPlayingRequestId) {
        await setSessionNowPlaying(session.id, nowPlayingRequestId);
        invalidateQueueCache(session.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/playback-state]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
