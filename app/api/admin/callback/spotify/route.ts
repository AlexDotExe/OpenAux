import { NextRequest, NextResponse } from 'next/server';
import { updateVenueOAuthTokens } from '@/lib/db/venues';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state'); // venueId
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL}/admin/${state}?error=spotify_denied`,
      );
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
    const redirectUri = `${baseUrl}/api/admin/callback/spotify`;

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
      console.error('[Spotify callback] Token exchange failed:', text);
      return NextResponse.redirect(
        `${baseUrl}/admin/${state}?error=spotify_token_failed`,
      );
    }

    const tokenData = await tokenRes.json();

    // Fetch Spotify user profile
    let accountName = null;
    let accountEmail = null;
    try {
      const profileRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        accountName = profile.display_name || profile.id;
        accountEmail = profile.email;
      }
    } catch (err) {
      console.error('Failed to fetch Spotify profile:', err);
    }

    await updateVenueOAuthTokens(state, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      scope: tokenData.scope,
      streamingService: 'spotify',
      connectedAccountName: accountName,
      connectedAccountEmail: accountEmail,
    });

    return NextResponse.redirect(`${baseUrl}/admin/${state}?connected=spotify`);
  } catch (error) {
    console.error('[GET /api/admin/callback/spotify]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
