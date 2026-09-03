/**
 * Reputation v1 (SPEC.md §5 V1: "Reputation-based weighting v1").
 *
 *   reputation_score = + upvotes received
 *                      − downvotes received
 *                      − spam attempts
 *                      − songs skipped (venue skip or crowd-vote skip)
 *
 * The formula is PURE (no I/O, no clock). Persistence + analytics live in the
 * `updateReputation` service, which reads/increments the per-user counters via a
 * stub-able `ReputationRepository`, recomputes the score, writes it back, and
 * emits a `reputation_updated` analytics event.
 *
 * Layering: reputation is an anti-spam / skip-risk input. It is recomputed here
 * and passed into the scoring engine (never computed inside ranking). It feeds
 * the V1 model's `skipRisk` term — higher reputation ⇒ lower skip risk (WS3 maps
 * score → skipRisk; see report). Reputation is NEVER derived inside the scoring
 * package.
 */

import { emitAnalyticsEvent as defaultEmitAnalyticsEvent } from '../analytics/index.js';
import type { EmitAnalyticsEventInput } from '../analytics/index.js';

/** The four raw counters that drive reputation (mirror the `users` columns). */
export interface ReputationCounters {
  upvotesReceived: number;
  downvotesReceived: number;
  spamAttempts: number;
  songsSkipped: number;
}

export interface ReputationWeights {
  /** Positive signal: crowd upvoted this user's played/queued songs. */
  upvoteReceived: number;
  /** Mild negative: crowd downvoted this user's songs. */
  downvoteReceived: number;
  /** Strong negative: caught anti-spam friction (rapid-fire, cooldown abuse, group arrival). */
  spamAttempt: number;
  /** Negative: a song this user requested was skipped (venue skip or crowd-vote skip). */
  songSkipped: number;
}

/**
 * Default weights. Rationale:
 *  - upvoteReceived +1  — one point of goodwill per crowd upvote.
 *  - downvoteReceived −1 — symmetric mild penalty; the crowd disliked the pick.
 *  - songSkipped −2      — stronger: the song actually played and was rejected.
 *  - spamAttempt −5      — strongest: deliberate abuse should erode reputation fast.
 * All tunable; the scoring package is unaffected (it consumes the derived score).
 */
export const DEFAULT_REPUTATION_WEIGHTS: ReputationWeights = {
  upvoteReceived: 1,
  downvoteReceived: 1,
  spamAttempt: 5,
  songSkipped: 2,
};

/**
 * Reputation is clamped to a floor of 0. It is used downstream as a non-negative
 * standing/weight, and an unbounded-negative score would let a single heavily
 * penalised user distort weight math. New users start at 0 and can only earn up.
 */
export const REPUTATION_FLOOR = 0;

/** PURE. reputation = Σ(+upvotes) − downvotes − spam − skips, clamped at REPUTATION_FLOOR. */
export function computeReputationScore(
  counters: ReputationCounters,
  weights: ReputationWeights = DEFAULT_REPUTATION_WEIGHTS,
): number {
  const raw =
    weights.upvoteReceived * counters.upvotesReceived -
    weights.downvoteReceived * counters.downvotesReceived -
    weights.spamAttempt * counters.spamAttempts -
    weights.songSkipped * counters.songsSkipped;
  return Math.max(REPUTATION_FLOOR, raw);
}

const ZERO_COUNTERS: ReputationCounters = {
  upvotesReceived: 0,
  downvotesReceived: 0,
  spamAttempts: 0,
  songsSkipped: 0,
};

// ---------------------------------------------------------------------------
// Repository seam (implemented against the shared pool by callers; stub in tests)
// ---------------------------------------------------------------------------

export interface ReputationRepository {
  /** Current counters for a user; null if the user does not exist. */
  getCounters(userId: string): Promise<ReputationCounters | null>;
  /**
   * Atomically add the given deltas to the user's counters and return the new
   * totals. Only the supplied keys are incremented; missing keys are unchanged.
   */
  incrementCounters(
    userId: string,
    delta: Partial<ReputationCounters>,
  ): Promise<ReputationCounters>;
  /** Persist the recomputed reputation_score for a user. */
  setReputationScore(userId: string, score: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// updateReputation service — increment (optional) + recompute + persist + emit
// ---------------------------------------------------------------------------

export interface UpdateReputationInput {
  userId: string;
  /** Venue context for the analytics event. */
  venueId: string;
  /**
   * Counter deltas to apply before recomputing (e.g. `{ upvotesReceived: 1 }`
   * when a vote lands, `{ spamAttempts: 1 }` when friction trips). Omit/empty to
   * just recompute+persist from current counters.
   */
  delta?: Partial<ReputationCounters>;
  /** Free-text reason recorded in the analytics event metadata. */
  reason?: string;
}

export interface UpdateReputationDeps {
  reputationRepository: ReputationRepository;
  /** Defaults to the real analytics pipeline; override in tests. */
  emitEvent?: (event: EmitAnalyticsEventInput) => void;
  weights?: ReputationWeights;
  now?: () => Date;
}

export interface UpdateReputationResult {
  counters: ReputationCounters;
  reputationScore: number;
}

function hasDelta(delta?: Partial<ReputationCounters>): delta is Partial<ReputationCounters> {
  return !!delta && Object.values(delta).some((v) => typeof v === 'number' && v !== 0);
}

/**
 * Applies optional counter deltas, recomputes reputation, persists it, and emits
 * `reputation_updated`. Returns the resulting counters + score. The analytics
 * emit is fire-and-forget (never blocks); persistence of the score is awaited so
 * callers can rely on read-after-write.
 */
export async function updateReputation(
  input: UpdateReputationInput,
  deps: UpdateReputationDeps,
): Promise<UpdateReputationResult> {
  const emit = deps.emitEvent ?? defaultEmitAnalyticsEvent;
  const now = deps.now?.() ?? new Date();

  const counters = hasDelta(input.delta)
    ? await deps.reputationRepository.incrementCounters(input.userId, input.delta)
    : ((await deps.reputationRepository.getCounters(input.userId)) ?? ZERO_COUNTERS);

  const reputationScore = computeReputationScore(counters, deps.weights);
  await deps.reputationRepository.setReputationScore(input.userId, reputationScore);

  emit({
    eventType: 'reputation_updated',
    actorUserId: input.userId,
    venueId: input.venueId,
    queueItemId: null,
    metadata: {
      reputationScore,
      upvotesReceived: counters.upvotesReceived,
      downvotesReceived: counters.downvotesReceived,
      spamAttempts: counters.spamAttempts,
      songsSkipped: counters.songsSkipped,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    eventTimestamp: now,
  });

  return { counters, reputationScore };
}
