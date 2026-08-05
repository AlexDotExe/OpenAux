import { describe, expect, it, vi } from 'vitest';
import type { PlaybackTarget, Track } from '@openaux/shared';
import { InMemoryVenueTokenStore } from '../types.js';
import { SpotifyProvider } from './spotify-provider.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Queue of canned responses returned in call order, regardless of URL. */
function queuedFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('queuedFetch: no more responses queued');
    return next;
  });
}

function makeProvider(
  fetchImpl: ReturnType<typeof vi.fn>,
  tokenStore = new InMemoryVenueTokenStore(),
) {
  return new SpotifyProvider({
    clientId: 'id',
    clientSecret: 'secret',
    tokenStore,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

const SAMPLE_TRACK_JSON = {
  id: 'track-1',
  name: 'Song One',
  artists: [{ id: 'artist-1', name: 'Artist One' }],
  album: { name: 'Album One', images: [{ url: 'https://img/large.jpg', width: 640, height: 640 }] },
  duration_ms: 210_000,
  explicit: true,
};

describe('SpotifyProvider.searchTracks', () => {
  it('maps results to the shared Track shape including genres from the artist batch call', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ access_token: 'app-tok', expires_in: 3600 }), // app token
      jsonResponse({ tracks: { items: [SAMPLE_TRACK_JSON] } }), // search
      jsonResponse({ artists: [{ id: 'artist-1', genres: ['pop', 'dance pop'] }] }), // artist genres
    ]);
    const provider = makeProvider(fetchImpl);

    const results = await provider.searchTracks('song one', { limit: 10 });

    expect(results).toHaveLength(1);
    const track = results[0] as Track;
    expect(track).toEqual({
      provider: 'spotify',
      providerTrackId: 'track-1',
      title: 'Song One',
      artist: 'Artist One',
      album: 'Album One',
      durationMs: 210_000,
      explicit: true,
      genres: ['pop', 'dance pop'],
      artworkUrl: 'https://img/large.jpg',
    });
  });

  it('caps the limit at 50', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ access_token: 'app-tok', expires_in: 3600 }),
      jsonResponse({ tracks: { items: [] } }),
      jsonResponse({ artists: [] }),
    ]);
    const provider = makeProvider(fetchImpl);

    await provider.searchTracks('x', { limit: 500 });

    const searchCall = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(searchCall[0]).toContain('limit=50');
  });
});

describe('SpotifyProvider.getTrack', () => {
  it('returns null on 404', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ access_token: 'app-tok', expires_in: 3600 }),
      new Response(null, { status: 404 }),
    ]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.getTrack('missing-id');

    expect(result).toBeNull();
  });

  it('retries once on a 401 from the app token and succeeds with the refreshed token', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ access_token: 'app-tok-1', expires_in: 3600 }), // initial app token
      new Response(null, { status: 401 }), // catalog call rejected
      jsonResponse({ access_token: 'app-tok-2', expires_in: 3600 }), // forced refresh
      jsonResponse(SAMPLE_TRACK_JSON), // retried catalog call
      jsonResponse({ artists: [{ id: 'artist-1', genres: [] }] }), // genre batch
    ]);
    const provider = makeProvider(fetchImpl);

    const result = await provider.getTrack('track-1');

    expect(result?.providerTrackId).toBe('track-1');
    // Confirm the retried call used the refreshed token.
    const retriedCall = fetchImpl.mock.calls[3] as [string, RequestInit];
    const headers = retriedCall[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer app-tok-2');
  });

  it('throws on non-401/404 failures', async () => {
    const fetchImpl = queuedFetch([
      jsonResponse({ access_token: 'app-tok', expires_in: 3600 }),
      new Response('server error', { status: 500 }),
    ]);
    const provider = makeProvider(fetchImpl);

    await expect(provider.getTrack('track-1')).rejects.toThrow(/Spotify API request failed: 500/);
  });
});

