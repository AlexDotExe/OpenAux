import { describe, expect, it, vi } from 'vitest';
import type { Session, User, Venue } from '@openaux/shared';
import { joinSession } from './service.js';
import type { SessionRepository } from './repository.js';
import { AuthVerificationError, type AuthVerifier } from './auth.js';
import type { AnalyticsEventEmitter } from './analytics.js';

const VENUE: Venue = {
  venueId: 'venue-1',
  ownerId: null,
  name: 'The Alibi',
  musicProvider: 'spotify',
  controlMode: 'crowd',
  qrToken: 'qr-abc',
  blockExplicit: false,
  blockedGenres: [],
  blockedArtists: [],
  scoringWeightsOverride: null,
  fallbackPlaylist: [],
  anthemProvider: null,
  anthemProviderTrackId: null,
  anthemTitle: null,
  anthemArtist: null,
  anthemPromoText: null,
  anthemPromoDurationMinutes: null,
  stripeAccountId: null,
  playbackDeviceId: null,
  powerHourGenre: null,
  powerHourMultiplier: null,
  powerHourEndsAt: null,
  latitude: null,
  longitude: null,
  geofenceRadiusM: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function makeGuestUser(id: string): User {
  return {
    userId: id,
    displayName: `Guest ${id}`,
    authProvider: 'guest',
    creditBalance: 0,
    influenceScore: 0,
    reputationScore: 0,
    upvotesReceived: 0,
    downvotesReceived: 0,
    spamAttempts: 0,
    songsSkipped: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeSession(over: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    venueId: VENUE.venueId,
    joinedAt: new Date('2026-01-01T00:00:00Z'),
    lastActiveAt: new Date('2026-01-01T00:00:00Z'),
    isGuest: true,
    isActive: true,
    sessionExpiredAt: null,
    activeRequestCount: 0,
    cooldownEndsAt: null,
    lastVoteAt: null,
    lastRequestAt: null,
    joinLatitude: null,
    joinLongitude: null,
    ...over,
  };
}

/** Minimal in-memory stub satisfying SessionRepository — no DB required. */
function makeRepository(over: Partial<SessionRepository> = {}): SessionRepository {
  return {
    findVenueByQrToken: vi.fn(async (qrToken: string) =>
      qrToken === VENUE.qrToken ? VENUE : null,
    ),
    findActiveSession: vi.fn(async () => null),
    createGuestUser: vi.fn(async (displayName: string) => makeGuestUser(displayName)),
    findOrCreateAuthedUser: vi.fn(async (_provider, subject: string, displayName: string) => ({
      userId: subject,
      displayName,
      authProvider: 'google' as const,
      creditBalance: 0,
      influenceScore: 0,
      reputationScore: 0,
      upvotesReceived: 0,
      downvotesReceived: 0,
      spamAttempts: 0,
      songsSkipped: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })),
    createSession: vi.fn(
      async (
        userId: string,
        venueId: string,
        isGuest: boolean,
        location?: { joinLatitude: number | null; joinLongitude: number | null },
      ) =>
        makeSession({
          userId,
          venueId,
          isGuest,
          joinLatitude: location?.joinLatitude ?? null,
          joinLongitude: location?.joinLongitude ?? null,
        }),
    ),
    touchSession: vi.fn(async () => undefined),
    findActiveSessions: vi.fn(async () => []),
    expireSession: vi.fn(async () => undefined),
    ...over,
  };
}

function makeAnalytics(): AnalyticsEventEmitter & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    emitAnalyticsEvent(input) {
      calls.push(input);
    },
  };
}

describe('joinSession — eligibility', () => {
  it('rejects an unknown QR token with not_found', async () => {
    const repository = makeRepository();
    const result = await joinSession({ venueQrToken: 'does-not-exist' }, { repository });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
    expect(repository.createGuestUser).not.toHaveBeenCalled();
  });

  it('resolves a valid QR token to its venue', async () => {
    const repository = makeRepository();
    const result = await joinSession({ venueQrToken: VENUE.qrToken }, { repository });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.venue.venueId).toBe(VENUE.venueId);
  });
});

