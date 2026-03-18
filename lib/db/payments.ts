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
