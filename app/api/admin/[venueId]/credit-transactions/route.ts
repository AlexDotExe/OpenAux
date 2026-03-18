/**
 * Admin Route: Credit Transaction History for Venue
 * GET /api/admin/[venueId]/credit-transactions?adminPassword=...
 *
 * Returns credit transactions for all users who have participated in sessions at this venue.
 * Protected by the venue admin password.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById } from '@/lib/db/venues';
import { findCreditTransactionsByVenue } from '@/lib/db/credits';

async function verifyAdmin(adminPassword: string, venueId: string): Promise<boolean> {
  const venue = await findVenueById(venueId);
  if (!venue) return false;
  return adminPassword === (venue as { adminPassword?: string }).adminPassword;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;
    const { searchParams } = new URL(req.url);
    const adminPassword = searchParams.get('adminPassword') ?? '';

    const isAdmin = await verifyAdmin(adminPassword, venueId);
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
