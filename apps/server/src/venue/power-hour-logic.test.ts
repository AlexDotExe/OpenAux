import { describe, expect, it } from 'vitest';
import {
  buildPowerHourBannerText,
  isPowerHourExpired,
  powerHourEndsAt,
  powerHourStateAt,
  validatePowerHourRequest,
} from './power-hour-logic.js';

describe('validatePowerHourRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validatePowerHourRequest({ genre: 'hip-hop', multiplier: 2, durationMinutes: 15 })).toEqual(
      { valid: true },
    );
  });

  it('rejects a missing/empty genre', () => {
    expect(validatePowerHourRequest({ genre: '  ', multiplier: 2, durationMinutes: 15 }).valid).toBe(
      false,
    );
  });

  it('rejects a multiplier of 1 or less (must be a boost)', () => {
    expect(validatePowerHourRequest({ genre: 'pop', multiplier: 1, durationMinutes: 15 }).valid).toBe(
      false,
    );
    expect(validatePowerHourRequest({ genre: 'pop', multiplier: 0.5, durationMinutes: 15 }).valid).toBe(
      false,
    );
  });

  it('rejects a multiplier above the cap', () => {
    expect(
      validatePowerHourRequest({ genre: 'pop', multiplier: 11, durationMinutes: 15 }).valid,
    ).toBe(false);
  });

  it('rejects a non-positive or absurd duration', () => {
    expect(validatePowerHourRequest({ genre: 'pop', multiplier: 2, durationMinutes: 0 }).valid).toBe(
      false,
    );
    expect(
      validatePowerHourRequest({ genre: 'pop', multiplier: 2, durationMinutes: 1000 }).valid,
    ).toBe(false);
  });

  it('rejects a NaN multiplier', () => {
    expect(
      validatePowerHourRequest({ genre: 'pop', multiplier: Number.NaN, durationMinutes: 15 }).valid,
    ).toBe(false);
  });
});

describe('powerHourEndsAt', () => {
  it('adds the duration in minutes to now', () => {
    const now = new Date('2026-09-03T22:00:00.000Z');
    expect(powerHourEndsAt(now, 15).toISOString()).toBe('2026-09-03T22:15:00.000Z');
  });
});

describe('powerHourStateAt (active-at-time)', () => {
  const now = new Date('2026-09-03T22:00:00.000Z');

  it('returns the state while the window is live', () => {
    const endsAt = new Date('2026-09-03T22:10:00.000Z');
    expect(powerHourStateAt({ genre: 'hip-hop', multiplier: 2, endsAt }, now)).toEqual({
      genre: 'hip-hop',
      multiplier: 2,
      endsAt: endsAt.toISOString(),
    });
  });

  it('returns null once endsAt has passed', () => {
    const endsAt = new Date('2026-09-03T21:59:59.000Z');
    expect(powerHourStateAt({ genre: 'hip-hop', multiplier: 2, endsAt }, now)).toBeNull();
  });

  it('treats the exact endsAt instant as expired (boundary)', () => {
    expect(powerHourStateAt({ genre: 'hip-hop', multiplier: 2, endsAt: now }, now)).toBeNull();
  });

  it('returns null when any column is unset', () => {
    expect(powerHourStateAt({ genre: null, multiplier: 2, endsAt: now }, now)).toBeNull();
    expect(powerHourStateAt({ genre: 'pop', multiplier: null, endsAt: now }, now)).toBeNull();
    expect(powerHourStateAt({ genre: 'pop', multiplier: 2, endsAt: null }, now)).toBeNull();
  });
});

describe('isPowerHourExpired', () => {
  const now = new Date('2026-09-03T22:00:00.000Z');

  it('is true for a set-but-elapsed window', () => {
    expect(
      isPowerHourExpired(
        { genre: 'pop', multiplier: 2, endsAt: new Date('2026-09-03T21:00:00.000Z') },
        now,
      ),
    ).toBe(true);
  });

  it('is false for a still-live window', () => {
    expect(
      isPowerHourExpired(
        { genre: 'pop', multiplier: 2, endsAt: new Date('2026-09-03T23:00:00.000Z') },
        now,
      ),
    ).toBe(false);
  });

  it('is false when no window is set', () => {
    expect(isPowerHourExpired({ genre: null, multiplier: null, endsAt: null }, now)).toBe(false);
  });
});

describe('buildPowerHourBannerText', () => {
  it('renders the genre and multiplier', () => {
    expect(buildPowerHourBannerText('Hip-Hop', 2)).toBe('🔥 Hip-Hop boosted ×2');
  });
});
