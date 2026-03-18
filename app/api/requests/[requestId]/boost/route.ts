/**
 * API Route: Boost Song Request
 * POST /api/requests/[requestId]/boost - Move a song request up ~3 positions in the queue
 *
 * For free boosts (boostPrice === 0): pass { userId }
 * For paid boosts via Stripe: pass { userId, stripePaymentIntentId } after completing payment
 * For paid boosts via credits: pass { userId, useCredits: true, authToken }
 */

import { NextRequest, NextResponse } from 'next/server';
import { boostRequest, findRequestById, findActiveRequests } from '@/lib/db/requests';
import { findSessionById } from '@/lib/db/sessions';
import { findVenueById } from '@/lib/db/venues';
import { getRankedQueue } from '@/lib/services/virtualDjEngine';
import { calculateSmartSettings } from '@/lib/services/smartMonetization';
import { invalidateQueueCache } from '@/lib/services/queueCache';
import { stripe } from '@/lib/stripe';
import { findPaymentByStripeId, updatePaymentStatus } from '@/lib/db/payments';
import { findUserByAuthToken } from '@/lib/db/users';
import { deductCreditsForBoost } from '@/lib/db/credits';

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { requestId } = await context.params;
    const body = await req.json();
    const { userId, stripePaymentIntentId, useCredits, authToken } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Fetch the request
    const request = await findRequestById(requestId);
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Verify request is PENDING
    if (request.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only pending requests can be boosted' },
        { status: 400 },
      );
    }

    // Verify user owns the request
    if (request.userId !== userId) {
      return NextResponse.json(
        { error: 'You can only boost your own requests' },
        { status: 403 },
      );
    }

    // Verify request is not already boosted
    if (request.isBoosted) {
      return NextResponse.json(
        { error: 'This request has already been boosted' },
        { status: 400 },
      );
    }

    // Fetch session and venue to check monetization settings
    const session = await findSessionById(request.sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const venue = await findVenueById(session.venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    // Determine effective settings (smart or manual)
    let boostPrice: number;

    if (venue.smartMonetizationEnabled) {
      // Calculate smart settings based on user count + simulated users
      const requests = await findActiveRequests(session.id);
      const uniqueUsers = new Set(requests.map(r => r.userId));
      const realUserCount = uniqueUsers.size;
      const totalUserCount = realUserCount + session.simulatedUserCount;

      const smartSettings = calculateSmartSettings(totalUserCount);
      boostPrice = smartSettings.boostPrice;
    } else {
      // Use manual settings from venue
      boostPrice = venue.defaultBoostPrice;

      // Only check monetization enabled in manual mode
      if (!venue.monetizationEnabled) {
        return NextResponse.json(
          { error: 'Boost feature is not enabled for this venue' },
          { status: 403 },
        );
      }
    }

    // For paid boosts, handle payment verification
    if (boostPrice > 0) {
      if (useCredits) {
        // Credit-based boost
        if (!authToken) {
          return NextResponse.json(
            { error: 'authToken is required for credit boosts' },
            { status: 400 },
          );
        }

        const user = await findUserByAuthToken(authToken);
        if (!user || user.id !== userId) {
          return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
        }

        try {
          await deductCreditsForBoost(
            userId,
            boostPrice,
            requestId,
            `Boost for "${request.song.title}" by ${request.song.artist}`,
          );
        } catch (err: unknown) {
          if (err instanceof Error && err.message === 'Insufficient credit balance') {
            return NextResponse.json(
              { error: 'Insufficient credit balance. Please purchase more credits.' },
              { status: 402 },
            );
          }
          throw err;
        }
      } else {
        // Stripe payment-based boost
        if (!stripePaymentIntentId) {
          return NextResponse.json(
            { error: 'stripePaymentIntentId or useCredits is required for paid boosts' },
            { status: 400 },
          );
        }

        // Verify payment intent with Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);

        if (paymentIntent.status !== 'succeeded') {
          return NextResponse.json(
            { error: 'Payment has not been completed' },
            { status: 402 },
          );
        }

        // Verify the payment intent is for this request
        if (paymentIntent.metadata?.requestId !== requestId) {
          return NextResponse.json(
            { error: 'Payment intent does not match this request' },
            { status: 400 },
          );
        }

        // Update the payment record to COMPLETED
        const payment = await findPaymentByStripeId(stripePaymentIntentId);
        if (payment && payment.status !== 'COMPLETED') {
          await updatePaymentStatus(payment.id, 'COMPLETED', new Date());
        }
      }
    }

    // Boost the request — position-based (+3 spots)
    const updated = await boostRequest(requestId, boostPrice);

    // Invalidate cache and get fresh queue
    invalidateQueueCache(session.id);
    const queue = await getRankedQueue(session.id, true); // skipCache = true

    return NextResponse.json({
      success: true,
      request: updated,
      queue,
    });
  } catch (err) {
    console.error('[POST /api/requests/[requestId]/boost]', err);
    return NextResponse.json({ error: 'Failed to boost request' }, { status: 500 });
  }
}
