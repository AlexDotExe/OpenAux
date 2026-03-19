/**
 * Admin Route: Credit Transaction History for Venue
 * GET /api/admin/[venueId]/credit-transactions?adminPassword=...
 *
 * Returns credit transactions for all users who have participated in sessions at this venue.
 * Protected by the venue admin password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/db/venues';
import { findCreditTransactionsByVenue } from '@/lib/db/credits';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const { searchParams } = new URL(req.url);
    const adminPassword = searchParams.get('adminPassword') ?? '';

    const isAdmin = await verifyAdminToken(venueId, adminPassword);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const transactions = await findCreditTransactionsByVenue(venueId);

    return NextResponse.json({ transactions });
  } catch (err) {
    console.error('[GET /api/admin/[venueId]/credit-transactions]', err);
    return NextResponse.json({ error: 'Failed to fetch credit transactions' }, { status: 500 });
  }
}
