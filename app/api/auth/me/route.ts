import { NextRequest, NextResponse } from 'next/server';
import { findUserByAuthToken } from '@/lib/db/users';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const authToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.nextUrl.searchParams.get('authToken');

    if (!authToken) {
      return NextResponse.json({ error: 'Auth token is required' }, { status: 401 });
    }

    const user = await findUserByAuthToken(authToken);
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired auth token' }, { status: 401 });
    }

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      reputationScore: user.reputationScore,
      influenceWeight: user.influenceWeight,
      creditBalance: user.creditBalance,
      authProvider: user.authProvider,
    });
  } catch (error) {
    console.error('[GET /api/auth/me]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
