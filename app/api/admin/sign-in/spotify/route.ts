import { NextRequest, NextResponse } from 'next/server';
import { createAdminOAuthState, setAdminOAuthStateCookie } from '@/lib/adminAuth';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'streaming',
  'user-read-email',
  'user-read-private',
  'playlist-read-private',       // Required for importing user playlists
].join(' ');

export async function GET(_req: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (!clientId || !baseUrl) {
    return NextResponse.json({ error: 'Spotify not configured' }, { status: 500 });
  }

  const state = createAdminOAuthState('signin', 'spotify');
  const authUrl = new URL(SPOTIFY_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('redirect_uri', `${baseUrl}/api/admin/callback/spotify`);
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl.toString());
  setAdminOAuthStateCookie(response, state);
  return response;
}
