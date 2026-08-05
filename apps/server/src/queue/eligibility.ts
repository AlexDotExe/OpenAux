/**
 * Eligibility layer (SPEC.md §1 layer 1) — pure decision functions.
 *
 * "Can this song be in the live queue at all?" Binary gate. Every failure maps to
 * an ApiErrorCode from the API contract. No I/O and no clock reads: callers pass in
 * `now` and the repository-derived facts, so every rule is unit-testable without a DB.
 */

import type { ApiErrorCode } from '@openaux/shared';
import {
  DUPLICATE_LOCKOUT_MINUTES,
  MAX_ACTIVE_REQUESTS_PER_USER,
  REQUEST_COOLDOWN_MINUTES,
} from './constants.js';

export interface EligibilityTrack {
  artist: string;
  /** Provider genre tags for the track (any match against a blocked genre fails). */
  genres: string[];
  explicit: boolean;
}

export interface EligibilityVenue {
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
}

export interface EligibilitySession {
  isActive: boolean;
  /** Set once the session has lapsed (1h inactivity, WS6). */
  sessionExpiredAt: Date | null;
  activeRequestCount: number;
  lastRequestAt: Date | null;
}

export interface RequestEligibilityInput {
  now: Date;
  venue: EligibilityVenue;
  track: EligibilityTrack;
  session: EligibilitySession;
  /**
   * created_at of the most recent live/recent queue item for this venue+song, or null
   * if none. The repository restricts its lookup to the lockout window; the rule below
   * re-checks the window so it stays correct in isolation.
   */
  mostRecentSameSongAt: Date | null;
}

export interface EligibilityFailure {
  code: ApiErrorCode;
  message: string;
}

export type EligibilityResult = { eligible: true } | ({ eligible: false } & EligibilityFailure);

const MS_PER_MINUTE = 60_000;

function minutesBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_MINUTE;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Individual rules — each returns a failure or null (eligible for that rule).
// ---------------------------------------------------------------------------

/** Session must be active and not expired. */
export function checkSessionValidity(
  session: EligibilitySession,
  now: Date,
): EligibilityFailure | null {
  if (session.sessionExpiredAt !== null && session.sessionExpiredAt.getTime() <= now.getTime()) {
    return { code: 'session_expired', message: 'Your session has expired. Rejoin the venue.' };
  }
  if (!session.isActive) {
    return { code: 'session_invalid', message: 'Your session is no longer active.' };
  }
  return null;
}

/** Venue blocklists: artist, then genre, then explicit. */
export function checkVenueBlocks(
  track: EligibilityTrack,
  venue: EligibilityVenue,
): EligibilityFailure | null {
  const blockedArtists = new Set(venue.blockedArtists.map(normalize));
  if (blockedArtists.has(normalize(track.artist))) {
    return {
      code: 'venue_blocked_artist',
      message: `This venue doesn't play ${track.artist}.`,
    };
  }

  const blockedGenres = new Set(venue.blockedGenres.map(normalize));
  const hitGenre = track.genres.map(normalize).find((g) => blockedGenres.has(g));
  if (hitGenre !== undefined) {
    return {
      code: 'venue_blocked_genre',
      message: `This venue doesn't play ${hitGenre} tracks.`,
    };
  }

  if (venue.blockExplicit && track.explicit) {
    return { code: 'explicit_blocked', message: 'This venue blocks explicit tracks.' };
  }

  return null;
}

/** Same song not requestable more than once per DUPLICATE_LOCKOUT_MINUTES per venue. */
export function checkDuplicateLockout(
  mostRecentSameSongAt: Date | null,
  now: Date,
): EligibilityFailure | null {
  if (mostRecentSameSongAt === null) return null;
  if (minutesBetween(now, mostRecentSameSongAt) < DUPLICATE_LOCKOUT_MINUTES) {
    return {
      code: 'duplicate_locked',
      message: `This song was requested within the last ${DUPLICATE_LOCKOUT_MINUTES} minutes.`,
    };
  }
  return null;
}

/** Max active (queued) requests per user. */
export function checkMaxActiveRequests(activeRequestCount: number): EligibilityFailure | null {
  if (activeRequestCount >= MAX_ACTIVE_REQUESTS_PER_USER) {
    return {
      code: 'max_active_requests',
      message: `You already have ${MAX_ACTIVE_REQUESTS_PER_USER} active requests.`,
    };
  }
  return null;
}

/** One request per REQUEST_COOLDOWN_MINUTES per user. */
export function checkRequestCooldown(
  lastRequestAt: Date | null,
  now: Date,
): EligibilityFailure | null {
  if (lastRequestAt === null) return null;
  if (minutesBetween(now, lastRequestAt) < REQUEST_COOLDOWN_MINUTES) {
    return {
      code: 'request_cooldown',
      message: `Please wait ${REQUEST_COOLDOWN_MINUTES} minutes between requests.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aggregate gate — returns the first failing rule.
// ---------------------------------------------------------------------------

/**
 * Runs every request-eligibility rule in a fixed order and returns the first failure,
 * or `{ eligible: true }`. Order: session validity → venue blocks → duplicate lockout
 * → max active requests → request cooldown.
 */
export function checkRequestEligibility(input: RequestEligibilityInput): EligibilityResult {
  const failure =
    checkSessionValidity(input.session, input.now) ??
    checkVenueBlocks(input.track, input.venue) ??
    checkDuplicateLockout(input.mostRecentSameSongAt, input.now) ??
    checkMaxActiveRequests(input.session.activeRequestCount) ??
    checkRequestCooldown(input.session.lastRequestAt, input.now);

  if (failure) return { eligible: false, ...failure };
  return { eligible: true };
}
