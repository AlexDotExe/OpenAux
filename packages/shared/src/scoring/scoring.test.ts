import { describe, expect, it } from "vitest";
import {
  DEFAULT_V0_WEIGHTS,
  DEFAULT_V1_WEIGHTS,
  PAID_BOOST_POINTS,
  computeQueueRankScore,
  computeQueueRankScoreV1,
  rankQueue,
  type RankableItem,
  type ScoringInputsV1,
} from "./index.js";

const zeroInputs = {
  upvotesCount: 0,
  downvotesCount: 0,
  uniqueSupporterCount: 0,
  priorityBoostCount: 0,
  artistRepeatPenalty: 0,
  spamPenalty: 0,
};

describe("computeQueueRankScore", () => {
  it("gives a fresh request the RequestBase score, not zero", () => {
    const score = computeQueueRankScore(zeroInputs);
    expect(score.total).toBe(DEFAULT_V0_WEIGHTS.requestBase);
  });

  it("applies all V0 weights per SPEC.md §4", () => {
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

  it("weighs downvotes 1.25x upvotes", () => {
    const even = computeQueueRankScore({
      ...zeroInputs,
      upvotesCount: 4,
      downvotesCount: 4,
    });
    expect(even.total).toBeLessThan(DEFAULT_V0_WEIGHTS.requestBase);
  });
});

describe("rankQueue tiebreakers", () => {
  const base = (over: Partial<RankableItem>): RankableItem => ({
    currentScore: 10,
    uniqueSupporterCount: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    downvotesCount: 0,
    ...over,
  });

  it("ranks by score first", () => {
    const items = [base({ currentScore: 5 }), base({ currentScore: 15 })];
    expect(rankQueue(items)[0]!.currentScore).toBe(15);
  });

  it("breaks score ties by unique supporters, then earlier request, then fewer downvotes", () => {
    const supporters = base({ uniqueSupporterCount: 3 });
    const earlier = base({ createdAt: new Date("2026-01-01T00:00:00Z") });
    const later = base({ createdAt: new Date("2026-01-01T00:05:00Z") });
    const fewerDown = base({ downvotesCount: 1 });
    const moreDown = base({ downvotesCount: 4 });

    expect(rankQueue([earlier, supporters])[0]).toBe(supporters);
    expect(rankQueue([later, earlier])[0]).toBe(earlier);
    expect(
      rankQueue([
        { ...moreDown, createdAt: new Date("2026-01-01T00:00:00Z") },
        { ...fewerDown, createdAt: new Date("2026-01-01T00:00:00Z") },
      ])[0]!.downvotesCount,
    ).toBe(1);
  });
});

describe("computeQueueRankScoreV1 (capped model)", () => {
  const zeroV1: ScoringInputsV1 = {
    upvotesCount: 0,
    downvotesCount: 0,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    ageMinutes: 0,
    skipRisk: 0,
    spam: 0,
    paidPointsCap: 100,
  };

  it("scores an empty request at zero (log(1)=0, no votes, no paid)", () => {
    expect(computeQueueRankScoreV1(zeroV1).total).toBe(0);
  });

  it("down-weights downvotes to 0.7 in net_votes", () => {
    const b = computeQueueRankScoreV1({
      ...zeroV1,
      upvotesCount: 10,
      downvotesCount: 10,
    });
    // net = 10 − 0.7*10 = 3; total = A*3 = 3
    expect(b.netVotes).toBeCloseTo(3);
    expect(b.total).toBeCloseTo(3);
  });

  it("maps paid points 1/4/7 for priority/instant/super", () => {
    expect(PAID_BOOST_POINTS.priority_boost).toBe(1);
    expect(PAID_BOOST_POINTS.instant_play_vote).toBe(4);
    expect(PAID_BOOST_POINTS.super_boost).toBe(7);
    const b = computeQueueRankScoreV1({
      ...zeroV1,
      priorityBoostCount: 2,
      instantVoteCount: 1,
      superBoostCount: 1,
    });
    // paid = 1*2 + 4*1 + 7*1 = 13, under cap 100
    expect(b.paidPointsCapped).toBe(13);
    expect(b.total).toBeCloseTo(DEFAULT_V1_WEIGHTS.b * 13);
  });

  it("caps paid points so the crowd can override", () => {
    const b = computeQueueRankScoreV1({
      ...zeroV1,
      superBoostCount: 5, // raw paid = 35
      paidPointsCap: 10,
    });
    expect(b.paidPointsCapped).toBe(10);
    expect(b.total).toBeCloseTo(DEFAULT_V1_WEIGHTS.b * 10);
  });

  it("adds a logarithmic time boost from ageMinutes", () => {
    const b = computeQueueRankScoreV1({ ...zeroV1, ageMinutes: Math.E - 1 });
    // log(1 + (e−1)) = log(e) = 1; total = C*1
    expect(b.timeBoost).toBeCloseTo(1);
    expect(b.total).toBeCloseTo(DEFAULT_V1_WEIGHTS.c);
  });

  it("subtracts weighted skip_risk and spam", () => {
    const b = computeQueueRankScoreV1({ ...zeroV1, skipRisk: 2, spam: 1 });
    // total = −D*2 − E*1 = −4 − 3 = −7
    expect(b.total).toBeCloseTo(
      -(DEFAULT_V1_WEIGHTS.d * 2) - DEFAULT_V1_WEIGHTS.e,
    );
  });

  it("combines every term with default weights", () => {
    const b = computeQueueRankScoreV1({
      upvotesCount: 8,
      downvotesCount: 5,
      priorityBoostCount: 1,
      instantVoteCount: 1,
      superBoostCount: 0,
      ageMinutes: Math.E - 1,
      skipRisk: 1,
      spam: 0.5,
      paidPointsCap: 100,
    });
    const net = 8 - 0.7 * 5; // 4.5
    const paid = 1 + 4; // 5
    const time = 1;
    const expected = 1.0 * net + 0.6 * paid + 0.4 * time - 2.0 * 1 - 3.0 * 0.5;
    expect(b.netVotes).toBeCloseTo(net);
    expect(b.paidPointsCapped).toBe(paid);
    expect(b.total).toBeCloseTo(expected);
  });

  it("honors weight overrides", () => {
    const inputs: ScoringInputsV1 = { ...zeroV1, upvotesCount: 10 };
    const base = computeQueueRankScoreV1(inputs);
    const doubled = computeQueueRankScoreV1(inputs, {
      ...DEFAULT_V1_WEIGHTS,
      a: 2.0,
    });
    expect(doubled.total).toBeCloseTo(base.total * 2);
  });
});
