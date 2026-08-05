/**
 * Pure helpers for working with a QueueSnapshot client-side: optimistic vote
 * updates, patching a single item after a server response, and picking out
 * "my songs" for the monetization moment cards. Kept framework-free so they
 * can be unit tested without React.
 */

import type { QueueItem, QueueSnapshot, VoteDirection } from '@openaux/shared';

export function mapSnapshotItem(
  snapshot: QueueSnapshot,
  queueItemId: string,
  fn: (item: QueueItem) => QueueItem,
): QueueSnapshot {
  const apply = (items: QueueItem[]) =>
    items.map((i) => (i.queueItemId === queueItemId ? fn(i) : i));
  return {
    nowPlaying:
      snapshot.nowPlaying && snapshot.nowPlaying.queueItemId === queueItemId
        ? fn(snapshot.nowPlaying)
        : snapshot.nowPlaying,
    upNext: apply(snapshot.upNext),
    rest: apply(snapshot.rest),
  };
}

/** Adjusts up/down counts locally to reflect a vote switch before the server confirms it. */
export function applyOptimisticVoteDelta(
  item: QueueItem,
  from: VoteDirection | null,
  to: VoteDirection | null,
): QueueItem {
  let upvotesCount = item.upvotesCount;
  let downvotesCount = item.downvotesCount;
  if (from === 'up') upvotesCount -= 1;
  if (from === 'down') downvotesCount -= 1;
  if (to === 'up') upvotesCount += 1;
  if (to === 'down') downvotesCount += 1;
  return {
    ...item,
    upvotesCount: Math.max(0, upvotesCount),
    downvotesCount: Math.max(0, downvotesCount),
  };
}

/** All of this user's active (queued or playing) requests, across all three buckets. */
export function collectMyItems(snapshot: QueueSnapshot | null, userId: string | null): QueueItem[] {
  if (!snapshot || !userId) return [];
  const all = [snapshot.nowPlaying, ...snapshot.upNext, ...snapshot.rest].filter(
    (i): i is QueueItem => i !== null,
  );
  return all.filter(
    (i) => i.requestingUserId === userId && (i.status === 'queued' || i.status === 'playing'),
  );
}
