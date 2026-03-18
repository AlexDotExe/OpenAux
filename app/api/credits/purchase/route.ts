/**
 * API Route: Create Stripe Payment Intent for a credit bundle purchase
 * POST /api/credits/purchase
 *
 * Creates a Stripe PaymentIntent (no Payment DB record — CreditTransaction
 * is used as the source of truth once the payment succeeds).
 * Returns the client secret to the frontend for in-app payment completion.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { findUserByAuthToken } from '@/lib/db/users';
import { CREDIT_BUNDLES, CreditBundleKey } from '@/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { bundleKey, authToken } = body as { bundleKey: CreditBundleKey; authToken: string };

    if (!bundleKey || !authToken) {
      return NextResponse.json({ error: 'bundleKey and authToken are required' }, { status: 400 });
    }

    // Authenticate the user via authToken
    const user = await findUserByAuthToken(authToken);
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    // Look up the selected bundle
    const bundle = CREDIT_BUNDLES.find((b) => b.key === bundleKey);
    if (!bundle) {
      return NextResponse.json({ error: 'Invalid bundle key' }, { status: 400 });
    }

    // Create a Stripe PaymentIntent (amount in cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(bundle.price * 100),
      currency: 'usd',
      metadata: {
        userId: user.id,
        bundleKey: bundle.key,
        credits: String(bundle.credits),
        type: 'CREDIT_PURCHASE',
      },
      description: `OpenAux credit purchase: ${bundle.credits} credits`,
      automatic_payment_methods: { enabled: true },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: bundle.price,
      credits: bundle.credits,
    });
  } catch (err) {
    console.error('[POST /api/credits/purchase]', err);
    return NextResponse.json({ error: 'Failed to create credit purchase intent' }, { status: 500 });
  }
}
