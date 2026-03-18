import { NextRequest, NextResponse } from 'next/server';
import {
  clearPendingAdminOnboardingCookies,
  clearPendingAdminSessionCookies,
  getPendingAdminOnboarding,
  setPendingAdminSessionCookies,
} from '@/lib/adminAuth';
import {
  createVenue,
  findVenueByAdminGoogleId,
  findVenueByAdminSpotifyId,
  rotateAdminAuthToken,
  updateVenueAdminOAuth,
  updateVenueOAuthTokens,
} from '@/lib/db/venues';

export async function GET(req: NextRequest) {
  const pending = getPendingAdminOnboarding(req.cookies);
  if (!pending) {
    return NextResponse.json({ error: 'No pending admin onboarding session' }, { status: 404 });
  }

  return NextResponse.json({
    provider: pending.provider,
    connectedAccountName: pending.connectedAccountName ?? null,
    connectedAccountEmail: pending.connectedAccountEmail ?? null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const pending = getPendingAdminOnboarding(req.cookies);
    if (!pending) {
      return NextResponse.json({ error: 'No pending admin onboarding session' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const venueName =
      typeof body.venueName === 'string' ? body.venueName.trim() : '';

    if (!venueName) {
      return NextResponse.json({ error: 'venueName is required' }, { status: 400 });
    }

    const providerVenue = pending.provider === 'spotify'
      ? await findVenueByAdminSpotifyId(pending.providerUserId)
      : await findVenueByAdminGoogleId(pending.providerUserId);

    const settings = {
      defaultBoostPrice: typeof body.defaultBoostPrice === 'number' ? body.defaultBoostPrice : undefined,
      maxSongRepeatsPerHour: typeof body.maxSongRepeatsPerHour === 'number' ? body.maxSongRepeatsPerHour : undefined,
      maxSongsPerUser: typeof body.maxSongsPerUser === 'number' ? body.maxSongsPerUser : undefined,
      monetizationEnabled: typeof body.monetizationEnabled === 'boolean' ? body.monetizationEnabled : undefined,
      smartMonetizationEnabled: typeof body.smartMonetizationEnabled === 'boolean' ? body.smartMonetizationEnabled : undefined,
      suggestionModeEnabled: typeof body.suggestionModeEnabled === 'boolean' ? body.suggestionModeEnabled : undefined,
      crowdControlEnabled: typeof body.crowdControlEnabled === 'boolean' ? body.crowdControlEnabled : undefined,
    };

    const venue = providerVenue ?? await createVenue({
      name: venueName,
      adminSpotifyId: pending.provider === 'spotify' ? pending.providerUserId : undefined,
      adminGoogleId: pending.provider === 'google' ? pending.providerUserId : undefined,
      streamingService: pending.provider === 'spotify' ? 'spotify' : 'youtube',
      oauthAccessToken: pending.accessToken,
      oauthRefreshToken: pending.refreshToken ?? null,
      oauthTokenExpiresAt: new Date(pending.expiresAt),
      oauthScope: pending.scope ?? null,
      connectedAccountName: pending.connectedAccountName ?? null,
      connectedAccountEmail: pending.connectedAccountEmail ?? null,
      ...settings,
    });

    if (providerVenue) {
      await updateVenueOAuthTokens(providerVenue.id, {
        accessToken: pending.accessToken,
        refreshToken: pending.refreshToken ?? providerVenue.oauthRefreshToken ?? null,
        expiresAt: new Date(pending.expiresAt),
        scope: pending.scope ?? null,
        streamingService: pending.provider === 'spotify' ? 'spotify' : 'youtube',
        connectedAccountName: pending.connectedAccountName ?? null,
        connectedAccountEmail: pending.connectedAccountEmail ?? null,
      });
      await updateVenueAdminOAuth(providerVenue.id, {
        adminSpotifyId: pending.provider === 'spotify' ? pending.providerUserId : undefined,
        adminGoogleId: pending.provider === 'google' ? pending.providerUserId : undefined,
      });
    }

    const authToken = await rotateAdminAuthToken(venue.id);
    const response = NextResponse.json({ success: true, venueId: venue.id }, { status: providerVenue ? 200 : 201 });
    clearPendingAdminOnboardingCookies(response);
    clearPendingAdminSessionCookies(response);
    setPendingAdminSessionCookies(response, {
      venueId: venue.id,
      authToken,
      provider: pending.provider,
      connectedProvider: pending.provider,
    });
    return response;
  } catch (error) {
    console.error('[POST /api/admin/onboarding]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
