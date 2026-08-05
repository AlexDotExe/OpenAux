import { describe, expect, it } from 'vitest';
import {
  CREDIT_BUNDLES,
  bundleUnitPriceCents,
  getBundle,
  isBundleAllowedForGuest,
  smallestBundle,
} from './bundles.js';

describe('credit bundles', () => {
  it('exposes the provisional V0 catalog', () => {
    expect(getBundle('starter_5')).toMatchObject({ credits: 5, priceCents: 499 });
    expect(getBundle('value_12')).toMatchObject({ credits: 12, priceCents: 999 });
  });

  it('returns undefined for an unknown bundle', () => {
    expect(getBundle('nope')).toBeUndefined();
  });

  it('all prices are integer cents and all credits are integers', () => {
    for (const b of CREDIT_BUNDLES) {
      expect(Number.isInteger(b.priceCents)).toBe(true);
      expect(Number.isInteger(b.credits)).toBe(true);
    }
  });

  it('smallest bundle is the cheapest by price', () => {
    expect(smallestBundle().id).toBe('starter_5');
  });

  it('guests may buy only the smallest bundle', () => {
    expect(isBundleAllowedForGuest('starter_5')).toBe(true);
    expect(isBundleAllowedForGuest('value_12')).toBe(false);
  });

  it('bigger bundle has a better unit price (bulk discount for signed-in users)', () => {
    expect(bundleUnitPriceCents(getBundle('value_12')!)).toBeLessThan(
      bundleUnitPriceCents(getBundle('starter_5')!),
    );
  });
});
