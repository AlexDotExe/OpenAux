import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { getRankedQueue } from '@/lib/services/virtualDjEngine';
import { getPlaybackHistory } from '@/lib/db/playback';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const session = await findSessionById(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const [queue, history] = await Promise.all([
      getRankedQueue(sessionId),
      getPlaybackHistory(sessionId),
    ]);

    return NextResponse.json({ session, queue, history });
  } catch (error) {
    console.error('[GET /api/sessions/:sessionId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
