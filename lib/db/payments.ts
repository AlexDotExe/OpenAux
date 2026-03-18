import { prisma } from './prisma';
import { Payment, PaymentStatus, PaymentType } from '@prisma/client';

/**
 * DB Access Layer - Payments
 */

export async function createPayment(data: {
  userId?: string;
  venueId: string;
  amount: number;
  type: PaymentType;
  stripePaymentId?: string;
  venueShareAmount?: number;
  platformShareAmount?: number;
  requestId?: string;
}): Promise<Payment> {
  return prisma.payment.create({ data });
}

export async function findPaymentByStripeId(stripePaymentId: string): Promise<Payment | null> {
  return prisma.payment.findUnique({ where: { stripePaymentId } });
}

export async function updatePaymentStatus(
  id: string,
  status: PaymentStatus,
  completedAt?: Date,
): Promise<Payment> {
  return prisma.payment.update({
    where: { id },
    data: { status, ...(completedAt ? { completedAt } : {}) },
  });
}

export async function findPaymentsByUser(userId: string): Promise<Payment[]> {
  return prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findPaymentsByVenue(venueId: string): Promise<Payment[]> {
  return prisma.payment.findMany({
    where: { venueId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findCompletedPaymentByRequestId(requestId: string): Promise<Payment | null> {
  return prisma.payment.findFirst({
    where: { requestId, type: 'BOOST', status: { in: ['COMPLETED', 'REFUNDED'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findRefundsByVenue(venueId: string): Promise<Payment[]> {
  return prisma.payment.findMany({
    where: { venueId, type: 'BOOST', status: 'REFUNDED' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all completed (unpaid-back) boost payments for requests in a session
 * that have not been played (status PENDING or APPROVED) and are not yet refunded.
 * Used to auto-refund unplayed songs when a session ends.
 */
export async function findUnplayedBoostPaymentsBySession(
  sessionId: string,
): Promise<(Payment & { requestId: string; songId: string })[]> {
  const results = await prisma.payment.findMany({
    where: {
      type: 'BOOST',
      status: 'COMPLETED',
      requestId: { not: null },
      request: {
        sessionId,
        status: { in: ['PENDING', 'APPROVED'] },
        isRefunded: false,
        isRefundEligible: true,
      },
    },
    include: {
      request: { select: { songId: true } },
    },
  });
  // Filter out rows where requestId is null (type-guard) and attach songId for efficiency
  return results
    .filter((p): p is typeof p & { requestId: string; request: { songId: string } } =>
      p.requestId !== null && p.request !== null,
    )
    .map((p) => ({ ...p, songId: p.request!.songId }));
}
