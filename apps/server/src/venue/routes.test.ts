import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { MusicProvider, RealtimeEvent, Track } from '@openaux/shared';
import { createVenueAnnouncementsService, registerVenueRoutes } from './index.js';
import { FakeBoostCodeRepository } from './test-support/fake-boost-code-repository.js';
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

  const boostCodeRepository = new FakeBoostCodeRepository();

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
    boostCodeRepository,
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
    boostCodeRepository,
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
      app.inject({
        method: 'POST',
        url: `/api/venues/${VENUE_ID}/power-hour`,
        payload: { genre: 'hip-hop', multiplier: 2, durationMinutes: 15 },
      }),
      app.inject({
        method: 'POST',
        url: `/api/venues/${VENUE_ID}/boost-codes`,
        payload: { tier: 'beer' },
      }),
      app.inject({ method: 'GET', url: `/api/venues/${VENUE_ID}/boost-codes` }),
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

describe('POST /api/venues/:venueId/power-hour', () => {
  it('persists the window, broadcasts the banner, emits analytics, and surfaces it on the summary', async () => {
    const { app, repository, broadcastEvents, analyticsEvents } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/power-hour`,
      headers: authHeader(),
      payload: { genre: 'hip-hop', multiplier: 2, durationMinutes: 15 },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.powerHour.genre).toBe('hip-hop');
    expect(body.powerHour.multiplier).toBe(2);
    expect(new Date(body.powerHour.endsAt).getTime()).toBeGreaterThan(Date.now());

    expect(repository.powerHours.get(VENUE_ID)?.genre).toBe('hip-hop');
    expect(broadcastEvents).toContainEqual(
      expect.objectContaining({
        type: 'power_hour_activated',
        payload: expect.objectContaining({ genre: 'hip-hop', multiplier: 2 }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({ eventType: 'power_hour_activated', venueId: VENUE_ID }),
    );

    const summary = await app.inject({ method: 'GET', url: `/api/venues/${VENUE_ID}` });
    expect(summary.json().powerHour).toMatchObject({ genre: 'hip-hop', multiplier: 2 });
  });

  it('rejects an invalid multiplier', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/power-hour`,
      headers: authHeader(),
      payload: { genre: 'hip-hop', multiplier: 1, durationMinutes: 15 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('404s for an unknown venue', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/venue-unknown/power-hour`,
      headers: authHeader(),
      payload: { genre: 'hip-hop', multiplier: 2, durationMinutes: 15 },
    });
    expect(response.statusCode).toBe(404);
  });

  it('lazily clears an expired window on read and broadcasts power_hour_ended', async () => {
    const { app, repository, broadcastEvents } = await buildApp();
    // Seed an already-elapsed window directly.
    await repository.setPowerHour(VENUE_ID, {
      genre: 'techno',
      multiplier: 3,
      endsAt: new Date(Date.now() - 60_000),
    });

    const summary = await app.inject({ method: 'GET', url: `/api/venues/${VENUE_ID}` });
    expect(summary.json().powerHour).toBeNull();
    expect(await repository.getPowerHour(VENUE_ID)).toBeNull();
    expect(broadcastEvents).toContainEqual(
      expect.objectContaining({ type: 'power_hour_ended', payload: { genre: 'techno' } }),
    );
  });
});

describe('POST + GET /api/venues/:venueId/boost-codes', () => {
  it('generates a single-use code with tier-fixed credits and emits analytics', async () => {
    const { app, boostCodeRepository, analyticsEvents } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/boost-codes`,
      headers: authHeader(),
      payload: { tier: 'cocktail' },
    });
    expect(response.statusCode).toBe(201);
    const { boostCode } = response.json();
    expect(boostCode.tier).toBe('cocktail');
    expect(boostCode.creditValue).toBe(2);
    expect(boostCode.redeemedBy).toBeNull();
    expect(boostCode.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(new Date(boostCode.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(boostCodeRepository.boostCodes.get(boostCode.boostCodeId)).toBeDefined();

    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventType: 'boost_code_generated',
        venueId: VENUE_ID,
        metadata: expect.objectContaining({ tier: 'cocktail', creditValue: 2 }),
      }),
    );
    // The raw code must not leak into analytics.
    const analyticsMeta = (
      analyticsEvents.find(
        (e): e is { metadata: Record<string, unknown> } =>
          typeof e === 'object' &&
          e !== null &&
          (e as { eventType?: string }).eventType === 'boost_code_generated',
      ) ?? { metadata: {} }
    ).metadata;
    expect(analyticsMeta).not.toHaveProperty('code');
  });

  it('rejects an unknown tier', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/boost-codes`,
      headers: authHeader(),
      payload: { tier: 'magnum' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('lists codes for the venue, newest first', async () => {
    const { app } = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/boost-codes`,
      headers: authHeader(),
      payload: { tier: 'beer' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/venues/${VENUE_ID}/boost-codes`,
      headers: authHeader(),
      payload: { tier: 'bottle' },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/venues/${VENUE_ID}/boost-codes`,
      headers: authHeader(),
    });
    expect(list.statusCode).toBe(200);
    const { boostCodes } = list.json();
    expect(boostCodes).toHaveLength(2);
    expect(boostCodes.map((c: { tier: string }) => c.tier)).toContain('beer');
    expect(boostCodes.map((c: { tier: string }) => c.tier)).toContain('bottle');
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
