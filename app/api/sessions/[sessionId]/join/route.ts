import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { joinOrRejoinUserSession } from '@/lib/db/userSessions';
import { countActiveUsersInSession, recordActiveUserSnapshot } from '@/lib/db/snapshots';

/**
 * POST /api/sessions/[sessionId]/join
 * Join or rejoin a user session. Creates a UserSession record with a 1-hour expiry.
 * Must be called after the user has been registered via POST /api/users.
 *
 * Body: { userId: string }
 * Returns: { expiresAt: string; isExpired: boolean }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = await req.json();
    const { userId } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const session = await findSessionById(sessionId);
    if (!session || !session.isActive) {
      return NextResponse.json({ error: 'Session not found or not active' }, { status: 404 });
    }

    const userSession = await joinOrRejoinUserSession(userId, sessionId);

    // Record active user snapshot and update peak (fire and forget)
    countActiveUsersInSession(sessionId)
      .then((activeCount) => recordActiveUserSnapshot(session.venueId, sessionId, activeCount))
      .catch(console.error);

    return NextResponse.json({
      expiresAt: userSession.expiresAt.toISOString(),
      isExpired: userSession.isExpired,
    });
  } catch (error) {
    console.error('[POST /api/sessions/:sessionId/join]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
