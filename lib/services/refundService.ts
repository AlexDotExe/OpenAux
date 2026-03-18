/**
 * Refund Service
 * Handles Stripe refunds for boosted song requests that were not played.
 * Called when a boosted request is skipped, deleted, or rejected.
 */

import { stripe } from '../stripe';
import { findCompletedPaymentByRequestId } from '../db/payments';
import { prisma } from '../db/prisma';

export interface RefundResult {
  refunded: boolean;
  reason: string;
}

/**
 * Process a Stripe refund for a paid boost on a song request.
 * No-ops if the request has no completed payment or was already refunded.
 * Both DB updates (payment + request) run inside a Prisma transaction so they
 * either both succeed or both roll back, keeping records consistent after the
 * Stripe refund completes.
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

  // Issue the Stripe refund first; if it fails we throw and the DB is unchanged.
  await stripe.refunds.create({ payment_intent: payment.stripePaymentId });

  // Persist the refund state atomically: both records update or neither does.
  try {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED' },
      }),
      prisma.songRequest.update({
        where: { id: requestId },
        data: { isRefunded: true, refundedAt: new Date() },
      }),
    ]);
  } catch (dbErr) {
    // Stripe refund succeeded but DB update failed — log for manual reconciliation.
    console.error(
      `[refundService] DB update failed after Stripe refund for payment ${payment.id} / request ${requestId}:`,
      dbErr,
    );
    throw dbErr;
  }

  console.log(`[refundService] Refunded boost payment ${payment.id} for request ${requestId}`);
  return { refunded: true, reason: 'Refund processed successfully' };
}
