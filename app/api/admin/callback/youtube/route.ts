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
  findVenueByAdminGoogleId,
  findVenueById,
  rotateAdminAuthToken,
  updateVenueAdminOAuth,
  updateVenueOAuthTokens,
} from '@/lib/db/venues';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

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
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'google_denied');
    }

    if (!code) {
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'missing_code');
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID!;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET!;
    const redirectUri = `${baseUrl}/api/admin/callback/youtube`;

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[Google admin callback] Token exchange failed:', text);
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'google_token_failed');
    }

    const tokenData = await tokenRes.json();

    let googleUserId: string | null = null;
    let accountName: string | null = null;
    let accountEmail: string | null = null;
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        googleUserId = profile.id ?? null;
        accountName = profile.name ?? profile.email ?? null;
        accountEmail = profile.email ?? null;
      }
    } catch (error) {
      console.error('[Google admin callback] Failed to fetch profile:', error);
    }

    if (!googleUserId) {
      return buildErrorRedirect(baseUrl, getErrorPath(parsedState), 'google_profile_failed');
    }

    const existingLinkedVenue = await findVenueByAdminGoogleId(googleUserId);

    if (parsedState.action === 'connect') {
      const venueId = parsedState.venueId;
      if (!venueId) {
        return buildErrorRedirect(baseUrl, fallbackErrorPath, 'missing_venue');
      }

      if (existingLinkedVenue && existingLinkedVenue.id !== venueId) {
        return buildErrorRedirect(baseUrl, `/admin/${venueId}`, 'google_account_in_use');
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
        streamingService: 'youtube',
        connectedAccountName: accountName,
        connectedAccountEmail: accountEmail,
      });
      await updateVenueAdminOAuth(venueId, { adminGoogleId: googleUserId });
      const authToken = await rotateAdminAuthToken(venueId);

      const response = NextResponse.redirect(`${baseUrl}/admin/${venueId}?connected=google`);
      clearAdminOAuthStateCookie(response);
      clearPendingAdminOnboardingCookies(response);
      clearPendingAdminSessionCookies(response);
      setPendingAdminSessionCookies(response, {
        venueId,
        authToken,
        provider: 'google',
        connectedProvider: 'google',
      });
      return response;
    }

    if (existingLinkedVenue) {
      await updateVenueOAuthTokens(existingLinkedVenue.id, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? existingLinkedVenue.oauthRefreshToken ?? null,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        scope: tokenData.scope ?? null,
        streamingService: 'youtube',
        connectedAccountName: accountName,
        connectedAccountEmail: accountEmail,
      });
      await updateVenueAdminOAuth(existingLinkedVenue.id, { adminGoogleId: googleUserId });
      const authToken = await rotateAdminAuthToken(existingLinkedVenue.id);

      const response = NextResponse.redirect(`${baseUrl}/admin/${existingLinkedVenue.id}`);
      clearAdminOAuthStateCookie(response);
      clearPendingAdminOnboardingCookies(response);
      clearPendingAdminSessionCookies(response);
      setPendingAdminSessionCookies(response, {
        venueId: existingLinkedVenue.id,
        authToken,
        provider: 'google',
        connectedProvider: 'google',
      });
      return response;
    }

    const response = NextResponse.redirect(`${baseUrl}/admin/onboarding`);
    clearAdminOAuthStateCookie(response);
    clearPendingAdminSessionCookies(response);
    clearPendingAdminOnboardingCookies(response);
    setPendingAdminOnboardingCookies(response, {
      provider: 'google',
      providerUserId: googleUserId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      scope: tokenData.scope ?? null,
      connectedAccountName: accountName,
      connectedAccountEmail: accountEmail,
    });
    return response;
  } catch (error) {
    console.error('[GET /api/admin/callback/youtube]', error);
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
