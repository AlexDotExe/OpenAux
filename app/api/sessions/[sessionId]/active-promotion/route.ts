/**
 * GET /api/sessions/[sessionId]/active-promotion
 * Returns the currently active sponsor song promotion for the session's venue, if any.
 * No authentication required (read-only, public data for session attendees).
 */

import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { getActivePromotion } from '@/lib/db/sponsorSongs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;

    const session = await findSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (!session.isActive) {
      return NextResponse.json({ activePromotion: null });
    }

    const activePromotion = await getActivePromotion(session.venueId);

    if (!activePromotion) {
      return NextResponse.json({ activePromotion: null });
    }

    return NextResponse.json({
      activePromotion: {
        id: activePromotion.id,
        promotionText: activePromotion.promotionText,
        promotionDurationMinutes: activePromotion.promotionDurationMinutes,
        promotionActivatedAt: activePromotion.promotionActivatedAt,
        promotionExpiresAt: activePromotion.promotionExpiresAt,
        isAnthem: activePromotion.isAnthem,
        song: activePromotion.song,
      },
    });
  } catch (error) {
    console.error('[GET /api/sessions/:sessionId/active-promotion]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
