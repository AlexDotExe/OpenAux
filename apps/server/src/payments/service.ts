/**
 * PaymentsService — settlement orchestration (SPEC.md §1 layer 5).
 *
 * Responsibilities:
 *  - Credit bundle purchases through the injected PaymentGateway.
 *  - Priority Boost purchases: debit ledger, enforce the 1-per-song-per-user
 *    limit, increment the boost count, emit analytics.
 *  - Auto-refund to credit (D14) when a boosted item ends without playing.
 *  - Revenue-share reporting (D15) derived from completed cash purchases.
 *
 * Invariants:
 *  - Every balance change is a credits_ledger row AND a users.credit_balance
 *    update, in the SAME transaction (see repo.withTx).
 *  - All mutating operations are idempotent via idempotency_key.
 *  - Money is integer cents; credits are integers. No floats touch the DB.
 *  - Network calls to the gateway happen OUTSIDE the DB transaction.
 */
import type { BoostCodeTier, QueueItemStatus } from '@openaux/shared';
import { getBundle, isBundleAllowedForGuest } from './bundles.js';
import { getBoostDef, type BoostType } from './boost-catalog.js';
import { computeRevSplit, DEFAULT_VENUE_SHARE_BPS } from './rev-split.js';
import { PaymentsError } from './errors.js';
import type { AnalyticsSink } from './analytics.js';
import type { PaymentGateway } from './gateway.js';
import {
  isUniqueViolation,
  type PaymentEventRow,
  type PaymentsRepo,
  type VenuePayoutGross,
} from './repo.js';

/** Terminal statuses where a boosted item never played → refund is due (D14). */
const REFUNDABLE_TERMINAL_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  'expired',
  'skipped',
  'blocked',
]);

export interface PurchaseCreditsInput {
  userId: string;
  venueId: string;
  bundleId: string;
  paymentMethodToken: string;
  idempotencyKey: string;
}

export interface PurchaseBoostInput {
  userId: string;
  queueItemId: string;
  boostType: BoostType;
  idempotencyKey: string;
}

export interface PurchaseBoostResult {
  creditBalance: number;
  priorityBoostCount: number;
  venueId: string;
}

export interface SettleResult {
  refundedCount: number;
  refundedCredits: number;
}

export interface RedeemBoostCodeInput {
  userId: string;
  code: string;
  idempotencyKey: string;
  /** Redemption clock; defaults to now (injectable for deterministic tests). */
  now?: Date;
}

export interface RedeemBoostCodeResult {
  tier: BoostCodeTier;
  creditsAdded: number;
  creditBalance: number;
}

export interface VenuePayout {
  venueId: string;
  grossCents: number;
  venueCents: number;
  appCents: number;
  completedPurchaseCount: number;
}

export interface PaymentsServiceDeps {
  repo: PaymentsRepo;
  gateway: PaymentGateway;
  analytics: AnalyticsSink;
  /** Rev-share venue cut in basis points (D15, per-contract configurable). */
  venueShareBps?: number;
}

export class PaymentsService {
  private readonly repo: PaymentsRepo;
  private readonly gateway: PaymentGateway;
  private readonly analytics: AnalyticsSink;
  private readonly venueShareBps: number;

  constructor(deps: PaymentsServiceDeps) {
    this.repo = deps.repo;
    this.gateway = deps.gateway;
    this.analytics = deps.analytics;
    this.venueShareBps = deps.venueShareBps ?? DEFAULT_VENUE_SHARE_BPS;
  }

