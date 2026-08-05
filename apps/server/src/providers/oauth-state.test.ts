import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STATE_TTL_MS, signState, verifyState } from './oauth-state.js';

const KEY = randomBytes(32);
const VENUE = 'venue-abc';
const T0 = 1_700_000_000_000;

describe('signState / verifyState', () => {
  it('verifies a freshly signed state and recovers the venueId', () => {
    const state = signState(VENUE, KEY, T0);
    const result = verifyState(state, KEY, T0 + 1000);
    expect(result).toEqual({ valid: true, venueId: VENUE });
  });

  it('rejects an expired state', () => {
    const state = signState(VENUE, KEY, T0);
    const result = verifyState(state, KEY, T0 + STATE_TTL_MS + 1);
    expect(result).toEqual({ valid: false, reason: 'expired' });
  });

  it('accepts a state exactly at the expiry boundary', () => {
    const state = signState(VENUE, KEY, T0);
    expect(verifyState(state, KEY, T0 + STATE_TTL_MS)).toEqual({ valid: true, venueId: VENUE });
  });

  it('rejects a state signed with a different key', () => {
    const state = signState(VENUE, KEY, T0);
    const result = verifyState(state, randomBytes(32), T0 + 1000);
    expect(result).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a tampered payload (venueId swap)', () => {
    const state = signState(VENUE, KEY, T0);
    const [, sig] = state.split('.') as [string, string];
    const forgedPayload = Buffer.from(`attacker-venue.${T0 + STATE_TTL_MS}`).toString('base64url');
    const forged = `${forgedPayload}.${sig}`;
    expect(verifyState(forged, KEY, T0 + 1000)).toEqual({ valid: false, reason: 'bad_signature' });
  });

  it('rejects a malformed state', () => {
    expect(verifyState('not-a-valid-state', KEY, T0)).toEqual({
      valid: false,
      reason: 'malformed',
    });
  });
});
