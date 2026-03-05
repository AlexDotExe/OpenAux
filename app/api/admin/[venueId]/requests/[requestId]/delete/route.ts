/**
 * Admin endpoint to mark a request as DELETED (soft delete)
 * Preserves data for analytics and audit trail
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findRequestById, updateRequestStatus } from '@/lib/db/requests';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string; requestId: string }> },
) {
  const { venueId, requestId } = await params;
  const body = await req.json();
  const { adminPassword } = body;

  // Validate admin auth
  const venue = await findVenueById(venueId);
  if (!venue || venue.adminPassword !== adminPassword) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  return NextResponse.json({ ok: true, deletedRequestId: requestId });
}
