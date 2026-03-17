/**
 * API Route: Create Stripe Payment Intent for a boost
 * POST /api/payments/create-intent
 *
 * Creates a Stripe PaymentIntent and a pending Payment record.
 * Returns the client secret to the frontend so payment can be completed in-app.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createPayment } from '@/lib/db/payments';
import { findRequestById, findActiveRequests } from '@/lib/db/requests';
import { findSessionById } from '@/lib/db/sessions';
import { findVenueById } from '@/lib/db/venues';
import { calculateSmartSettings } from '@/lib/services/smartMonetization';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { requestId, userId } = body;

    if (!requestId || !userId) {
      return NextResponse.json({ error: 'requestId and userId are required' }, { status: 400 });
    }

    // Fetch and validate the request
    const request = await findRequestById(requestId);
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (request.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending requests can be boosted' },
        { status: 400 },
      );
    }
    if (request.userId !== userId) {
      return NextResponse.json(
        { error: 'You can only boost your own requests' },
        { status: 403 },
      );
    }
    if (request.isBoosted) {
      return NextResponse.json(
        { error: 'This request has already been boosted' },
        { status: 400 },
      );
    }

    // Fetch session and venue
    const session = await findSessionById(request.sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const venue = await findVenueById(session.venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    // Determine boost price
    let boostPrice: number;

    if (venue.smartMonetizationEnabled) {
      const requests = await findActiveRequests(session.id);
      const uniqueUsers = new Set(requests.map(r => r.userId));
      const totalUserCount = uniqueUsers.size + session.simulatedUserCount;
      const smartSettings = calculateSmartSettings(totalUserCount);
      boostPrice = smartSettings.boostPrice;
    } else {
      if (!venue.monetizationEnabled) {
        return NextResponse.json(
          { error: 'Boost feature is not enabled for this venue' },
          { status: 403 },
        );
      }
      boostPrice = venue.defaultBoostPrice;
    }

    // Boost amount must be positive to require payment
    if (boostPrice <= 0) {
      return NextResponse.json(
        { error: 'Use the boost endpoint directly for free boosts' },
        { status: 400 },
      );
    }

    // Calculate revenue split
    const venueSharePercent = venue.revenueSharePercent / 100;
    const venueShareAmount = boostPrice * venueSharePercent;
    const platformShareAmount = boostPrice * (1 - venueSharePercent);

    // Create Stripe PaymentIntent (amount in cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(boostPrice * 100),
      currency: 'usd',
      metadata: {
        requestId,
        userId,
        venueId: venue.id,
        sessionId: session.id,
      },
      description: `Boost for "${request.song.title}" by ${request.song.artist} at ${venue.name}`,
      automatic_payment_methods: { enabled: true },
    });

    // Record a pending Payment in the database
    await createPayment({
      userId,
      venueId: venue.id,
      amount: boostPrice,
      type: 'BOOST',
      stripePaymentId: paymentIntent.id,
      venueShareAmount,
      platformShareAmount,
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: boostPrice,
    });
  } catch (err) {
    console.error('[POST /api/payments/create-intent]', err);
    return NextResponse.json({ error: 'Failed to create payment intent' }, { status: 500 });
  }
}
