/**
 * PgPaymentsRepo — production PaymentsRepo over the shared pg pool.
 *
 * Owns all settlement SQL. `withTx` runs a real BEGIN/COMMIT transaction on a
 * dedicated client so every debit/credit pair is atomic. Unique-index
 * violations are translated to UniqueViolationError (carrying the constraint
 * name) so the service can map them to contract errors.
 */
import type { Pool, PoolClient } from 'pg';
import {
  PG_UNIQUE_VIOLATION,
  UniqueViolationError,
  type BoostCodeRow,
  type InsertLedgerEntry,
  type InsertPaymentEvent,
  type PaymentEventRow,
  type PaymentsRepo,
  type PaymentsTx,
  type QueueItemRow,
  type UserRow,
  type VenuePayoutGross,
} from './repo.js';
import type { CreditsLedgerEntry, PaymentType } from './domain-rows.js';
import { REFUNDABLE_BOOST_TYPES, type BoostCountColumn } from './boost-catalog.js';
import type { BoostCodeTier, QueueItem } from '@openaux/shared';

interface PgError {
  code?: string;
  constraint?: string;
}

function asPgError(err: unknown): PgError {
  return (err ?? {}) as PgError;
}

/** SELECT list → PaymentEventRow. */
const PAYMENT_EVENT_COLUMNS = `
  payment_event_id, user_id, venue_id, queue_item_id, payment_type,
  credit_amount, cash_amount_cents, status, refund_status, idempotency_key`;

function toPaymentEventRow(r: Record<string, unknown>): PaymentEventRow {
  return {
    paymentEventId: r.payment_event_id as string,
    userId: r.user_id as string,
    venueId: r.venue_id as string,
    queueItemId: (r.queue_item_id as string | null) ?? null,
    paymentType: r.payment_type as PaymentEventRow['paymentType'],
    creditAmount: r.credit_amount as number,
    cashAmountCents: r.cash_amount_cents as number,
    status: r.status as PaymentEventRow['status'],
    refundStatus: r.refund_status as PaymentEventRow['refundStatus'],
    idempotencyKey: (r.idempotency_key as string | null) ?? null,
  };
}

function toBoostCodeRow(r: Record<string, unknown>): BoostCodeRow {
  return {
    boostCodeId: r.boost_code_id as string,
    code: r.code as string,
    venueId: r.venue_id as string,
    tier: r.tier as BoostCodeTier,
    creditValue: r.credit_value as number,
    expiresAt: r.expires_at as Date,
    redeemedBy: (r.redeemed_by as string | null) ?? null,
    redeemedAt: (r.redeemed_at as Date | null) ?? null,
  };
}

/** BoostCountColumn is an app-fixed allowlist, so it is safe to interpolate. */
const BOOST_COUNT_COLUMNS: readonly BoostCountColumn[] = [
  'priority_boost_count',
  'instant_vote_count',
  'super_boost_count',
];

class PgPaymentsTx implements PaymentsTx {
  constructor(private readonly client: PoolClient) {}

