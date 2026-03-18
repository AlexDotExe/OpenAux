import { NextRequest, NextResponse } from 'next/server';
import { createAdminOAuthState, setAdminOAuthStateCookie } from '@/lib/adminAuth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

export async function GET(_req: NextRequest) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (!clientId || !baseUrl) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 500 });
  }

  const state = createAdminOAuthState('signin', 'google');
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('redirect_uri', `${baseUrl}/api/admin/callback/youtube`);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const response = NextResponse.redirect(authUrl.toString());
  setAdminOAuthStateCookie(response, state);
  return response;
}
