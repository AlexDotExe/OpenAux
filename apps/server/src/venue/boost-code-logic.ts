/**
 * Pure logic for Boost Codes (decision D7): request validation, tier→credit
 * mapping, 30-min expiry, and code-string generation. No I/O.
 *
 * Redemption is NOT owned here — WS5 payments owns POST /api/boost-codes/redeem
 * and the redeemed_by/redeemed_at write. This module only mints codes.
 */
import {
  BOOST_CODE_TIER_CREDITS,
  type BoostCode,
  type BoostCodePublic,
  type BoostCodeTier,
} from '@openaux/shared';

export type BoostCodeValidationResult =
  | { valid: true; tier: BoostCodeTier }
  | { valid: false; message: string };

const VALID_TIERS = Object.keys(BOOST_CODE_TIER_CREDITS) as BoostCodeTier[];

export function validateGenerateBoostCodeRequest(body: {
  tier?: unknown;
}): BoostCodeValidationResult {
  if (typeof body.tier !== 'string' || !VALID_TIERS.includes(body.tier as BoostCodeTier)) {
    return { valid: false, message: `tier must be one of: ${VALID_TIERS.join(', ')}` };
  }
  return { valid: true, tier: body.tier as BoostCodeTier };
}

/** Fixed tier → credit value (decision D7). Single source of truth is the shared map. */
export function creditValueForTier(tier: BoostCodeTier): number {
  return BOOST_CODE_TIER_CREDITS[tier];
}

/** Codes expire 30 minutes after issue (decision D7). */
export const BOOST_CODE_TTL_MS = 30 * 60 * 1000;

export function boostCodeExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + BOOST_CODE_TTL_MS);
}

/**
 * Human-enterable code alphabet: uppercase letters + digits with the visually
 * ambiguous glyphs removed (no I/O/0/1). An operator reads the code off a
 * screen and a patron types it, so legibility matters more than density.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUP_LENGTH = 4;
const CODE_GROUPS = 2;

/** Injectable randomness so generation is deterministically unit-testable. */
export type RandomInt = (maxExclusive: number) => number;

/**
 * Generate a single code string, e.g. `H7K9-Q2MR`. Two groups of 4 from a
 * 32-char alphabet ≈ 32^8 ≈ 1.1e12 combinations; the DB enforces a unique
 * constraint and the repository retries on the rare collision, so this only
 * needs to produce a well-formed, high-entropy candidate.
 */
export function generateBoostCodeString(randomInt: RandomInt): string {
  const groups: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < CODE_GROUP_LENGTH; i += 1) {
      group += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Assemble the fields to persist for a new code (pure — caller supplies code + now). */
export function buildNewBoostCode(input: {
  code: string;
  venueId: string;
  tier: BoostCodeTier;
  issuedAt: Date;
}): {
  code: string;
  venueId: string;
  tier: BoostCodeTier;
  creditValue: number;
  issuedAt: Date;
  expiresAt: Date;
} {
  return {
    code: input.code,
    venueId: input.venueId,
    tier: input.tier,
    creditValue: creditValueForTier(input.tier),
    issuedAt: input.issuedAt,
    expiresAt: boostCodeExpiresAt(input.issuedAt),
  };
}

/**
 * Project a persisted BoostCode to its venue-facing public shape (Dates → ISO).
 * The venue console is the only reader; redeemed status is surfaced via
 * redeemedAt/redeemedBy, and no patron PII beyond the redeeming user id is
 * carried.
 */
export function toBoostCodePublic(boostCode: BoostCode): BoostCodePublic {
  return {
    boostCodeId: boostCode.boostCodeId,
    code: boostCode.code,
    venueId: boostCode.venueId,
    tier: boostCode.tier,
    creditValue: boostCode.creditValue,
    issuedAt: boostCode.issuedAt.toISOString(),
    expiresAt: boostCode.expiresAt.toISOString(),
    redeemedBy: boostCode.redeemedBy,
    redeemedAt: boostCode.redeemedAt ? boostCode.redeemedAt.toISOString() : null,
  };
}
