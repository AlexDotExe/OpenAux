/**
 * API Route: Get Effective Monetization Settings
 * GET /api/sessions/[sessionId]/effective-settings
 *
 * Returns either smart or manual settings based on venue configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { findSessionById } from '@/lib/db/sessions';
import { findVenueById } from '@/lib/db/venues';
import { findActiveRequests } from '@/lib/db/requests';
import { calculateSmartSettings } from '@/lib/services/smartMonetization';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { sessionId } = await context.params;

    const session = await findSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const venue = await findVenueById(session.venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    // If smart monetization is enabled, calculate dynamic settings
    if (venue.smartMonetizationEnabled) {
      // Count unique users in session + simulated users
      const requests = await findActiveRequests(sessionId);
      const uniqueUsers = new Set(requests.map(r => r.userId));
      const realUserCount = uniqueUsers.size;
      const totalUserCount = realUserCount + session.simulatedUserCount;

      const smartSettings = calculateSmartSettings(totalUserCount);

      console.log('[effective-settings] Smart mode:', {
        realUsers: realUserCount,
        simulatedUsers: session.simulatedUserCount,
        totalUsers: totalUserCount,
        boostPrice: smartSettings.boostPrice,
      });

      return NextResponse.json({
        ...smartSettings,
        userCount: totalUserCount,
        isSmartMode: true,
      });
    }

    // Otherwise, return manual settings from venue
    return NextResponse.json({
      boostPrice: venue.defaultBoostPrice,
      maxSongsPerUser: venue.maxSongsPerUser,
      maxSongRepeatsPerHour: venue.maxSongRepeatsPerHour,
      monetizationEnabled: venue.monetizationEnabled,
      userCount: 0, // Not calculated in manual mode
      isSmartMode: false,
    });
  } catch (err) {
    console.error('[GET /api/sessions/[sessionId]/effective-settings]', err);
    return NextResponse.json({ error: 'Failed to get settings' }, { status: 500 });
  }
}
