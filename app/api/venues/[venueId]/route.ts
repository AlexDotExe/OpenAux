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
    return NextResponse.json({ venue, activeSession });
  } catch (error) {
    console.error('[GET /api/venues/:venueId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
