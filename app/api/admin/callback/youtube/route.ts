import { NextRequest, NextResponse } from 'next/server';
import { updateVenueOAuthTokens } from '@/lib/db/venues';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state'); // venueId
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL}/admin/${state}?error=youtube_denied`,
      );
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID!;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET!;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
    const redirectUri = `${baseUrl}/api/admin/callback/youtube`;

    // Exchange authorization code for tokens
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
      console.error('[YouTube callback] Token exchange failed:', text);
      return NextResponse.redirect(
        `${baseUrl}/admin/${state}?error=youtube_token_failed`,
      );
    }

    const tokenData = await tokenRes.json();

    // Fetch Google user profile
    let accountName = null;
    let accountEmail = null;
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        accountName = profile.name;
        accountEmail = profile.email;
      }
    } catch (err) {
      console.error('Failed to fetch Google profile:', err);
    }

    await updateVenueOAuthTokens(state, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      scope: tokenData.scope,
      streamingService: 'youtube',
      connectedAccountName: accountName,
      connectedAccountEmail: accountEmail,
    });

    return NextResponse.redirect(`${baseUrl}/admin/${state}?connected=youtube`);
  } catch (error) {
    console.error('[GET /api/admin/callback/youtube]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
