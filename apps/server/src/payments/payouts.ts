/**
 * Venue payout seam (SPEC.md §2, D15).
 *
 * Revenue ACCOUNTING is live (PaymentsService.venuePayouts computes the 70/30
 * split from completed cash purchases). Moving money to the venue is a separate
 * concern that requires Stripe Connect (each venue has a connected account, and
 * we create Transfers/Payouts on a schedule). That wiring is deliberately a STUB
 * here — the interface below is the documented seam WS5 will implement next.
 *
 * TODO(ws5, Stripe Connect): implement StripeConnectPayoutGateway that:
 *   1. Resolves the venue's connected account id (needs a venues.stripe_account_id
 *      column — a contract change; not done here).
 *   2. Creates a Transfer for `amountCents` in the venue's currency.
 *   3. Records a payout row / reconciles against payment_events.
 *   4. Requires STRIPE_SECRET_KEY (+ Connect enabled on the platform account).
 */

export interface PayoutRequest {
  venueId: string;
  amountCents: number;
  currency: string;
  /** Idempotency for the transfer so retries don't double-pay. */
  idempotencyKey: string;
}

export interface PayoutResult {
  status: 'transferred' | 'pending' | 'not_implemented';
  transferId: string | null;
  amountCents: number;
}

export interface PayoutGateway {
  transferToVenue(req: PayoutRequest): Promise<PayoutResult>;
}

/**
 * Stub used until Stripe Connect is wired. It performs NO money movement; it
 * only echoes the request so callers/tests can exercise the seam. Never treat a
 * `not_implemented` result as a completed payout.
 */
export class StubPayoutGateway implements PayoutGateway {
  readonly requests: PayoutRequest[] = [];

  async transferToVenue(req: PayoutRequest): Promise<PayoutResult> {
    this.requests.push(req);
    return { status: 'not_implemented', transferId: null, amountCents: req.amountCents };
  }
}
