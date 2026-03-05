import { NextRequest, NextResponse } from 'next/server';
import { clearVenueOAuthTokens } from '@/lib/db/venues';

/**
 * POST: Disconnects the streaming service and clears OAuth tokens
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    await clearVenueOAuthTokens(venueId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/disconnect]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
