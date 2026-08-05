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
