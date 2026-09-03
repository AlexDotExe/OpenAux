import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@openaux/shared';
import { isSessionExpired, sweepExpiredSessions, SESSION_EXPIRY_MS } from './lifecycle.js';
import type { SweepRepository } from './lifecycle.js';
import type { AnalyticsEventEmitter } from './analytics.js';

function makeSession(over: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    venueId: 'venue-1',
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

describe('isSessionExpired', () => {
  const lastActiveAt = new Date('2026-01-01T00:00:00Z');

  it('is false right at joined_at', () => {
    expect(isSessionExpired(makeSession({ lastActiveAt }), lastActiveAt)).toBe(false);
  });

  it('is false just under the 1-hour threshold', () => {
    const now = new Date(lastActiveAt.getTime() + SESSION_EXPIRY_MS - 1);
    expect(isSessionExpired(makeSession({ lastActiveAt }), now)).toBe(false);
  });

  it('is true exactly at the 1-hour threshold', () => {
    const now = new Date(lastActiveAt.getTime() + SESSION_EXPIRY_MS);
    expect(isSessionExpired(makeSession({ lastActiveAt }), now)).toBe(true);
  });

  it('is true well past the threshold', () => {
    const now = new Date(lastActiveAt.getTime() + SESSION_EXPIRY_MS * 3);
    expect(isSessionExpired(makeSession({ lastActiveAt }), now)).toBe(true);
  });

  it('is false for a session that is already inactive, regardless of age', () => {
    const now = new Date(lastActiveAt.getTime() + SESSION_EXPIRY_MS * 10);
    expect(isSessionExpired(makeSession({ lastActiveAt, isActive: false }), now)).toBe(false);
  });

  it('respects a custom expiryMs', () => {
    const now = new Date(lastActiveAt.getTime() + 5000);
    expect(isSessionExpired(makeSession({ lastActiveAt }), now, 10_000)).toBe(false);
    expect(isSessionExpired(makeSession({ lastActiveAt }), now, 1000)).toBe(true);
  });
});

describe('sweepExpiredSessions', () => {
  function makeRepo(sessions: Session[]): SweepRepository {
    return {
      findActiveSessions: vi.fn(async () => sessions),
      expireSession: vi.fn(async () => undefined),
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

  it('expires only sessions past the inactivity threshold', async () => {
    const now = new Date('2026-01-01T02:00:00Z');
    const stale = makeSession({
      sessionId: 'stale',
      lastActiveAt: new Date('2026-01-01T00:00:00Z'),
    });
    const fresh = makeSession({
      sessionId: 'fresh',
      lastActiveAt: new Date('2026-01-01T01:45:00Z'),
    });
    const repository = makeRepo([stale, fresh]);

    const expired = await sweepExpiredSessions({ repository, now });

    expect(expired.map((s) => s.sessionId)).toEqual(['stale']);
    expect(repository.expireSession).toHaveBeenCalledTimes(1);
    expect(repository.expireSession).toHaveBeenCalledWith('stale', now);
  });

  it('emits user_session_expired for each newly expired session', async () => {
    const now = new Date('2026-01-01T02:00:00Z');
    const stale = makeSession({
      sessionId: 'stale',
      userId: 'user-9',
      venueId: 'venue-9',
      lastActiveAt: new Date('2026-01-01T00:00:00Z'),
    });
    const repository = makeRepo([stale]);
    const analytics = makeAnalytics();

    await sweepExpiredSessions({ repository, analytics, now });

    expect(analytics.calls).toEqual([
      {
        eventType: 'user_session_expired',
        actorUserId: 'user-9',
        venueId: 'venue-9',
        queueItemId: null,
        metadata: { sessionId: 'stale', isGuest: true },
      },
    ]);
  });

  it('calls onSessionExpired once per expired session so realtime can notify clients', async () => {
    const now = new Date('2026-01-01T02:00:00Z');
    const stale = makeSession({
      sessionId: 'stale',
      lastActiveAt: new Date('2026-01-01T00:00:00Z'),
    });
    const repository = makeRepo([stale]);
    const onSessionExpired = vi.fn();

    await sweepExpiredSessions({ repository, onSessionExpired, now });

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledWith(stale);
  });

  it('is a no-op when nothing is expired', async () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const fresh = makeSession({ lastActiveAt: new Date('2026-01-01T00:00:00Z') });
    const repository = makeRepo([fresh]);

    const expired = await sweepExpiredSessions({ repository, now });

    expect(expired).toEqual([]);
    expect(repository.expireSession).not.toHaveBeenCalled();
  });
});
