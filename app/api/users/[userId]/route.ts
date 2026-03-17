import { NextRequest, NextResponse } from 'next/server';
import { setDisplayName } from '@/lib/services/userService';
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/constants';

/**
 * PATCH /api/users/[userId]
 * Update a user's display name (DJ name).
 * Called when a user sets their DJ name in the session UI.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId } = await params;
    const body = await req.json();
    const { displayName } = body;

    if (!displayName || typeof displayName !== 'string') {
      return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
    }

    const trimmed = displayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
    if (!trimmed) {
      return NextResponse.json({ error: 'displayName cannot be empty' }, { status: 400 });
    }

    const user = await setDisplayName(userId, trimmed);
    return NextResponse.json({ displayName: user.displayName }, { status: 200 });
  } catch (error) {
    console.error('[PATCH /api/users/:userId]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
