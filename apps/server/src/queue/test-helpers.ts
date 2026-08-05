/**
 * Shared builders for queue-core unit tests. Not a test file itself.
 */

import type { QueueItem } from '@openaux/shared';

let seq = 0;

export function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  seq += 1;
  return {
    queueItemId: `qi-${seq}`,
    venueId: 'venue-1',
    songId: `song-${seq}`,
    provider: 'spotify',
    requestingUserId: `user-${seq}`,
    createdAt: new Date('2026-07-24T20:00:00.000Z'),
    status: 'queued',
    upvotesCount: 0,
    downvotesCount: 0,
    uniqueSupporterCount: 0,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    explicitFlag: false,
    genre: null,
    artist: 'Test Artist',
    title: 'Test Title',
    isDuplicateLocked: false,
    lastScoreCalculatedAt: null,
    currentScore: 0,
    playabilityState: 'playable',
    playabilityReason: null,
    sourceType: 'organic',
    playedAt: null,
    ...overrides,
  };
}
