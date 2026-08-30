/**
 * Spotify authorization-code flow helpers (venue-account linking).
 *
 * - buildAuthorizeUrl: the URL the console redirects the operator to.
 * - exchangeCodeForTokens: swaps the returned `code` for a user access +
 *   refresh token at accounts.spotify.com.
 *
 * Network access goes through an injectable fetch so the flow is unit-tested
 * without hitting Spotify.
 */
import type { FetchLike } from '../types.js';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Scopes required to read devices and control Spotify Connect playback. */
export const SPOTIFY_PLAYBACK_SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
] as const;

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: (opts.scopes ?? SPOTIFY_PLAYBACK_SCOPES).join(' '),
    state: opts.state,
    // Force the consent screen instead of silently auto-redirecting the already
    // logged-in account. This is what lets an operator switch Spotify accounts
    // (the screen exposes a "Not you? / Log out" link); without it a browser
    // with an active Spotify session links that account with no chance to pick.
    show_dialog: 'true',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface SpotifyTokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which the access token must be refreshed. */
  expiresAt: number;
  scope: string;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<SpotifyTokenExchangeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  const basicAuth = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Spotify authorization-code exchange failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  if (!body.access_token || !body.refresh_token) {
    throw new Error('Spotify authorization-code exchange returned no tokens.');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now + body.expires_in * 1000,
    scope: body.scope ?? '',
  };
}
