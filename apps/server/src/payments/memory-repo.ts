/**
 * In-memory PaymentsRepo for unit tests — no live DB.
 *
 * Faithfully simulates the two settlement unique indexes and the
 * credit_balance >= 0 CHECK so idempotency / boost-limit / overdraft paths are
 * exercised exactly as Postgres would enforce them. Tests run single-threaded
 * and sequentially, so `withTx` executes the callback directly (row locks are
 * no-ops but ordering guarantees still hold).
 */
import { randomUUID } from 'node:crypto';
import type { QueueItem } from '@openaux/shared';
import type { CreditsLedgerEntry, PaymentType } from './domain-rows.js';
import { REFUNDABLE_BOOST_TYPES, type BoostCountColumn } from './boost-catalog.js';
import {
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

/** queue_items boost tally column → the QueueItem field the in-memory row uses. */
const COUNT_FIELD: Record<BoostCountColumn, 'priorityBoostCount' | 'instantVoteCount' | 'superBoostCount'> = {
  priority_boost_count: 'priorityBoostCount',
  instant_vote_count: 'instantVoteCount',
  super_boost_count: 'superBoostCount',
};

/** Refundable boost types as a Set for O(1) membership in the in-memory repo. */
const REFUNDABLE_SET: ReadonlySet<PaymentType> = new Set(REFUNDABLE_BOOST_TYPES);

export class InMemoryPaymentsRepo implements PaymentsRepo, PaymentsTx {
  readonly users = new Map<string, UserRow>();
  readonly queueItems = new Map<string, QueueItem>();
  readonly paymentEvents: PaymentEventRow[] = [];
  readonly ledger: CreditsLedgerEntry[] = [];
  /** Boost codes keyed by their code string (WS4 generates; we redeem). */
  readonly boostCodes = new Map<string, BoostCodeRow>();
  /** Count of withTx invocations — lets tests assert atomic-block usage. */
  txCount = 0;

  // ---- seeding helpers ----
  seedUser(user: Partial<UserRow> & { userId: string }): UserRow {
    const row: UserRow = {
      userId: user.userId,
      authProvider: user.authProvider ?? 'google',
      creditBalance: user.creditBalance ?? 0,
    };
    this.users.set(row.userId, row);
    // Keep the cache balance ledger-backed (mirrors production), so tests can
    // assert sum(ledger) === credit_balance.
    if (row.creditBalance > 0) {
      this.ledger.push({
        entryId: randomUUID(),
        userId: row.userId,
        delta: row.creditBalance,
        reason: 'admin_adjustment',
        paymentEventId: null,
        createdAt: new Date(),
      });
    }
    return row;
  }

  seedQueueItem(item: Partial<QueueItem> & { queueItemId: string; venueId: string }): QueueItem {
    const row: QueueItem = {
      queueItemId: item.queueItemId,
      venueId: item.venueId,
      songId: item.songId ?? 'song_1',
      provider: item.provider ?? 'spotify',
      requestingUserId: item.requestingUserId ?? 'requester',
      createdAt: item.createdAt ?? new Date(),
      status: item.status ?? 'queued',
      upvotesCount: item.upvotesCount ?? 0,
      downvotesCount: item.downvotesCount ?? 0,
      uniqueSupporterCount: item.uniqueSupporterCount ?? 0,
      priorityBoostCount: item.priorityBoostCount ?? 0,
      instantVoteCount: item.instantVoteCount ?? 0,
      superBoostCount: item.superBoostCount ?? 0,
      explicitFlag: item.explicitFlag ?? false,
      genre: item.genre ?? null,
      artist: item.artist ?? 'Artist',
      title: item.title ?? 'Title',
      isDuplicateLocked: item.isDuplicateLocked ?? false,
      lastScoreCalculatedAt: item.lastScoreCalculatedAt ?? null,
      currentScore: item.currentScore ?? 0,
      playabilityState: item.playabilityState ?? 'playable',
      playabilityReason: item.playabilityReason ?? null,
      sourceType: item.sourceType ?? 'organic',
      playedAt: item.playedAt ?? null,
      crowdSkipVotes: item.crowdSkipVotes ?? 0,
    };
    this.queueItems.set(row.queueItemId, row);
    return row;
  }

  seedBoostCode(
    code: Partial<BoostCodeRow> & { code: string; venueId: string },
  ): BoostCodeRow {
    const row: BoostCodeRow = {
      boostCodeId: code.boostCodeId ?? randomUUID(),
      code: code.code,
      venueId: code.venueId,
      tier: code.tier ?? 'beer',
      creditValue: code.creditValue ?? 1,
      expiresAt: code.expiresAt ?? new Date(Date.now() + 30 * 60_000),
      redeemedBy: code.redeemedBy ?? null,
      redeemedAt: code.redeemedAt ?? null,
    };
    this.boostCodes.set(row.code, row);
    return row;
  }

  // ---- PaymentsRepo ----
  async withTx<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T> {
    this.txCount += 1;
    return fn(this);
  }

  async getUser(userId: string): Promise<UserRow | null> {
    const u = this.users.get(userId);
    return u ? { ...u } : null;
  }

  async getQueueItemView(queueItemId: string): Promise<QueueItem | null> {
    const q = this.queueItems.get(queueItemId);
    return q ? { ...q } : null;
  }

  async findCompletedByIdempotencyKey(key: string): Promise<PaymentEventRow | null> {
    const e = this.paymentEvents.find((p) => p.idempotencyKey === key && p.status === 'completed');
    return e ? { ...e } : null;
  }

  async venuePayoutsGross(venueId?: string): Promise<VenuePayoutGross[]> {
    const byVenue = new Map<string, VenuePayoutGross>();
    for (const e of this.paymentEvents) {
      if (e.status !== 'completed' || e.cashAmountCents <= 0) continue;
      if (venueId && e.venueId !== venueId) continue;
      const agg = byVenue.get(e.venueId) ?? {
        venueId: e.venueId,
        grossCents: 0,
        completedPurchaseCount: 0,
      };
      agg.grossCents += e.cashAmountCents;
      agg.completedPurchaseCount += 1;
      byVenue.set(e.venueId, agg);
    }
    return [...byVenue.values()].sort((a, b) => b.grossCents - a.grossCents);
  }

  // ---- PaymentsTx ----
  async lockUser(userId: string): Promise<UserRow | null> {
    const u = this.users.get(userId);
    return u ? { ...u } : null;
  }

  async lockQueueItem(queueItemId: string): Promise<QueueItemRow | null> {
    const q = this.queueItems.get(queueItemId);
    if (!q) return null;
    return {
      queueItemId: q.queueItemId,
      venueId: q.venueId,
      status: q.status,
      priorityBoostCount: q.priorityBoostCount,
    };
  }

  async insertPaymentEvent(row: InsertPaymentEvent): Promise<PaymentEventRow> {
    // Global unique index on idempotency_key.
    if (row.idempotencyKey !== null) {
      const clash = this.paymentEvents.find((p) => p.idempotencyKey === row.idempotencyKey);
      if (clash) throw new UniqueViolationError('payment_events_idempotency_key_key');
    }
    // Partial unique index: one completed priority_boost per (user, queue_item).
    if (row.paymentType === 'priority_boost' && row.status === 'completed') {
      const clash = this.paymentEvents.find(
        (p) =>
          p.paymentType === 'priority_boost' &&
          p.status === 'completed' &&
          p.userId === row.userId &&
          p.queueItemId === row.queueItemId,
      );
      if (clash) throw new UniqueViolationError('payment_events_one_priority_boost');
    }
    const event: PaymentEventRow = {
      paymentEventId: randomUUID(),
      userId: row.userId,
      venueId: row.venueId,
      queueItemId: row.queueItemId,
      paymentType: row.paymentType,
      creditAmount: row.creditAmount,
      cashAmountCents: row.cashAmountCents,
      status: row.status,
      refundStatus: row.refundStatus ?? 'none',
      idempotencyKey: row.idempotencyKey,
    };
    this.paymentEvents.push(event);
    return { ...event };
  }

  async setRefundStatus(
    paymentEventId: string,
    refundStatus: PaymentEventRow['refundStatus'],
  ): Promise<void> {
    const e = this.paymentEvents.find((p) => p.paymentEventId === paymentEventId);
    if (e) e.refundStatus = refundStatus;
  }

  async insertLedgerEntry(row: InsertLedgerEntry): Promise<CreditsLedgerEntry> {
    const entry: CreditsLedgerEntry = {
      entryId: randomUUID(),
      userId: row.userId,
      delta: row.delta,
      reason: row.reason,
      paymentEventId: row.paymentEventId,
      createdAt: new Date(),
    };
    this.ledger.push(entry);
    return { ...entry };
  }

  async applyCreditDelta(userId: string, delta: number): Promise<number> {
    const u = this.users.get(userId);
    if (!u) throw new Error(`no such user ${userId}`);
    const next = u.creditBalance + delta;
    if (next < 0) throw new Error('credit_balance check violation (would go negative)');
    u.creditBalance = next;
    return next;
  }

  async incrementBoostCount(queueItemId: string, column: BoostCountColumn): Promise<void> {
    const q = this.queueItems.get(queueItemId);
    if (q) q[COUNT_FIELD[column]] += 1;
  }

  async findCompletedBoostForItem(
    userId: string,
    queueItemId: string,
    paymentType: PaymentType,
  ): Promise<PaymentEventRow | null> {
    const e = this.paymentEvents.find(
      (p) =>
        p.userId === userId &&
        p.queueItemId === queueItemId &&
        p.paymentType === paymentType &&
        p.status === 'completed',
    );
    return e ? { ...e } : null;
  }

  async findRefundableBoosts(queueItemId: string): Promise<PaymentEventRow[]> {
    return this.paymentEvents
      .filter(
        (p) =>
          p.queueItemId === queueItemId &&
          REFUNDABLE_SET.has(p.paymentType) &&
          p.status === 'completed' &&
          p.refundStatus === 'none',
      )
      .map((p) => ({ ...p }));
  }

  async lockBoostCodeByCode(code: string): Promise<BoostCodeRow | null> {
    const c = this.boostCodes.get(code);
    return c ? { ...c } : null;
  }

  async markBoostCodeRedeemed(
    boostCodeId: string,
    userId: string,
    redeemedAt: Date,
  ): Promise<boolean> {
    const c = [...this.boostCodes.values()].find((b) => b.boostCodeId === boostCodeId);
    if (!c || c.redeemedBy !== null) return false;
    c.redeemedBy = userId;
    c.redeemedAt = redeemedAt;
    return true;
  }
}
