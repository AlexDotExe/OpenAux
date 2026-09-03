import { randomUUID } from 'node:crypto';
import type { BoostCode, VenueId } from '@openaux/shared';
import { BoostCodeConflictError, type BoostCodeRepository, type NewBoostCode } from '../types.js';

/** In-memory BoostCodeRepository for tests — enforces the `code` unique constraint. */
export class FakeBoostCodeRepository implements BoostCodeRepository {
  boostCodes = new Map<string, BoostCode>();
  private codes = new Set<string>();

  async insert(input: NewBoostCode): Promise<BoostCode> {
    if (this.codes.has(input.code)) {
      throw new BoostCodeConflictError();
    }
    const boostCode: BoostCode = {
      boostCodeId: randomUUID(),
      code: input.code,
      venueId: input.venueId,
      tier: input.tier,
      creditValue: input.creditValue,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      redeemedBy: null,
      redeemedAt: null,
    };
    this.codes.add(input.code);
    this.boostCodes.set(boostCode.boostCodeId, boostCode);
    return boostCode;
  }

  async listByVenue(venueId: VenueId): Promise<BoostCode[]> {
    return [...this.boostCodes.values()]
      .filter((bc) => bc.venueId === venueId)
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
  }
}
