import { NextRequest, NextResponse } from 'next/server';
import { setEnergyLevel } from '@/lib/services/sessionService';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = await req.json();
    const { level } = body;

    if (typeof level !== 'number' || level < 0 || level > 1) {
      return NextResponse.json({ error: 'level must be a number between 0 and 1' }, { status: 400 });
    }

    const session = await setEnergyLevel(sessionId, level);
    return NextResponse.json(session);
  } catch (error) {
    console.error('[POST /api/sessions/:sessionId/energy]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
