import { describe, expect, it } from 'vitest';
import type { QueueItem, QueueSnapshot } from '@openaux/shared';

import { applyOptimisticVoteDelta, collectMyItems, mapSnapshotItem } from './queueSnapshotHelpers';

function makeQueueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    queueItemId: 'qi-1',
    venueId: 'venue-1',
    songId: 'song-1',
    provider: 'spotify',
    requestingUserId: 'user-1',
    createdAt: new Date(),
    status: 'queued',
    upvotesCount: 2,
    downvotesCount: 1,
    uniqueSupporterCount: 2,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    explicitFlag: false,
    genre: null,
    artist: 'Artist',
    title: 'Title',
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

describe('applyOptimisticVoteDelta', () => {
  it('adds an upvote when going from no vote to up', () => {
    const item = makeQueueItem({ upvotesCount: 2, downvotesCount: 1 });
    const next = applyOptimisticVoteDelta(item, null, 'up');
    expect(next.upvotesCount).toBe(3);
    expect(next.downvotesCount).toBe(1);
  });

  it('switches from down to up in one step', () => {
    const item = makeQueueItem({ upvotesCount: 2, downvotesCount: 1 });
    const next = applyOptimisticVoteDelta(item, 'down', 'up');
    expect(next.upvotesCount).toBe(3);
    expect(next.downvotesCount).toBe(0);
  });

  it('removes a vote when going to null', () => {
    const item = makeQueueItem({ upvotesCount: 2, downvotesCount: 1 });
    const next = applyOptimisticVoteDelta(item, 'up', null);
    expect(next.upvotesCount).toBe(1);
    expect(next.downvotesCount).toBe(1);
  });

  it('never goes below zero', () => {
    const item = makeQueueItem({ upvotesCount: 0, downvotesCount: 0 });
    const next = applyOptimisticVoteDelta(item, 'up', null);
    expect(next.upvotesCount).toBe(0);
  });

  it('does not mutate the original item', () => {
    const item = makeQueueItem({ upvotesCount: 2 });
    applyOptimisticVoteDelta(item, null, 'up');
    expect(item.upvotesCount).toBe(2);
  });
});

describe('mapSnapshotItem', () => {
  it('updates the item wherever it appears (nowPlaying / upNext / rest)', () => {
    const target = makeQueueItem({ queueItemId: 'target', title: 'Old title' });
    const snapshot: QueueSnapshot = {
      nowPlaying: makeQueueItem({ queueItemId: 'now' }),
      upNext: [target, makeQueueItem({ queueItemId: 'other' })],
      rest: [],
    };
    const next = mapSnapshotItem(snapshot, 'target', (i) => ({ ...i, title: 'New title' }));
    expect(next.upNext[0]!.title).toBe('New title');
    expect(next.upNext[1]!.title).not.toBe('New title');
    expect(next.nowPlaying).toBe(snapshot.nowPlaying);
  });

  it('updates nowPlaying when the id matches there', () => {
    const nowPlaying = makeQueueItem({ queueItemId: 'now', title: 'Old' });
    const snapshot: QueueSnapshot = { nowPlaying, upNext: [], rest: [] };
    const next = mapSnapshotItem(snapshot, 'now', (i) => ({ ...i, title: 'New' }));
    expect(next.nowPlaying?.title).toBe('New');
  });
});

describe('collectMyItems', () => {
  it("returns only the given user's queued/playing items across all buckets", () => {
    const mine1 = makeQueueItem({ queueItemId: 'a', requestingUserId: 'me', status: 'queued' });
    const mine2 = makeQueueItem({ queueItemId: 'b', requestingUserId: 'me', status: 'playing' });
    const notMine = makeQueueItem({ queueItemId: 'c', requestingUserId: 'them', status: 'queued' });
    const playedMine = makeQueueItem({
      queueItemId: 'd',
      requestingUserId: 'me',
      status: 'played',
    });

    const snapshot: QueueSnapshot = {
      nowPlaying: mine2,
      upNext: [mine1],
      rest: [notMine, playedMine],
    };
    const mine = collectMyItems(snapshot, 'me');

    expect(mine.map((i) => i.queueItemId).sort()).toEqual(['a', 'b']);
  });

  it('returns an empty array when there is no snapshot or user', () => {
    expect(collectMyItems(null, 'me')).toEqual([]);
    expect(collectMyItems({ nowPlaying: null, upNext: [], rest: [] }, null)).toEqual([]);
  });
});