  // -------------------------------------------------------------------------
  // Credit bundle purchase — POST /api/credits/purchase
  // -------------------------------------------------------------------------
  async purchaseCredits(input: PurchaseCreditsInput): Promise<{ creditBalance: number }> {
    const bundle = getBundle(input.bundleId);
    if (!bundle) {
      throw new PaymentsError('not_found', `Unknown credit bundle "${input.bundleId}".`);
    }

    const user = await this.repo.getUser(input.userId);
    if (!user) throw new PaymentsError('unauthorized', 'No such user.');

    // Guests may only buy the smallest bundle (SPEC.md §4).
    if (user.authProvider === 'guest' && !isBundleAllowedForGuest(input.bundleId)) {
      throw new PaymentsError(
        'unauthorized',
        'Guests may only purchase the smallest credit bundle. Sign in to buy larger bundles.',
      );
    }

    // Idempotent replay: a completed purchase for this key already happened.
    const prior = await this.repo.findCompletedByIdempotencyKey(input.idempotencyKey);
    if (prior) {
      const current = await this.repo.getUser(input.userId);
      return { creditBalance: current?.creditBalance ?? user.creditBalance };
    }

    // Charge the card OUTSIDE any DB transaction. Stripe honors the same key.
    const intent = await this.gateway.createAndConfirmPaymentIntent({
      amountCents: bundle.priceCents,
      currency: bundle.currency,
      paymentMethodToken: input.paymentMethodToken,
      idempotencyKey: input.idempotencyKey,
      metadata: { userId: input.userId, venueId: input.venueId, bundleId: bundle.id },
    });

    if (intent.status !== 'succeeded') {
      // Record the failed attempt for reconciliation (no ledger movement).
      await this.repo.withTx((tx) =>
        tx.insertPaymentEvent({
          userId: input.userId,
          venueId: input.venueId,
          queueItemId: null,
          paymentType: 'credit_purchase',
          creditAmount: 0,
          cashAmountCents: bundle.priceCents,
          status: 'failed',
          idempotencyKey: `${input.idempotencyKey}:failed:${intent.id}`,
        }),
      );
      throw new PaymentsError(
        'payment_gateway_error',
        `Card charge did not succeed (status: ${intent.status}).`,
      );
    }

    const creditBalance = await this.repo.withTx(async (tx) => {
      // Re-check inside the tx to close the concurrent-request race.
      const raced = await tx.findCompletedByIdempotencyKey(input.idempotencyKey);
      if (raced) {
        const u = await tx.lockUser(input.userId);
        return u?.creditBalance ?? user.creditBalance;
      }

      let payment: PaymentEventRow;
      try {
        payment = await tx.insertPaymentEvent({
          userId: input.userId,
          venueId: input.venueId,
          queueItemId: null,
          paymentType: 'credit_purchase',
          creditAmount: bundle.credits,
          cashAmountCents: bundle.priceCents,
          status: 'completed',
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Lost the race on idempotency_key — replay the winner's balance.
          const u = await tx.lockUser(input.userId);
          return u?.creditBalance ?? user.creditBalance;
        }
        throw err;
      }

      await tx.insertLedgerEntry({
        userId: input.userId,
        delta: bundle.credits,
        reason: 'credit_purchase',
        paymentEventId: payment.paymentEventId,
      });
      return tx.applyCreditDelta(input.userId, bundle.credits);
    });

    return { creditBalance };
  }

  // -------------------------------------------------------------------------
  // Priority Boost purchase — POST /api/queue-items/:id/boosts
  // -------------------------------------------------------------------------
  async purchaseBoost(input: PurchaseBoostInput): Promise<PurchaseBoostResult> {
    const def = getBoostDef(input.boostType);
    if (!def.available) {
      throw new PaymentsError(
        'boost_type_unavailable',
        `${def.label} is not available yet.`,
      );
    }

    const outcome = await this.repo.withTx(async (tx) => {
      // Idempotent replay guard.
      const prior = await tx.findCompletedByIdempotencyKey(input.idempotencyKey);
      if (prior) {
        const item = await tx.lockQueueItem(input.queueItemId);
        const u = await tx.lockUser(input.userId);
        return {
          replay: true,
          creditBalance: u?.creditBalance ?? 0,
          priorityBoostCount: item?.priorityBoostCount ?? 0,
          venueId: prior.venueId,
        };
      }

      const item = await tx.lockQueueItem(input.queueItemId);
      if (!item) throw new PaymentsError('not_found', 'Queue item not found.');

      const user = await tx.lockUser(input.userId);
      if (!user) throw new PaymentsError('unauthorized', 'No such user.');

      if (user.creditBalance < def.creditCost) {
        throw new PaymentsError(
          'insufficient_credits',
          `${def.label} costs ${def.creditCost} credit(s); balance is ${user.creditBalance}.`,
        );
      }

      // 1-per-song-per-user limit. priority_boost is also backed by a partial
      // unique index (the backstop for concurrent inserts below); the other
      // boost types have no dedicated index, so this in-tx check under the item
      // lock is their authority.
      const existing = await tx.findCompletedBoostForItem(
        input.userId,
        item.queueItemId,
        input.boostType,
      );
      if (existing) {
        throw new PaymentsError(
          'boost_limit_reached',
          `You have already applied ${def.label} to this song (limit 1 per song).`,
        );
      }

      let payment: PaymentEventRow;
      try {
        payment = await tx.insertPaymentEvent({
          userId: input.userId,
          venueId: item.venueId,
          queueItemId: item.queueItemId,
          paymentType: input.boostType,
          creditAmount: def.creditCost,
          cashAmountCents: 0,
          status: 'completed',
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          const constraint = err.constraint ?? '';
          // The 1-per-song-per-user index → boost limit reached (contract code).
          if (constraint.includes('priority_boost')) {
            throw new PaymentsError(
              'boost_limit_reached',
              'You have already boosted this song (limit 1 per song).',
            );
          }
          // Otherwise it was the idempotency_key index → replay.
          const u = await tx.lockUser(input.userId);
          return {
            replay: true,
            creditBalance: u?.creditBalance ?? user.creditBalance,
            priorityBoostCount: item.priorityBoostCount,
            venueId: item.venueId,
          };
        }
        throw err;
      }

      await tx.insertLedgerEntry({
        userId: input.userId,
        delta: -def.creditCost,
        reason: input.boostType,
        paymentEventId: payment.paymentEventId,
      });
      const creditBalance = await tx.applyCreditDelta(input.userId, -def.creditCost);
      await tx.incrementBoostCount(item.queueItemId, def.countColumn);

      return {
        replay: false,
        creditBalance,
        priorityBoostCount:
          item.priorityBoostCount + (input.boostType === 'priority_boost' ? 1 : 0),
        venueId: item.venueId,
      };
    });

    if (!outcome.replay) {
      this.analytics.emit({
        eventType: 'boost_purchased',
        actorUserId: input.userId,
        venueId: outcome.venueId,
        queueItemId: input.queueItemId,
        metadata: { boostType: input.boostType, creditCost: def.creditCost },
      });
    }

    return {
      creditBalance: outcome.creditBalance,
      priorityBoostCount: outcome.priorityBoostCount,
      venueId: outcome.venueId,
    };
  }

  /** Full queue-item view for assembling the PurchaseBoostResponse. */
  getQueueItemView(queueItemId: string) {
    return this.repo.getQueueItemView(queueItemId);
  }

  // -------------------------------------------------------------------------
  // Refund on terminal state — called by the queue engine (WS3) (D14)
  // -------------------------------------------------------------------------
  /**
   * Settle a queue item at its terminal status. If it was boosted and never
   * played (expired/skipped/blocked), auto-refund each boost to the payer's
   * credit ledger. Idempotent: only boosts still marked refund_status='none'
   * are refunded, so repeated calls are safe.
   */
  async settleQueueItem(queueItemId: string, finalStatus: QueueItemStatus): Promise<SettleResult> {
    if (!REFUNDABLE_TERMINAL_STATUSES.has(finalStatus)) {
      return { refundedCount: 0, refundedCredits: 0 };
    }

    const refunded = await this.repo.withTx(async (tx) => {
      const boosts = await tx.findRefundableBoosts(queueItemId);
      const done: PaymentEventRow[] = [];
      for (const boost of boosts) {
        await tx.insertLedgerEntry({
          userId: boost.userId,
          delta: boost.creditAmount,
          reason: 'refund',
          paymentEventId: boost.paymentEventId,
        });
        await tx.applyCreditDelta(boost.userId, boost.creditAmount);
        await tx.setRefundStatus(boost.paymentEventId, 'refunded_to_credit');
        done.push(boost);
      }
      return done;
    });

    for (const boost of refunded) {
      this.analytics.emit({
        eventType: 'refund_issued',
        actorUserId: boost.userId,
        venueId: boost.venueId,
        queueItemId,
        metadata: {
          reason: 'boosted_song_never_played',
          finalStatus,
          refundStatus: 'refunded_to_credit',
          credits: boost.creditAmount,
        },
      });
    }

    return {
      refundedCount: refunded.length,
      refundedCredits: refunded.reduce((sum, b) => sum + b.creditAmount, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Boost Code redemption — POST /api/boost-codes/redeem (D7)
  // -------------------------------------------------------------------------
  /**
   * Redeem a venue-issued Boost Code for credits. Validates the code (invalid /
   * expired / already redeemed), then in one transaction credits the patron
   * (payment_event 'promo_code_redemption' + credits_ledger) and stamps the code
   * redeemed. Idempotent via idempotency_key; single-use via the code lock +
   * redeemed_by guard. Emits `promo_code_redeemed`.
   */
  async redeemBoostCode(input: RedeemBoostCodeInput): Promise<RedeemBoostCodeResult> {
    const now = input.now ?? new Date();

    const outcome = await this.repo.withTx(async (tx) => {
      const code = await tx.lockBoostCodeByCode(input.code);

      // Idempotent replay: a completed redemption already used this key.
      const prior = await tx.findCompletedByIdempotencyKey(input.idempotencyKey);
      if (prior) {
        const u = await tx.lockUser(input.userId);
        return {
          replay: true,
          tier: code?.tier ?? ('beer' as BoostCodeTier),
          creditsAdded: prior.creditAmount,
          creditBalance: u?.creditBalance ?? 0,
          venueId: prior.venueId,
        };
      }

      if (!code) {
        throw new PaymentsError('boost_code_invalid', 'That code is not valid.');
      }
      if (code.redeemedBy !== null) {
        throw new PaymentsError('boost_code_already_redeemed', 'That code has already been redeemed.');
      }
      if (code.expiresAt.getTime() <= now.getTime()) {
        throw new PaymentsError('boost_code_expired', 'That code has expired.');
      }

      const user = await tx.lockUser(input.userId);
      if (!user) throw new PaymentsError('unauthorized', 'No such user.');

      let payment: PaymentEventRow;
      try {
        payment = await tx.insertPaymentEvent({
          userId: input.userId,
          venueId: code.venueId,
          queueItemId: null,
          paymentType: 'promo_code_redemption',
          creditAmount: code.creditValue,
          cashAmountCents: 0,
          status: 'completed',
          idempotencyKey: input.idempotencyKey,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Lost the race on idempotency_key → replay the winner's balance.
          const u = await tx.lockUser(input.userId);
          return {
            replay: true,
            tier: code.tier,
            creditsAdded: code.creditValue,
            creditBalance: u?.creditBalance ?? user.creditBalance,
            venueId: code.venueId,
          };
        }
        throw err;
      }

      await tx.insertLedgerEntry({
        userId: input.userId,
        delta: code.creditValue,
        reason: 'promo_code_redemption',
        paymentEventId: payment.paymentEventId,
      });
      const creditBalance = await tx.applyCreditDelta(input.userId, code.creditValue);

      // Single-use stamp. The FOR UPDATE lock + redeemed_by check above make this
      // succeed; a false return means a concurrent redemption won — throw to roll
      // back the credit we just wrote.
      const marked = await tx.markBoostCodeRedeemed(code.boostCodeId, input.userId, now);
      if (!marked) {
        throw new PaymentsError('boost_code_already_redeemed', 'That code has already been redeemed.');
      }

      return {
        replay: false,
        tier: code.tier,
        creditsAdded: code.creditValue,
        creditBalance,
        venueId: code.venueId,
      };
    });

    if (!outcome.replay) {
      this.analytics.emit({
        eventType: 'promo_code_redeemed',
        actorUserId: input.userId,
        venueId: outcome.venueId,
        queueItemId: null,
        metadata: { tier: outcome.tier, credits: outcome.creditsAdded },
      });
    }

    return {
      tier: outcome.tier,
      creditsAdded: outcome.creditsAdded,
      creditBalance: outcome.creditBalance,
    };
  }

  // -------------------------------------------------------------------------
  // Revenue-share reporting (D15)
  // -------------------------------------------------------------------------
  async venuePayouts(venueId?: string): Promise<VenuePayout[]> {
    const gross = await this.repo.venuePayoutsGross(venueId);
    return gross.map((g: VenuePayoutGross) => {
      const split = computeRevSplit(g.grossCents, this.venueShareBps);
      return {
        venueId: g.venueId,
        grossCents: g.grossCents,
        venueCents: split.venueCents,
        appCents: split.appCents,
        completedPurchaseCount: g.completedPurchaseCount,
      };
    });
  }
}
