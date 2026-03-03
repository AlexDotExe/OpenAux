import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, blacklistSong } from '@/lib/db/venues';

async function verifyAdmin(venueId: string, adminPassword: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json();
    const { adminPassword, songId } = body;

    if (!await verifyAdmin(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!songId) {
      return NextResponse.json({ error: 'songId is required' }, { status: 400 });
    }

    await blacklistSong(venueId, songId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/blacklist]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
