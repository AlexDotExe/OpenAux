import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/db/venues';
import { startSession, stopSession, findActiveSession } from '@/lib/services/sessionService';

/**
 * Admin-only: Start or end a session for a venue.
 * Protected by admin token check (accepts legacy adminPassword or OAuth adminAuthToken).
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const body = await req.json().catch(() => ({}));
    const { adminPassword, action } = body;

    const isAdmin = await verifyAdminToken(venueId, adminPassword ?? '');
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (action === 'start') {
      const session = await startSession(venueId);
      return NextResponse.json(session, { status: 201 });
    }

    if (action === 'end') {
      const active = await findActiveSession(venueId);
      if (!active) return NextResponse.json({ error: 'No active session' }, { status: 404 });
      const session = await stopSession(active.id);
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: 'action must be start or end' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/admin/:venueId/session]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
