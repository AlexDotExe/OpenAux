/**
 * Refund Service
 * Handles Stripe refunds for boosted song requests that were not played.
 * Called when a boosted request is skipped, deleted, or rejected, and
 * automatically for all unplayed boosted requests when a session ends.
 */

import { stripe } from '../stripe';
import { findCompletedPaymentByRequestId, findUnplayedBoostPaymentsBySession } from '../db/payments';
import { prisma } from '../db/prisma';
import { applyRefundScorePenalty } from './userService';

export interface RefundResult {
  refunded: boolean;
  reason: string;
}

export interface BulkRefundResult {
  totalProcessed: number;
  totalRefunded: number;
  failures: { requestId: string; reason: string }[];
}

/**
 * Process a Stripe refund for a paid boost on a song request.
 * No-ops if the request has no completed payment or was already refunded.
 * Both DB updates (payment + request) run inside a Prisma transaction so they
 * either both succeed or both roll back, keeping records consistent after the
 * Stripe refund completes.
 * Errors are caught and logged so callers are not blocked.
 *
 * @param requestId - The song request ID to refund
 * @param applyScorePenalty - When true, applies a reputation penalty to the requester.
 *   Pass false (default) for skip-initiated refunds where reputation is already updated via recalculateReputation.
 * @param songId - Optional: pre-fetched songId to avoid an extra DB query when calling from bulk refund
 * @param sessionId - Optional: pre-fetched sessionId to avoid an extra DB query when calling from bulk refund
 */
export async function processBoostRefund(
  requestId: string,
  applyScorePenalty = false,
  songId?: string,
  sessionId?: string,
): Promise<RefundResult> {
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
      // Create a credit transaction record for the refund so it appears in the user's ledger
      ...(payment.userId
        ? [
            prisma.creditTransaction.create({
              data: {
                userId: payment.userId,
                amount: payment.amount,
                type: 'REFUND',
                description: `Refund for unplayed boosted song`,
                requestId,
              },
            }),
          ]
        : []),
    ]);
  } catch (dbErr) {
    // Stripe refund succeeded but DB update failed — log for manual reconciliation.
    console.error(
      `[refundService] DB update failed after Stripe refund for payment ${payment.id} / request ${requestId}:`,
      dbErr,
    );
    throw dbErr;
  }

  // Apply reputation penalty if requested (e.g. reject/delete/session-end scenarios)
  if (applyScorePenalty && payment.userId) {
    // Use pre-fetched values when available to avoid an extra DB query
    const resolvedSongId = songId;
    const resolvedSessionId = sessionId;
    if (resolvedSongId && resolvedSessionId) {
      applyRefundScorePenalty(payment.userId, resolvedSongId, resolvedSessionId).catch((err) =>
        console.error('[refundService] Score penalty failed for request', requestId, err),
      );
    } else {
      prisma.songRequest
        .findUnique({
          where: { id: requestId },
          select: { songId: true, sessionId: true },
        })
        .then((req) => {
          if (req) {
            applyRefundScorePenalty(payment.userId!, req.songId, req.sessionId).catch((err) =>
              console.error('[refundService] Score penalty failed for request', requestId, err),
            );
          }
        })
        .catch((err) =>
          console.error('[refundService] Could not fetch request for score penalty:', requestId, err),
        );
    }
  }

  console.log(`[refundService] Refunded boost payment ${payment.id} for request ${requestId}`);
  return { refunded: true, reason: 'Refund processed successfully' };
}

/**
 * Automatically refund all unplayed boosted songs in a session.
 * Called when a session ends to ensure no user is charged for songs that were
 * never played. Each refund applies a reputation score penalty weighted by
 * how unique/uncommon the song request was.
 */
export async function refundUnplayedBoosts(sessionId: string): Promise<BulkRefundResult> {
  const unplayedPayments = await findUnplayedBoostPaymentsBySession(sessionId);

  const result: BulkRefundResult = {
    totalProcessed: unplayedPayments.length,
    totalRefunded: 0,
    failures: [],
  };

  if (unplayedPayments.length === 0) {
    return result;
  }

  console.log(
    `[refundService] Processing ${unplayedPayments.length} unplayed boost refund(s) for session ${sessionId}`,
  );

  for (const payment of unplayedPayments) {
    try {
      // Mark the request as DELETED so it won't appear in future queue queries
      await prisma.songRequest.update({
        where: { id: payment.requestId },
        data: { status: 'DELETED' },
      });

      // Pass songId and sessionId to avoid redundant DB queries inside processBoostRefund
      const refundResult = await processBoostRefund(payment.requestId, true, payment.songId, sessionId);
      if (refundResult.refunded) {
        result.totalRefunded++;
      } else {
        result.failures.push({ requestId: payment.requestId, reason: refundResult.reason });
      }
    } catch (err) {
      console.error(
        `[refundService] Failed to refund unplayed request ${payment.requestId}:`,
        err,
      );
      result.failures.push({
        requestId: payment.requestId,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  console.log(
    `[refundService] Session ${sessionId} end: refunded ${result.totalRefunded}/${result.totalProcessed} unplayed boosts`,
  );
  return result;
}
