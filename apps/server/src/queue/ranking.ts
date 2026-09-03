/**
 * Ranking loop (SPEC.md §1 layer 2 / §4). Recomputes queue_rank_score for the live
 * queue using ONLY the shared engine — the formula/weights are never reimplemented here.
 * Friction inputs (artistRepeatPenalty, spamPenalty) are supplied by a FrictionProvider
 * (WS6); missing entries default to zero.
 */

import {
  DEFAULT_V0_WEIGHTS,
  DEFAULT_V1_WEIGHTS,
  DOWNVOTE_NET_WEIGHT,
  computeQueueRankScore,
  computeQueueRankScoreV1,
  rankQueue,
  type QueueItem,
  type QueueItemId,
  type ScoreBreakdown,
  type ScoreBreakdownV1,
  type ScoringInputsV1,
  type ScoringWeights,
  type ScoringWeightsV1,
} from '@openaux/shared';
import {
  DISTINCT_SUPPORTER_MULTIPLIER,
  PAID_POINTS_CAP_FLOOR,
  PAID_POINTS_CAP_FRACTION,
} from './constants.js';
import { ZERO_FRICTION, type FrictionInputs } from './seams.js';

/** Merge a per-venue partial override onto the V0 defaults. */
export function resolveWeights(
  override: Partial<ScoringWeights> | null | undefined,
): ScoringWeights {
  return { ...DEFAULT_V0_WEIGHTS, ...(override ?? {}) };
}

/** Score a single item via the shared engine. Pure. */
export function scoreItem(
  item: QueueItem,
  weights: ScoringWeights,
  friction: FrictionInputs = ZERO_FRICTION,
): ScoreBreakdown {
  return computeQueueRankScore(
    {
      upvotesCount: item.upvotesCount,
      downvotesCount: item.downvotesCount,
      uniqueSupporterCount: item.uniqueSupporterCount,
      priorityBoostCount: item.priorityBoostCount,
      artistRepeatPenalty: friction.artistRepeatPenalty,
      spamPenalty: friction.spamPenalty,
    },
    weights,
  );
}

/**
 * Recompute currentScore for every item, then sort with the shared tiebreakers.
 * Returns fresh copies (does not mutate inputs).
 */
export function rankItems(
  items: QueueItem[],
  weights: ScoringWeights,
  frictionByItem: Map<QueueItemId, FrictionInputs> = new Map(),
): QueueItem[] {
  const scored = items.map((item) => ({
    ...item,
    currentScore: scoreItem(item, weights, frictionByItem.get(item.queueItemId) ?? ZERO_FRICTION)
      .total,
  }));
  return rankQueue(scored);
}

// ===========================================================================
// V1 ranking path — capped paid-points model (SPEC.md §4 V1+). ADDITIVE and
// versioned: V0 above stays the default engine; a venue opts into this path via
// its scoring model. Still delegates the formula to @openaux/shared — this module
// only maps a live QueueItem + context into ScoringInputsV1.
// ===========================================================================

/** The scoring model a venue's ranking runs under. V0 remains the default. */
export type ScoringModel = 'v0' | 'v1';

/** Merge a per-venue partial override onto the V1 defaults. */
export function resolveWeightsV1(
  override: Partial<ScoringWeightsV1> | null | undefined,
): ScoringWeightsV1 {
  return { ...DEFAULT_V1_WEIGHTS, ...(override ?? {}) };
}

/**
 * Distinct-supporter demand (SPEC.md §5 V1): the same song requested by multiple
 * independent users counts each distinct supporter as 1.5× an upvote. We express that
 * as effective upvotes = upvotes + (1.5 − 1)·uniqueSupporters, folding only the +0.5
 * excess over a plain upvote so the distinct supporters aren't double-counted. Pure.
 */
export function effectiveUpvotes(item: {
  upvotesCount: number;
  uniqueSupporterCount: number;
}): number {
  return item.upvotesCount + (DISTINCT_SUPPORTER_MULTIPLIER - 1) * item.uniqueSupporterCount;
}

/** V1 net-votes for an item: effective upvotes − 0.7·downvotes. Pure. */
export function netVotesV1(item: {
  upvotesCount: number;
  downvotesCount: number;
  uniqueSupporterCount: number;
}): number {
  return effectiveUpvotes(item) - DOWNVOTE_NET_WEIGHT * item.downvotesCount;
}

