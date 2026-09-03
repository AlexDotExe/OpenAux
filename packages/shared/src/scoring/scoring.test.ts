import { describe, expect, it } from 'vitest';
import {
  DEFAULT_V0_WEIGHTS,
  DEFAULT_V1_WEIGHTS,
  computeQueueRankScore,
  computeQueueRankScoreV1,
  rankQueue,
  type RankableItem,
} from './index.js';

const zeroInputs = {
  upvotesCount: 0,
  downvotesCount: 0,
  uniqueSupporterCount: 0,
  priorityBoostCount: 0,
  artistRepeatPenalty: 0,
  spamPenalty: 0,
};

describe('computeQueueRankScore', () => {
  it('gives a fresh request the RequestBase score, not zero', () => {
    const score = computeQueueRankScore(zeroInputs);
    expect(score.total).toBe(DEFAULT_V0_WEIGHTS.requestBase);
  });

  it('applies all V0 weights per SPEC.md §4', () => {
    const score = computeQueueRankScore({
      upvotesCount: 12,
      downvotesCount: 3,
      uniqueSupporterCount: 5,
      priorityBoostCount: 2,
      artistRepeatPenalty: 1,
      spamPenalty: 0.5,
    });
    // demand = 2 + 12 − 3.75 + 2.5 = 12.75; payment = 6; friction = 1.5
    expect(score.demandScore).toBeCloseTo(12.75);
    expect(score.paymentScore).toBe(6);
    expect(score.frictionScore).toBe(1.5);
    expect(score.total).toBeCloseTo(17.25);
  });

  it('weighs downvotes 1.25x upvotes', () => {
    const even = computeQueueRankScore({ ...zeroInputs, upvotesCount: 4, downvotesCount: 4 });
    expect(even.total).toBeLessThan(DEFAULT_V0_WEIGHTS.requestBase);
  });
});

describe('rankQueue tiebreakers', () => {
  const base = (over: Partial<RankableItem>): RankableItem => ({
    currentScore: 10,
    uniqueSupporterCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    downvotesCount: 0,
    ...over,
  });

  it('ranks by score first', () => {
    const items = [base({ currentScore: 5 }), base({ currentScore: 15 })];
    expect(rankQueue(items)[0]!.currentScore).toBe(15);
  });

  it('breaks score ties by unique supporters, then earlier request, then fewer downvotes', () => {
    const supporters = base({ uniqueSupporterCount: 3 });
    const earlier = base({ createdAt: new Date('2026-01-01T00:00:00Z') });
    const later = base({ createdAt: new Date('2026-01-01T00:05:00Z') });
    const fewerDown = base({ downvotesCount: 1 });
    const moreDown = base({ downvotesCount: 4 });

    expect(rankQueue([earlier, supporters])[0]).toBe(supporters);
    expect(rankQueue([later, earlier])[0]).toBe(earlier);
    expect(
      rankQueue([
        { ...moreDown, createdAt: new Date('2026-01-01T00:00:00Z') },
        { ...fewerDown, createdAt: new Date('2026-01-01T00:00:00Z') },
      ])[0]!.downvotesCount,
    ).toBe(1);
  });
});

describe('computeQueueRankScoreV1', () => {
  const zeroV1Inputs = {
    upvotesCount: 0,
    downvotesCount: 0,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    ageMinutes: 0,
    skipRisk: 0,
    spamPenalty: 0,
  };

  it('scores a brand-new, untouched request as zero', () => {
    const score = computeQueueRankScoreV1(zeroV1Inputs);
    expect(score.total).toBe(0);
  });

  it('applies net_votes, time_boost, capped paid points, and friction per SPEC.md §4', () => {
    const score = computeQueueRankScoreV1({
      upvotesCount: 10,
      downvotesCount: 4,
      priorityBoostCount: 2, // 2 points
      instantVoteCount: 1, // 4 points
      superBoostCount: 1, // 7 points -> paid_points = 13, capped at 10
      ageMinutes: Math.E - 1, // time_boost = log(1 + (e-1)) = 1
      skipRisk: 1,
      spamPenalty: 0.5,
    });
    // net_votes = 10 - 0.7*4 = 7.2; demand = 1.0*7.2 + 0.4*1 = 7.6
    expect(score.demandScore).toBeCloseTo(7.6);
    // paid_points_capped = min(13, 10) = 10; payment = 0.6*10 = 6
    expect(score.paymentScore).toBe(6);
    // friction = 2.0*1 + 3.0*0.5 = 3.5
    expect(score.frictionScore).toBeCloseTo(3.5);
    expect(score.total).toBeCloseTo(10.1);
  });

  it('caps paid points so crowd votes can still outweigh a single paid boost', () => {
    const paidOnly = computeQueueRankScoreV1({ ...zeroV1Inputs, superBoostCount: 5 }); // 35 pts, capped to 10
    const crowdOnly = computeQueueRankScoreV1({ ...zeroV1Inputs, upvotesCount: 20 });
    expect(crowdOnly.total).toBeGreaterThan(paidOnly.total);
  });

  it('never lets paid_points_capped exceed the configured cap', () => {
    const score = computeQueueRankScoreV1(
      { ...zeroV1Inputs, superBoostCount: 100 },
      DEFAULT_V1_WEIGHTS,
    );
    expect(score.paymentScore).toBe(DEFAULT_V1_WEIGHTS.paidPointsWeight * DEFAULT_V1_WEIGHTS.paidPointsCap);
  });

  it('paid actions never override crowd hate (downvotes still subtract from net_votes)', () => {
    const heavilyDownvoted = computeQueueRankScoreV1({
      ...zeroV1Inputs,
      downvotesCount: 20,
      superBoostCount: 1,
    });
    expect(heavilyDownvoted.total).toBeLessThan(0);
  });
});
