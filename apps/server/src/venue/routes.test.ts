import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { MusicProvider, RealtimeEvent, Track } from '@openaux/shared';
import { createVenueAnnouncementsService, registerVenueRoutes } from './index.js';
import { FakeVenueRepository } from './test-support/fake-repository.js';
import type { AdminTokenProvider } from './auth.js';
import type { AnalyticsSink, Broadcaster, QueueControl } from './types.js';

const ADMIN_TOKEN = 'test-admin-token';
const VENUE_ID = 'venue-1';

const FAKE_TRACK: Track = {
  provider: 'spotify',
  providerTrackId: 'track-abc',
  title: 'Test Song',
  artist: 'Test Artist',
  album: null,
  durationMs: 200_000,
  explicit: false,
  genres: ['pop'],
  artworkUrl: null,
};

function fakeMusicProvider(track: Track | null = FAKE_TRACK): MusicProvider {
  return {
    id: 'spotify',
    searchTracks: async () => (track ? [track] : []),
    getTrack: async (id: string) => (track && track.providerTrackId === id ? track : null),
    queueNext: async () => {},
    play: async () => {},
    pause: async () => {},
    skip: async () => {},
    getNowPlaying: async () => ({ track: null, positionMs: 0, isPlaying: false }),
  };
}

async function buildApp(opts?: { track?: Track | null }) {
  const repository = new FakeVenueRepository();
  repository.seedVenue(VENUE_ID);

  const insertOverrideCalls: unknown[] = [];
  const skipCurrentCalls: unknown[] = [];
  const queueControl: QueueControl = {
    insertOverride: async (input) => {
      insertOverrideCalls.push(input);
    },
    skipCurrent: async (venueId) => {
      skipCurrentCalls.push(venueId);
    },
  };

  const broadcastEvents: RealtimeEvent[] = [];
  const broadcaster: Broadcaster = {
    broadcastToVenue: (_venueId, event) => {
      broadcastEvents.push(event);
    },
  };

  const adminTokenProvider: AdminTokenProvider = {
    getExpectedToken: async () => ADMIN_TOKEN,
  };

  const analyticsEvents: unknown[] = [];
  const analytics: AnalyticsSink = {
    record: (event) => {
      analyticsEvents.push(event);
    },
  };

  const app = Fastify();
  await app.register(registerVenueRoutes, {
    repository,
    analytics,
    queueControl,
    broadcaster,
    adminTokenProvider,
    resolveMusicProvider: () => fakeMusicProvider(opts?.track ?? FAKE_TRACK),
  });
  await app.ready();

  return {
    app,
    repository,
    insertOverrideCalls,
    skipCurrentCalls,
    broadcastEvents,
    analyticsEvents,
  };
}

function authHeader() {
  return { authorization: `Bearer ${ADMIN_TOKEN}` };
}

describe('venue admin routes — auth guard', () => {
  it('rejects requests without a valid admin token on every route', async () => {
    const { app } = await buildApp();

    const responses = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/venues/${VENUE_ID}/settings`,
        payload: { blockExplicit: true },
      }),
      app.inject({
        method: 'POST',
        url: `/api/venues/${VENUE_ID}/overrides`,
        payload: { providerTrackId: 'track-abc', when: 'now' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/venues/${VENUE_ID}/approvals/some-id`,
        payload: { decision: 'approve' },
      }),
      app.inject({ method: 'POST', url: `/api/venues/${VENUE_ID}/skip`, payload: {} }),
      app.inject({
        method: 'PUT',
        url: `/api/venues/${VENUE_ID}/fallback-playlist`,
        payload: { providerTrackIds: ['t1'] },
      }),
      app.inject({
        method: 'POST',
        url: `/api/venues/${VENUE_ID}/anthem`,
        payload: { providerTrackId: 't1', promoText: 'promo', promoDurationMinutes: 5 },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
    }
  });
});