describe('joinSession — guest identity', () => {
  it('auto-creates a guest user when no authToken is supplied', async () => {
    const repository = makeRepository();
    const result = await joinSession({ venueQrToken: VENUE.qrToken }, { repository });

    expect(repository.createGuestUser).toHaveBeenCalledTimes(1);
    expect(repository.findOrCreateAuthedUser).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.isGuest).toBe(true);
  });

  it('creates a new active session and emits user_session_started for a fresh guest join', async () => {
    const repository = makeRepository();
    const analytics = makeAnalytics();
    const result = await joinSession({ venueQrToken: VENUE.qrToken }, { repository, analytics });

    expect(result.ok).toBe(true);
    expect(repository.createSession).toHaveBeenCalledTimes(1);
    expect(analytics.calls).toEqual([
      expect.objectContaining({ eventType: 'user_session_started', metadata: { isGuest: true } }),
    ]);
  });

  it('reuses an existing active session instead of creating a new one, and does not re-emit user_session_started', async () => {
    const existing = makeSession({ sessionId: 'existing-session' });
    const repository = makeRepository({
      findActiveSession: vi.fn(async () => existing),
    });
    const analytics = makeAnalytics();
    const now = () => new Date('2026-01-01T01:00:00Z');

    const result = await joinSession(
      { venueQrToken: VENUE.qrToken },
      { repository, analytics, now },
    );

    expect(repository.createSession).not.toHaveBeenCalled();
    expect(repository.touchSession).toHaveBeenCalledWith('existing-session', now());
    expect(analytics.calls).toEqual([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.sessionId).toBe('existing-session');
  });
});

describe('joinSession — authToken seam', () => {
  it('rejects with unauthorized when the injected verifier fails', async () => {
    const repository = makeRepository();
    const authVerifier: AuthVerifier = {
      verify: vi.fn(async () => {
        throw new AuthVerificationError('bad token');
      }),
    };

    const result = await joinSession(
      { venueQrToken: VENUE.qrToken, authToken: 'opaque-token' },
      { repository, authVerifier },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unauthorized');
    expect(repository.createGuestUser).not.toHaveBeenCalled();
  });

  it('the default unimplementedAuthVerifier rejects any authToken (documents the stub seam)', async () => {
    const repository = makeRepository();
    const result = await joinSession(
      { venueQrToken: VENUE.qrToken, authToken: 'whatever' },
      { repository },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unauthorized');
  });

  it('resolves an authed user via the injected verifier on success', async () => {
    const repository = makeRepository();
    const authVerifier: AuthVerifier = {
      verify: vi.fn(async () => ({
        provider: 'google' as const,
        subject: 'google-subject-1',
        displayName: 'Real User',
      })),
    };

    const result = await joinSession(
      { venueQrToken: VENUE.qrToken, authToken: 'opaque-token' },
      { repository, authVerifier },
    );

    expect(result.ok).toBe(true);
    expect(repository.findOrCreateAuthedUser).toHaveBeenCalledWith(
      'google',
      'google-subject-1',
      'Real User',
    );
    if (result.ok) expect(result.session.isGuest).toBe(false);
  });
});

describe('joinSession — location verification (SPEC.md §5/§7)', () => {
  const GEOFENCED_VENUE: Venue = {
    ...VENUE,
    latitude: 40.0,
    longitude: -74.0,
    geofenceRadiusM: 100,
  };

  it('allows the join when the venue has no geofence configured, regardless of coords', async () => {
    const repository = makeRepository();
    const result = await joinSession({ venueQrToken: VENUE.qrToken }, { repository });
    expect(result.ok).toBe(true);
  });

  it('rejects with outside_geofence when the venue has a geofence and no coords were supplied', async () => {
    const repository = makeRepository({
      findVenueByQrToken: vi.fn(async () => GEOFENCED_VENUE),
    });
    const result = await joinSession({ venueQrToken: VENUE.qrToken }, { repository });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('outside_geofence');
    expect(repository.createGuestUser).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it('rejects with outside_geofence when the patron coords are outside the radius', async () => {
    const repository = makeRepository({
      findVenueByQrToken: vi.fn(async () => GEOFENCED_VENUE),
    });
    const result = await joinSession(
      { venueQrToken: VENUE.qrToken, latitude: 41.0, longitude: -75.0 },
      { repository },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('outside_geofence');
  });

  it('allows and persists join coords when the patron is within the radius', async () => {
    const repository = makeRepository({
      findVenueByQrToken: vi.fn(async () => GEOFENCED_VENUE),
    });
    const result = await joinSession(
      { venueQrToken: VENUE.qrToken, latitude: 40.0001, longitude: -74.0001 },
      { repository },
    );
    expect(result.ok).toBe(true);
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.any(String),
      GEOFENCED_VENUE.venueId,
      true,
      { joinLatitude: 40.0001, joinLongitude: -74.0001 },
    );
    if (result.ok) {
      expect(result.session.joinLatitude).toBe(40.0001);
      expect(result.session.joinLongitude).toBe(-74.0001);
    }
  });
});
