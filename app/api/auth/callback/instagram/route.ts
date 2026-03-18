import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { findOrCreateOAuthUser } from '@/lib/db/users';

const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com/me';

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  try {
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    const error = req.nextUrl.searchParams.get('error');

    if (error) {
      const returnUrl = state ? decodeStateReturnUrl(state) : '/';
      return NextResponse.redirect(`${baseUrl}${returnUrl}?auth_error=instagram_denied`);
    }

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code or state' }, { status: 400 });
    }

    const { returnUrl, nonce } = decodeState(state);

    const clientId = process.env.INSTAGRAM_CLIENT_ID!;
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET!;
    const redirectUri = `${baseUrl}/api/auth/callback/instagram`;

    // Exchange authorization code for access token
    const tokenRes = await fetch(INSTAGRAM_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[Instagram callback] Token exchange failed:', text);
      return NextResponse.redirect(`${baseUrl}${returnUrl}?auth_error=instagram_token_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const instagramUserId: string = String(tokenData.user_id);

    // Fetch user profile
    let displayName: string | undefined;
    try {
      const profileRes = await fetch(
        `${INSTAGRAM_GRAPH_URL}?fields=id,username&access_token=${accessToken}`,
      );
      if (profileRes.ok) {
        const profile = await profileRes.json();
        displayName = profile.username;
      }
    } catch (err) {
      console.error('[Instagram callback] Failed to fetch profile:', err);
    }

    const authToken = uuidv4();
    const user = await findOrCreateOAuthUser({
      instagramId: instagramUserId,
      displayName,
      authProvider: 'instagram',
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
    redirectResponse.cookies.set('_pending_auth_provider', 'instagram', {
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
    console.error('[GET /api/auth/callback/instagram]', error);
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
