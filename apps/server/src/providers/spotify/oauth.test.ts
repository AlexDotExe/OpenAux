import { describe, expect, it, vi } from 'vitest';
import { SPOTIFY_PLAYBACK_SCOPES, buildAuthorizeUrl, exchangeCodeForTokens } from './oauth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildAuthorizeUrl', () => {
  it('includes the playback scopes, redirect URI, client id and state', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'client-1',
        redirectUri: 'https://api.example/api/spotify/callback',
        state: 'signed-state',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example/api/spotify/callback');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('scope')).toBe(SPOTIFY_PLAYBACK_SCOPES.join(' '));
    // show_dialog forces the consent screen so operators can switch accounts.
    expect(url.searchParams.get('show_dialog')).toBe('true');
  });
});

describe('exchangeCodeForTokens', () => {
  it('posts the authorization_code grant and maps the token response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'user-modify-playback-state user-read-playback-state',
      }),
    );

    const result = await exchangeCodeForTokens({
      code: 'auth-code',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'https://api.example/api/spotify/callback',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: 1_000_000,
    });

    expect(result).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_000_000 + 3600 * 1000,
      scope: 'user-modify-playback-state user-read-playback-state',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).toContain('code=auth-code');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`,
    );
  });

  it('throws when Spotify returns a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    await expect(
      exchangeCodeForTokens({
        code: 'bad',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://api.example/cb',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/exchange failed: 400/);
  });

  it('throws when the token payload is missing a refresh token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'access-1', expires_in: 3600 }),
    );
    await expect(
      exchangeCodeForTokens({
        code: 'x',
        clientId: 'c',
        clientSecret: 's',
        redirectUri: 'https://api.example/cb',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no tokens/);
  });
});
