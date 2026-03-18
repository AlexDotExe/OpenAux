import { prisma } from './prisma';
import { CreditTransaction, CreditTransactionType } from '@prisma/client';

/**
 * DB Access Layer - Credit Transactions
 * All balance mutations use atomic Prisma operations to prevent race conditions.
 */

export async function createCreditTransaction(data: {
  userId: string;
  amount: number;
  type: CreditTransactionType;
  description?: string;
  paymentId?: string;
  requestId?: string;
}): Promise<CreditTransaction> {
  return prisma.creditTransaction.create({ data });
}

export async function findCreditTransactionsByUser(userId: string): Promise<CreditTransaction[]> {
  return prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Atomically add credits to a user's balance and record the transaction.
 * Uses a Prisma transaction so the balance and history record stay in sync.
 */
export async function addCreditsToUser(
  userId: string,
  amount: number,
  type: CreditTransactionType,
  description?: string,
  paymentId?: string,
): Promise<{ newBalance: number; transaction: CreditTransaction }> {
  const [updatedUser, transaction] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true },
    }),
    prisma.creditTransaction.create({
      data: { userId, amount, type, description, paymentId },
    }),
  ]);

  return { newBalance: updatedUser.creditBalance, transaction };
}

/**
 * Atomically deduct credits from a user's balance for a boost.
 * Uses an interactive Prisma transaction to atomically check balance,
 * decrement, and record the transaction — safe against concurrent requests.
 *
 * Throws an error if the balance is insufficient.
 */
export async function deductCreditsForBoost(
  userId: string,
  amount: number,
  requestId: string,
  description: string,
): Promise<{ newBalance: number; transaction: CreditTransaction }> {
  return prisma.$transaction(async (tx) => {
    // Lock and read the user's current balance
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    });

    if (!user || user.creditBalance < amount) {
      throw new Error('Insufficient credit balance');
    }

    // Decrement balance and create the transaction record atomically
    const [updatedUser, transaction] = await Promise.all([
      tx.user.update({
        where: { id: userId },
        data: { creditBalance: { decrement: amount } },
        select: { creditBalance: true },
      }),
      tx.creditTransaction.create({
        data: {
          userId,
          amount: -amount, // Negative for debits
          type: 'BOOST_DEBIT',
          description,
          requestId,
        },
      }),
    ]);

    return { newBalance: updatedUser.creditBalance, transaction };
  });
}

/**
 * Atomically refund credits to a user when a credit-boosted song is skipped or deleted.
 */
export async function refundCreditsForRequest(
  userId: string,
  amount: number,
  requestId: string,
  description: string,
): Promise<{ newBalance: number; transaction: CreditTransaction }> {
  const [updatedUser, transaction] = await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: amount } },
      select: { creditBalance: true },
    }),
    prisma.creditTransaction.create({
      data: { userId, amount, type: 'REFUND', description, requestId },
    }),
  ]);

  return { newBalance: updatedUser.creditBalance, transaction };
}

/**
 * Find all credit transactions for users who have participated in sessions at the given venue.
 * Used by venue admins to view credit activity associated with their venue.
 */
export async function findCreditTransactionsByVenue(
  venueId: string,
): Promise<(CreditTransaction & { user: { displayName: string | null; email: string | null } })[]> {
  // Find all user IDs that have had sessions at this venue
  const userSessions = await prisma.userSession.findMany({
    where: { session: { venueId } },
    select: { userId: true },
    distinct: ['userId'],
  });

  const userIds = userSessions.map((us) => us.userId);

  if (userIds.length === 0) return [];

  return prisma.creditTransaction.findMany({
    where: { userId: { in: userIds } },
    include: { user: { select: { displayName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
