/**
 * API Route: Boost Song Request
 * POST /api/requests/[requestId]/boost - Move a song request up ~3 positions in the queue
 */

import { NextRequest, NextResponse } from 'next/server';
import { boostRequest, findRequestById, findActiveRequests } from '@/lib/db/requests';
import { findSessionById } from '@/lib/db/sessions';
import { findVenueById } from '@/lib/db/venues';
import { getRankedQueue } from '@/lib/services/virtualDjEngine';
import { calculateSmartSettings } from '@/lib/services/smartMonetization';
import { invalidateQueueCache } from '@/lib/services/queueCache';

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

/**
 * Simulate payment processing for the MVP.
 * In production this would be replaced by a real payment gateway call (e.g. Stripe).
 * Always returns true so the boost can proceed — a real implementation would
 * return false on network errors or insufficient funds.
 */
async function simulatePayment(amount: number): Promise<boolean> {
  // Future: call Stripe or another payment processor here
  void amount; // amount will be passed to the payment gateway in production
  return true;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { requestId } = await context.params;
    const body = await req.json();
    const { userId } = body;

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

    // Simulate payment processing before applying the boost.
    // In production this would call a real payment processor (e.g. Stripe).
    // For the MVP we perform a lightweight validation step and then mark the
    // boost as paid so the guard in the DB layer fires correctly.
    if (boostPrice > 0) {
      // Stub: simulate a payment verification delay and confirm success
      const paymentSuccess = await simulatePayment(boostPrice);
      if (!paymentSuccess) {
        return NextResponse.json(
          { error: 'Payment processing failed. Please try again.' },
          { status: 402 },
        );
      }
    }

    // Boost the request — payment has already been (simulated as) processed
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
