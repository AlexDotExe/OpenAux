import { NextRequest, NextResponse } from 'next/server';
import { clearVenueOAuthTokens, verifyAdminToken } from '@/lib/db/venues';

/**
 * POST: Disconnects the streaming service and clears OAuth tokens
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const adminPassword = req.headers.get('x-admin-password') ?? '';
    if (!await verifyAdminToken(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await clearVenueOAuthTokens(venueId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/disconnect]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
