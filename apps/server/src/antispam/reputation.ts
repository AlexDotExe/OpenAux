/**
 * Reputation v1 (SPEC.md §5 V1: "Reputation-based weighting v1") extended by
 * Reputation v2 (SPEC.md §5 V2: "+ songs played, + time in venue — reward all
 * engagement").
 *
 *   reputation_score = + upvotes received
 *                      − downvotes received
 *                      − spam attempts
 *                      − songs skipped (venue skip or crowd-vote skip)
 *                      + songs played              (v2)
 *                      + time in venue, per minute (v2)
 *
 * v1 was purely punitive above the upvote term: the only way to gain standing was
 * to be voted up. v2 also rewards showing up and having your picks actually play,
 * so a regular who never games the system accrues standing over the night.
 *
 * The formula is PURE (no I/O, no clock). Persistence + analytics live in the
 * `updateReputation` service, which reads/increments the per-user counters via a
 * stub-able `ReputationRepository`, recomputes the score, writes it back, and
 * emits a `reputation_updated` analytics event. `recordEngagement` is the v2
 * entry point for the two engagement counters.
 *
 * Layering: reputation is an anti-spam / skip-risk input. It is recomputed here
 * and passed into the scoring engine (never computed inside ranking). It feeds
 * the V1 model's `skipRisk` term — higher reputation ⇒ lower skip risk (WS3 maps
 * score → skipRisk; see report). Reputation is NEVER derived inside the scoring
 * package.
 */

import { emitAnalyticsEvent as defaultEmitAnalyticsEvent } from '../analytics/index.js';
import type { EmitAnalyticsEventInput } from '../analytics/index.js';

/** The raw counters that drive reputation (mirror the `users` columns). */
export interface ReputationCounters {
  upvotesReceived: number;
  downvotesReceived: number;
  spamAttempts: number;
  songsSkipped: number;
  /** v2: this user's requests that actually played. */
  songsPlayed: number;
  /** v2: cumulative active session time, in whole seconds. */
  timeInVenueSeconds: number;
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
  /** v2 positive: a song this user requested actually played. */
  songPlayed: number;
  /** v2 positive, applied per MINUTE of `timeInVenueSeconds` (not per second). */
  timeInVenuePerMinute: number;
}

/**
 * Default weights. Rationale:
 *  - upvoteReceived +1  — one point of goodwill per crowd upvote.
 *  - downvoteReceived −1 — symmetric mild penalty; the crowd disliked the pick.
 *  - songSkipped −2      — stronger: the song actually played and was rejected.
 *  - spamAttempt −5      — strongest: deliberate abuse should erode reputation fast.
 *  - songPlayed +3 (v2)  — strongest positive: the user picked something the room
 *    let run to completion. Deliberately outweighs one songSkipped (−2), so a
 *    patron whose picks mostly land stays net-positive despite the odd skip.
 *  - timeInVenuePerMinute +0.1 (v2) — presence is real but passive engagement, so
 *    it accrues slowly: 10 minutes ≈ 1 upvote, a full hour ≈ 2 played songs. Kept
 *    small on purpose — merely camping in a venue must never out-earn crowd
 *    signal, and it is the one term a user can accumulate without participating.
 * All tunable; the scoring package is unaffected (it consumes the derived score).
 */
export const DEFAULT_REPUTATION_WEIGHTS: ReputationWeights = {
  upvoteReceived: 1,
  downvoteReceived: 1,
  spamAttempt: 5,
  songSkipped: 2,
  songPlayed: 3,
  timeInVenuePerMinute: 0.1,
};

/** `timeInVenueSeconds` is stored in seconds but weighted per minute. */
const SECONDS_PER_MINUTE = 60;

/**
 * Reputation is clamped to a floor of 0. It is used downstream as a non-negative
 * standing/weight, and an unbounded-negative score would let a single heavily
 * penalised user distort weight math. New users start at 0 and can only earn up.
 */
export const REPUTATION_FLOOR = 0;

/**
 * PURE. reputation = Σ(+upvotes) − downvotes − spam − skips + played + minutes,
 * clamped at REPUTATION_FLOOR.
 */
export function computeReputationScore(
  counters: ReputationCounters,
  weights: ReputationWeights = DEFAULT_REPUTATION_WEIGHTS,
): number {
  const raw =
    weights.upvoteReceived * counters.upvotesReceived -
    weights.downvoteReceived * counters.downvotesReceived -
    weights.spamAttempt * counters.spamAttempts -
    weights.songSkipped * counters.songsSkipped +
    weights.songPlayed * counters.songsPlayed +
    weights.timeInVenuePerMinute * (counters.timeInVenueSeconds / SECONDS_PER_MINUTE);
  return Math.max(REPUTATION_FLOOR, raw);
}

const ZERO_COUNTERS: ReputationCounters = {
  upvotesReceived: 0,
  downvotesReceived: 0,
  spamAttempts: 0,
  songsSkipped: 0,
  songsPlayed: 0,
  timeInVenueSeconds: 0,
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
  /** Optional queue item the update is attributable to (e.g. the song that played). */
  queueItemId?: string | null;
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
    queueItemId: input.queueItemId ?? null,
    metadata: {
      reputationScore,
      upvotesReceived: counters.upvotesReceived,
      downvotesReceived: counters.downvotesReceived,
      spamAttempts: counters.spamAttempts,
      songsSkipped: counters.songsSkipped,
      songsPlayed: counters.songsPlayed,
      timeInVenueSeconds: counters.timeInVenueSeconds,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    eventTimestamp: now,
  });

  return { counters, reputationScore };
}

// ---------------------------------------------------------------------------
// recordEngagement — Reputation v2 entry point (SPEC.md §5 V2)
// ---------------------------------------------------------------------------

export interface RecordEngagementInput {
  userId: string;
  venueId: string;
  /**
   * Number of this user's requested songs that just played. Normally 1, from the
   * queue item's transition to `played`.
   */
  songsPlayed?: number;
  /**
   * Seconds of venue time to add — e.g. a finished session's duration. Rounded to
   * a whole second because the `users.time_in_venue_seconds` column is an integer.
   */
  timeInVenueSeconds?: number;
  /** Free-text reason for the analytics event (defaults to `engagement_recorded`). */
  reason?: string;
  /** The queue item that played, when this is a song-played increment. */
  queueItemId?: string | null;
}

/**
 * Records positive engagement (songs played and/or time in venue), then
 * recomputes, persists, and emits exactly as `updateReputation` does — this is a
 * thin, intention-revealing wrapper over it, so there is still ONE recompute path.
 *
 * Engagement is additive only: negative or non-finite amounts are dropped rather
 * than allowed to decrement a counter (reputation is docked through the v1
 * penalty counters, never by rewinding engagement). An all-zero call degrades to
 * `updateReputation`'s recompute-only read path.
 */
export async function recordEngagement(
  input: RecordEngagementInput,
  deps: UpdateReputationDeps,
): Promise<UpdateReputationResult> {
  const songsPlayed = normalizeEngagementAmount(input.songsPlayed);
  const timeInVenueSeconds = normalizeEngagementAmount(input.timeInVenueSeconds);

  return updateReputation(
    {
      userId: input.userId,
      venueId: input.venueId,
      delta: { songsPlayed, timeInVenueSeconds },
      reason: input.reason ?? 'engagement_recorded',
      queueItemId: input.queueItemId ?? null,
    },
    deps,
  );
}

/** Non-finite/negative ⇒ 0; otherwise rounded to a whole unit (both columns are integers). */
function normalizeEngagementAmount(amount: number | undefined): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount);
}
