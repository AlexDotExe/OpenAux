/**
 * Ranking loop (SPEC.md §1 layer 2 / §4). Recomputes queue_rank_score for the live
 * queue using ONLY the shared engine — the formula/weights are never reimplemented here.
 * Friction inputs (artistRepeatPenalty, spamPenalty) are supplied by a FrictionProvider
 * (WS6); missing entries default to zero.
 */

import {
  DEFAULT_V0_WEIGHTS,
  computeQueueRankScore,
  computeQueueRankScoreV1,
  rankQueue,
  type QueueItem,
  type QueueItemId,
  type ScoreBreakdown,
  type ScoringModel,
  type ScoringWeights,
} from '@openaux/shared';
import { ZERO_FRICTION, type FrictionInputs } from './seams.js';

/** Merge a per-venue partial override onto the V0 defaults. */
export function resolveWeights(
  override: Partial<ScoringWeights> | null | undefined,
): ScoringWeights {
  return { ...DEFAULT_V0_WEIGHTS, ...(override ?? {}) };
}

/** Score a single item via the shared engine (V0 by default, V1 when the venue opts in). Pure. */
export function scoreItem(
  item: QueueItem,
  weights: ScoringWeights,
  friction: FrictionInputs = ZERO_FRICTION,
  scoringModel: ScoringModel = 'v0',
  now: Date = new Date(),
): ScoreBreakdown {
  if (scoringModel === 'v1') {
    const ageMinutes = (now.getTime() - item.createdAt.getTime()) / 60_000;
    return computeQueueRankScoreV1({
      upvotesCount: item.upvotesCount,
      downvotesCount: item.downvotesCount,
      priorityBoostCount: item.priorityBoostCount,
      instantVoteCount: item.instantVoteCount,
      superBoostCount: item.superBoostCount,
      ageMinutes,
      skipRisk: friction.artistRepeatPenalty,
      spamPenalty: friction.spamPenalty,
    });
  }
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
  scoringModel: ScoringModel = 'v0',
  now: Date = new Date(),
): QueueItem[] {
  const scored = items.map((item) => ({
    ...item,
    currentScore: scoreItem(
      item,
      weights,
      frictionByItem.get(item.queueItemId) ?? ZERO_FRICTION,
      scoringModel,
      now,
    ).total,
  }));
  return rankQueue(scored);
}
