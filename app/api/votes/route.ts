import { NextRequest, NextResponse } from 'next/server';
import { submitVote } from '@/lib/services/voteService';
import { findOrCreateUser } from '@/lib/db/users';

/**
 * POST /api/votes
 * Cast a vote on a song request.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requestId, deviceFingerprint, value } = body;

    if (!requestId || !deviceFingerprint || ![-1, 1].includes(value)) {
      return NextResponse.json(
        { error: 'requestId, deviceFingerprint, and value (+1 or -1) are required' },
        { status: 400 },
      );
    }

    const user = await findOrCreateUser(deviceFingerprint);
    const result = await submitVote(requestId, user.id, user.influenceWeight, value as 1 | -1);

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('not found') ? 404 : message.includes('Cannot vote') ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