  async lockUser(userId: string): Promise<UserRow | null> {
    const { rows } = await this.client.query(
      `select user_id, auth_provider, credit_balance
         from users where user_id = $1 for update`,
      [userId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      userId: r.user_id,
      authProvider: r.auth_provider,
      creditBalance: r.credit_balance,
    };
  }

  async lockQueueItem(queueItemId: string): Promise<QueueItemRow | null> {
    const { rows } = await this.client.query(
      `select queue_item_id, venue_id, status, priority_boost_count
         from queue_items where queue_item_id = $1 for update`,
      [queueItemId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      queueItemId: r.queue_item_id,
      venueId: r.venue_id,
      status: r.status,
      priorityBoostCount: r.priority_boost_count,
    };
  }

  async findCompletedByIdempotencyKey(key: string): Promise<PaymentEventRow | null> {
    const { rows } = await this.client.query(
      `select ${PAYMENT_EVENT_COLUMNS} from payment_events
         where idempotency_key = $1 and status = 'completed' limit 1`,
      [key],
    );
    return rows[0] ? toPaymentEventRow(rows[0]) : null;
  }

  async insertPaymentEvent(row: InsertPaymentEvent): Promise<PaymentEventRow> {
    try {
      const { rows } = await this.client.query(
        `insert into payment_events
           (user_id, venue_id, queue_item_id, payment_type,
            credit_amount, cash_amount_cents, status, refund_status, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${PAYMENT_EVENT_COLUMNS}`,
        [
          row.userId,
          row.venueId,
          row.queueItemId,
          row.paymentType,
          row.creditAmount,
          row.cashAmountCents,
          row.status,
          row.refundStatus ?? 'none',
          row.idempotencyKey,
        ],
      );
      return toPaymentEventRow(rows[0] as Record<string, unknown>);
    } catch (err) {
      const pg = asPgError(err);
      if (pg.code === PG_UNIQUE_VIOLATION) {
        throw new UniqueViolationError(pg.constraint);
      }
      throw err;
    }
  }

  async setRefundStatus(
    paymentEventId: string,
    refundStatus: PaymentEventRow['refundStatus'],
  ): Promise<void> {
    await this.client.query(
      `update payment_events set refund_status = $2 where payment_event_id = $1`,
      [paymentEventId, refundStatus],
    );
  }

  async insertLedgerEntry(row: InsertLedgerEntry): Promise<CreditsLedgerEntry> {
    const { rows } = await this.client.query(
      `insert into credits_ledger (user_id, delta, reason, payment_event_id)
         values ($1, $2, $3, $4)
         returning entry_id, user_id, delta, reason, payment_event_id, created_at`,
      [row.userId, row.delta, row.reason, row.paymentEventId],
    );
    const r = rows[0];
    return {
      entryId: r.entry_id,
      userId: r.user_id,
      delta: r.delta,
      reason: r.reason,
      paymentEventId: r.payment_event_id ?? null,
      createdAt: r.created_at,
    };
  }

  async applyCreditDelta(userId: string, delta: number): Promise<number> {
    // The credit_balance >= 0 CHECK constraint is the last line of defense;
    // the service pre-checks balance under the same row lock.
    const { rows } = await this.client.query(
      `update users set credit_balance = credit_balance + $2
         where user_id = $1 returning credit_balance`,
      [userId, delta],
    );
    return rows[0].credit_balance as number;
  }

  async incrementBoostCount(queueItemId: string, column: BoostCountColumn): Promise<void> {
    // `column` is validated against an app-fixed allowlist before interpolation.
    if (!BOOST_COUNT_COLUMNS.includes(column)) {
      throw new Error(`invalid boost count column: ${column}`);
    }
    await this.client.query(
      `update queue_items set ${column} = ${column} + 1 where queue_item_id = $1`,
      [queueItemId],
    );
  }

  async findCompletedBoostForItem(
    userId: string,
    queueItemId: string,
    paymentType: PaymentType,
  ): Promise<PaymentEventRow | null> {
    const { rows } = await this.client.query(
      `select ${PAYMENT_EVENT_COLUMNS} from payment_events
         where user_id = $1 and queue_item_id = $2
           and payment_type = $3 and status = 'completed'
         limit 1 for update`,
      [userId, queueItemId, paymentType],
    );
    return rows[0] ? toPaymentEventRow(rows[0] as Record<string, unknown>) : null;
  }

  async findRefundableBoosts(queueItemId: string): Promise<PaymentEventRow[]> {
    const { rows } = await this.client.query(
      `select ${PAYMENT_EVENT_COLUMNS} from payment_events
         where queue_item_id = $1
           and payment_type = any($2::payment_type[])
           and status = 'completed'
           and refund_status = 'none'
         for update`,
      [queueItemId, REFUNDABLE_BOOST_TYPES],
    );
    return rows.map((r) => toPaymentEventRow(r as Record<string, unknown>));
  }

  async lockBoostCodeByCode(code: string): Promise<BoostCodeRow | null> {
    const { rows } = await this.client.query(
      `select boost_code_id, code, venue_id, tier, credit_value,
              expires_at, redeemed_by, redeemed_at
         from boost_codes where code = $1 for update`,
      [code],
    );
    return rows[0] ? toBoostCodeRow(rows[0] as Record<string, unknown>) : null;
  }

  async markBoostCodeRedeemed(
    boostCodeId: string,
    userId: string,
    redeemedAt: Date,
  ): Promise<boolean> {
    const { rowCount } = await this.client.query(
      `update boost_codes set redeemed_by = $2, redeemed_at = $3
         where boost_code_id = $1 and redeemed_by is null`,
      [boostCodeId, userId, redeemedAt],
    );
    return (rowCount ?? 0) > 0;
  }
}

export class PgPaymentsRepo implements PaymentsRepo {
  constructor(private readonly pool: Pool) {}

  async withTx<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(new PgPaymentsTx(client));
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getUser(userId: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      `select user_id, auth_provider, credit_balance from users where user_id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return null;
    return { userId: r.user_id, authProvider: r.auth_provider, creditBalance: r.credit_balance };
  }

  async findCompletedByIdempotencyKey(key: string): Promise<PaymentEventRow | null> {
    const { rows } = await this.pool.query(
      `select ${PAYMENT_EVENT_COLUMNS} from payment_events
         where idempotency_key = $1 and status = 'completed' limit 1`,
      [key],
    );
    return rows[0] ? toPaymentEventRow(rows[0]) : null;
  }

  async getQueueItemView(queueItemId: string): Promise<QueueItem | null> {
    const { rows } = await this.pool.query(`select * from queue_items where queue_item_id = $1`, [
      queueItemId,
    ]);
    const r = rows[0];
    if (!r) return null;
    return {
      queueItemId: r.queue_item_id,
      venueId: r.venue_id,
      songId: r.song_id,
      provider: r.provider,
      requestingUserId: r.requesting_user_id,
      createdAt: r.created_at,
      status: r.status,
      upvotesCount: r.upvotes_count,
      downvotesCount: r.downvotes_count,
      uniqueSupporterCount: r.unique_supporter_count,
      priorityBoostCount: r.priority_boost_count,
      instantVoteCount: r.instant_vote_count,
      superBoostCount: r.super_boost_count,
      explicitFlag: r.explicit_flag,
      genre: r.genre ?? null,
      artist: r.artist,
      title: r.title,
      isDuplicateLocked: r.is_duplicate_locked,
      lastScoreCalculatedAt: r.last_score_calculated_at ?? null,
      currentScore: Number(r.current_score),
      playabilityState: r.playability_state,
      playabilityReason: r.playability_reason ?? null,
      sourceType: r.source_type,
      playedAt: r.played_at ?? null,
      crowdSkipVotes: r.crowd_skip_votes ?? 0,
    };
  }

  async venuePayoutsGross(venueId?: string): Promise<VenuePayoutGross[]> {
    const { rows } = await this.pool.query(
      `select venue_id,
              coalesce(sum(cash_amount_cents), 0)::int as gross_cents,
              count(*)::int as completed_purchase_count
         from payment_events
        where status = 'completed'
          and cash_amount_cents > 0
          and ($1::uuid is null or venue_id = $1)
        group by venue_id
        order by gross_cents desc`,
      [venueId ?? null],
    );
    return rows.map((r) => ({
      venueId: r.venue_id,
      grossCents: r.gross_cents,
      completedPurchaseCount: r.completed_purchase_count,
    }));
  }
}
