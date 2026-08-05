/**
 * Vote-rate limiting helper for other workstreams (mainly WS3's vote endpoint).
 *
 * Session (db/schema.sql) only carries a single `last_vote_at` timestamp, not a
 * rolling per-window vote count — so the hard gate here is session-liveness plus
 * a minimum spacing between votes (guards against double-fire/spam-clicking).
 * The softer ">3 votes / 10min" signal from SPEC.md §4 is a *scoring* penalty,
 * not a hard block — see `friction.ts` (`computeSpamPenalty`), which reads full
 * vote history via VoteActivityRepository.
 */

import { checkSessionExpiry, SESSION_EXPIRY_MS } from './cooldown.js';

/** Minimum time between two votes from the same session (anti double-click). */
export const DEFAULT_MIN_VOTE_INTERVAL_MS = 2000;

export interface VoteAllowedSessionFields {
  isActive: boolean;
  lastActiveAt: Date;
  lastVoteAt: Date | null;
}

export type VoteDeniedReason = 'session_inactive' | 'session_expired' | 'vote_rate_limited';

export interface VoteAllowedDecision {
  allowed: boolean;
  reason: VoteDeniedReason | null;
  /** Milliseconds until the caller may retry; 0 when allowed or denial isn't time-based. */
  retryAfterMs: number;
}

export interface CheckVoteAllowedOptions {
  sessionExpiryMs?: number;
  minVoteIntervalMs?: number;
}

export function checkVoteAllowed(
  session: VoteAllowedSessionFields,
  now: Date,
  options: CheckVoteAllowedOptions = {},
): VoteAllowedDecision {
  const sessionExpiryMs = options.sessionExpiryMs ?? SESSION_EXPIRY_MS;
  const minVoteIntervalMs = options.minVoteIntervalMs ?? DEFAULT_MIN_VOTE_INTERVAL_MS;

  if (!session.isActive) {
    return { allowed: false, reason: 'session_inactive', retryAfterMs: 0 };
  }

  const { expired } = checkSessionExpiry(session, now, sessionExpiryMs);
  if (expired) {
    return { allowed: false, reason: 'session_expired', retryAfterMs: 0 };
  }

  if (session.lastVoteAt) {
    const elapsed = now.getTime() - session.lastVoteAt.getTime();
    if (elapsed < minVoteIntervalMs) {
      return {
        allowed: false,
        reason: 'vote_rate_limited',
        retryAfterMs: minVoteIntervalMs - elapsed,
      };
    }
  }

  return { allowed: true, reason: null, retryAfterMs: 0 };
}
