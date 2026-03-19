import { NextRequest, NextResponse } from 'next/server';
import { createAdminOAuthState, setAdminOAuthStateCookie } from '@/lib/adminAuth';
import { verifyAdminToken } from '@/lib/db/venues';

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const adminToken = req.headers.get('x-admin-password') ?? '';

  if (!clientId || !baseUrl) {
    return NextResponse.json({ error: 'Spotify not configured' }, { status: 500 });
  }
  if (!await verifyAdminToken(venueId, adminToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redirectUri = `${baseUrl}/api/admin/callback/spotify`;
  const state = createAdminOAuthState('connect', 'spotify', venueId);

  const authUrl = new URL(SPOTIFY_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  const response = NextResponse.json({ url: authUrl.toString() });
  setAdminOAuthStateCookie(response, state);
  return response;
}
