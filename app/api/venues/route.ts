import { NextRequest, NextResponse } from 'next/server';
import { listVenues, createVenue } from '@/lib/db/venues';

export async function GET() {
  try {
    const venues = await listVenues();
    return NextResponse.json(venues);
  } catch (error) {
    console.error('[GET /api/venues]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, genreProfile, bpmRange, energyCurveProfile, adminPassword } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const venue = await createVenue({ name, genreProfile, bpmRange, energyCurveProfile, adminPassword });
    return NextResponse.json(venue, { status: 201 });
  } catch (error) {
    console.error('[POST /api/venues]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
