/**
 * Admin endpoint to mark a request as DELETED (soft delete)
 * Preserves data for analytics and audit trail.
 * If the request was paid-boosted, issues a Stripe refund automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { findRequestById, updateRequestStatus } from '@/lib/db/requests';
import { processBoostRefund } from '@/lib/services/refundService';
import { recalculateReputation } from '@/lib/services/userService';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string; requestId: string }> },
) {
  const { venueId, requestId } = await params;
  const body = await req.json();
  const { adminPassword } = body;

  // Validate admin auth
  if (!await verifyAdminToken(venueId, adminPassword ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const venue = await findVenueById(venueId);

  // Validate request exists
  const request = await findRequestById(requestId);
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  // Only allow deleting PENDING or APPROVED requests
  if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
    return NextResponse.json(
      { error: `Cannot delete request with status ${request.status}` },
      { status: 400 },
    );
  }

  // Mark as DELETED
  await updateRequestStatus(requestId, 'DELETED');

  // Issue a refund if the request was paid-boosted.
  // applyScorePenalty=true: apply reputation hit since recalculateReputation
  // is not called for deleted (never-played) requests.
  if (request.isBoosted && request.isRefundEligible) {
    processBoostRefund(requestId, true).catch((err) =>
      console.error('[DELETE request] Boost refund failed for deleted request:', requestId, err),
    );
  }

  // Update the requester's reputation to reflect this interaction even without playback.
  if (!request.isPreloaded && request.userId) {
    recalculateReputation(request.userId).catch((err) =>
      console.error('[DELETE request] Reputation update failed for user:', request.userId, err),
    );
  }

  // Log admin action when crowd control mode is active
  if (venue?.crowdControlEnabled) {
    await prisma.adminAction.create({
      data: {
        venueId,
        sessionId: request.sessionId,
        actionType: 'DELETE_REQUEST',
        targetRequestId: requestId,
        metadata: { title: request.song.title, artist: request.song.artist },
      },
    });
  }

  return NextResponse.json({ ok: true, deletedRequestId: requestId });
}
