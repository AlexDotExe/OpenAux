import { describe, expect, it } from 'vitest';
import {
  DEFAULT_V1_WEIGHTS,
  computeQueueRankScoreV1,
  type ScoringWeightsV1,
} from '@openaux/shared';
import {
  ageMinutesOf,
  computePaidPointsCap,
  effectiveUpvotes,
  netVotesV1,
  rankItemsV1,
  resolveWeightsV1,
  scoreItemV1,
  toScoringInputsV1,
} from './ranking.js';
import { PAID_POINTS_CAP_FLOOR } from './constants.js';
import { makeQueueItem } from './test-helpers.js';
import type { FrictionInputs } from './seams.js';

describe('resolveWeightsV1', () => {
  it('returns V1 defaults when override is null/undefined', () => {
    expect(resolveWeightsV1(null)).toEqual(DEFAULT_V1_WEIGHTS);
    expect(resolveWeightsV1(undefined)).toEqual(DEFAULT_V1_WEIGHTS);
  });
  it('merges a partial override onto the V1 defaults', () => {
    expect(resolveWeightsV1({ b: 1.2 })).toEqual({ ...DEFAULT_V1_WEIGHTS, b: 1.2 });
  });
});

describe('effectiveUpvotes / netVotesV1 (distinct-supporter 1.5×)', () => {
  it('counts each distinct supporter as 1.5× an upvote (adds +0.5 over a plain upvote)', () => {
    expect(effectiveUpvotes({ upvotesCount: 4, uniqueSupporterCount: 0 })).toBe(4);
    expect(effectiveUpvotes({ upvotesCount: 4, uniqueSupporterCount: 2 })).toBe(5);
  });
  it('nets effective upvotes against 0.7·downvotes', () => {
    expect(netVotesV1({ upvotesCount: 4, downvotesCount: 2, uniqueSupporterCount: 2 })).toBeCloseTo(
      5 - 1.4,
    );
  });
});

describe('computePaidPointsCap', () => {
  it('floors at PAID_POINTS_CAP_FLOOR when there is no demand to beat', () => {
    expect(computePaidPointsCap({ items: [], weights: DEFAULT_V1_WEIGHTS })).toBe(
      PAID_POINTS_CAP_FLOOR,
    );
    const noVotes = makeQueueItem({ upvotesCount: 0 });
    expect(computePaidPointsCap({ items: [noVotes], weights: DEFAULT_V1_WEIGHTS })).toBe(
      PAID_POINTS_CAP_FLOOR,
    );
  });
  it('grows with the crowd leader’s demand (≈33% of A/B · maxNetVotes)', () => {
    const leader = makeQueueItem({ upvotesCount: 30 });
    const cap = computePaidPointsCap({ items: [leader], weights: DEFAULT_V1_WEIGHTS });
    // (A/B)=1/0.6=1.667; 0.33·1.667·30 ≈ 16.5 → 17
    expect(cap).toBe(Math.round(0.33 * (1.0 / 0.6) * 30));
    expect(cap).toBeGreaterThan(PAID_POINTS_CAP_FLOOR);
  });
  it('caps paid points so the crowd can out-vote a super boost', () => {
    // A single Super Boost = 7 paid points; a modest crowd leader keeps the cap below that.
    const leader = makeQueueItem({ upvotesCount: 8 });
    const cap = computePaidPointsCap({ items: [leader], weights: DEFAULT_V1_WEIGHTS });
    expect(cap).toBeLessThan(7);
  });
});

describe('ageMinutesOf', () => {
  it('returns minutes since createdAt, clamped at 0', () => {
    const item = makeQueueItem({ createdAt: new Date('2026-07-24T20:00:00Z') });
    expect(ageMinutesOf(item, new Date('2026-07-24T20:30:00Z'))).toBe(30);
    expect(ageMinutesOf(item, new Date('2026-07-24T19:00:00Z'))).toBe(0);
  });
});

describe('scoreItemV1 / toScoringInputsV1', () => {
  it('delegates to the shared V1 engine with mapped inputs (skipRisk from friction)', () => {
    const item = makeQueueItem({
      upvotesCount: 4,
      downvotesCount: 1,
      uniqueSupporterCount: 2,
      priorityBoostCount: 1,
      instantVoteCount: 1,
      superBoostCount: 0,
    });
    const friction: FrictionInputs = { artistRepeatPenalty: 0, spamPenalty: 2, skipRisk: 1.5 };
    const inputs = toScoringInputsV1(item, {
      ageMinutes: 10,
      skipRisk: 1.5,
      spam: 2,
      paidPointsCap: 8,
    });
    const expected = computeQueueRankScoreV1(inputs, DEFAULT_V1_WEIGHTS);
    const actual = scoreItemV1(item, DEFAULT_V1_WEIGHTS, {
      ageMinutes: 10,
      paidPointsCap: 8,
      friction,
    });
    expect(actual).toEqual(expected);
    // effective upvotes fold in the 1.5× distinct-supporter bonus.
    expect(inputs.upvotesCount).toBe(5);
  });
});

describe('rankItemsV1', () => {
  const now = new Date('2026-07-24T21:00:00Z');
  it('orders by the V1 capped score and writes it onto currentScore', () => {
    const strongCrowd = makeQueueItem({ queueItemId: 'crowd', upvotesCount: 12 });
    const paidOnly = makeQueueItem({
      queueItemId: 'paid',
      upvotesCount: 0,
      superBoostCount: 3, // 21 raw paid points, but capped
    });
    const ranked = rankItemsV1([paidOnly, strongCrowd], DEFAULT_V1_WEIGHTS, { now });
    // With the cap, the strong crowd favorite still outranks a stack of paid boosts.
    expect(ranked[0]?.queueItemId).toBe('crowd');
  });
  it('applies skipRisk from the friction map (V1 −D·skip_risk term)', () => {
    const weights: ScoringWeightsV1 = DEFAULT_V1_WEIGHTS;
    const a = makeQueueItem({ queueItemId: 'a', upvotesCount: 5 });
    const b = makeQueueItem({ queueItemId: 'b', upvotesCount: 5 });
    const frictionByItem = new Map<string, FrictionInputs>([
      ['a', { artistRepeatPenalty: 0, spamPenalty: 0, skipRisk: 3 }],
    ]);
    const ranked = rankItemsV1([a, b], weights, { now, frictionByItem });
    expect(ranked.map((i) => i.queueItemId)).toEqual(['b', 'a']);
  });
  it('does not mutate the input items', () => {
    const item = makeQueueItem({ upvotesCount: 4, currentScore: 999 });
    rankItemsV1([item], DEFAULT_V1_WEIGHTS, { now });
    expect(item.currentScore).toBe(999);
  });
});
