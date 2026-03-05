/**
 * API Route: Boost Song Request
 * POST /api/requests/[requestId]/boost - Boost a song request to the top of the queue
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

    // Boost the request (fake payment for MVP)
    // Note: boostPrice can be 0 (free) or > 0 (paid)
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
