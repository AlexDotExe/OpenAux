/**
 * POST /api/admin/[venueId]/requests/[requestId]/approve
 * Approve a pending suggestion, moving it into the active queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findRequestById, updateRequestStatus } from '@/lib/db/requests';
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

    // Approve: change status from PENDING to APPROVED
    const updated = await updateRequestStatus(requestId, 'APPROVED');

    // Log admin action
    await prisma.adminAction.create({
      data: {
        venueId,
        sessionId: request.sessionId,
        actionType: 'APPROVE_SUGGESTION',
        targetRequestId: requestId,
      },
    });

    invalidateQueueCache(request.sessionId);

    return NextResponse.json({ request: updated });
  } catch (error) {
    console.error('[POST /api/admin/[venueId]/requests/[requestId]/approve]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
