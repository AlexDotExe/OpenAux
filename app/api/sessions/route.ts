import { NextRequest, NextResponse } from 'next/server';
import { startSession } from '@/lib/services/sessionService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { venueId } = body;

    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
    }

    const session = await startSession(venueId);
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error('[POST /api/sessions]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