/**
 * Derive the paid-points cap (SPEC.md §4: "cap ≈ 25–40% of what's needed to win").
 *
 * "What's needed to win" is measured against the current crowd leader's demand: to
 * overcome a net-votes lead L, capped paid points must satisfy B·pp ≥ A·L, i.e.
 * pp = (A/B)·L. The cap grants only `fraction` (≈33%) of that, so paid boosts can climb
 * but the crowd can always out-vote them. A `floor` keeps a single Priority Boost
 * meaningful early in a session when demand (L) is still near zero. Pure.
 */
export function computePaidPointsCap(params: {
  items: readonly QueueItem[];
  weights: ScoringWeightsV1;
  fraction?: number;
  floor?: number;
}): number {
  const fraction = params.fraction ?? PAID_POINTS_CAP_FRACTION;
  const floor = params.floor ?? PAID_POINTS_CAP_FLOOR;
  const maxNetVotes = params.items.reduce((max, item) => Math.max(max, netVotesV1(item)), 0);
  const pointsToWin = params.weights.b > 0 ? (params.weights.a / params.weights.b) * maxNetVotes : 0;
  return Math.max(floor, Math.round(fraction * pointsToWin));
}

/** Minutes elapsed since the item was created, clamped at 0. Pure (clock passed in). */
export function ageMinutesOf(item: { createdAt: Date }, now: Date): number {
  return Math.max(0, (now.getTime() - item.createdAt.getTime()) / 60_000);
}

/** Map a live QueueItem + context into the shared V1 scoring inputs. Pure. */
export function toScoringInputsV1(
  item: QueueItem,
  ctx: { ageMinutes: number; skipRisk: number; spam: number; paidPointsCap: number },
): ScoringInputsV1 {
  return {
    upvotesCount: effectiveUpvotes(item),
    downvotesCount: item.downvotesCount,
    priorityBoostCount: item.priorityBoostCount,
    instantVoteCount: item.instantVoteCount,
    superBoostCount: item.superBoostCount,
    ageMinutes: ctx.ageMinutes,
    skipRisk: ctx.skipRisk,
    spam: ctx.spam,
    paidPointsCap: ctx.paidPointsCap,
  };
}

/** Score a single item via the shared V1 engine. Pure. */
export function scoreItemV1(
  item: QueueItem,
  weights: ScoringWeightsV1,
  ctx: { ageMinutes: number; paidPointsCap: number; friction?: FrictionInputs },
): ScoreBreakdownV1 {
  const friction = ctx.friction ?? ZERO_FRICTION;
  return computeQueueRankScoreV1(
    toScoringInputsV1(item, {
      ageMinutes: ctx.ageMinutes,
      skipRisk: friction.skipRisk ?? 0,
      spam: friction.spamPenalty,
      paidPointsCap: ctx.paidPointsCap,
    }),
    weights,
  );
}

export interface RankContextV1 {
  /** Reference clock instant for age/time-boost (no clock reads inside). */
  now: Date;
  frictionByItem?: Map<QueueItemId, FrictionInputs>;
  /** Pre-derived cap; when omitted it is computed from `items` via computePaidPointsCap. */
  paidPointsCap?: number;
  capFraction?: number;
  capFloor?: number;
}

/**
 * V1 sibling of rankItems: recompute currentScore for every item under the capped model,
 * then sort with the shared tiebreakers. Returns fresh copies (does not mutate inputs).
 */
export function rankItemsV1(
  items: QueueItem[],
  weights: ScoringWeightsV1,
  ctx: RankContextV1,
): QueueItem[] {
  const cap =
    ctx.paidPointsCap ??
    computePaidPointsCap({ items, weights, fraction: ctx.capFraction, floor: ctx.capFloor });
  const friction = ctx.frictionByItem ?? new Map<QueueItemId, FrictionInputs>();
  const scored = items.map((item) => ({
    ...item,
    currentScore: scoreItemV1(item, weights, {
      ageMinutes: ageMinutesOf(item, ctx.now),
      paidPointsCap: cap,
      friction: friction.get(item.queueItemId) ?? ZERO_FRICTION,
    }).total,
  }));
  return rankQueue(scored);
}
