/**
 * API Route: Get Spotify Access Token
 * GET /api/admin/[venueId]/spotify-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, verifyAdminToken } from '@/lib/db/venues';
import { refreshSpotifyToken } from '@/lib/services/streaming/spotify';

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const adminPassword = req.headers.get('x-admin-password') ?? '';

    if (!await verifyAdminToken(venueId, adminPassword)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (!venue.oauthRefreshToken || venue.streamingService !== 'spotify') {
      return NextResponse.json({ error: 'Spotify not connected' }, { status: 404 });
    }

    // Refresh the token to ensure it's valid
    const tokens = await refreshSpotifyToken(venue.oauthRefreshToken);

    return NextResponse.json({
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
    });
  } catch (err) {
    console.error('[GET /api/admin/[venueId]/spotify-token]', err);
    return NextResponse.json({ error: 'Failed to get token' }, { status: 500 });
  }
}
