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

/**
 * V1+ capped scoring engine (SPEC.md §4 "V1+ evolution" / "Possible Algorithm Logic").
 *
 * score = A·net_votes + B·paid_points_capped + C·time_boost − D·skip_risk − E·spam
 * net_votes  = up − downvoteWeight·down
 * time_boost = log(1 + age_minutes)
 * paid_points = priorityBoostPoints·boosts + instantVotePoints·instantVotes + superBoostPoints·superBoosts
 * paid_points_capped = min(paid_points, cap)
 *
 * Opt-in per venue via `Venue.scoringModel`; V0 (`computeQueueRankScore`) remains the
 * default until a venue switches to `'v1'`. Never re-derive this elsewhere.
 */
export interface V1ScoringWeights {
  netVoteWeight: number; // A
  paidPointsWeight: number; // B
  timeBoostWeight: number; // C
  skipRiskWeight: number; // D
  spamWeight: number; // E
  /** Downvotes count against net_votes at this multiplier (SPEC.md §4). */
  downvoteWeight: number;
  /** Cap on paid_points, ≈25–40% of what's needed to win a typical queue. */
  paidPointsCap: number;
  priorityBoostPoints: number;
  instantVotePoints: number;
  superBoostPoints: number;
}

/** SPEC.md §4 V1+ starting weights (A=1.0, B=0.6, C=0.4, D=2.0, E=3.0), tunable per venue. */
export const DEFAULT_V1_WEIGHTS: V1ScoringWeights = {
  netVoteWeight: 1.0,
  paidPointsWeight: 0.6,
  timeBoostWeight: 0.4,
  skipRiskWeight: 2.0,
  spamWeight: 3.0,
  downvoteWeight: 0.7,
  paidPointsCap: 10,
  priorityBoostPoints: 1,
  instantVotePoints: 4,
  superBoostPoints: 7,
};

export interface V1ScoringInputs {
  upvotesCount: number;
  downvotesCount: number;
  priorityBoostCount: number;
  instantVoteCount: number;
  superBoostCount: number;
  /** Age of the request in minutes; older requests slowly rise via time_boost. */
  ageMinutes: number;
  /** Friction terms are computed by the anti-spam layer and passed in. */
  skipRisk: number;
  spamPenalty: number;
}

export function computeQueueRankScoreV1(
  inputs: V1ScoringInputs,
  weights: V1ScoringWeights = DEFAULT_V1_WEIGHTS,
): ScoreBreakdown {
  const netVotes = inputs.upvotesCount - weights.downvoteWeight * inputs.downvotesCount;
  const timeBoost = Math.log(1 + Math.max(0, inputs.ageMinutes));
  const paidPoints =
    weights.priorityBoostPoints * inputs.priorityBoostCount +
    weights.instantVotePoints * inputs.instantVoteCount +
    weights.superBoostPoints * inputs.superBoostCount;
  const paidPointsCapped = Math.min(paidPoints, weights.paidPointsCap);

  const demandScore = weights.netVoteWeight * netVotes + weights.timeBoostWeight * timeBoost;
  const paymentScore = weights.paidPointsWeight * paidPointsCapped;
  const frictionScore =
    weights.skipRiskWeight * inputs.skipRisk + weights.spamWeight * inputs.spamPenalty;

  return {
    demandScore,
    paymentScore,
    frictionScore,
    total: demandScore + paymentScore - frictionScore,
  };
}
