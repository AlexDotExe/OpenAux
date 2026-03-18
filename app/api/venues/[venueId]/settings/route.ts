/**
 * API Route: Venue Settings Management
 * GET /api/venues/[venueId]/settings - Fetch venue settings
 * PUT /api/venues/[venueId]/settings - Update venue settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { findVenueById, updateVenueSettings } from '@/lib/db/venues';

interface RouteContext {
  params: Promise<{ venueId: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const venue = await findVenueById(venueId);

    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    return NextResponse.json({
      defaultBoostPrice: venue.defaultBoostPrice,
      maxSongRepeatsPerHour: venue.maxSongRepeatsPerHour,
      maxSongsPerUser: venue.maxSongsPerUser,
      monetizationEnabled: venue.monetizationEnabled,
      smartMonetizationEnabled: venue.smartMonetizationEnabled,
      suggestionModeEnabled: venue.suggestionModeEnabled,
      activePlaylistId: venue.activePlaylistId ?? null,
      playlistPriority: venue.playlistPriority,
    });
  } catch (err) {
    console.error('[GET /api/venues/[venueId]/settings]', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await context.params;
    const body = await req.json();

    // Validate admin password
    const venue = await findVenueById(venueId);
    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (!body.adminPassword || body.adminPassword !== venue.adminPassword) {
      return NextResponse.json({ error: 'Invalid admin password' }, { status: 401 });
    }

    // Extract settings from body
    const settings: {
      defaultBoostPrice?: number;
      maxSongRepeatsPerHour?: number;
      maxSongsPerUser?: number;
      monetizationEnabled?: boolean;
      smartMonetizationEnabled?: boolean;
      suggestionModeEnabled?: boolean;
      activePlaylistId?: string | null;
      playlistPriority?: boolean;
    } = {};

    if (body.defaultBoostPrice !== undefined) settings.defaultBoostPrice = body.defaultBoostPrice;
    if (body.maxSongRepeatsPerHour !== undefined) settings.maxSongRepeatsPerHour = body.maxSongRepeatsPerHour;
    if (body.maxSongsPerUser !== undefined) settings.maxSongsPerUser = body.maxSongsPerUser;
    if (body.monetizationEnabled !== undefined) settings.monetizationEnabled = body.monetizationEnabled;
    if (body.smartMonetizationEnabled !== undefined) settings.smartMonetizationEnabled = body.smartMonetizationEnabled;
    if (body.suggestionModeEnabled !== undefined) settings.suggestionModeEnabled = body.suggestionModeEnabled;
    if (body.activePlaylistId !== undefined) settings.activePlaylistId = body.activePlaylistId ?? null;
    if (body.playlistPriority !== undefined) settings.playlistPriority = body.playlistPriority;

    const updated = await updateVenueSettings(venueId, settings);

    return NextResponse.json({
      defaultBoostPrice: updated.defaultBoostPrice,
      maxSongRepeatsPerHour: updated.maxSongRepeatsPerHour,
      maxSongsPerUser: updated.maxSongsPerUser,
      monetizationEnabled: updated.monetizationEnabled,
      smartMonetizationEnabled: updated.smartMonetizationEnabled,
      suggestionModeEnabled: updated.suggestionModeEnabled,
      activePlaylistId: updated.activePlaylistId ?? null,
      playlistPriority: updated.playlistPriority,
    });
  } catch (err) {
    console.error('[PUT /api/venues/[venueId]/settings]', err);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
