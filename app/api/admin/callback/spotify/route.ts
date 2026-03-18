import { NextRequest, NextResponse } from 'next/server';
import {
  clearAdminOAuthStateCookie,
  clearPendingAdminOnboardingCookies,
  clearPendingAdminSessionCookies,
  parseAdminOAuthState,
  setPendingAdminOnboardingCookies,
  setPendingAdminSessionCookies,
  ADMIN_OAUTH_STATE_COOKIE,
} from '@/lib/adminAuth';
import {
  findVenueByAdminSpotifyId,
  findVenueById,
  rotateAdminAuthToken,
  updateVenueAdminOAuth,
  updateVenueOAuthTokens,
} from '@/lib/db/venues';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  const fallbackErrorPath = '/admin/sign-in';

  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const oauthError = req.nextUrl.searchParams.get('error');
    const parsedState = parseAdminOAuthState(state);
    const storedState = req.cookies.get(ADMIN_OAUTH_STATE_COOKIE)?.value ?? null;

    if (!parsedState || !storedState || storedState !== state) {
      return buildErrorRedirect(baseUrl, fallbackErrorPath, 'invalid_state');
    }

    if (oauthError) {
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'spotify_denied');
    }

    if (!code) {
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'missing_code');
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const redirectUri = `${baseUrl}/api/admin/callback/spotify`;

    const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[Spotify admin callback] Token exchange failed:', text);
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'spotify_token_failed');
    }

    const tokenData = await tokenRes.json();

    let spotifyUserId: string | null = null;
    let accountName: string | null = null;
    let accountEmail: string | null = null;
    try {
      const profileRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        spotifyUserId = profile.id ?? null;
        accountName = profile.display_name || profile.id || null;
        accountEmail = profile.email ?? null;
      }
    } catch (error) {
      console.error('[Spotify admin callback] Failed to fetch profile:', error);
    }

    if (!spotifyUserId) {
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'spotify_profile_failed');
    }

    const existingLinkedVenue = await findVenueByAdminSpotifyId(spotifyUserId);

    if (parsedState.action === 'connect') {
      const venueId = parsedState.venueId;
      if (!venueId) {
        return buildErrorRedirect(baseUrl, fallbackErrorPath, 'missing_venue');
      }

      if (existingLinkedVenue && existingLinkedVenue.id !== venueId) {
        return buildErrorRedirect(baseUrl, `/admin/${venueId}`, 'spotify_account_in_use');
      }

      const venue = await findVenueById(venueId);
      if (!venue) {
        return buildErrorRedirect(baseUrl, fallbackErrorPath, 'venue_not_found');
      }

      await updateVenueOAuthTokens(venueId, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? venue.oauthRefreshToken ?? null,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scope: tokenData.scope ?? null,
        streamingService: 'spotify',
        connectedAccountName: accountName,
        connectedAccountEmail: accountEmail,
      });
      await updateVenueAdminOAuth(venueId, { adminSpotifyId: spotifyUserId });
      const authToken = await rotateAdminAuthToken(venueId);

      const response = NextResponse.redirect(`${baseUrl}/admin/${venueId}?connected=spotify`);
      clearAdminOAuthStateCookie(response);
      clearPendingAdminOnboardingCookies(response);
      clearPendingAdminSessionCookies(response);
      setPendingAdminSessionCookies(response, {
        venueId,
        authToken,
        provider: 'spotify',
        connectedProvider: 'spotify',
      });
      return response;
    }

    if (existingLinkedVenue) {
      await updateVenueOAuthTokens(existingLinkedVenue.id, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? existingLinkedVenue.oauthRefreshToken ?? null,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scope: tokenData.scope ?? null,
        streamingService: 'spotify',
        connectedAccountName: accountName,
        connectedAccountEmail: accountEmail,
      });
      await updateVenueAdminOAuth(existingLinkedVenue.id, { adminSpotifyId: spotifyUserId });
      const authToken = await rotateAdminAuthToken(existingLinkedVenue.id);

      const response = NextResponse.redirect(`${baseUrl}/admin/${existingLinkedVenue.id}`);
      clearAdminOAuthStateCookie(response);
      clearPendingAdminOnboardingCookies(response);
      clearPendingAdminSessionCookies(response);
      setPendingAdminSessionCookies(response, {
        venueId: existingLinkedVenue.id,
        authToken,
        provider: 'spotify',
        connectedProvider: 'spotify',
      });
      return response;
    }

    const response = NextResponse.redirect(`${baseUrl}/admin/onboarding`);
    clearAdminOAuthStateCookie(response);
    clearPendingAdminSessionCookies(response);
    clearPendingAdminOnboardingCookies(response);
    setPendingAdminOnboardingCookies(response, {
      provider: 'spotify',
      providerUserId: spotifyUserId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      scope: tokenData.scope ?? null,
      connectedAccountName: accountName,
      connectedAccountEmail: accountEmail,
    });
    return response;
  } catch (error) {
    console.error('[GET /api/admin/callback/spotify]', error);
    return buildErrorRedirect(baseUrl, fallbackErrorPath, 'internal_error');
  }
}

function getErrorPath(state: { action: 'signin' | 'connect'; venueId?: string }): string {
  if (state.action === 'connect' && state.venueId) {
    return `/admin/${state.venueId}`;
  }

  return '/admin/sign-in';
}

function buildErrorRedirect(baseUrl: string, path: string, error: string): NextResponse {
  const response = NextResponse.redirect(`${baseUrl}${path}?error=${encodeURIComponent(error)}`);
  clearAdminOAuthStateCookie(response);
  return response;
}