describe('SpotifyProvider playback (Spotify Connect)', () => {
  const target: PlaybackTarget = { venueId: 'venue-1', providerDeviceId: 'device-1' };
  const track: Track = {
    provider: 'spotify',
    providerTrackId: 'track-1',
    title: 'Song One',
    artist: 'Artist One',
    album: 'Album One',
    durationMs: 210_000,
    explicit: false,
    genres: [],
    artworkUrl: null,
  };

  it('throws when the venue has no linked Spotify account', async () => {
    const fetchImpl = queuedFetch([]);
    const provider = makeProvider(fetchImpl);

    await expect(provider.queueNext(target, track)).rejects.toThrow(/No Spotify account linked/);
  });

  it('queues a track using the venue user token', async () => {
    const tokenStore = new InMemoryVenueTokenStore();
    await tokenStore.set('venue-1', {
      accessToken: 'user-tok',
      refreshToken: 'refresh-tok',
      expiresAt: Date.now() + 3600_000,
    });
    const fetchImpl = queuedFetch([new Response(null, { status: 204 })]);
    const provider = makeProvider(fetchImpl, tokenStore);

    await provider.queueNext(target, track);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/me/player/queue');
    expect(url).toContain('uri=spotify%3Atrack%3Atrack-1');
    expect(url).toContain('device_id=device-1');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer user-tok');
  });

  it('refreshes the venue token via refresh_token grant on 401 and retries once', async () => {
    const tokenStore = new InMemoryVenueTokenStore();
    await tokenStore.set('venue-1', {
      accessToken: 'expired-tok',
      refreshToken: 'refresh-tok',
      expiresAt: Date.now() + 3600_000, // still "fresh" by clock, but server says 401
    });
    const fetchImpl = queuedFetch([
      new Response(null, { status: 401 }), // first attempt rejected
      jsonResponse({ access_token: 'new-user-tok', expires_in: 3600 }), // refresh grant
      new Response(null, { status: 204 }), // retried call succeeds
    ]);
    const provider = makeProvider(fetchImpl, tokenStore);

    await provider.play(target);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const refreshCall = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(refreshCall[0]).toBe('https://accounts.spotify.com/api/token');
    expect(refreshCall[1].body).toContain('grant_type=refresh_token');
    expect(refreshCall[1].body).toContain('refresh_tok');

    const retriedCall = fetchImpl.mock.calls[2] as [string, RequestInit];
    const headers = retriedCall[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer new-user-tok');

    // The store should now hold the refreshed access token.
    const stored = await tokenStore.get('venue-1');
    expect(stored?.accessToken).toBe('new-user-tok');
  });

  it('listDevices maps Spotify Connect devices to the contract shape and drops device-less entries', async () => {
    const tokenStore = new InMemoryVenueTokenStore();
    await tokenStore.set('venue-1', {
      accessToken: 'user-tok',
      refreshToken: 'refresh-tok',
      expiresAt: Date.now() + 3600_000,
    });
    const fetchImpl = queuedFetch([
      jsonResponse({
        devices: [
          { id: 'dev-1', name: 'Bar Speaker', is_active: true },
          { id: null, name: 'Restricted', is_active: false },
          { id: 'dev-2', name: 'Back Room', is_active: false },
        ],
      }),
    ]);
    const provider = makeProvider(fetchImpl, tokenStore);

    const devices = await provider.listDevices('venue-1');

    expect(devices).toEqual([
      { providerDeviceId: 'dev-1', name: 'Bar Speaker', isActive: true },
      { providerDeviceId: 'dev-2', name: 'Back Room', isActive: false },
    ]);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/me/player/devices');
  });

  it('getNowPlaying reports silence on 204 (nothing playing)', async () => {
    const tokenStore = new InMemoryVenueTokenStore();
    await tokenStore.set('venue-1', {
      accessToken: 'user-tok',
      refreshToken: 'refresh-tok',
      expiresAt: Date.now() + 3600_000,
    });
    const fetchImpl = queuedFetch([new Response(null, { status: 204 })]);
    const provider = makeProvider(fetchImpl, tokenStore);

    const state = await provider.getNowPlaying(target);

    expect(state).toEqual({ track: null, positionMs: 0, isPlaying: false });
  });

  it('getNowPlaying maps the currently playing track', async () => {
    const tokenStore = new InMemoryVenueTokenStore();
    await tokenStore.set('venue-1', {
      accessToken: 'user-tok',
      refreshToken: 'refresh-tok',
      expiresAt: Date.now() + 3600_000,
    });
    const fetchImpl = queuedFetch([
      jsonResponse({ item: SAMPLE_TRACK_JSON, progress_ms: 5000, is_playing: true }), // GET /me/player
      jsonResponse({ access_token: 'app-tok', expires_in: 3600 }), // app token for the genre lookup
      jsonResponse({ artists: [{ id: 'artist-1', genres: ['pop'] }] }), // genre batch call
    ]);
    const provider = makeProvider(fetchImpl, tokenStore);

    const state = await provider.getNowPlaying(target);

    expect(state.isPlaying).toBe(true);
    expect(state.positionMs).toBe(5000);
    expect(state.track?.providerTrackId).toBe('track-1');
    expect(state.track?.genres).toEqual(['pop']);
  });
});
