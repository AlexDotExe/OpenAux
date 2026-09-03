import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, HttpApiClient, __resetApiClientForTests, getApiClient } from './api';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HttpApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends POST /api/sessions/join with the request body and parses the response', async () => {
    const session = {
      sessionId: 's1',
      userId: 'u1',
      venueId: 'venue-1',
      joinedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      isGuest: true,
      isActive: true,
      sessionExpiredAt: null,
      activeRequestCount: 0,
      cooldownEndsAt: null,
      lastVoteAt: null,
      lastRequestAt: null,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        session,
        venue: { venueId: 'venue-1', name: 'The Rooftop', controlMode: 'crowd' },
      }),
    );

    const client = new HttpApiClient();
    const res = await client.joinSession({ venueQrToken: 'demo-qr-token' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/sessions/join');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ venueQrToken: 'demo-qr-token' });
    expect(res.venue.name).toBe('The Rooftop');
  });

  it('attaches X-Session-Id and X-Venue-Admin-Token auth headers when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tracks: [] }));
    const client = new HttpApiClient();
    await client.getPosition('qi-1', { sessionId: 'sess-abc' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-Session-Id']).toBe('sess-abc');
    expect(init.headers['X-Venue-Admin-Token']).toBeUndefined();
  });

  it('throws ApiClientError with the code/message from the ApiError envelope on failure', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'request_cooldown', message: 'Slow down.' } }, { status: 429 }),
    );
    const client = new HttpApiClient();

    await expect(
      client.createRequest('venue-1', { providerTrackId: 't-1' }, { sessionId: 's1' }),
    ).rejects.toMatchObject(new ApiClientError('request_cooldown', 'Slow down.'));
  });

  it('wraps network failures in an ApiClientError with code "internal"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const client = new HttpApiClient();

    await expect(client.getQueue('venue-1')).rejects.toMatchObject({ code: 'internal' });
  });

  it('treats a 204 response as a void success (venue-admin acks)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new HttpApiClient();

    await expect(client.skip('venue-1', { venueAdminToken: 'tok' })).resolves.toBeUndefined();
  });

  it('GET /spotify/status with the venue-admin bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ linked: true, scope: 'x', expiresAt: null }));
    const client = new HttpApiClient();

    const res = await client.spotifyStatus('venue-1', { venueAdminToken: 'tok' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/venues/venue-1/spotify/status');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(res.linked).toBe(true);
  });

  it('POST /spotify/connect returns the authorizeUrl', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authorizeUrl: 'https://accounts.spotify.com/x' }));
    const client = new HttpApiClient();

    const res = await client.spotifyConnect('venue-1', { venueAdminToken: 'tok' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/venues/venue-1/spotify/connect');
    expect(init.method).toBe('POST');
    expect(res.authorizeUrl).toBe('https://accounts.spotify.com/x');
  });

  it('GET /playback/devices returns the device list', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ devices: [{ providerDeviceId: 'd1', name: 'Speaker', isActive: true }] }),
    );
    const client = new HttpApiClient();

    const res = await client.listPlaybackDevices('venue-1', { venueAdminToken: 'tok' });

    expect(fetchMock.mock.calls[0]![0]).toContain('/api/venues/venue-1/playback/devices');
    expect(res.devices[0]!.providerDeviceId).toBe('d1');
  });

  it('POST /skip-vote sends an empty body and returns the tally', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ queueItem: { queueItemId: 'qi-1' }, crowdSkipVotes: 3, skipped: false }),
    );
    const client = new HttpApiClient();

    const res = await client.crowdSkipVote('qi-1', { sessionId: 's1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/queue-items/qi-1/skip-vote');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Session-Id']).toBe('s1');
    expect(res.crowdSkipVotes).toBe(3);
  });

  it('POST /boost-codes/redeem sends the code and returns credits added', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ tier: 'beer', creditsAdded: 1, creditBalance: 6 }),
    );
    const client = new HttpApiClient();

    const res = await client.redeemBoostCode({ code: 'BEE-123' }, { sessionId: 's1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/boost-codes/redeem');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ code: 'BEE-123' });
    expect(res.creditBalance).toBe(6);
  });

  it('POST /power-hour sends genre/multiplier/duration', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ powerHour: { genre: 'hip-hop', multiplier: 2, endsAt: 'x' } }),
    );
    const client = new HttpApiClient();

    const res = await client.activatePowerHour(
      'venue-1',
      { genre: 'hip-hop', multiplier: 2, durationMinutes: 15 },
      { venueAdminToken: 'tok' },
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/venues/venue-1/power-hour');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ genre: 'hip-hop', multiplier: 2, durationMinutes: 15 });
    expect(res.powerHour.genre).toBe('hip-hop');
  });

  it('POST + GET /boost-codes generate and list codes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ boostCode: { boostCodeId: 'bc-1', code: 'BEE-1', tier: 'beer' } }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ boostCodes: [{ boostCodeId: 'bc-1', code: 'BEE-1', tier: 'beer' }] }),
    );
    const client = new HttpApiClient();

    const gen = await client.generateBoostCode('venue-1', { tier: 'beer' }, { venueAdminToken: 'tok' });
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/venues/venue-1/boost-codes');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
    expect(gen.boostCode.code).toBe('BEE-1');

    const list = await client.listBoostCodes('venue-1', { venueAdminToken: 'tok' });
    expect(fetchMock.mock.calls[1]![0]).toContain('/api/venues/venue-1/boost-codes');
    expect((fetchMock.mock.calls[1]![1].method ?? 'GET')).toBe('GET');
    expect(list.boostCodes).toHaveLength(1);
  });

  it('PUT /playback/device sends the chosen device id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ playbackDeviceId: 'd1' }));
    const client = new HttpApiClient();

    const res = await client.setPlaybackDevice(
      'venue-1',
      { providerDeviceId: 'd1' },
      { venueAdminToken: 'tok' },
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/venues/venue-1/playback/device');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ providerDeviceId: 'd1' });
    expect(res.playbackDeviceId).toBe('d1');
  });
});

describe('getApiClient', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_MOCK;

  beforeEach(() => {
    __resetApiClientForTests();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_MOCK = originalEnv;
    __resetApiClientForTests();
  });

  it('returns the mock client when NEXT_PUBLIC_API_MOCK=1', async () => {
    process.env.NEXT_PUBLIC_API_MOCK = '1';
    const client = getApiClient();
    // The mock client's join only accepts the seeded demo token.
    await expect(client.joinSession({ venueQrToken: 'not-the-real-token' })).rejects.toMatchObject({
      code: 'session_invalid',
    });
  });

  it('memoizes the client instance across calls', () => {
    process.env.NEXT_PUBLIC_API_MOCK = '1';
    expect(getApiClient()).toBe(getApiClient());
  });
});
