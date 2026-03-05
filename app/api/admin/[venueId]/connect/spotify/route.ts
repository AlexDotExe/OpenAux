import { NextRequest, NextResponse } from 'next/server';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'streaming',              // Required for Web Playback SDK
  'user-read-email',        // Required for Web Playback SDK
  'user-read-private',      // Required for Web Playback SDK
].join(' ');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  if (!clientId || !baseUrl) {
    return NextResponse.json({ error: 'Spotify not configured' }, { status: 500 });
  }

  const redirectUri = `${baseUrl}/api/admin/callback/spotify`;
  const state = venueId; // Encode venueId in state for the callback

  const authUrl = new URL(SPOTIFY_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
