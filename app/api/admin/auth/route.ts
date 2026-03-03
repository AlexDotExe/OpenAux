import { NextRequest, NextResponse } from 'next/server';
import { findVenueByAdminUsername } from '@/lib/db/venues';

/**
 * POST /api/admin/auth
 * Validates admin credentials (username + password).
 * Looks up the venue by adminUsername — no venueId required.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'username and password are required' },
        { status: 400 },
      );
    }

    const venue = await findVenueByAdminUsername(username);
    if (!venue) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (password !== venue.adminPassword) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    return NextResponse.json({ success: true, venueId: venue.id });
  } catch (error) {
    console.error('[POST /api/admin/auth]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
