import { NextRequest, NextResponse } from 'next/server';
import { findUserByAuthToken, updateUserAuthToken } from '@/lib/db/users';

export async function POST(req: NextRequest) {
  try {
    const { authToken } = await req.json();

    if (!authToken) {
      return NextResponse.json({ error: 'Auth token is required' }, { status: 400 });
    }

    const user = await findUserByAuthToken(authToken);
    if (!user) {
      return NextResponse.json({ error: 'Invalid auth token' }, { status: 401 });
    }

    // Invalidate the token
    await updateUserAuthToken(user.id, null);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/auth/signout]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
