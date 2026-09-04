import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import type {
  MusicProvider,
  PlaybackCommandEvent,
  PlaybackTarget,
  QueueItem,
  QueueItemId,
  RealtimeEvent,
  Session,
  Track,
  UserId,
  VenueId,
} from '@openaux/shared';
import {
  registerQueueRoutes,
  type InsertQueueItemInput,
  type QueueRepository,
  type ScoreUpdate,
  type VenueConfig,
} from '../../apps/server/src/queue/index.js';
import { registerPlaybackRoutes } from '../../apps/server/src/playback/routes.js';
import { RealtimePlaybackBridge } from '../../apps/server/src/playback/bridge.js';
import {
  ConnectionRegistry,
  broadcastToVenue,
  registerRealtime,
  sendToConsole,
} from '../../apps/server/src/realtime/index.js';
import { makeQueueItem } from '../../apps/server/src/queue/test-helpers.js';
import { registerVenueRoutes } from '../../apps/server/src/venue/index.js';
import { FakeBoostCodeRepository } from '../../apps/server/src/venue/test-support/fake-boost-code-repository.js';
import { FakeVenueRepository } from '../../apps/server/src/venue/test-support/fake-repository.js';

const ADMIN_TOKEN = 'console-secret';
const VENUE_ID = 'venue-1';
const OTHER_VENUE_ID = 'venue-2';
const PATRON_SESSION_ID = 'session-patron';
const SKIP_VOTER_SESSION_ID = 'session-skip-voter';

const REQUEST_TRACK: Track = {
  provider: 'apple_music',
  providerTrackId: 'track-request',
  title: 'Request Track',
  artist: 'Artist One',
  album: null,
  durationMs: 180_000,
  explicit: false,
  genres: ['pop'],
  artworkUrl: null,
};

const OVERRIDE_TRACK: Track = {
  provider: 'apple_music',
  providerTrackId: 'track-override',
  title: 'Override Track',
  artist: 'Artist Two',
  album: null,
  durationMs: 200_000,
  explicit: false,
  genres: ['dance'],
  artworkUrl: null,
};