describe('PATCH /api/venues/:venueId/settings', () => {
  it('updates settings and returns the record', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${VENUE_ID}/settings`,
      headers: authHeader(),
      payload: { controlMode: 'suggestion', blockedGenres: ['country', 'Country'] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.venue.controlMode).toBe('suggestion');
    expect(body.venue.blockedGenres).toEqual(['country']);
  });

  it('rejects an invalid body', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/venues/${VENUE_ID}/settings`,
      headers: authHeader(),
      payload: { controlMode: 'nonsense' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/venues/:venueId/overrides', () => {
  it('inserts a queue_items row with source_type override, calls QueueControl, and emits analytics', async () => {
    const { app, repository, insertOverrideCalls, analyticsEvents } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/overrides`,
      headers: authHeader(),
      payload: { providerTrackId: 'track-abc', when: 'now' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.queueItem.sourceType).toBe('override');
    expect(body.queueItem.venueId).toBe(VENUE_ID);
    expect(repository.queueItems.get(body.queueItem.queueItemId)).toBeDefined();
    expect(insertOverrideCalls).toEqual([
      { venueId: VENUE_ID, queueItemId: body.queueItem.queueItemId, when: 'now' },
    ]);
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventType: 'venue_override_used',
        queueItemId: body.queueItem.queueItemId,
      }),
    );
  });

  it('404s when the track cannot be resolved by the music provider', async () => {
    const { app } = await buildApp({ track: null });
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/overrides`,
      headers: authHeader(),
      payload: { providerTrackId: 'missing', when: 'now' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/venues/:venueId/approvals/:queueItemId', () => {
  it('approve flips playability_state to playable', async () => {
    const { app, repository } = await buildApp();
    const item = await repository.insertQueueItem({
      venueId: VENUE_ID,
      track: FAKE_TRACK,
      requestingUserId: 'user-1',
      sourceType: 'organic',
      playabilityState: 'awaiting_approval',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/approvals/${item.queueItemId}`,
      headers: authHeader(),
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().queueItem.playabilityState).toBe('playable');
  });

  it('reject sets status to blocked', async () => {
    const { app, repository } = await buildApp();
    const item = await repository.insertQueueItem({
      venueId: VENUE_ID,
      track: FAKE_TRACK,
      requestingUserId: 'user-1',
      sourceType: 'organic',
      playabilityState: 'awaiting_approval',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/approvals/${item.queueItemId}`,
      headers: authHeader(),
      payload: { decision: 'reject' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().queueItem.status).toBe('blocked');
  });

  it('409s when the item is not awaiting approval', async () => {
    const { app, repository } = await buildApp();
    const item = await repository.insertQueueItem({
      venueId: VENUE_ID,
      track: FAKE_TRACK,
      requestingUserId: 'user-1',
      sourceType: 'organic',
      playabilityState: 'playable',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/approvals/${item.queueItemId}`,
      headers: authHeader(),
      payload: { decision: 'approve' },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('POST /api/venues/:venueId/skip', () => {
  it('marks the current item skipped, calls QueueControl.skipCurrent, and emits analytics', async () => {
    const { app, repository, skipCurrentCalls, analyticsEvents } = await buildApp();
    const item = await repository.insertQueueItem({
      venueId: VENUE_ID,
      track: FAKE_TRACK,
      requestingUserId: 'user-1',
      sourceType: 'organic',
      playabilityState: 'playable',
    });
    await repository.setStatus(item.queueItemId, 'playing');

    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/skip`,
      headers: authHeader(),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().queueItem.status).toBe('skipped');
    expect(skipCurrentCalls).toEqual([VENUE_ID]);
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({ eventType: 'song_skipped', queueItemId: item.queueItemId }),
    );
  });

  it('404s when nothing is playing', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/skip`,
      headers: authHeader(),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('PUT /api/venues/:venueId/fallback-playlist', () => {
  it('stores the ordered playlist', async () => {
    const { app, repository } = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/venues/${VENUE_ID}/fallback-playlist`,
      headers: authHeader(),
      payload: { providerTrackIds: ['t1', 't2'] },
    });
    expect(response.statusCode).toBe(200);
    expect(repository.fallbackPlaylists.get(VENUE_ID)).toEqual(['t1', 't2']);
  });
});

describe('POST /api/venues/:venueId/anthem', () => {
  it('stores the anthem and broadcasts a venue_anthem announcement', async () => {
    const { app, repository, broadcastEvents } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/anthem`,
      headers: authHeader(),
      payload: { providerTrackId: 'track-abc', promoText: '$1 off shots', promoDurationMinutes: 5 },
    });
    expect(response.statusCode).toBe(201);
    expect(repository.anthems.get(VENUE_ID)?.promoText).toBe('$1 off shots');
    expect(broadcastEvents).toContainEqual(
      expect.objectContaining({
        type: 'announcement',
        payload: expect.objectContaining({ kind: 'venue_anthem' }),
      }),
    );
  });
});

describe('createVenueAnnouncementsService (notifyNowPlaying hook for WS3)', () => {
  it('emits dj_attribution when a queue item starts playing', async () => {
    const repository = new FakeVenueRepository();
    repository.seedVenue(VENUE_ID);
    repository.displayNames.set('user-1', 'Alex');

    const broadcastEvents: RealtimeEvent[] = [];
    const broadcaster: Broadcaster = {
      broadcastToVenue: (_venueId, event) => {
        broadcastEvents.push(event);
      },
    };

    const service = createVenueAnnouncementsService({ repository, broadcaster });

    await service.notifyNowPlaying({
      queueItemId: 'qi-1',
      venueId: VENUE_ID,
      songId: 'track-abc',
      provider: 'spotify',
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
      artist: 'Test Artist',
      title: 'Test Song',
      isDuplicateLocked: false,
      lastScoreCalculatedAt: null,
      currentScore: 0,
      playabilityState: 'playable',
      playabilityReason: null,
      sourceType: 'organic',
      playedAt: null,
      crowdSkipVotes: 0,
    });

    expect(broadcastEvents).toContainEqual(
      expect.objectContaining({
        type: 'announcement',
        payload: expect.objectContaining({
          kind: 'dj_attribution',
          text: expect.stringContaining('Alex'),
        }),
      }),
    );
  });
});
