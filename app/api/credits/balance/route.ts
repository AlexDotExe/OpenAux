/**
 * API Route: Credit Balance
 * GET /api/credits/balance?authToken=...
 *
 * Returns the authenticated user's current credit balance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findUserByAuthToken } from '@/lib/db/users';

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

    return NextResponse.json({ creditBalance: user.creditBalance });
  } catch (err) {
    console.error('[GET /api/credits/balance]', err);
    return NextResponse.json({ error: 'Failed to fetch credit balance' }, { status: 500 });
  }
}
