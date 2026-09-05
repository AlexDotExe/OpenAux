import Fastify, { type FastifyInstance } from 'fastify';
import type { MusicProvider, PlaybackTarget, Session, Track } from '@openaux/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerQueueRouteHandlers } from './routes.js';
import type { QueueRepository, VenueConfig } from './repository.js';
import type { MusicProviderResolver } from './seams.js';
import type { QueueService } from './service.js';

function makeVenue(overrides: Partial<VenueConfig> = {}): VenueConfig {
  return {
    venueId: 'venue-1',
    name: 'Neon Room',
    controlMode: 'crowd',
    musicProvider: 'spotify',
    blockExplicit: false,
    blockedGenres: [],
    blockedArtists: [],
    scoringWeightsOverride: null,
    fallbackPlaylist: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    venueId: 'venue-1',
    joinedAt: new Date('2026-09-04T14:00:00.000Z'),
    lastActiveAt: new Date('2026-09-04T14:00:00.000Z'),
    isGuest: false,
    isActive: true,
    sessionExpiredAt: null,
    activeRequestCount: 0,
    cooldownEndsAt: null,
    lastVoteAt: null,
    lastRequestAt: null,
    joinLatitude: null,
    joinLongitude: null,
    ...overrides,
  };
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    provider: 'spotify',
    providerTrackId: 'trk-1',
    title: 'Dancing Queen',
    artist: 'ABBA',
    album: 'Arrival',
    durationMs: 231_000,
    explicit: false,
    genres: ['pop'],
    artworkUrl: null,
    ...overrides,
  };
}

class SearchRouteProvider implements MusicProvider {
  readonly id = 'spotify' as const;
  readonly tracks: Track[];
  searchCalls: Array<{ query: string; limit: number | undefined }> = [];

  constructor(tracks: Track[]) {
    this.tracks = tracks;
  }

  async searchTracks(query: string, opts?: { limit?: number }) {
    this.searchCalls.push({ query, limit: opts?.limit });
    return this.tracks;
  }

  async getTrack() {
    return null;
  }

  async queueNext(_target: PlaybackTarget, _track: Track) {}

  async play(_target: PlaybackTarget) {}

  async pause(_target: PlaybackTarget) {}

  async skip(_target: PlaybackTarget) {}

  async getNowPlaying() {
    return { track: null, positionMs: 0, isPlaying: false };
  }
}

function buildRepository(options: {
  venue?: VenueConfig | null;
  session?: Session | null;
}): QueueRepository {
  return {
    async getVenueConfig() {
      return options.venue ?? null;
    },
    async getSessionById() {
      return options.session ?? null;
    },
    async getDisplayName() {
      return null;
    },
    async getQueueItem() {
      return null;
    },
    async getLiveQueueItems() {
      return [];
    },
    async getNowPlaying() {
      return null;
    },
    async getMostRecentSameSongAt() {
      return null;
    },
    async insertQueueItem() {
      throw new Error('not implemented');
    },
    async getVote() {
      return null;
    },
    async setVote() {
      throw new Error('not implemented');
    },
    async deleteVote() {
      throw new Error('not implemented');
    },
    async applyVoteCounters() {
      throw new Error('not implemented');
    },
    async updateScores() {},
    async getRecentPlayedArtists() {
      return [];
    },
    async getPlayedCount() {
      return 0;
    },
    async markPlaying() {
      return null;
    },
    async markFinished() {},
    async getActiveUserCount() {
      return 0;
    },
    async hasCrowdSkipVoted() {
      return false;
    },
    async recordCrowdSkipVote() {
      throw new Error('not implemented');
    },
    async recordRequestOnSession() {},
    async setForcedNextItem() {},
    async getForcedNextItem() {
      return null;
    },
    async clearForcedNextItem() {},
  };
}

function buildResolver(provider: MusicProvider): MusicProviderResolver {
  return {
    async getProvider() {
      return provider;
    },
    async getPlaybackTarget() {
      return { venueId: 'venue-1', providerDeviceId: 'device-1' };
    },
  };
}

function buildApp(repository: QueueRepository, providerResolver: MusicProviderResolver): FastifyInstance {
  const app = Fastify();
  registerQueueRouteHandlers(
    app,
    {} as QueueService,
    repository,
    providerResolver,
  );
  return app;
}

describe('GET /api/venues/:venueId/search', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    app = Fastify();
  });

  it('returns provider search results for the venue session and uses the default limit', async () => {
    const provider = new SearchRouteProvider([makeTrack()]);
    app = buildApp(
      buildRepository({ venue: makeVenue(), session: makeSession() }),
      buildResolver(provider),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/venues/venue-1/search?q=%20Dancing%20Queen%20',
      headers: { 'x-session-id': 'session-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tracks: [makeTrack()] });
    expect(provider.searchCalls).toEqual([{ query: 'Dancing Queen', limit: 20 }]);
  });

  it('rejects a missing or blank query with a validation error', async () => {
    const provider = new SearchRouteProvider([makeTrack()]);
    app = buildApp(
      buildRepository({ venue: makeVenue(), session: makeSession() }),
      buildResolver(provider),
    );

    const missing = await app.inject({
      method: 'GET',
      url: '/api/venues/venue-1/search',
      headers: { 'x-session-id': 'session-1' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('validation');

    const blank = await app.inject({
      method: 'GET',
      url: '/api/venues/venue-1/search?q=%20%20%20',
      headers: { 'x-session-id': 'session-1' },
    });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error.code).toBe('validation');
    expect(provider.searchCalls).toEqual([]);
  });

  it('rejects requests without a patron session header', async () => {
    app = buildApp(
      buildRepository({ venue: makeVenue(), session: makeSession() }),
      buildResolver(new SearchRouteProvider([makeTrack()])),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/venues/venue-1/search?q=dancing',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('returns not_found for an unknown venue', async () => {
    const provider = new SearchRouteProvider([makeTrack()]);
    app = buildApp(
      buildRepository({ venue: null, session: makeSession() }),
      buildResolver(provider),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/venues/missing/search?q=dancing',
      headers: { 'x-session-id': 'session-1' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('not_found');
    expect(provider.searchCalls).toEqual([]);
  });
});
