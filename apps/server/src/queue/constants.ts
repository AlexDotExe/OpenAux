/**
 * V0 queue-core thresholds (SPEC.md §4, §5 V0 checklist).
 * All are per-venue configurable in later milestones; these are the global defaults.
 */

/** Max concurrent active (queued) requests per user (SPEC.md V0). */
export const MAX_ACTIVE_REQUESTS_PER_USER = 3;

/** Same song not requestable more than once per this window, per venue (SPEC.md V0). */
export const DUPLICATE_LOCKOUT_MINUTES = 45;

/** One request per this window, per user (SPEC.md anti-spam V0). */
export const REQUEST_COOLDOWN_MINUTES = 2;

/** Ordered "Up Next" list size in the queue snapshot (contract QueueSnapshot.upNext). */
export const UP_NEXT_SIZE = 3;

/** DJ-brain vibe constraint: avoid the same artist within the last N played songs. */
export const ARTIST_REPEAT_WINDOW = 3;

/** Fallback ETA input: average track length in minutes (position × this = ETA). */
export const DEFAULT_AVG_TRACK_MINUTES = 3.5;

// ---------------------------------------------------------------------------
// V1 scoring / playability / crowd-skip thresholds (SPEC.md §4 V1+, D3 / D12).
// ---------------------------------------------------------------------------

/**
 * A distinct independent supporter (a different user who requested the *same* song)
 * counts as 1.5× a plain upvote (SPEC.md §5 V1). We fold the +0.5 excess over a normal
 * upvote into the effective upvote count fed to the V1 net-votes term.
 */
export const DISTINCT_SUPPORTER_MULTIPLIER = 1.5;

/**
 * Fraction of "what's needed to win" a paid boost may buy (SPEC.md §4: cap ≈ 25–40%).
 * Mid-range so the crowd can always out-vote paid boosts.
 */
export const PAID_POINTS_CAP_FRACTION = 0.33;

/**
 * Minimum paid-points cap so a single Priority Boost still counts early in a session,
 * when there is little live demand to measure "what's needed to win" against. One Instant
 * Play Vote's worth (4 points).
 */
export const PAID_POINTS_CAP_FLOOR = 4;

/** Min-vote gate is only ACTIVE at/above this many active users (SPEC.md §4 / D3). */
export const GATE_MIN_ACTIVE_USERS = 10;

/** Min-vote gate: absolute upvotes required to play at scale (SPEC.md §4). */
export const MIN_VOTE_UPVOTES = 6;

/** Min-vote gate: minimum positive ratio up/(up+down) required at scale (SPEC.md §4). */
export const MIN_VOTE_RATIO = 0.6;

/**
 * Demand override: an item backed by ≥70% of active users bypasses the min-vote gate
 * (SPEC.md §5 V1 / D3) — overwhelming crowd demand always plays.
 */
export const DEMAND_OVERRIDE_FRACTION = 0.7;

/**
 * Crowd-skip: fraction of active users whose skip-votes force the now-playing song out.
 * A simple majority of the room.
 */
export const CROWD_SKIP_FRACTION = 0.5;

/**
 * Crowd-skip floor: minimum skip-votes required regardless of crowd size, so a tiny room
 * can't skip a song on one or two taps.
 */
export const CROWD_SKIP_MIN_VOTES = 3;
