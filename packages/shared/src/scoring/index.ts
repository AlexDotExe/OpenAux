/**
 * V0 scoring engine — THE canonical implementation (SPEC.md §4).
 *
 * QueueRankScore = DemandScore + PaymentScore − FrictionScore
 *
 * Rules:
 * - Pure functions only. No I/O, no clock reads — callers pass everything in.
 * - Never reimplement this elsewhere; server code imports from @openaux/shared.
 * - Weight changes go through ScoringWeights (per-venue override), never literals.
 */

export interface ScoringWeights {
  requestBase: number;
  upvoteWeight: number;
  downvoteWeight: number;
  uniqueSupporterWeight: number;
  priorityBoostWeight: number;
}

/** SPEC.md §4 defaults. Per-venue overrides come from venue.scoringWeightsOverride. */
export const DEFAULT_V0_WEIGHTS: ScoringWeights = {
  requestBase: 2,
  upvoteWeight: 1,
  downvoteWeight: 1.25,
  uniqueSupporterWeight: 0.5,
  priorityBoostWeight: 3,
};

export interface ScoringInputs {
  upvotesCount: number;
  downvotesCount: number;
  uniqueSupporterCount: number;
  priorityBoostCount: number;
  /** Friction terms are computed by the anti-spam layer and passed in. */
  artistRepeatPenalty: number;
  spamPenalty: number;
}

export interface ScoreBreakdown {
  demandScore: number;
  paymentScore: number;
  frictionScore: number;
  total: number;
}

export function computeQueueRankScore(
  inputs: ScoringInputs,
  weights: ScoringWeights = DEFAULT_V0_WEIGHTS,
): ScoreBreakdown {
  const demandScore =
    weights.requestBase +
    weights.upvoteWeight * inputs.upvotesCount -
    weights.downvoteWeight * inputs.downvotesCount +
    weights.uniqueSupporterWeight * inputs.uniqueSupporterCount;

  const paymentScore = weights.priorityBoostWeight * inputs.priorityBoostCount;

  const frictionScore = inputs.artistRepeatPenalty + inputs.spamPenalty;

  return {
    demandScore,
    paymentScore,
    frictionScore,
    total: demandScore + paymentScore - frictionScore,
  };
}

export interface RankableItem {
  currentScore: number;
  uniqueSupporterCount: number;
  createdAt: Date;
  downvotesCount: number;
}

/**
 * Sort comparator: score desc, then tiebreakers in spec order —
 * higher unique supporters, earlier createdAt, fewer downvotes.
 */
export function compareQueueItems(a: RankableItem, b: RankableItem): number {
  if (b.currentScore !== a.currentScore) return b.currentScore - a.currentScore;
  if (b.uniqueSupporterCount !== a.uniqueSupporterCount) {
    return b.uniqueSupporterCount - a.uniqueSupporterCount;
  }
  const aTime = a.createdAt.getTime();
  const bTime = b.createdAt.getTime();
  if (aTime !== bTime) return aTime - bTime;
  return a.downvotesCount - b.downvotesCount;
}

export function rankQueue<T extends RankableItem>(items: T[]): T[] {
  return [...items].sort(compareQueueItems);
}