class SharedRealtimeTestRepository
  extends FakeVenueRepository
  implements QueueRepository
{
  private readonly sessions = new Map<string, Session>();
  private readonly votes = new Map<string, 'up' | 'down'>();
  private readonly crowdSkipVoters = new Map<QueueItemId, Set<UserId>>();
  private readonly forcedNextByVenue = new Map<VenueId, QueueItemId>();

  seedSession(session: Session, displayName: string): void {
    this.sessions.set(session.sessionId, session);
    this.displayNames.set(session.userId, displayName);
  }

  override async getVenueSummary(venueId: VenueId) {
    const settings = this.settings.get(venueId);
    if (!settings) return null;
    const record = this.powerHours.get(venueId) ?? null;
    return {
      venueId,
      name: `Test Venue ${venueId}`,
      musicProvider: this.musicProviders.get(venueId) ?? 'spotify',
      controlMode: settings.controlMode,
      qrToken: `qr-${venueId}`,
      blockExplicit: settings.blockExplicit,
      blockedGenres: settings.blockedGenres,
      blockedArtists: settings.blockedArtists,
      powerHour: record
        ? {
            genre: record.genre,
            multiplier: record.multiplier,
            endsAt: record.endsAt.toISOString(),
            bannerText: null,
          }
        : null,
    };
  }

  async getVenueConfig(venueId: VenueId): Promise<VenueConfig | null> {
    const settings = this.settings.get(venueId);
    if (!settings) return null;
    return {
      venueId,
      name: `Test Venue ${venueId}`,
      controlMode: settings.controlMode,
      musicProvider: this.musicProviders.get(venueId) ?? 'apple_music',
      blockExplicit: settings.blockExplicit,
      blockedGenres: settings.blockedGenres,
      blockedArtists: settings.blockedArtists,
      scoringWeightsOverride: null,
      scoringWeightsOverrideV1: null,
      scoringModel: 'v0',
      fallbackPlaylist: this.fallbackPlaylists.get(venueId) ?? [],
    };
  }

  async getSessionById(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getDisplayName(userId: UserId): Promise<string | null> {
    return this.displayNames.get(userId) ?? null;
  }

  async getLiveQueueItems(venueId: VenueId): Promise<QueueItem[]> {
    return [...this.queueItems.values()].filter(
      (item) => item.venueId === venueId && item.status === 'queued',
    );
  }

  async getNowPlaying(venueId: VenueId): Promise<QueueItem | null> {
    return this.getCurrentlyPlaying(venueId);
  }

  async getMostRecentSameSongAt(
    venueId: VenueId,
    songId: string,
    since: Date,
  ): Promise<Date | null> {
    const matches = [...this.queueItems.values()]
      .filter(
        (item) =>
          item.venueId === venueId &&
          item.songId === songId &&
          item.createdAt.getTime() >= since.getTime(),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0]?.createdAt ?? null;
  }

  async insertQueueItem(input: InsertQueueItemInput): Promise<QueueItem>;
  async insertQueueItem(input: {
    venueId: VenueId;
    track: Track;
    requestingUserId: UserId;
    sourceType: QueueItem['sourceType'];
    playabilityState: QueueItem['playabilityState'];
  }): Promise<QueueItem>;
  async insertQueueItem(
    input:
      | InsertQueueItemInput
      | {
          venueId: VenueId;
          track: Track;
          requestingUserId: UserId;
          sourceType: QueueItem['sourceType'];
          playabilityState: QueueItem['playabilityState'];
        },
  ): Promise<QueueItem> {
    const track = 'track' in input ? input.track : null;
    const item: QueueItem = {
      queueItemId: randomUUID(),
      venueId: input.venueId,
      songId: track?.providerTrackId ?? input.songId,
      provider: track?.provider ?? input.provider,
      requestingUserId: input.requestingUserId,
      createdAt: new Date(),
      status: 'queued',
      upvotesCount: 0,
      downvotesCount: 0,
      uniqueSupporterCount: 0,
      priorityBoostCount: 0,
      instantVoteCount: 0,
      superBoostCount: 0,
      explicitFlag: track?.explicit ?? input.explicitFlag,
      genre: track?.genres[0] ?? input.genre ?? null,
      artist: track?.artist ?? input.artist,
      title: track?.title ?? input.title,
      isDuplicateLocked: false,
      lastScoreCalculatedAt: null,
      currentScore: 0,
      playabilityState: input.playabilityState,
      playabilityReason: 'playabilityReason' in input ? input.playabilityReason : null,
      sourceType: input.sourceType,
      playedAt: null,
      crowdSkipVotes: 0,
    };
    this.queueItems.set(item.queueItemId, item);
    return item;
  }

  async getVote(queueItemId: QueueItemId, userId: UserId): Promise<'up' | 'down' | null> {
    return this.votes.get(`${queueItemId}:${userId}`) ?? null;
  }

  async setVote(queueItemId: QueueItemId, userId: UserId, direction: 'up' | 'down'): Promise<void> {
    this.votes.set(`${queueItemId}:${userId}`, direction);
  }

  async deleteVote(queueItemId: QueueItemId, userId: UserId): Promise<void> {
    this.votes.delete(`${queueItemId}:${userId}`);
  }

  async applyVoteCounters(
    queueItemId: QueueItemId,
    delta: { upvotes: number; downvotes: number },
  ): Promise<QueueItem> {
    const item = this.queueItems.get(queueItemId);
    if (!item) throw new Error(`Unknown queue item ${queueItemId}`);
    const updated: QueueItem = {
      ...item,
      upvotesCount: Math.max(0, item.upvotesCount + delta.upvotes),
      downvotesCount: Math.max(0, item.downvotesCount + delta.downvotes),
    };
    updated.uniqueSupporterCount = [...this.votes.entries()].filter(
      ([key, value]) => key.startsWith(`${queueItemId}:`) && value === 'up',
    ).length;
    this.queueItems.set(queueItemId, updated);
    return updated;
  }

  async updateScores(updates: ScoreUpdate[]): Promise<void> {
    for (const update of updates) {
      const item = this.queueItems.get(update.queueItemId);
      if (!item) continue;
      this.queueItems.set(update.queueItemId, {
        ...item,
        currentScore: update.currentScore,
        lastScoreCalculatedAt: update.lastScoreCalculatedAt,
      });
    }
  }

  async getRecentPlayedArtists(venueId: VenueId, limit: number): Promise<string[]> {
    return [...this.queueItems.values()]
      .filter((item) => item.venueId === venueId && item.playedAt !== null)
      .sort((a, b) => (b.playedAt?.getTime() ?? 0) - (a.playedAt?.getTime() ?? 0))
      .slice(0, limit)
      .map((item) => item.artist);
  }

  async getPlayedCount(venueId: VenueId): Promise<number> {
    return [...this.queueItems.values()].filter(
      (item) => item.venueId === venueId && (item.status === 'played' || item.status === 'skipped'),
    ).length;
  }

  async markPlaying(queueItemId: QueueItemId): Promise<QueueItem | null> {
    const item = this.queueItems.get(queueItemId);
    if (!item) return null;
    const updated = { ...item, status: 'playing' as const };
    this.queueItems.set(queueItemId, updated);
    return updated;
  }

  async markFinished(queueItemId: QueueItemId, status: 'played' | 'skipped'): Promise<void> {
    const item = this.queueItems.get(queueItemId);
    if (!item) return;
    this.queueItems.set(queueItemId, { ...item, status, playedAt: new Date() });
  }

  async getActiveUserCount(venueId: VenueId): Promise<number> {
    return [...this.sessions.values()].filter((session) => session.venueId === venueId && session.isActive)
      .length;
  }

  async hasCrowdSkipVoted(queueItemId: QueueItemId, userId: UserId): Promise<boolean> {
    return this.crowdSkipVoters.get(queueItemId)?.has(userId) ?? false;
  }

  async recordCrowdSkipVote(queueItemId: QueueItemId, userId: UserId): Promise<QueueItem> {
    const item = this.queueItems.get(queueItemId);
    if (!item) throw new Error(`Unknown queue item ${queueItemId}`);
    const voters = this.crowdSkipVoters.get(queueItemId) ?? new Set<UserId>();
    voters.add(userId);
    this.crowdSkipVoters.set(queueItemId, voters);
    const updated = { ...item, crowdSkipVotes: item.crowdSkipVotes + 1 };
    this.queueItems.set(queueItemId, updated);
    return updated;
  }

  async recordRequestOnSession(sessionId: string, now: Date, cooldownEndsAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, {
      ...session,
      activeRequestCount: session.activeRequestCount + 1,
      lastRequestAt: now,
      cooldownEndsAt,
    });
  }

  async setForcedNextItem(venueId: VenueId, queueItemId: QueueItemId): Promise<void> {
    this.forcedNextByVenue.set(venueId, queueItemId);
  }

  async getForcedNextItem(venueId: VenueId): Promise<QueueItemId | null> {
    return this.forcedNextByVenue.get(venueId) ?? null;
  }

  async clearForcedNextItem(venueId: VenueId): Promise<void> {
    this.forcedNextByVenue.delete(venueId);
  }
}

