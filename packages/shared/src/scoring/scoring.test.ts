import { describe, expect, it } from 'vitest';
import {
  DEFAULT_V0_WEIGHTS,
  computeQueueRankScore,
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
