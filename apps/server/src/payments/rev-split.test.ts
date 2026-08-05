import { describe, expect, it } from 'vitest';
import { computeRevSplit, DEFAULT_VENUE_SHARE_BPS } from './rev-split.js';

describe('computeRevSplit', () => {
  it('splits an even amount 70/30 (D15)', () => {
    const s = computeRevSplit(1000);
    expect(s.venueCents).toBe(700);
    expect(s.appCents).toBe(300);
    expect(s.venueShareBps).toBe(DEFAULT_VENUE_SHARE_BPS);
  });

  it('always conserves the total (venue + app === total)', () => {
    for (const cents of [0, 1, 7, 99, 333, 499, 999, 1234, 987654]) {
      const s = computeRevSplit(cents);
      expect(s.venueCents + s.appCents).toBe(cents);
    }
  });

  it('awards the sub-cent remainder to the venue, never the app', () => {
    // 30% of 999 = 299.7 → app floored to 299, venue keeps the remainder (700).
    const s = computeRevSplit(999);
    expect(s.appCents).toBe(299);
    expect(s.venueCents).toBe(700);
    // Exact venue share would be 699.3; the remainder (0.7) went to the venue.
    expect(s.venueCents).toBeGreaterThan(Math.floor((999 * 7000) / 10000));
  });

  it('gives the venue everything on a 1-cent charge', () => {
    const s = computeRevSplit(1);
    expect(s.venueCents).toBe(1);
    expect(s.appCents).toBe(0);
  });

  it('honors a per-contract configurable venue share', () => {
    const s = computeRevSplit(1000, 8000);
    expect(s.venueCents).toBe(800);
    expect(s.appCents).toBe(200);
  });

  it('splits negative totals (refund/chargeback) symmetrically', () => {
    const s = computeRevSplit(-1000);
    expect(s.venueCents).toBe(-700);
    expect(s.appCents).toBe(-300);
    expect(s.venueCents + s.appCents).toBe(-1000);
  });

  it('rejects non-integer cents', () => {
    expect(() => computeRevSplit(9.99)).toThrow(/integer cents/);
  });

  it('rejects an out-of-range share', () => {
    expect(() => computeRevSplit(100, 12000)).toThrow(/venueShareBps/);
  });
});