class EventCollector {
  readonly events: RealtimeEvent[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.events.push(JSON.parse(data.toString()) as RealtimeEvent);
    });
  }

  count(): number {
    return this.events.length;
  }

  async waitFor<T extends RealtimeEvent>(
    predicate: (event: RealtimeEvent) => event is T,
    afterIndex = 0,
    timeoutMs = 2_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = this.events.slice(afterIndex).find(predicate);
      if (match) return match;
      await delay(10);
    }
    throw new Error(`Timed out waiting for event after index ${afterIndex}`);
  }

  eventsSince(index: number): RealtimeEvent[] {
    return this.events.slice(index);
  }

  async close(): Promise<void> {
    if (
      this.socket.readyState === WebSocket.CLOSED ||
      this.socket.readyState === WebSocket.CLOSING
    ) {
      return;
    }
    const closed = once(this.socket, 'close');
    this.socket.close();
    await closed;
  }
}

function seedSession(
  venueId: VenueId,
  sessionId: string,
  userId: string,
  isActive = true,
): Session {
  const now = new Date('2026-09-04T05:34:08.000Z');
  return {
    sessionId,
    userId,
    venueId,
    joinedAt: now,
    lastActiveAt: now,
    isGuest: true,
    isActive,
    sessionExpiredAt: null,
    activeRequestCount: 0,
    cooldownEndsAt: null,
    lastVoteAt: null,
    lastRequestAt: null,
    joinLatitude: null,
    joinLongitude: null,
  };
}

