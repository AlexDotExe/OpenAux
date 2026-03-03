import { NextRequest, NextResponse } from 'next/server';
import { findVenueByAdminUsername, createVenue } from '@/lib/db/venues';

/**
 * POST /api/admin/signup
 * Registers a new admin by creating a venue with the provided credentials.
 * Body: { username, password, venueName, streamingService? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username, password, venueName, streamingService } = body;

    if (!username || !password || !venueName) {
      return NextResponse.json(
        { error: 'username, password, and venueName are required' },
        { status: 400 },
      );
    }

    const existing = await findVenueByAdminUsername(username);
    if (existing) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    }

    if (streamingService && streamingService !== 'spotify' && streamingService !== 'youtube') {
      return NextResponse.json(
        { error: 'streamingService must be spotify or youtube' },
        { status: 400 },
      );
    }

    const venue = await createVenue({
      name: venueName,
      adminUsername: username,
      adminPassword: password,
      streamingService: streamingService || null,
    });

    return NextResponse.json({ success: true, venueId: venue.id }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/admin/signup]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
