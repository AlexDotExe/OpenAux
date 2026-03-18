import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { findOrCreateOAuthUser } from '@/lib/db/users';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
      const returnUrl = state ? decodeStateReturnUrl(state) : '/';
      return NextResponse.redirect(`${baseUrl}${returnUrl}?auth_error=spotify_denied`);
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    const { returnUrl, nonce } = decodeState(state);

    // Use dedicated user OAuth credentials if provided, otherwise fall back to shared credentials
    const clientId =
      process.env.SPOTIFY_USER_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
    const clientSecret =
      process.env.SPOTIFY_USER_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('[Spotify user callback] Missing Spotify credentials');
      return NextResponse.redirect(`${baseUrl}${returnUrl}?auth_error=spotify_not_configured`);
    }
    const redirectUri = `${baseUrl}/api/auth/callback/spotify`;

    // Exchange authorization code for tokens
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
      console.error('[Spotify user callback] Token exchange failed:', text);
      return NextResponse.redirect(`${baseUrl}${returnUrl}?auth_error=spotify_token_failed`);
    }

    const tokenData = await tokenRes.json();

    // Fetch Spotify user profile
    let spotifyUserId: string | undefined;
    let displayName: string | undefined;
    let email: string | undefined;
    try {
      const profileRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        spotifyUserId = profile.id;
        displayName = profile.display_name || profile.id;
        email = profile.email;
      }
    } catch (err) {
      console.error('[Spotify user callback] Failed to fetch profile:', err);
    }

    if (!spotifyUserId) {
      return NextResponse.redirect(`${baseUrl}${returnUrl}?auth_error=spotify_profile_failed`);
    }

    const authToken = uuidv4();
    const user = await findOrCreateOAuthUser({
      spotifyUserId,
      email,
      displayName,
      authProvider: 'spotify',
      authToken,
    });

    // Use a short-lived cookie to pass the auth token back to the client.
    // Avoids exposing the token in URL query parameters (browser history / server logs).
    const redirectResponse = NextResponse.redirect(`${baseUrl}${returnUrl}`);
    redirectResponse.cookies.set('_pending_auth_token', authToken, {
      httpOnly: false, // Client JS must read and store it based on stayLoggedIn preference
      sameSite: 'strict',
      maxAge: 60, // Expires in 60 seconds — client must consume promptly
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
    redirectResponse.cookies.set('_pending_auth_provider', 'spotify', {
      httpOnly: false,
      sameSite: 'strict',
      maxAge: 60,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
    redirectResponse.cookies.set('_pending_auth_user_id', user.id, {
      httpOnly: false,
      sameSite: 'strict',
      maxAge: 60,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    });
    if (nonce) {
      redirectResponse.cookies.set('_pending_auth_nonce', nonce, {
        httpOnly: false,
        sameSite: 'strict',
        maxAge: 60,
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    return redirectResponse;
  } catch (error) {
    console.error('[GET /api/auth/callback/spotify]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function decodeState(state: string): { returnUrl: string; nonce?: string } {
  try {
    return JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
  } catch {
    return { returnUrl: '/' };
  }
}

function decodeStateReturnUrl(state: string): string {
  return decodeState(state).returnUrl;
}
