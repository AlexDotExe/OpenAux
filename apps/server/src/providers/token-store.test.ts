import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TokenCipher } from './crypto.js';
import { PgVenueTokenStore, setVenuePlaybackDeviceId, type QueryablePool } from './token-store.js';
import { SpotifyProvider } from './spotify/spotify-provider.js';

const CIPHER = new TokenCipher(randomBytes(32));

/**
 * In-memory fake of the encrypted venue_provider_tokens table backed by a
 * single row keyed (venueId, provider). Verifies stored columns are ciphertext.
 */
function fakeStorePool() {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (venueId: string, provider: string) => `${venueId}:${provider}`;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('insert into venue_provider_tokens')) {
      const withScope = sql.includes('scope, updated_at');
      const [venueId, provider, access, refresh, expiresAt] = params as [
        string,
        string,
        string,
        string | null,
        Date,
      ];
      const k = key(venueId, provider);
      const existing = rows.get(k);
      const scope = withScope ? (params[5] as string) : (existing?.scope ?? null);
      rows.set(k, {
        access_token_encrypted: access,
        refresh_token_encrypted: refresh,
        expires_at: expiresAt,
        scope,
      });
      return { rows: [] };
    }
    // select
    const [venueId, provider] = params as [string, string];
    const row = rows.get(key(venueId, provider));
    return { rows: row ? [row] : [] };
  });
  return { pool: { query } as QueryablePool, rows, query };
}

describe('PgVenueTokenStore', () => {
  it('roundtrips tokens: link writes ciphertext, get decrypts', async () => {
    const { pool, rows } = fakeStorePool();
    const store = new PgVenueTokenStore(pool, CIPHER);

    await store.link('venue-1', {
      accessToken: 'access-plain',
      refreshToken: 'refresh-plain',
      expiresAt: Date.now() + 3600_000,
      scope: 'user-modify-playback-state',
    });

    const stored = rows.get('venue-1:spotify')!;
    expect(stored.access_token_encrypted).not.toBe('access-plain');
    expect(stored.refresh_token_encrypted).not.toBe('refresh-plain');
    // Ciphertext must decrypt back to plaintext only via the cipher.
    expect(CIPHER.decrypt(stored.access_token_encrypted as string)).toBe('access-plain');

    const got = await store.get('venue-1');
    expect(got?.accessToken).toBe('access-plain');
    expect(got?.refreshToken).toBe('refresh-plain');
  });

  it('getStatus reports linked state, scope and expiry without token material', async () => {
    const { pool } = fakeStorePool();
    const store = new PgVenueTokenStore(pool, CIPHER);
    expect(await store.getStatus('venue-1')).toEqual({
      linked: false,
      scope: null,
      expiresAt: null,
    });

    const expiresAt = Date.now() + 3600_000;
    await store.link('venue-1', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt,
      scope: 'user-read-playback-state',
    });
    const status = await store.getStatus('venue-1');
    expect(status.linked).toBe(true);
    expect(status.scope).toBe('user-read-playback-state');
    expect(status.expiresAt?.getTime()).toBe(new Date(expiresAt).getTime());
  });

  it('set() (refresh path) preserves the previously granted scope', async () => {
    const { pool } = fakeStorePool();
    const store = new PgVenueTokenStore(pool, CIPHER);
    await store.link('venue-1', {
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: Date.now() + 1000,
      scope: 'user-modify-playback-state',
    });

    await store.set('venue-1', {
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: Date.now() + 3600_000,
    });

    const status = await store.getStatus('venue-1');
    expect(status.scope).toBe('user-modify-playback-state');
    const got = await store.get('venue-1');
    expect(got?.accessToken).toBe('a2');
    expect(got?.refreshToken).toBe('r2');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SpotifyProvider refresh persists through PgVenueTokenStore', () => {
  it('on a 401 it refreshes and writes the rotated token back (decryptable)', async () => {
    const { pool, rows } = fakeStorePool();
    const store = new PgVenueTokenStore(pool, CIPHER);
    await store.link('venue-1', {
      accessToken: 'stale-access',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3600_000, // not expired, so refresh is triggered by the 401
      scope: 'user-modify-playback-state',
    });

    const fetchImpl = vi.fn();
    // 1) play -> 401, 2) token refresh, 3) play retry -> 200
    fetchImpl
      .mockResolvedValueOnce(jsonResponse(undefined, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh-access', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(undefined, 200));

    const provider = new SpotifyProvider({
      clientId: 'id',
      clientSecret: 'secret',
      tokenStore: store,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.play({ venueId: 'venue-1', providerDeviceId: 'device-1' });

    // Rotated access token was persisted encrypted and decrypts to the new value.
    const stored = rows.get('venue-1:spotify')!;
    expect(CIPHER.decrypt(stored.access_token_encrypted as string)).toBe('fresh-access');
    // Refresh token unchanged (Spotify omitted a new one) and still decryptable.
    expect(CIPHER.decrypt(stored.refresh_token_encrypted as string)).toBe('refresh-1');
  });
});

describe('setVenuePlaybackDeviceId', () => {
  it('returns true when a venue row is updated', async () => {
    const query = vi.fn(async () => ({ rows: [{ venue_id: 'venue-1' }] }));
    const ok = await setVenuePlaybackDeviceId({ query } as QueryablePool, 'venue-1', 'device-9');
    expect(ok).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('update venues set playback_device_id'),
      ['venue-1', 'device-9'],
    );
  });

  it('returns false when no venue row matches', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const ok = await setVenuePlaybackDeviceId({ query } as QueryablePool, 'missing', 'device-9');
    expect(ok).toBe(false);
  });
});
