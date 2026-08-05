import { describe, expect, it } from 'vitest';
import { checkVoteAllowed, DEFAULT_MIN_VOTE_INTERVAL_MS } from './vote-rate-limit.js';

describe('checkVoteAllowed', () => {
  const now = new Date('2026-07-24T22:00:00Z');

  it('denies when the session is inactive', () => {
    const decision = checkVoteAllowed(
      { isActive: false, lastActiveAt: now, lastVoteAt: null },
      now,
    );
    expect(decision).toEqual({ allowed: false, reason: 'session_inactive', retryAfterMs: 0 });
  });

  it('denies when the session has expired from inactivity', () => {
    const lastActiveAt = new Date(now.getTime() - 61 * 60 * 1000);
    const decision = checkVoteAllowed({ isActive: true, lastActiveAt, lastVoteAt: null }, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('session_expired');
  });

  it('allows a first-ever vote (no lastVoteAt) on a live session', () => {
    const decision = checkVoteAllowed({ isActive: true, lastActiveAt: now, lastVoteAt: null }, now);
    expect(decision).toEqual({ allowed: true, reason: null, retryAfterMs: 0 });
  });

  it('denies a vote inside the minimum interval and reports retryAfterMs', () => {
    const lastVoteAt = new Date(now.getTime() - 500);
    const decision = checkVoteAllowed({ isActive: true, lastActiveAt: now, lastVoteAt }, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('vote_rate_limited');
    expect(decision.retryAfterMs).toBe(DEFAULT_MIN_VOTE_INTERVAL_MS - 500);
  });

  it('allows a vote once the minimum interval has elapsed', () => {
    const lastVoteAt = new Date(now.getTime() - DEFAULT_MIN_VOTE_INTERVAL_MS);
    const decision = checkVoteAllowed({ isActive: true, lastActiveAt: now, lastVoteAt }, now);
    expect(decision.allowed).toBe(true);
  });

  it('honors a custom minVoteIntervalMs', () => {
    const lastVoteAt = new Date(now.getTime() - 100);
    const decision = checkVoteAllowed({ isActive: true, lastActiveAt: now, lastVoteAt }, now, {
      minVoteIntervalMs: 50,
    });
    expect(decision.allowed).toBe(true);
  });
});
