import { NextRequest, NextResponse } from 'next/server';
import { advanceToNextSong } from '@/lib/services/sessionService';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = await req.json().catch(() => ({}));
    const { currentRequestId, wasSkipped, skipInitiatedByAdmin, skipInitiatedByUserId } = body;

    const result = await advanceToNextSong(
      sessionId,
      currentRequestId,
      wasSkipped,
      skipInitiatedByAdmin ?? false,
      skipInitiatedByUserId,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/sessions/:sessionId/advance]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
