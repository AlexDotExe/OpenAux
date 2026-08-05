/**
 * Vote resolution (SPEC.md §1 layer 2, votes table = source of truth).
 *
 * The `votes` table holds one row per (queue_item, user); the counters on queue_items
 * are denormalized. These pure functions compute the counter deltas for a vote action
 * given the caller's PRIOR vote, so casting is idempotent and re-voting switches
 * direction. A "unique supporter" is a user with an active upvote.
 */

import type { VoteDirection } from '@openaux/shared';

export type VoteChange = 'added' | 'switched' | 'removed' | 'unchanged';

export interface VoteCounterDelta {
  upvotesDelta: number;
  downvotesDelta: number;
  uniqueSupporterDelta: number;
}

export interface VoteResolution {
  change: VoteChange;
  previousDirection: VoteDirection | null;
  nextDirection: VoteDirection | null;
  delta: VoteCounterDelta;
}

const NO_DELTA: VoteCounterDelta = {
  upvotesDelta: 0,
  downvotesDelta: 0,
  uniqueSupporterDelta: 0,
};

/** Delta for adding a vote in `direction` from a clean slate. */
function addDelta(direction: VoteDirection): VoteCounterDelta {
  return direction === 'up'
    ? { upvotesDelta: 1, downvotesDelta: 0, uniqueSupporterDelta: 1 }
    : { upvotesDelta: 0, downvotesDelta: 1, uniqueSupporterDelta: 0 };
}

/** Delta for removing an existing vote in `direction`. */
function removeDelta(direction: VoteDirection): VoteCounterDelta {
  return direction === 'up'
    ? { upvotesDelta: -1, downvotesDelta: 0, uniqueSupporterDelta: -1 }
    : { upvotesDelta: 0, downvotesDelta: -1, uniqueSupporterDelta: 0 };
}

function sumDeltas(a: VoteCounterDelta, b: VoteCounterDelta): VoteCounterDelta {
  return {
    upvotesDelta: a.upvotesDelta + b.upvotesDelta,
    downvotesDelta: a.downvotesDelta + b.downvotesDelta,
    uniqueSupporterDelta: a.uniqueSupporterDelta + b.uniqueSupporterDelta,
  };
}

/**
 * PUT /vote — cast or switch. Idempotent: casting the same direction is a no-op.
 */
export function resolveCastVote(
  existing: VoteDirection | null,
  direction: VoteDirection,
): VoteResolution {
  if (existing === direction) {
    return {
      change: 'unchanged',
      previousDirection: existing,
      nextDirection: direction,
      delta: NO_DELTA,
    };
  }
  if (existing === null) {
    return {
      change: 'added',
      previousDirection: null,
      nextDirection: direction,
      delta: addDelta(direction),
    };
  }
  // Switch: undo the old vote, apply the new one.
  return {
    change: 'switched',
    previousDirection: existing,
    nextDirection: direction,
    delta: sumDeltas(removeDelta(existing), addDelta(direction)),
  };
}

/**
 * DELETE /vote — remove. Idempotent: removing when none exists is a no-op.
 */
export function resolveRemoveVote(existing: VoteDirection | null): VoteResolution {
  if (existing === null) {
    return { change: 'unchanged', previousDirection: null, nextDirection: null, delta: NO_DELTA };
  }
  return {
    change: 'removed',
    previousDirection: existing,
    nextDirection: null,
    delta: removeDelta(existing),
  };
}

export interface VoteCounters {
  upvotesCount: number;
  downvotesCount: number;
  uniqueSupporterCount: number;
}

/** Apply a delta to denormalized counters, clamped at zero (defensive). */
export function applyVoteDelta(counters: VoteCounters, delta: VoteCounterDelta): VoteCounters {
  return {
    upvotesCount: Math.max(0, counters.upvotesCount + delta.upvotesDelta),
    downvotesCount: Math.max(0, counters.downvotesCount + delta.downvotesDelta),
    uniqueSupporterCount: Math.max(0, counters.uniqueSupporterCount + delta.uniqueSupporterDelta),
  };
}
