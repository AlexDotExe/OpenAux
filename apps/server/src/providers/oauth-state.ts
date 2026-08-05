/**
 * Signed `state` parameter for the Spotify authorization-code flow.
 *
 * The state carries the venueId and an absolute expiry, authenticated with an
 * HMAC-SHA256 over the payload keyed by TOKEN_ENCRYPTION_KEY. The callback is
 * a public endpoint, so this signature is what lets us trust the venueId that
 * comes back and bound the link's validity to 10 minutes.
 *
 * Pure helpers, no I/O — unit-tested for verify / expiry / tamper / malformed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VenueId } from '@openaux/shared';

/** State is valid for 10 minutes after issuance. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export type StateInvalidReason = 'malformed' | 'bad_signature' | 'expired';

export type StateVerifyResult =
  { valid: true; venueId: VenueId } | { valid: false; reason: StateInvalidReason };

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * Produces `<base64url(payload)>.<hmac>` where payload is `venueId.expiresAt`.
 * @param now injectable clock (epoch ms) for deterministic tests.
 */
export function signState(
  venueId: VenueId,
  key: Buffer,
  now: number = Date.now(),
  ttlMs: number = STATE_TTL_MS,
): string {
  const expiresAt = now + ttlMs;
  const payload = `${venueId}.${expiresAt}`;
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${sign(payload, key)}`;
}

/**
 * Verifies signature first (constant-time), then expiry. Returns the venueId
 * only when both pass.
 */
export function verifyState(
  state: string,
  key: Buffer,
  now: number = Date.now(),
): StateVerifyResult {
  const parts = state.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'malformed' };
  }
  const [encodedPayload, providedSig] = parts as [string, string];

  const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  const expectedSig = sign(payload, key);
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'bad_signature' };
  }

  const payloadParts = payload.split('.');
  if (payloadParts.length !== 2) {
    return { valid: false, reason: 'malformed' };
  }
  const [venueId, expiresAtStr] = payloadParts as [string, string];
  const expiresAt = Number(expiresAtStr);
  if (!venueId || !Number.isFinite(expiresAt)) {
    return { valid: false, reason: 'malformed' };
  }
  if (now > expiresAt) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, venueId };
}
