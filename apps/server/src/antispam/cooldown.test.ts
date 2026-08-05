import { describe, expect, it } from 'vitest';
import {
  checkRequestCooldown,
  checkSessionExpiry,
  computeNextCooldownEndsAt,
  REQUEST_COOLDOWN_MS,
  SESSION_EXPIRY_MS,
} from './cooldown.js';

describe('checkRequestCooldown', () => {
  it('allows a request when cooldownEndsAt is null', () => {
    const decision = checkRequestCooldown(
      { cooldownEndsAt: null },
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterMs).toBe(0);
  });

  it('allows a request once cooldownEndsAt has passed', () => {
    const now = new Date('2026-01-01T00:02:00Z');
    const decision = checkRequestCooldown(
      { cooldownEndsAt: new Date('2026-01-01T00:01:59Z') },
      now,
    );
    expect(decision.allowed).toBe(true);
  });

  it('allows a request exactly at cooldownEndsAt (inclusive boundary)', () => {
    const now = new Date('2026-01-01T00:02:00Z');
    const decision = checkRequestCooldown({ cooldownEndsAt: now }, now);
    expect(decision.allowed).toBe(true);
  });

  it('denies a request still inside the cooldown window and reports retryAfterMs', () => {
    const now = new Date('2026-01-01T00:00:30Z');
    const cooldownEndsAt = new Date('2026-01-01T00:02:00Z');
    const decision = checkRequestCooldown({ cooldownEndsAt }, now);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(90_000);
    expect(decision.cooldownEndsAt).toEqual(cooldownEndsAt);
  });
});

describe('computeNextCooldownEndsAt', () => {
  it('adds the 2-minute default cooldown to now', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(computeNextCooldownEndsAt(now)).toEqual(new Date(now.getTime() + REQUEST_COOLDOWN_MS));
    expect(REQUEST_COOLDOWN_MS).toBe(2 * 60 * 1000);
  });

  it('honors a custom cooldown duration', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(computeNextCooldownEndsAt(now, 5000)).toEqual(new Date(now.getTime() + 5000));
  });
});

describe('checkSessionExpiry', () => {
  it('is not expired within the 1h inactivity window', () => {
    const lastActiveAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:59:59Z');
    const decision = checkSessionExpiry({ isActive: true, lastActiveAt }, now);
    expect(decision.expired).toBe(false);
    expect(decision.expiresAt).toEqual(new Date(lastActiveAt.getTime() + SESSION_EXPIRY_MS));
  });

  it('expires exactly at the 1h boundary', () => {
    const lastActiveAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date(lastActiveAt.getTime() + SESSION_EXPIRY_MS);
    expect(checkSessionExpiry({ isActive: true, lastActiveAt }, now).expired).toBe(true);
  });

  it('expires past the 1h boundary', () => {
    const lastActiveAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T01:00:01Z');
    expect(checkSessionExpiry({ isActive: true, lastActiveAt }, now).expired).toBe(true);
  });

  it('treats an already-inactive session as expired regardless of timing', () => {
    const lastActiveAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:00:01Z');
    expect(checkSessionExpiry({ isActive: false, lastActiveAt }, now).expired).toBe(true);
  });

  it('honors a custom expiry duration', () => {
    const lastActiveAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-01-01T00:00:05Z');
    expect(checkSessionExpiry({ isActive: true, lastActiveAt }, now, 4000).expired).toBe(true);
    expect(checkSessionExpiry({ isActive: true, lastActiveAt }, now, 6000).expired).toBe(false);
  });
});
