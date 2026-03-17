import { NextRequest, NextResponse } from 'next/server';
import { submitVote } from '@/lib/services/voteService';
import { findOrCreateUser } from '@/lib/db/users';
import { updateUserSessionActivity } from '@/lib/db/userSessions';

/**
 * POST /api/votes
 * Cast a vote on a song request.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requestId, sessionId, deviceFingerprint, value } = body;

    if (!requestId || !deviceFingerprint || ![-1, 1].includes(value)) {
      return NextResponse.json(
        { error: 'requestId, deviceFingerprint, and value (+1 or -1) are required' },
        { status: 400 },
      );
    }

    const user = await findOrCreateUser(deviceFingerprint);
    const result = await submitVote(requestId, user.id, user.influenceWeight, value as 1 | -1);

    // Reset the session expiry timer for this user
    if (sessionId && typeof sessionId === 'string') {
      await updateUserSessionActivity(user.id, sessionId);
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') ? 404 : message.includes('Cannot vote') ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
