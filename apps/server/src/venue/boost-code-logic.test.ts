import { describe, expect, it } from 'vitest';
import { BOOST_CODE_TIER_CREDITS, type BoostCode } from '@openaux/shared';
import {
  BOOST_CODE_TTL_MS,
  boostCodeExpiresAt,
  buildNewBoostCode,
  creditValueForTier,
  generateBoostCodeString,
  toBoostCodePublic,
  validateGenerateBoostCodeRequest,
} from './boost-code-logic.js';

describe('validateGenerateBoostCodeRequest', () => {
  it('accepts each known tier', () => {
    expect(validateGenerateBoostCodeRequest({ tier: 'beer' })).toEqual({ valid: true, tier: 'beer' });
    expect(validateGenerateBoostCodeRequest({ tier: 'cocktail' })).toEqual({
      valid: true,
      tier: 'cocktail',
    });
    expect(validateGenerateBoostCodeRequest({ tier: 'bottle' })).toEqual({
      valid: true,
      tier: 'bottle',
    });
  });

  it('rejects an unknown or missing tier', () => {
    expect(validateGenerateBoostCodeRequest({ tier: 'magnum' }).valid).toBe(false);
    expect(validateGenerateBoostCodeRequest({}).valid).toBe(false);
    expect(validateGenerateBoostCodeRequest({ tier: 5 }).valid).toBe(false);
  });
});

describe('creditValueForTier (tier → credit mapping, decision D7)', () => {
  it('matches the shared contract map exactly', () => {
    expect(creditValueForTier('beer')).toBe(1);
    expect(creditValueForTier('cocktail')).toBe(2);
    expect(creditValueForTier('bottle')).toBe(10);
    // Never re-derive: assert we mirror the single source of truth.
    expect(creditValueForTier('beer')).toBe(BOOST_CODE_TIER_CREDITS.beer);
    expect(creditValueForTier('cocktail')).toBe(BOOST_CODE_TIER_CREDITS.cocktail);
    expect(creditValueForTier('bottle')).toBe(BOOST_CODE_TIER_CREDITS.bottle);
  });
});

describe('boostCodeExpiresAt (30-min expiry)', () => {
  it('adds exactly 30 minutes', () => {
    const issuedAt = new Date('2026-09-03T22:00:00.000Z');
    expect(boostCodeExpiresAt(issuedAt).toISOString()).toBe('2026-09-03T22:30:00.000Z');
    expect(BOOST_CODE_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe('generateBoostCodeString (code generation)', () => {
  it('produces two 4-char groups from the unambiguous alphabet', () => {
    // Deterministic rng: always pick index 0 → 'A'.
    expect(generateBoostCodeString(() => 0)).toBe('AAAA-AAAA');
  });

  it('is deterministic given the rng and matches the code format', () => {
    let i = 0;
    const seq = [0, 1, 2, 3, 4, 5, 6, 7];
    const code = generateBoostCodeString(() => seq[i++ % seq.length]!);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(code).toBe('ABCD-EFGH');
  });

  it('never emits visually ambiguous glyphs (I, O, 0, 1)', () => {
    // Walk the whole alphabet by cycling indices.
    let i = 0;
    const code = generateBoostCodeString(() => i++);
    expect(code).not.toMatch(/[IO01]/);
  });
});

describe('buildNewBoostCode', () => {
  it('assembles fields with tier-fixed credit and 30-min expiry', () => {
    const issuedAt = new Date('2026-09-03T22:00:00.000Z');
    expect(
      buildNewBoostCode({ code: 'ABCD-EFGH', venueId: 'venue-1', tier: 'bottle', issuedAt }),
    ).toEqual({
      code: 'ABCD-EFGH',
      venueId: 'venue-1',
      tier: 'bottle',
      creditValue: 10,
      issuedAt,
      expiresAt: new Date('2026-09-03T22:30:00.000Z'),
    });
  });
});

describe('toBoostCodePublic', () => {
  const base: BoostCode = {
    boostCodeId: 'bc-1',
    code: 'ABCD-EFGH',
    venueId: 'venue-1',
    tier: 'beer',
    creditValue: 1,
    issuedAt: new Date('2026-09-03T22:00:00.000Z'),
    expiresAt: new Date('2026-09-03T22:30:00.000Z'),
    redeemedBy: null,
    redeemedAt: null,
  };

  it('maps Dates to ISO strings for an unredeemed code', () => {
    expect(toBoostCodePublic(base)).toEqual({
      boostCodeId: 'bc-1',
      code: 'ABCD-EFGH',
      venueId: 'venue-1',
      tier: 'beer',
      creditValue: 1,
      issuedAt: '2026-09-03T22:00:00.000Z',
      expiresAt: '2026-09-03T22:30:00.000Z',
      redeemedBy: null,
      redeemedAt: null,
    });
  });

  it('surfaces redeemed status when set', () => {
    const redeemedAt = new Date('2026-09-03T22:10:00.000Z');
    const result = toBoostCodePublic({ ...base, redeemedBy: 'user-9', redeemedAt });
    expect(result.redeemedBy).toBe('user-9');
    expect(result.redeemedAt).toBe(redeemedAt.toISOString());
  });
});
