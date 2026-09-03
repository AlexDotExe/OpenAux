/**
 * Postgres-backed BoostCodeRepository (decision D7). Uses the shared pool from
 * apps/server/src/db.ts. WS4 owns generation + listing only; redemption (the
 * redeemed_by/redeemed_at UPDATE) belongs to WS5 payments, so no redeem method
 * lives here. Not exercised by the unit suite — pure logic is in
 * boost-code-logic.ts; the FakeBoostCodeRepository covers the route tests.
 */
import type { Pool } from 'pg';
import type { BoostCode, BoostCodeTier, VenueId } from '@openaux/shared';
import { BoostCodeConflictError, type BoostCodeRepository, type NewBoostCode } from './types.js';

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

interface BoostCodeRow {
  boost_code_id: string;
  code: string;
  venue_id: string;
  tier: BoostCodeTier;
  credit_value: number;
  issued_at: Date;
  expires_at: Date;
  redeemed_by: string | null;
  redeemed_at: Date | null;
}

function mapBoostCodeRow(row: BoostCodeRow): BoostCode {
  return {
    boostCodeId: row.boost_code_id,
    code: row.code,
    venueId: row.venue_id,
    tier: row.tier,
    creditValue: row.credit_value,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    redeemedBy: row.redeemed_by,
    redeemedAt: row.redeemed_at,
  };
}

const BOOST_CODE_COLUMNS = `
  boost_code_id, code, venue_id, tier, credit_value, issued_at, expires_at, redeemed_by, redeemed_at
`;

export class PostgresBoostCodeRepository implements BoostCodeRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: NewBoostCode): Promise<BoostCode> {
    try {
      const { rows } = await this.pool.query<BoostCodeRow>(
        `insert into boost_codes (code, venue_id, tier, credit_value, issued_at, expires_at)
         values ($1, $2, $3, $4, $5, $6)
         returning ${BOOST_CODE_COLUMNS}`,
        [input.code, input.venueId, input.tier, input.creditValue, input.issuedAt, input.expiresAt],
      );
      return mapBoostCodeRow(rows[0]!);
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new BoostCodeConflictError();
      }
      throw err;
    }
  }

  async listByVenue(venueId: VenueId): Promise<BoostCode[]> {
    const { rows } = await this.pool.query<BoostCodeRow>(
      `select ${BOOST_CODE_COLUMNS} from boost_codes
       where venue_id = $1
       order by issued_at desc`,
      [venueId],
    );
    return rows.map(mapBoostCodeRow);
  }
}
