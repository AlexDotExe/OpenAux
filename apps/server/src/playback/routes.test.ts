import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { QueueItem, ReportPlaybackStateRequest } from '@openaux/shared';
import { registerPlaybackRoutes, type PlaybackRoutesOptions } from './routes.js';
import { PlaybackStateStore } from './state.js';
import type { ConsoleTokenProvider } from './auth.js';

const VENUE_ID = 'venue-1';
const TOKEN = 'console-token';

const tokenProvider: ConsoleTokenProvider = { getExpectedToken: async () => TOKEN };

function makeQueueItem(id: string): QueueItem {
  return {
    queueItemId: id,
    venueId: VENUE_ID,
    songId: 'song-1',
    provider: 'apple_music',
    requestingUserId: 'user-1',
    createdAt: new Date(),
    status: 'playing',
    upvotesCount: 0,
    downvotesCount: 0,
    uniqueSupporterCount: 0,
    priorityBoostCount: 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    explicitFlag: false,
    genre: null,
    artist: 'Artist',
    title: 'Title',
    isDuplicateLocked: false,
    lastScoreCalculatedAt: null,
    currentScore: 0,
    playabilityState: 'playable',
    playabilityReason: null,
    sourceType: 'organic',
    playedAt: null,
  };
}

async function buildApp(opts: PlaybackRoutesOptions = {}) {
  const app = Fastify();
  await app.register(registerPlaybackRoutes, { consoleTokenProvider: tokenProvider, ...opts });
  await app.ready();
  return app;
}

function report(body: Partial<ReportPlaybackStateRequest> = {}): ReportPlaybackStateRequest {
  return { isPlaying: true, positionMs: 1000, providerTrackId: 'am-1', ...body };
}

describe('POST /api/venues/:venueId/playback/state', () => {
  it('rejects a request without a valid console token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      payload: report(),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('acknowledges and caches state on a valid report', async () => {
    const stateStore = new PlaybackStateStore();
    const app = await buildApp({ stateStore });
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: report({ providerTrackId: 'am-42', positionMs: 2500 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ acknowledged: true, nowPlaying: null });
    expect(stateStore.getSnapshot(VENUE_ID)).toEqual({
      providerTrackId: 'am-42',
      positionMs: 2500,
      isPlaying: true,
    });
    await app.close();
  });

  it('resolves the pending command when a commandId is echoed back', async () => {
    const resolveCommand = vi.fn(() => true);
    const app = await buildApp({ resolveCommand });
    await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: report({ commandId: 'cmd-9' }),
    });
    expect(resolveCommand).toHaveBeenCalledWith('cmd-9');
    await app.close();
  });

  it('calls onTrackEnded and returns the advanced item when trackEnded is true', async () => {
    const advanced = makeQueueItem('qi-next');
    const onTrackEnded = vi.fn(async () => advanced);
    const app = await buildApp({ onTrackEnded });
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: report({ trackEnded: true, providerTrackId: null }),
    });
    expect(onTrackEnded).toHaveBeenCalledWith(VENUE_ID);
    expect(res.json().nowPlaying.queueItemId).toBe('qi-next');
    await app.close();
  });

  it('does not call onTrackEnded when trackEnded is absent', async () => {
    const onTrackEnded = vi.fn(async () => null);
    const app = await buildApp({ onTrackEnded });
    await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: report(),
    });
    expect(onTrackEnded).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a malformed body with a validation error', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { isPlaying: 'yes', positionMs: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation');
    await app.close();
  });

  it('the default onTrackEnded is a throws-safe noop returning null', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/playback/state`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: report({ trackEnded: true }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ acknowledged: true, nowPlaying: null });
    await app.close();
  });
});
