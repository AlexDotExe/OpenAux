import { describe, expect, it } from 'vitest';
import { DEFAULT_V0_WEIGHTS, computeQueueRankScore } from '@openaux/shared';
import { rankItems, resolveWeights, scoreItem } from './ranking.js';
import { ZERO_FRICTION, type FrictionInputs } from './seams.js';
import { makeQueueItem } from './test-helpers.js';

describe('resolveWeights', () => {
  it('returns defaults when override is null/undefined', () => {
    expect(resolveWeights(null)).toEqual(DEFAULT_V0_WEIGHTS);
    expect(resolveWeights(undefined)).toEqual(DEFAULT_V0_WEIGHTS);
  });

  it('merges a partial override onto the defaults', () => {
    expect(resolveWeights({ upvoteWeight: 2 })).toEqual({ ...DEFAULT_V0_WEIGHTS, upvoteWeight: 2 });
  });
});

describe('scoreItem', () => {
  it('delegates to the shared engine (no re-derived formula)', () => {
    const item = makeQueueItem({ upvotesCount: 3, downvotesCount: 1, priorityBoostCount: 1 });
    const expected = computeQueueRankScore(
      {
        upvotesCount: 3,
        downvotesCount: 1,
        uniqueSupporterCount: 0,
        priorityBoostCount: 1,
        artistRepeatPenalty: 0,
        spamPenalty: 0,
      },
      DEFAULT_V0_WEIGHTS,
    );
    expect(scoreItem(item, DEFAULT_V0_WEIGHTS, ZERO_FRICTION)).toEqual(expected);
  });

  it('subtracts injected friction', () => {
    const item = makeQueueItem({ upvotesCount: 3 });
    const friction: FrictionInputs = { artistRepeatPenalty: 2, spamPenalty: 1 };
    const withFriction = scoreItem(item, DEFAULT_V0_WEIGHTS, friction).total;
    const without = scoreItem(item, DEFAULT_V0_WEIGHTS, ZERO_FRICTION).total;
    expect(without - withFriction).toBeCloseTo(3);
  });
});

describe('rankItems', () => {
  it('orders by computed score descending', () => {
    const low = makeQueueItem({ queueItemId: 'low', upvotesCount: 0 });
    const high = makeQueueItem({ queueItemId: 'high', upvotesCount: 5 });
    const ranked = rankItems([low, high], DEFAULT_V0_WEIGHTS);
    expect(ranked.map((i) => i.queueItemId)).toEqual(['high', 'low']);
  });

  it('writes the recomputed score onto currentScore', () => {
    const item = makeQueueItem({ upvotesCount: 4, currentScore: 0 });
    const [ranked] = rankItems([item], DEFAULT_V0_WEIGHTS);
    // RequestBase 2 + 4 upvotes = 6
    expect(ranked?.currentScore).toBeCloseTo(6);
  });

  it('applies per-item friction from the provided map', () => {
    const a = makeQueueItem({ queueItemId: 'a', upvotesCount: 3 });
    const b = makeQueueItem({ queueItemId: 'b', upvotesCount: 3 });
    const friction = new Map<string, FrictionInputs>([
      ['a', { artistRepeatPenalty: 5, spamPenalty: 0 }],
    ]);
    const ranked = rankItems([a, b], DEFAULT_V0_WEIGHTS, friction);
    // b unpenalized should outrank the penalized a
    expect(ranked.map((i) => i.queueItemId)).toEqual(['b', 'a']);
  });

  it('breaks ties by unique supporters then earlier createdAt', () => {
    const older = makeQueueItem({
      queueItemId: 'older',
      upvotesCount: 2,
      createdAt: new Date('2026-07-24T20:00:00Z'),
    });
    const newer = makeQueueItem({
      queueItemId: 'newer',
      upvotesCount: 2,
      createdAt: new Date('2026-07-24T20:05:00Z'),
    });
    const ranked = rankItems([newer, older], DEFAULT_V0_WEIGHTS);
    expect(ranked.map((i) => i.queueItemId)).toEqual(['older', 'newer']);
  });

  it('does not mutate the input items', () => {
    const item = makeQueueItem({ upvotesCount: 4, currentScore: 999 });
    rankItems([item], DEFAULT_V0_WEIGHTS);
    expect(item.currentScore).toBe(999);
  });
});
