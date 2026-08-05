import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SpotifyAppTokenProvider } from './token.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SpotifyAppTokenProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches a token on first call using client-credentials grant', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }));
    const provider = new SpotifyAppTokenProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });

    const token = await provider.getToken();

    expect(token).toBe('tok-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('grant_type=client_credentials');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
  });

  it('caches the token and does not refetch before expiry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }));
    const provider = new SpotifyAppTokenProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });

    await provider.getToken();
    await provider.getToken();
    await provider.getToken();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('auto-refreshes once the token nears expiry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-2', expires_in: 3600 }));
    const provider = new SpotifyAppTokenProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });

    const first = await provider.getToken();
    expect(first).toBe('tok-1');

    // Advance past expiry minus the refresh skew.
    vi.advanceTimersByTime(3600 * 1000);

    const second = await provider.getToken();
    expect(second).toBe('tok-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refresh() forces a new token even if the cached one is still valid', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-2', expires_in: 3600 }));
    const provider = new SpotifyAppTokenProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });

    await provider.getToken();
    const refreshed = await provider.refresh();

    expect(refreshed).toBe('tok-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws a descriptive error when the token endpoint fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad creds', { status: 400 }));
    const provider = new SpotifyAppTokenProvider({
      clientId: 'id',
      clientSecret: 'secret',
      fetchImpl,
    });

    await expect(provider.getToken()).rejects.toThrow(/Spotify token request failed: 400/);
  });
});
