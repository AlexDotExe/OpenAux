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
