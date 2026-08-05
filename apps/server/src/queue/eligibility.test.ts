import { describe, expect, it } from 'vitest';
import {
  checkDuplicateLockout,
  checkMaxActiveRequests,
  checkRequestCooldown,
  checkRequestEligibility,
  checkSessionValidity,
  checkVenueBlocks,
  type EligibilitySession,
  type EligibilityTrack,
  type EligibilityVenue,
  type RequestEligibilityInput,
} from './eligibility.js';

const NOW = new Date('2026-07-24T21:00:00.000Z');
function minutesAgo(mins: number): Date {
  return new Date(NOW.getTime() - mins * 60_000);
}

const openVenue: EligibilityVenue = {
  blockExplicit: false,
  blockedGenres: [],
  blockedArtists: [],
};
const cleanTrack: EligibilityTrack = { artist: 'Daft Punk', genres: ['house'], explicit: false };
const validSession: EligibilitySession = {
  isActive: true,
  sessionExpiredAt: null,
  activeRequestCount: 0,
  lastRequestAt: null,
};

function input(over: Partial<RequestEligibilityInput> = {}): RequestEligibilityInput {
  return {
    now: NOW,
    venue: openVenue,
    track: cleanTrack,
    session: validSession,
    mostRecentSameSongAt: null,
    ...over,
  };
}

describe('checkSessionValidity', () => {
  it('passes for an active, unexpired session', () => {
    expect(checkSessionValidity(validSession, NOW)).toBeNull();
  });

  it('rejects an inactive session as session_invalid', () => {
    expect(checkSessionValidity({ ...validSession, isActive: false }, NOW)?.code).toBe(
      'session_invalid',
    );
  });

  it('rejects an expired session as session_expired', () => {
    const s = { ...validSession, sessionExpiredAt: minutesAgo(1) };
    expect(checkSessionValidity(s, NOW)?.code).toBe('session_expired');
  });

  it('prefers session_expired over session_invalid when both apply', () => {
    const s = { ...validSession, isActive: false, sessionExpiredAt: minutesAgo(1) };
    expect(checkSessionValidity(s, NOW)?.code).toBe('session_expired');
  });
});

describe('checkVenueBlocks', () => {
  it('passes when nothing is blocked', () => {
    expect(checkVenueBlocks(cleanTrack, openVenue)).toBeNull();
  });

  it('blocks a blocked artist case-insensitively', () => {
    const venue = { ...openVenue, blockedArtists: ['daft punk'] };
    expect(checkVenueBlocks({ ...cleanTrack, artist: 'Daft Punk' }, venue)?.code).toBe(
      'venue_blocked_artist',
    );
  });

  it('blocks a blocked genre case-insensitively', () => {
    const venue = { ...openVenue, blockedGenres: ['HOUSE'] };
    expect(checkVenueBlocks(cleanTrack, venue)?.code).toBe('venue_blocked_genre');
  });

  it('blocks explicit tracks only when blockExplicit is set', () => {
    const explicit = { ...cleanTrack, explicit: true };
    expect(checkVenueBlocks(explicit, openVenue)).toBeNull();
    expect(checkVenueBlocks(explicit, { ...openVenue, blockExplicit: true })?.code).toBe(
      'explicit_blocked',
    );
  });

  it('prioritizes artist over genre over explicit', () => {
    const venue = {
      blockExplicit: true,
      blockedGenres: ['house'],
      blockedArtists: ['daft punk'],
    };
    expect(checkVenueBlocks({ ...cleanTrack, explicit: true }, venue)?.code).toBe(
      'venue_blocked_artist',
    );
  });
});

describe('checkDuplicateLockout', () => {
  it('passes when the song was never requested', () => {
    expect(checkDuplicateLockout(null, NOW)).toBeNull();
  });

  it('locks a song requested 44 minutes ago', () => {
    expect(checkDuplicateLockout(minutesAgo(44), NOW)?.code).toBe('duplicate_locked');
  });

  it('allows a song requested 45 minutes ago (window elapsed)', () => {
    expect(checkDuplicateLockout(minutesAgo(45), NOW)).toBeNull();
  });
});

describe('checkMaxActiveRequests', () => {
  it('passes below the cap', () => {
    expect(checkMaxActiveRequests(2)).toBeNull();
  });

  it('rejects at the cap of 3', () => {
    expect(checkMaxActiveRequests(3)?.code).toBe('max_active_requests');
  });
});

describe('checkRequestCooldown', () => {
  it('passes with no prior request', () => {
    expect(checkRequestCooldown(null, NOW)).toBeNull();
  });

  it('rejects within the 2-minute cooldown', () => {
    expect(checkRequestCooldown(minutesAgo(1), NOW)?.code).toBe('request_cooldown');
  });

  it('passes once the cooldown elapses', () => {
    expect(checkRequestCooldown(minutesAgo(2), NOW)).toBeNull();
  });
});

describe('checkRequestEligibility (aggregate order)', () => {
  it('returns eligible for a clean request', () => {
    expect(checkRequestEligibility(input())).toEqual({ eligible: true });
  });

  it('checks session validity first', () => {
    const result = checkRequestEligibility(
      input({
        session: { ...validSession, isActive: false },
        venue: { ...openVenue, blockedArtists: ['daft punk'] },
      }),
    );
    expect(result).toMatchObject({ eligible: false, code: 'session_invalid' });
  });

  it('checks venue blocks before duplicate lockout', () => {
    const result = checkRequestEligibility(
      input({
        venue: { ...openVenue, blockedArtists: ['daft punk'] },
        mostRecentSameSongAt: minutesAgo(1),
      }),
    );
    expect(result).toMatchObject({ eligible: false, code: 'venue_blocked_artist' });
  });

  it('checks duplicate lockout before per-user limits', () => {
    const result = checkRequestEligibility(
      input({
        mostRecentSameSongAt: minutesAgo(1),
        session: { ...validSession, activeRequestCount: 3, lastRequestAt: minutesAgo(0) },
      }),
    );
    expect(result).toMatchObject({ eligible: false, code: 'duplicate_locked' });
  });

  it('checks max active requests before cooldown', () => {
    const result = checkRequestEligibility(
      input({
        session: { ...validSession, activeRequestCount: 3, lastRequestAt: minutesAgo(0) },
      }),
    );
    expect(result).toMatchObject({ eligible: false, code: 'max_active_requests' });
  });

  it('falls through to cooldown last', () => {
    const result = checkRequestEligibility(
      input({ session: { ...validSession, lastRequestAt: minutesAgo(1) } }),
    );
    expect(result).toMatchObject({ eligible: false, code: 'request_cooldown' });
  });
});
