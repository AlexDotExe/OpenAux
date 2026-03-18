/**
 * API Route: Credit Transaction History
 * GET /api/credits/transactions?authToken=...
 *
 * Returns the authenticated user's full credit transaction history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findUserByAuthToken } from '@/lib/db/users';
import { findCreditTransactionsByUser } from '@/lib/db/credits';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const authToken = searchParams.get('authToken');

    if (!authToken) {
      return NextResponse.json({ error: 'authToken query parameter is required' }, { status: 400 });
    }

    const user = await findUserByAuthToken(authToken);
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const transactions = await findCreditTransactionsByUser(user.id);

    return NextResponse.json({
      creditBalance: user.creditBalance,
      transactions,
    });
  } catch (err) {
    console.error('[GET /api/credits/transactions]', err);
    return NextResponse.json({ error: 'Failed to fetch credit transactions' }, { status: 500 });
  }
}
