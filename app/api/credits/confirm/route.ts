/**
 * API Route: Confirm Credit Purchase
 * POST /api/credits/confirm
 *
 * Called by the frontend after Stripe payment succeeds.
 * Verifies the PaymentIntent, credits the user's balance, and records a CreditTransaction.
 * Idempotent: a second call for the same PaymentIntent returns the already-recorded balance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { findUserByAuthToken } from '@/lib/db/users';
import { addCreditsToUser } from '@/lib/db/credits';
import { prisma } from '@/lib/db/prisma';
import { CREDIT_BUNDLES, CreditBundleKey } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { paymentIntentId, authToken } = body as { paymentIntentId: string; authToken: string };

    if (!paymentIntentId || !authToken) {
      return NextResponse.json(
        { error: 'paymentIntentId and authToken are required' },
        { status: 400 },
      );
    }

    // Authenticate the user
    const user = await findUserByAuthToken(authToken);
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    // Verify the payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment has not completed successfully' }, { status: 402 });
    }

    // Validate that this payment intent belongs to the authenticated user
    if (paymentIntent.metadata?.userId !== user.id) {
      return NextResponse.json(
        { error: 'Payment intent does not belong to this user' },
        { status: 403 },
      );
    }

    // Validate that this is a credit purchase intent
    if (paymentIntent.metadata?.type !== 'CREDIT_PURCHASE') {
      return NextResponse.json({ error: 'Invalid payment type' }, { status: 400 });
    }

    // Idempotency check: skip if already processed
    const existingTx = await prisma.creditTransaction.findFirst({
      where: { userId: user.id, paymentId: paymentIntentId, type: 'PURCHASE' },
    });
    if (existingTx) {
      const currentUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { creditBalance: true },
      });
      return NextResponse.json({ creditBalance: currentUser!.creditBalance, alreadyProcessed: true });
    }

    // Look up the bundle to get the credit amount
    const bundleKey = paymentIntent.metadata?.bundleKey as CreditBundleKey | undefined;
    const bundle = bundleKey ? CREDIT_BUNDLES.find((b) => b.key === bundleKey) : null;
    const credits = bundle
      ? bundle.credits
      : parseInt(paymentIntent.metadata?.credits ?? '0', 10);

    if (!credits || credits <= 0) {
      return NextResponse.json({ error: 'Could not determine credit amount from payment' }, { status: 400 });
    }

    const { newBalance } = await addCreditsToUser(
      user.id,
      credits,
      'PURCHASE',
      bundle ? bundle.label : `${credits} credits purchased`,
      paymentIntentId,
    );

    return NextResponse.json({ creditBalance: newBalance, creditsAdded: credits });
  } catch (err) {
    console.error('[POST /api/credits/confirm]', err);
    return NextResponse.json({ error: 'Failed to confirm credit purchase' }, { status: 500 });
  }
}
