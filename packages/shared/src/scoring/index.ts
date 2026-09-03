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

// ===========================================================================
// V1 scoring engine — capped paid-points model (SPEC.md §4 "V1+ evolution").
//
//   score = A·net_votes + B·paid_points_capped + C·time_boost − D·skip_risk − E·spam
//
//   net_votes          = up − 0.7·down
//   paid_points        = 1·priority + 4·instant + 7·super
//   paid_points_capped = min(paid_points, cap)   // cap ≈ 25–40% of what's needed to win
//   time_boost         = log(1 + age_minutes)    // older requests slowly rise
//
// ADDITIVE + versioned: the V0 functions above stay the canonical engine until a
// venue opts into the capped model. Same rules apply — pure, no I/O, no clock
// reads. ageMinutes / skipRisk / spam are computed by their layers and passed in.
// ===========================================================================

export interface ScoringWeightsV1 {
  /** A — net votes weight. */
  a: number;
  /** B — capped paid-points weight. */
  b: number;
  /** C — time-boost weight. */
  c: number;
  /** D — skip-risk penalty weight. */
  d: number;
  /** E — spam penalty weight. */
  e: number;
}

/** SPEC.md §4 V1+ starting weights. Per-venue overrides come from the venue row. */
export const DEFAULT_V1_WEIGHTS: ScoringWeightsV1 = {
  a: 1.0,
  b: 0.6,
  c: 0.4,
  d: 2.0,
  e: 3.0,
};

/** Down-weight applied to downvotes in net_votes (SPEC.md §4: up − 0.7·down). */
export const DOWNVOTE_NET_WEIGHT = 0.7;

/** Paid-action point values feeding paid_points (SPEC.md §4 / decision D2). */
export type PaidBoostType =
  "priority_boost" | "instant_play_vote" | "super_boost";

export const PAID_BOOST_POINTS: Readonly<Record<PaidBoostType, number>> = {
  priority_boost: 1,
  instant_play_vote: 4,
  super_boost: 7,
};

export interface ScoringInputsV1 {
  upvotesCount: number;
  downvotesCount: number;
  priorityBoostCount: number;
  instantVoteCount: number;
  superBoostCount: number;
  /** Minutes since the request was created; supplied by the caller (no clock reads here). */
  ageMinutes: number;
  /** Skip-risk term from the anti-spam / reputation layer. */
  skipRisk: number;
  /** Spam term from the anti-spam layer. */
  spam: number;
  /**
   * Cap on paid_points (≈ 25–40% of what's needed to win). The caller derives it
   * from the current live-queue state so the crowd can always override paid boosts.
   */
  paidPointsCap: number;
}

export interface ScoreBreakdownV1 {
  netVotes: number;
  paidPointsCapped: number;
  timeBoost: number;
  skipRisk: number;
  spam: number;
  total: number;
}

export function computeQueueRankScoreV1(
  inputs: ScoringInputsV1,
  weights: ScoringWeightsV1 = DEFAULT_V1_WEIGHTS,
): ScoreBreakdownV1 {
  const netVotes =
    inputs.upvotesCount - DOWNVOTE_NET_WEIGHT * inputs.downvotesCount;

  const paidPoints =
    PAID_BOOST_POINTS.priority_boost * inputs.priorityBoostCount +
    PAID_BOOST_POINTS.instant_play_vote * inputs.instantVoteCount +
    PAID_BOOST_POINTS.super_boost * inputs.superBoostCount;
  const paidPointsCapped = Math.min(paidPoints, inputs.paidPointsCap);

  const timeBoost = Math.log(1 + inputs.ageMinutes);

  const total =
    weights.a * netVotes +
    weights.b * paidPointsCapped +
    weights.c * timeBoost -
    weights.d * inputs.skipRisk -
    weights.e * inputs.spam;

  return {
    netVotes,
    paidPointsCapped,
    timeBoost,
    skipRisk: inputs.skipRisk,
    spam: inputs.spam,
    total,
  };
}
