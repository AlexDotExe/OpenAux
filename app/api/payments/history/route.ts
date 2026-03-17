/**
 * API Route: Payment History
 * GET /api/payments/history?userId=... — returns payments for a specific user
 * GET /api/payments/history?venueId=... — returns payments for a specific venue
 */

import { NextRequest, NextResponse } from 'next/server';
import { findPaymentsByUser, findPaymentsByVenue } from '@/lib/db/payments';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const venueId = searchParams.get('venueId');

    if (!userId && !venueId) {
      return NextResponse.json(
        { error: 'userId or venueId query parameter is required' },
        { status: 400 },
      );
    }

    const payments = userId
      ? await findPaymentsByUser(userId)
      : await findPaymentsByVenue(venueId!);

    return NextResponse.json({ payments });
  } catch (err) {
    console.error('[GET /api/payments/history]', err);
    return NextResponse.json({ error: 'Failed to fetch payment history' }, { status: 500 });
  }
}
