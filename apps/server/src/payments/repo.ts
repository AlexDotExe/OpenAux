/**
 * Persistence seam for settlement.
 *
 * The service depends only on these interfaces so unit tests can run against an
 * in-memory double (no live DB). `PgPaymentsRepo` (pg-repo.ts) is the production
 * implementation over the shared pool.
 *
 * Concurrency model: every debit/credit pair runs inside `withTx`, which maps to
 * a single SQL transaction. Unique-index violations surface as `UNIQUE_VIOLATION`
 * so the service can translate them into contract errors idempotently.
 */
import type { QueueItem } from '@openaux/shared';
import type {
  AuthProvider,
  PaymentStatus,
  PaymentType,
  RefundStatus,
  CreditsLedgerEntry,
} from './domain-rows.js';

/** Minimal shape of `pg` we use — lets us pass a Pool or a PoolClient. */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** Postgres SQLSTATE for unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';

/** Raised by repo writes when a unique index rejects the row. */
export class UniqueViolationError extends Error {
  readonly constraint?: string;
  constructor(constraint?: string) {
    super(`unique_violation${constraint ? ` (${constraint})` : ''}`);
    this.name = 'UniqueViolationError';
    this.constraint = constraint;
  }
}

export function isUniqueViolation(err: unknown): err is UniqueViolationError {
  return err instanceof UniqueViolationError;
}

// ---------------------------------------------------------------------------
// Row shapes (camelCase views over snake_case columns)
// ---------------------------------------------------------------------------

export interface UserRow {
  userId: string;
  authProvider: AuthProvider;
  creditBalance: number;
}

export interface QueueItemRow {
  queueItemId: string;
  venueId: string;
  status: string;
  priorityBoostCount: number;
}

export interface PaymentEventRow {
  paymentEventId: string;
  userId: string;
  venueId: string;
  queueItemId: string | null;
  paymentType: PaymentType;
  creditAmount: number;
  cashAmountCents: number;
  status: PaymentStatus;
  refundStatus: RefundStatus;
  idempotencyKey: string | null;
}

export interface InsertPaymentEvent {
  userId: string;
  venueId: string;
  queueItemId: string | null;
  paymentType: PaymentType;
  creditAmount: number;
  cashAmountCents: number;
  status: PaymentStatus;
  refundStatus?: RefundStatus;
  idempotencyKey: string | null;
}

export interface InsertLedgerEntry {
  userId: string;
  delta: number;
  reason: CreditsLedgerEntry['reason'];
  paymentEventId: string | null;
}

/** Raw per-venue gross totals from the DB, before the rev-share split is applied. */
export interface VenuePayoutGross {
  venueId: string;
  grossCents: number;
  completedPurchaseCount: number;
}

// ---------------------------------------------------------------------------
// Transaction + repo interfaces
// ---------------------------------------------------------------------------

/** Operations available inside a settlement transaction. */
export interface PaymentsTx {
  /** SELECT ... FOR UPDATE on the user row. Returns null if missing. */
  lockUser(userId: string): Promise<UserRow | null>;
  /** SELECT ... FOR UPDATE on the queue item. Returns null if missing. */
  lockQueueItem(queueItemId: string): Promise<QueueItemRow | null>;
  /** Look up a completed payment by idempotency key (idempotent replay check). */
  findCompletedByIdempotencyKey(key: string): Promise<PaymentEventRow | null>;
  /** Insert a payment_events row. Throws UniqueViolationError on conflict. */
  insertPaymentEvent(row: InsertPaymentEvent): Promise<PaymentEventRow>;
  /** Set refund_status on a payment_events row. */
  setRefundStatus(paymentEventId: string, refundStatus: RefundStatus): Promise<void>;
  /** Insert a credits_ledger row. */
  insertLedgerEntry(row: InsertLedgerEntry): Promise<CreditsLedgerEntry>;
  /**
   * Apply `delta` to users.credit_balance (the denormalized cache) and return
   * the new balance. Must reject if the result would go negative.
   */
  applyCreditDelta(userId: string, delta: number): Promise<number>;
  /** Increment queue_items.priority_boost_count by 1. */
  incrementPriorityBoostCount(queueItemId: string): Promise<void>;
  /** Completed priority_boost payments for a queue item with refund_status='none'. */
  findRefundableBoosts(queueItemId: string): Promise<PaymentEventRow[]>;
}

export interface PaymentsRepo {
  /** Run `fn` inside a single DB transaction. */
  withTx<T>(fn: (tx: PaymentsTx) => Promise<T>): Promise<T>;
  /** Non-transactional read of a user. */
  getUser(userId: string): Promise<UserRow | null>;
  /** Full queue-item view for building the contract PurchaseBoostResponse. */
  getQueueItemView(queueItemId: string): Promise<QueueItem | null>;
  /** Non-transactional idempotency lookup (pre-charge replay guard). */
  findCompletedByIdempotencyKey(key: string): Promise<PaymentEventRow | null>;
  /** Gross cash totals per venue over completed purchases (split applied in the service). */
  venuePayoutsGross(venueId?: string): Promise<VenuePayoutGross[]>;
}
