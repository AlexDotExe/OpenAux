/**
 * API Route: Credit Balance
 * GET /api/credits/balance?authToken=... — legacy support
 * POST /api/credits/balance { authToken } — preferred (token stays out of logs/URLs)
 *
 * Returns the authenticated user's current credit balance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { findUserByAuthToken } from '@/lib/db/users';

async function resolveAuthToken(req: NextRequest): Promise<string | null> {
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    return body.authToken ?? null;
  }
  return new URL(req.url).searchParams.get('authToken');
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}

async function handleRequest(req: NextRequest) {
  try {
    const authToken = await resolveAuthToken(req);

    if (!authToken) {
      return NextResponse.json({ error: 'authToken is required' }, { status: 400 });
    }

    const user = await findUserByAuthToken(authToken);
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    return NextResponse.json({ creditBalance: user.creditBalance });
  } catch (err) {
    console.error('[/api/credits/balance]', err);
    return NextResponse.json({ error: 'Failed to fetch credit balance' }, { status: 500 });
  }
}
