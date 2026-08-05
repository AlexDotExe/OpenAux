import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PlaybackDevice } from '@openaux/shared';
import { TokenCipher } from './crypto.js';
import { signState } from './oauth-state.js';
import { registerProviderAuthRoutes, type DeviceLister } from './auth-routes.js';
import { PgVenueTokenStore, type QueryablePool } from './token-store.js';

const KEY = randomBytes(32);
const CIPHER = new TokenCipher(KEY);
const ADMIN_TOKEN = 'admin-secret';
const VENUE_ID = 'venue-1';
const REDIRECT_URI = 'https://api.example/api/spotify/callback';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fake pool over venue_provider_tokens + venues.playback_device_id writes. */
function fakePool() {
  const tokenRows = new Map<string, Record<string, unknown>>();
  const venues = new Set<string>();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('insert into venue_provider_tokens')) {
      const [venueId, provider, access, refresh, expiresAt, scope] = params as [
        string,
        string,
        string,
        string | null,
        Date,
        string,
      ];
      tokenRows.set(`${venueId}:${provider}`, {
        access_token_encrypted: access,
        refresh_token_encrypted: refresh,
        expires_at: expiresAt,
        scope,
      });
      return { rows: [] };
    }
    if (sql.includes('from venue_provider_tokens')) {
      const [venueId, provider] = params as [string, string];
      const row = tokenRows.get(`${venueId}:${provider}`);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('update venues set playback_device_id')) {
      const [venueId] = params as [string];
      return { rows: venues.has(venueId) ? [{ venue_id: venueId }] : [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { pool: { query } as QueryablePool, tokenRows, venues, query };
}

async function buildApp(over?: {
  fetchImpl?: typeof fetch;
  deviceLister?: DeviceLister;
  poolCtx?: ReturnType<typeof fakePool>;
}) {
  const poolCtx = over?.poolCtx ?? fakePool();
  const tokenStore = new PgVenueTokenStore(poolCtx.pool, CIPHER);
  const app = Fastify();
  await app.register(registerProviderAuthRoutes, {
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectUri: REDIRECT_URI,
    encryptionKey: KEY,
    tokenStore,
    pool: poolCtx.pool,
    adminToken: ADMIN_TOKEN,
    fetchImpl: over?.fetchImpl ?? (vi.fn() as unknown as typeof fetch),
    deviceLister: over?.deviceLister,
  });
  await app.ready();
  return { app, poolCtx, tokenStore };
}

const authHeader = { authorization: `Bearer ${ADMIN_TOKEN}` };

describe('POST /spotify/connect', () => {
  it('rejects without a valid admin token', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/spotify/connect`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns an authorizeUrl carrying a verifiable signed state', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/spotify/connect`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json<{ authorizeUrl: string }>().authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('scope')).toContain('user-modify-playback-state');
    // The state parameter must round-trip through verifyState back to this venue.
    const { verifyState } = await import('./oauth-state.js');
    const verified = verifyState(url.searchParams.get('state')!, KEY);
    expect(verified).toEqual({ valid: true, venueId: VENUE_ID });
    await app.close();
  });
});

describe('GET /spotify/callback', () => {
  it('exchanges the code and stores encrypted tokens on a valid state', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'user-modify-playback-state',
      }),
    ) as unknown as typeof fetch;
    const { app, poolCtx } = await buildApp({ fetchImpl });

    const state = signState(VENUE_ID, KEY);
    const res = await app.inject({
      method: 'GET',
      url: `/api/spotify/callback?code=the-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Spotify connected');
    // Token persisted as ciphertext, decryptable back to plaintext.
    const stored = poolCtx.tokenRows.get(`${VENUE_ID}:spotify`)!;
    expect(stored.access_token_encrypted).not.toBe('access-1');
    expect(CIPHER.decrypt(stored.access_token_encrypted as string)).toBe('access-1');
    expect(stored.scope).toBe('user-modify-playback-state');
    await app.close();
  });

  it('rejects a tampered/invalid state without calling Spotify', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { app } = await buildApp({ fetchImpl });
    const res = await app.inject({
      method: 'GET',
      url: `/api/spotify/callback?code=c&state=forged.sig`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('invalid or has expired');
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an expired state', async () => {
    const { app } = await buildApp();
    const expired = signState(VENUE_ID, KEY, Date.now() - 20 * 60 * 1000);
    const res = await app.inject({
      method: 'GET',
      url: `/api/spotify/callback?code=c&state=${encodeURIComponent(expired)}`,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('shows an error page (no throw) when the code exchange fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'invalid_grant' }, 400));
    const { app } = await buildApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const state = signState(VENUE_ID, KEY);
    const res = await app.inject({
      method: 'GET',
      url: `/api/spotify/callback?code=bad&state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('could not complete');
    await app.close();
  });
});

describe('GET /spotify/status', () => {
  it('reports not linked with no token material before connecting', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/venues/${VENUE_ID}/spotify/status`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ linked: false, scope: null, expiresAt: null });
    await app.close();
  });

  it('reports linked with scope + expiry after a token is stored', async () => {
    const { app, tokenStore } = await buildApp();
    const expiresAt = Date.now() + 3600_000;
    await tokenStore.link(VENUE_ID, {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt,
      scope: 'user-read-playback-state',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/venues/${VENUE_ID}/spotify/status`,
      headers: authHeader,
    });
    const body = res.json<{ linked: boolean; scope: string | null; expiresAt: string | null }>();
    expect(body.linked).toBe(true);
    expect(body.scope).toBe('user-read-playback-state');
    expect(body.expiresAt).toBe(new Date(expiresAt).toISOString());
    // Never leak token material.
    expect(res.body).not.toContain('"a"');
    await app.close();
  });
});

describe('GET /playback/devices', () => {
  it('maps Spotify devices to the contract shape', async () => {
    const devices: PlaybackDevice[] = [
      { providerDeviceId: 'dev-1', name: 'Bar Speaker', isActive: true },
    ];
    const deviceLister: DeviceLister = { listDevices: vi.fn(async () => devices) };
    const { app, tokenStore } = await buildApp({ deviceLister });
    await tokenStore.link(VENUE_ID, {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
      scope: 'user-read-playback-state',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/venues/${VENUE_ID}/playback/devices`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ devices });
    await app.close();
  });

  it('returns 400 when no Spotify account is linked', async () => {
    const deviceLister: DeviceLister = { listDevices: vi.fn() };
    const { app } = await buildApp({ deviceLister });
    const res = await app.inject({
      method: 'GET',
      url: `/api/venues/${VENUE_ID}/playback/devices`,
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    expect(deviceLister.listDevices).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('PUT /playback/device', () => {
  it('persists playback_device_id and echoes it back', async () => {
    const poolCtx = fakePool();
    poolCtx.venues.add(VENUE_ID);
    const { app } = await buildApp({ poolCtx });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/venues/${VENUE_ID}/playback/device`,
      headers: authHeader,
      payload: { providerDeviceId: 'dev-9' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ playbackDeviceId: 'dev-9' });
    await app.close();
  });

  it('rejects an empty providerDeviceId with a validation error', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/venues/${VENUE_ID}/playback/device`,
      headers: authHeader,
      payload: { providerDeviceId: '  ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('validation');
    await app.close();
  });

  it('returns 404 when the venue does not exist', async () => {
    const poolCtx = fakePool(); // no venues seeded
    const { app } = await buildApp({ poolCtx });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/venues/${VENUE_ID}/playback/device`,
      headers: authHeader,
      payload: { providerDeviceId: 'dev-9' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
