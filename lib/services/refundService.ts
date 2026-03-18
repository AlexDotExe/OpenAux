/**
 * Refund Service
 * Handles Stripe refunds for boosted song requests that were not played.
 * Called when a boosted request is skipped, deleted, or rejected.
 */

import { stripe } from '../stripe';
import { findCompletedPaymentByRequestId, updatePaymentStatus } from '../db/payments';
import { markRequestRefunded } from '../db/requests';

export interface RefundResult {
  refunded: boolean;
  reason: string;
}

/**
 * Process a Stripe refund for a paid boost on a song request.
 * No-ops if the request has no completed payment or was already refunded.
 * Errors are caught and logged so callers are not blocked.
 */
export async function processBoostRefund(requestId: string): Promise<RefundResult> {
  const payment = await findCompletedPaymentByRequestId(requestId);

  if (!payment) {
    return { refunded: false, reason: 'No completed boost payment found for this request' };
  }

  if (payment.status === 'REFUNDED') {
    return { refunded: false, reason: 'Payment already refunded' };
  }

  if (!payment.stripePaymentId) {
    return { refunded: false, reason: 'No Stripe payment ID on record' };
  }

  try {
    await stripe.refunds.create({ payment_intent: payment.stripePaymentId });
    await updatePaymentStatus(payment.id, 'REFUNDED');
    await markRequestRefunded(requestId);

    console.log(`[refundService] Refunded boost payment ${payment.id} for request ${requestId}`);
    return { refunded: true, reason: 'Refund processed successfully' };
  } catch (err) {
    console.error(`[refundService] Failed to refund payment ${payment.id} for request ${requestId}:`, err);
    throw err;
  }
}
