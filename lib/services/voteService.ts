/**
 * Vote Service
 * Business logic for voting on song requests.
 */

import { castVote, recalculateRequestVoteWeight } from '../db/votes';
import { findRequestById } from '../db/requests';
import { invalidateQueueCache } from './queueCache';

export interface VoteResult {
  requestId: string;
  newVoteWeight: number;
  userVote: number;
}

export async function submitVote(
  requestId: string,
  userId: string,
  influenceWeight: number,
  value: 1 | -1,
): Promise<VoteResult> {
  const request = await findRequestById(requestId);
  if (!request) throw new Error('Request not found');
  if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
    throw new Error('Cannot vote on a request that is not active');
  }

  await castVote({ requestId, userId, value, weight: influenceWeight });
  const newVoteWeight = await recalculateRequestVoteWeight(requestId);

  // Invalidate queue cache since votes affect ranking
  invalidateQueueCache(request.sessionId);

  return { requestId, newVoteWeight, userVote: value };
}
