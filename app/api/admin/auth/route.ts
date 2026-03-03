import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';

/**
 * POST /api/admin/auth
 * Validates admin credentials (username + password) for a given venue.
 * Username must be "admin"; password must match the venue's adminPassword.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username, password, venueId } = body;

    if (!username || !password || !venueId) {
      return NextResponse.json(
        { error: 'username, password, and venueId are required' },
        { status: 400 },
      );
    }

    if (username !== 'admin') {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (password !== (venue as { adminPassword?: string }).adminPassword) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    return NextResponse.json({ success: true, venueId: venue.id });
  } catch (error) {
    console.error('[POST /api/admin/auth]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
