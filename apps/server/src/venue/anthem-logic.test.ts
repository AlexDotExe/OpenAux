import { describe, expect, it } from 'vitest';
import { isAnthemWin, validateAnthemRequest } from './anthem-logic.js';

describe('isAnthemWin', () => {
  const anthem = { provider: 'spotify' as const, providerTrackId: 'track-123' };

  it('is true when the now-playing item matches the anthem track and provider', () => {
    expect(isAnthemWin({ provider: 'spotify', songId: 'track-123' }, anthem)).toBe(true);
  });

  it('is false when the songId differs', () => {
    expect(isAnthemWin({ provider: 'spotify', songId: 'track-999' }, anthem)).toBe(false);
  });

  it('is false when the provider differs even if the id string matches', () => {
    expect(isAnthemWin({ provider: 'apple_music', songId: 'track-123' }, anthem)).toBe(false);
  });

  it('is false when no anthem is configured', () => {
    expect(isAnthemWin({ provider: 'spotify', songId: 'track-123' }, null)).toBe(false);
  });
});

describe('validateAnthemRequest', () => {
  it('accepts a well-formed request', () => {
    expect(
      validateAnthemRequest({
        providerTrackId: 't1',
        promoText: '$2 off shots',
        promoDurationMinutes: 5,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects a missing providerTrackId', () => {
    const result = validateAnthemRequest({ promoText: 'promo', promoDurationMinutes: 5 });
    expect(result.valid).toBe(false);
  });

  it('rejects an empty promoText', () => {
    const result = validateAnthemRequest({
      providerTrackId: 't1',
      promoText: '  ',
      promoDurationMinutes: 5,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a non-positive promoDurationMinutes', () => {
    const result = validateAnthemRequest({
      providerTrackId: 't1',
      promoText: 'promo',
      promoDurationMinutes: 0,
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a NaN promoDurationMinutes', () => {
    const result = validateAnthemRequest({
      providerTrackId: 't1',
      promoText: 'promo',
      promoDurationMinutes: Number.NaN,
    });
    expect(result.valid).toBe(false);
  });
});
