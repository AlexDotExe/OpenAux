/**
 * POST /api/admin/[venueId]/requests/[requestId]/reject
 * Reject a pending suggestion, removing it from the approval queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findRequestById, updateRequestStatus } from '@/lib/db/requests';
import { processBoostRefund } from '@/lib/services/refundService';
import { recalculateReputation } from '@/lib/services/userService';
import { invalidateQueueCache } from '@/lib/services/queueCache';
import { prisma } from '@/lib/db/prisma';

interface RouteContext {
  params: Promise<{ venueId: string; requestId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { venueId, requestId } = await context.params;
    const body = await req.json();

    if (!body.adminPassword) {
      return NextResponse.json({ error: 'adminPassword is required' }, { status: 400 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (body.adminPassword !== venue.adminPassword) {
      return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
    }

    const request = await findRequestById(requestId);
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (request.status !== 'PENDING') {
      return NextResponse.json({ error: 'Request is not pending' }, { status: 409 });
    }

    // Reject: change status to DELETED (excluded from all future queries)
    const updated = await updateRequestStatus(requestId, 'DELETED');

    // Issue a refund if the suggestion was paid-boosted before rejection.
    // applyScorePenalty=true: the reputation hit is applied as part of the refund since
    // recalculateReputation is not called for rejected (never-played) requests.
    if (request.isBoosted && request.isRefundEligible) {
      processBoostRefund(requestId, true).catch((err) =>
        console.error('[REJECT suggestion] Boost refund failed for rejected request:', requestId, err),
      );
    }

    // Update the requester's reputation to reflect this interaction even without playback.
    if (!request.isPreloaded && request.userId) {
      recalculateReputation(request.userId).catch((err) =>
        console.error('[REJECT suggestion] Reputation update failed for user:', request.userId, err),
      );
    }

    // Log admin action
    await prisma.adminAction.create({
      data: {
        venueId,
        sessionId: request.sessionId,
        actionType: 'REJECT_SUGGESTION',
        targetRequestId: requestId,
        metadata: body.reason ? { reason: body.reason } : undefined,
      },
    });

    invalidateQueueCache(request.sessionId);

    return NextResponse.json({ request: updated });
  } catch (error) {
    console.error('[POST /api/admin/[venueId]/requests/[requestId]/reject]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
