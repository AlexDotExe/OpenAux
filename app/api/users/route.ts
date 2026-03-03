import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateUserByFingerprint } from '@/lib/services/userService';

/**
 * POST /api/users
 * Create or retrieve a user by device fingerprint.
 * Called on page load to establish anonymous identity.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { deviceFingerprint } = body;

    if (!deviceFingerprint || typeof deviceFingerprint !== 'string') {
      return NextResponse.json({ error: 'deviceFingerprint is required' }, { status: 400 });
    }

    const user = await getOrCreateUserByFingerprint(deviceFingerprint);
    return NextResponse.json(user, { status: 200 });
  } catch (error) {
    console.error('[POST /api/users]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