async function openCollector(wsUrl: string): Promise<EventCollector> {
  const socket = new WebSocket(wsUrl);
  await once(socket, 'open');
  return new EventCollector(socket);
}

async function postJson(
  baseUrl: string,
  path: string,
  init: { headers?: Record<string, string>; body: unknown },
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
    body: JSON.stringify(init.body),
  });
  return response;
}

function toWsUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace('http://', 'ws://')}${suffix}`;
}

function requestIdsFromQueueUpdated(event: RealtimeEvent): string[] {
  if (event.type !== 'queue_updated') return [];
  return [...event.payload.upNext, ...event.payload.rest].map((item) => item.queueItemId);
}

async function buildRealtimeHarness() {
  const app = Fastify();
  const registry = new ConnectionRegistry();
  const repository = new SharedRealtimeTestRepository();
  const broadcaster = {
    broadcastToVenue: (venueId: VenueId, event: RealtimeEvent) =>
      broadcastToVenue(venueId, event, registry),
  };

  repository.seedVenue(VENUE_ID, { musicProvider: 'apple_music' });
  repository.seedVenue(OTHER_VENUE_ID, { musicProvider: 'apple_music' });

  repository.seedSession(seedSession(VENUE_ID, PATRON_SESSION_ID, 'user-patron'), 'Patron');
  repository.seedSession(
    seedSession(VENUE_ID, SKIP_VOTER_SESSION_ID, 'user-skip-voter'),
    'Skip Voter',
  );
  repository.seedSession(seedSession(VENUE_ID, 'session-extra-1', 'user-extra-1'), 'Extra One');
  repository.seedSession(seedSession(VENUE_ID, 'session-extra-2', 'user-extra-2'), 'Extra Two');
  repository.seedSession(
    seedSession(OTHER_VENUE_ID, 'session-other', 'user-other'),
    'Other Venue Patron',
  );
  repository.displayNames.set('user-current', 'Current DJ');

  repository.seedQueueItem(
    makeQueueItem({
      queueItemId: 'playing-item',
      venueId: VENUE_ID,
      songId: 'track-current',
      provider: 'apple_music',
      requestingUserId: 'user-current',
      status: 'playing',
      artist: 'Current Artist',
      title: 'Current Song',
    }),
  );

  const catalog = new Map<string, Track>([
    [REQUEST_TRACK.providerTrackId, REQUEST_TRACK],
    [OVERRIDE_TRACK.providerTrackId, OVERRIDE_TRACK],
    [
      'track-current',
      {
        provider: 'apple_music',
        providerTrackId: 'track-current',
        title: 'Current Song',
        artist: 'Current Artist',
        album: null,
        durationMs: 170_000,
        explicit: false,
        genres: ['pop'],
        artworkUrl: null,
      },
    ],
  ]);

  registerRealtime(app, {
    registry,
    consoleTokenProvider: () => ADMIN_TOKEN,
  });

  const bridge = new RealtimePlaybackBridge({
    sendToConsole: (venueId, event) => sendToConsole(venueId, event, registry),
    generateCommandId: () => 'cmd-realtime-smoke',
  });

  const provider: MusicProvider = {
    id: 'apple_music',
    searchTracks: async () => [...catalog.values()],
    getTrack: async (providerTrackId: string) => catalog.get(providerTrackId) ?? null,
    queueNext: async (target: PlaybackTarget, track: Track) => {
      await bridge.send(target, { type: 'queueNext', track });
    },
    play: async () => {},
    pause: async () => {},
    skip: async () => {},
    getNowPlaying: async (target: PlaybackTarget) => bridge.getNowPlaying(target),
  };

  const queueService = registerQueueRoutes(app, {
    repository,
    broadcaster,
    providerResolver: {
      getProvider: async () => provider,
      getPlaybackTarget: async (venueId) => ({ venueId, providerDeviceId: 'console' }),
    },
  });

  await app.register(registerVenueRoutes, {
    repository,
    boostCodeRepository: new FakeBoostCodeRepository(),
    analytics: { record: () => {} },
    queueControl: {
      insertOverride: async ({ queueItemId, when }) => {
        if (when === 'now') {
          await queueService.playNow(queueItemId);
          return;
        }
        await queueService.playNext(queueItemId);
      },
      skipCurrent: async (venueId) => {
        await queueService.advance({ venueId, reason: 'skipped' });
      },
    },
    broadcaster,
    resolveMusicProvider: () => provider,
    adminTokenProvider: {
      getExpectedToken: async () => ADMIN_TOKEN,
    },
  });

  await app.register(registerPlaybackRoutes, {
    resolveCommand: (commandId) => bridge.resolveCommand(commandId),
    stateStore: bridge.store,
    consoleTokenProvider: {
      getExpectedToken: async () => ADMIN_TOKEN,
    },
  });

  await app.ready();
  const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

  return {
    app,
    baseUrl,
    repository,
  };
}

describe('realtime integration smoke', () => {
  it('delivers venue events to patron+console, keeps playback commands console-only, and isolates venues', async () => {
    const { app, baseUrl } = await buildRealtimeHarness();
    const patron = await openCollector(
      toWsUrl(baseUrl, `/ws/venues/${VENUE_ID}?sessionId=${PATRON_SESSION_ID}`),
    );
    const consoleClient = await openCollector(
      toWsUrl(baseUrl, `/ws/venues/${VENUE_ID}?role=console&token=${ADMIN_TOKEN}`),
    );
    const otherVenue = await openCollector(
      toWsUrl(baseUrl, `/ws/venues/${OTHER_VENUE_ID}?sessionId=session-other`),
    );

    try {
      const patronRequestStart = patron.count();
      const consoleRequestStart = consoleClient.count();

      const createRequestResponse = await postJson(baseUrl, `/api/venues/${VENUE_ID}/requests`, {
        headers: { 'x-session-id': PATRON_SESSION_ID },
        body: { providerTrackId: REQUEST_TRACK.providerTrackId },
      });
      expect(createRequestResponse.status).toBe(201);
      const { queueItem: requestedItem } = (await createRequestResponse.json()) as {
        queueItem: QueueItem;
      };

      const patronQueueUpdated = await patron.waitFor(
        (event): event is Extract<RealtimeEvent, { type: 'queue_updated' }> =>
          event.type === 'queue_updated',
        patronRequestStart,
      );
      const consoleQueueUpdated = await consoleClient.waitFor(
        (event): event is Extract<RealtimeEvent, { type: 'queue_updated' }> =>
          event.type === 'queue_updated',
        consoleRequestStart,
      );
      expect(requestIdsFromQueueUpdated(patronQueueUpdated)).toContain(requestedItem.queueItemId);
      expect(requestIdsFromQueueUpdated(consoleQueueUpdated)).toContain(requestedItem.queueItemId);

      const patronSkipStart = patron.count();
      const consoleSkipStart = consoleClient.count();

      const crowdSkipResponse = await postJson(baseUrl, '/api/queue-items/playing-item/skip-vote', {
        headers: { 'x-session-id': SKIP_VOTER_SESSION_ID },
        body: {},
      });
      expect(crowdSkipResponse.status).toBe(200);

      const patronSkipUpdate = await patron.waitFor(
        (event): event is Extract<RealtimeEvent, { type: 'crowd_skip_vote_update' }> =>
          event.type === 'crowd_skip_vote_update',
        patronSkipStart,
      );
      const consoleSkipUpdate = await consoleClient.waitFor(
        (event): event is Extract<RealtimeEvent, { type: 'crowd_skip_vote_update' }> =>
          event.type === 'crowd_skip_vote_update',
        consoleSkipStart,
      );
      expect(patronSkipUpdate.payload).toMatchObject({
        queueItemId: 'playing-item',
        crowdSkipVotes: 1,
        threshold: 3,
      });
      expect(consoleSkipUpdate.payload).toMatchObject({
        queueItemId: 'playing-item',
        crowdSkipVotes: 1,
        threshold: 3,
      });

      const patronPowerHourStart = patron.count();
      const consolePowerHourStart = consoleClient.count();

      const powerHourResponse = await postJson(baseUrl, `/api/venues/${VENUE_ID}/power-hour`, {
        headers: { authorization: ['Bearer', ADMIN_TOKEN].join(' ') },
        body: { genre: 'hip-hop', multiplier: 2, durationMinutes: 15 },
      });
      expect(powerHourResponse.status).toBe(201);

      const patronPowerHour = await patron.waitFor(
        (event): event is Extract<RealtimeEvent, { type: 'power_hour_activated' }> =>
          event.type === 'power_hour_activated',
        patronPowerHourStart,
      );
      const consolePowerHour = await consoleClient.waitFor(
        (event): event is Extract<RealtimeEvent, { type: 'power_hour_activated' }> =>
          event.type === 'power_hour_activated',
        consolePowerHourStart,
      );
      expect(patronPowerHour.payload).toMatchObject({ genre: 'hip-hop', multiplier: 2 });
      expect(consolePowerHour.payload).toMatchObject({ genre: 'hip-hop', multiplier: 2 });

      const patronPlaybackStart = patron.count();
      const consolePlaybackStart = consoleClient.count();

      const overridePromise = postJson(baseUrl, `/api/venues/${VENUE_ID}/overrides`, {
        headers: { authorization: ['Bearer', ADMIN_TOKEN].join(' ') },
        body: { providerTrackId: OVERRIDE_TRACK.providerTrackId, when: 'now' },
      });

      const playbackCommand = await consoleClient.waitFor(
        (event): event is PlaybackCommandEvent => event.type === 'playback_command',
        consolePlaybackStart,
      );
      expect(playbackCommand.payload).toMatchObject({
        command: 'queue_next',
        track: expect.objectContaining({ providerTrackId: OVERRIDE_TRACK.providerTrackId }),
        commandId: 'cmd-realtime-smoke',
      });

      await delay(50);
      expect(
        patron.eventsSince(patronPlaybackStart).some((event) => event.type === 'playback_command'),
      ).toBe(false);

      const commandAckResponse = await postJson(
        baseUrl,
        `/api/venues/${VENUE_ID}/playback/state`,
        {
          headers: { authorization: ['Bearer', ADMIN_TOKEN].join(' ') },
          body: {
            isPlaying: true,
            positionMs: 0,
            providerTrackId: OVERRIDE_TRACK.providerTrackId,
            commandId: playbackCommand.payload.commandId,
          },
        },
      );
      expect(commandAckResponse.status).toBe(200);

      const overrideResponse = await overridePromise;
      expect(overrideResponse.status).toBe(201);

      await delay(50);
      expect(
        patron.eventsSince(patronPlaybackStart).some((event) => event.type === 'playback_command'),
      ).toBe(false);
      expect(
        consoleClient.eventsSince(consolePlaybackStart).filter((event) => event.type === 'playback_command'),
      ).toHaveLength(1);

      await delay(50);
      expect(otherVenue.events).toHaveLength(0);
    } finally {
      await Promise.allSettled([patron.close(), consoleClient.close(), otherVenue.close()]);
      await app.close();
    }
  });
});
