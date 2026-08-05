import { describe, expect, it } from 'vitest';
import { applyVoteDelta, resolveCastVote, resolveRemoveVote } from './votes.js';

describe('resolveCastVote', () => {
  it('adds a fresh upvote and a unique supporter', () => {
    const r = resolveCastVote(null, 'up');
    expect(r.change).toBe('added');
    expect(r.delta).toEqual({ upvotesDelta: 1, downvotesDelta: 0, uniqueSupporterDelta: 1 });
  });

  it('adds a fresh downvote without a supporter', () => {
    const r = resolveCastVote(null, 'down');
    expect(r.change).toBe('added');
    expect(r.delta).toEqual({ upvotesDelta: 0, downvotesDelta: 1, uniqueSupporterDelta: 0 });
  });

  it('is idempotent when re-casting the same up direction', () => {
    const r = resolveCastVote('up', 'up');
    expect(r.change).toBe('unchanged');
    expect(r.delta).toEqual({ upvotesDelta: 0, downvotesDelta: 0, uniqueSupporterDelta: 0 });
  });

  it('is idempotent when re-casting the same down direction', () => {
    expect(resolveCastVote('down', 'down').change).toBe('unchanged');
  });

  it('switches up -> down (removes supporter)', () => {
    const r = resolveCastVote('up', 'down');
    expect(r.change).toBe('switched');
    expect(r.delta).toEqual({ upvotesDelta: -1, downvotesDelta: 1, uniqueSupporterDelta: -1 });
  });

  it('switches down -> up (adds supporter)', () => {
    const r = resolveCastVote('down', 'up');
    expect(r.change).toBe('switched');
    expect(r.delta).toEqual({ upvotesDelta: 1, downvotesDelta: -1, uniqueSupporterDelta: 1 });
  });
});

describe('resolveRemoveVote', () => {
  it('removes an existing upvote', () => {
    const r = resolveRemoveVote('up');
    expect(r.change).toBe('removed');
    expect(r.delta).toEqual({ upvotesDelta: -1, downvotesDelta: 0, uniqueSupporterDelta: -1 });
  });

  it('removes an existing downvote', () => {
    const r = resolveRemoveVote('down');
    expect(r.change).toBe('removed');
    expect(r.delta).toEqual({ upvotesDelta: 0, downvotesDelta: -1, uniqueSupporterDelta: 0 });
  });

  it('is idempotent when removing a non-existent vote', () => {
    const r = resolveRemoveVote(null);
    expect(r.change).toBe('unchanged');
    expect(r.delta).toEqual({ upvotesDelta: 0, downvotesDelta: 0, uniqueSupporterDelta: 0 });
  });
});

describe('applyVoteDelta', () => {
  const base = { upvotesCount: 5, downvotesCount: 2, uniqueSupporterCount: 5 };

  it('applies a switch delta', () => {
    const r = resolveCastVote('up', 'down');
    expect(applyVoteDelta(base, r.delta)).toEqual({
      upvotesCount: 4,
      downvotesCount: 3,
      uniqueSupporterCount: 4,
    });
  });

  it('clamps counters at zero', () => {
    const zero = { upvotesCount: 0, downvotesCount: 0, uniqueSupporterCount: 0 };
    const r = resolveRemoveVote('up');
    expect(applyVoteDelta(zero, r.delta)).toEqual({
      upvotesCount: 0,
      downvotesCount: 0,
      uniqueSupporterCount: 0,
    });
  });

  it('round-trips add then remove back to the original counts', () => {
    const added = applyVoteDelta(base, resolveCastVote(null, 'up').delta);
    const removed = applyVoteDelta(added, resolveRemoveVote('up').delta);
    expect(removed).toEqual(base);
  });
});
