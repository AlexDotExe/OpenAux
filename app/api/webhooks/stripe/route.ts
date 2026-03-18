/**
 * API Route: Stripe Webhook Handler
 * POST /api/webhooks/stripe
 *
 * Handles payment lifecycle events from Stripe.
 * payment_intent.succeeded → marks Payment as COMPLETED and marks SongRequest as boosted,
 *   or adds credits to user balance for CREDIT_PURCHASE intents.
 * payment_intent.payment_failed → marks Payment as FAILED
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { findPaymentByStripeId, updatePaymentStatus } from '@/lib/db/payments';
import { findRequestById, boostRequest } from '@/lib/db/requests';
import { findSessionById } from '@/lib/db/sessions';
import { invalidateQueueCache } from '@/lib/services/queueCache';
import { addCreditsToUser } from '@/lib/db/credits';
import { prisma } from '@/lib/db/prisma';
import { CREDIT_BUNDLES, CreditBundleKey } from '@/lib/constants';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Stripe Webhook] Missing STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSucceeded(paymentIntent);
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailed(paymentIntent);
        break;
      }
      default:
        // Ignore unhandled event types
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook] Error processing event:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  // Handle CREDIT_PURCHASE intents (not tracked in Payment table)
  if (paymentIntent.metadata?.type === 'CREDIT_PURCHASE') {
    await handleCreditPurchaseSucceeded(paymentIntent);
    return;
  }

  const payment = await findPaymentByStripeId(paymentIntent.id);
  if (!payment) {
    console.warn('[Stripe Webhook] Payment not found for intent:', paymentIntent.id);
    return;
  }

  // Avoid double-processing
  if (payment.status === 'COMPLETED') return;

  await updatePaymentStatus(payment.id, 'COMPLETED', new Date());

  // Mark the boost on the request if this was a BOOST payment
  if (payment.type === 'BOOST') {
    const requestId = paymentIntent.metadata?.requestId;
    if (!requestId) {
      console.warn('[Stripe Webhook] No requestId in metadata for intent:', paymentIntent.id);
      return;
    }

    const request = await findRequestById(requestId);
    if (!request || request.isBoosted) return;

    await boostRequest(requestId, payment.amount);

    // Invalidate queue cache so the boost takes effect
    const session = await findSessionById(request.sessionId);
    if (session) {
      invalidateQueueCache(session.id);
    }
  }
}

async function handleCreditPurchaseSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const userId = paymentIntent.metadata?.userId;
  if (!userId) {
    console.warn('[Stripe Webhook] No userId in CREDIT_PURCHASE metadata:', paymentIntent.id);
    return;
  }

  // Idempotency check
  const existingTx = await prisma.creditTransaction.findFirst({
    where: { userId, paymentId: paymentIntent.id, type: 'PURCHASE' },
  });
  if (existingTx) return; // Already processed

  const bundleKey = paymentIntent.metadata?.bundleKey as CreditBundleKey | undefined;
  const bundle = bundleKey ? CREDIT_BUNDLES.find((b) => b.key === bundleKey) : null;
  const credits = bundle
    ? bundle.credits
    : parseInt(paymentIntent.metadata?.credits ?? '0', 10);

  if (!credits || credits <= 0) {
    console.warn('[Stripe Webhook] Could not determine credits for intent:', paymentIntent.id);
    return;
  }

  await addCreditsToUser(
    userId,
    credits,
    'PURCHASE',
    bundle ? bundle.label : `${credits} credits purchased`,
    paymentIntent.id,
  );

  console.log(`[Stripe Webhook] Added ${credits} credits to user ${userId} via webhook`);
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const payment = await findPaymentByStripeId(paymentIntent.id);
  if (!payment) return;

  await updatePaymentStatus(payment.id, 'FAILED');
}
