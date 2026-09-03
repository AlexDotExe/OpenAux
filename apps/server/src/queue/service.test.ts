import { beforeEach, describe, expect, it } from 'vitest';
import type {
  MusicProvider,
  PlaybackTarget,
  QueueItem,
  Session,
  Track,
  VoteDirection,
} from '@openaux/shared';
import { QueueService } from './service.js';
import { QueueError } from './errors.js';
import type {
  InsertQueueItemInput,
  QueueRepository,
  ScoreUpdate,
  VenueConfig,
} from './repository.js';
import type { VoteCounterDelta } from './votes.js';
import type { AnalyticsEventInput, Broadcaster, MusicProviderResolver } from './seams.js';
import { makeQueueItem } from './test-helpers.js';

const FIXED_NOW = new Date('2026-07-24T22:00:00.000Z');
const clock = { now: () => FIXED_NOW };

function track(over: Partial<Track> = {}): Track {
  return {
    provider: 'spotify',
    providerTrackId: 'trk-1',
    title: 'Song',
    artist: 'Artist',
    album: null,
    durationMs: 200_000,
    explicit: false,
    genres: ['pop'],
    artworkUrl: null,
    ...over,
  };
}

/** Minimal in-memory repository for orchestration tests (no DB). */
class FakeRepo implements QueueRepository {
  venue: VenueConfig = {
    venueId: 'v1',
    name: 'Test Venue',
    controlMode: 'crowd',
    musicProvider: 'spotify',
    blockExplicit: false,
    blockedGenres: [],
    blockedArtists: [],
    scoringWeightsOverride: null,
    fallbackPlaylist: [],
  };
  sessions = new Map<string, Session>();
  items = new Map<string, QueueItem>();
  votes = new Map<string, VoteDirection>();
  displayNames = new Map<string, string>();
  playedArtists: string[] = [];
  playedCount = 0;
  recordRequestCalls = 0;
  forcedNextByVenue = new Map<string, string>();
  activeUserCount = 0;
  crowdSkipVoters = new Map<string, Set<string>>();

  private key(qi: string, u: string) {
    return `${qi}::${u}`;
  }

  async getActiveUserCount() {
    return this.activeUserCount;
  }
  async hasCrowdSkipVoted(qi: string, u: string) {
    return this.crowdSkipVoters.get(qi)?.has(u) ?? false;
  }
  async recordCrowdSkipVote(qi: string, u: string) {
    const voters = this.crowdSkipVoters.get(qi) ?? new Set<string>();
    voters.add(u);
    this.crowdSkipVoters.set(qi, voters);
    const item = this.items.get(qi);
    if (!item) throw new Error('missing item');
    const updated: QueueItem = { ...item, crowdSkipVotes: item.crowdSkipVotes + 1 };
    this.items.set(qi, updated);
    return updated;
  }

  async getVenueConfig() {
    return this.venue;
  }
  async getSessionById(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async getDisplayName(userId: string) {
    return this.displayNames.get(userId) ?? null;
  }
  async getQueueItem(id: string) {
    return this.items.get(id) ?? null;
  }
  async getLiveQueueItems() {
    return [...this.items.values()].filter((i) => i.status === 'queued');
  }
  async getNowPlaying() {
    return [...this.items.values()].find((i) => i.status === 'playing') ?? null;
  }
  async getMostRecentSameSongAt() {
    return null;
  }
  async insertQueueItem(input: InsertQueueItemInput) {
    const item = makeQueueItem({
      venueId: input.venueId,
      songId: input.songId,
      requestingUserId: input.requestingUserId,
      artist: input.artist,
      title: input.title,
      genre: input.genre,
      explicitFlag: input.explicitFlag,
      playabilityState: input.playabilityState,
      playabilityReason: input.playabilityReason,
    });
    this.items.set(item.queueItemId, item);
    return item;
  }
  async getVote(qi: string, u: string) {
    return this.votes.get(this.key(qi, u)) ?? null;
  }
  async setVote(qi: string, u: string, dir: VoteDirection) {
    this.votes.set(this.key(qi, u), dir);
  }
  async deleteVote(qi: string, u: string) {
    this.votes.delete(this.key(qi, u));
  }
  async applyVoteCounters(qi: string, delta: VoteCounterDelta) {
    const item = this.items.get(qi);
    if (!item) throw new Error('missing item');
    const updated: QueueItem = {
      ...item,
      upvotesCount: item.upvotesCount + delta.upvotesDelta,
      downvotesCount: item.downvotesCount + delta.downvotesDelta,
      uniqueSupporterCount: item.uniqueSupporterCount + delta.uniqueSupporterDelta,
    };
    this.items.set(qi, updated);
    return updated;
  }
  async updateScores(updates: ScoreUpdate[]) {
    for (const u of updates) {
      const item = this.items.get(u.queueItemId);
      if (item) this.items.set(u.queueItemId, { ...item, currentScore: u.currentScore });
    }
  }
  async getRecentPlayedArtists(_venueId: string, limit: number) {
    return this.playedArtists.slice(0, limit);
  }
  async getPlayedCount() {
    return this.playedCount;
  }
  async markPlaying(id: string) {
    const item = this.items.get(id);
    if (!item) return null;
    const updated = { ...item, status: 'playing' as const };
    this.items.set(id, updated);
    return updated;
  }
  async markFinished(id: string, status: 'played' | 'skipped') {
    const item = this.items.get(id);
    if (item) this.items.set(id, { ...item, status });
  }
  async recordRequestOnSession() {
    this.recordRequestCalls += 1;
  }
  async setForcedNextItem(venueId: string, queueItemId: string) {
    this.forcedNextByVenue.set(venueId, queueItemId);
  }
  async getForcedNextItem(venueId: string) {
    return this.forcedNextByVenue.get(venueId) ?? null;
  }
  async clearForcedNextItem(venueId: string) {
    this.forcedNextByVenue.delete(venueId);
  }
}

class FakeProvider implements MusicProvider {
  readonly id = 'spotify' as const;
  queued: Track[] = [];
  playCalls = 0;
  constructor(private readonly catalog: Map<string, Track>) {}
  async searchTracks() {
    return [];
  }
  async getTrack(id: string) {
    return this.catalog.get(id) ?? null;
  }
  async queueNext(_t: PlaybackTarget, track: Track) {
    this.queued.push(track);
  }
  async play() {
    this.playCalls += 1;
  }
  async pause() {}
  async skip() {}
  async getNowPlaying() {
    return { track: null, positionMs: 0, isPlaying: false };
  }
}

function makeSession(over: Partial<Session> = {}): Session {
  return {
    sessionId: 's1',
    userId: 'u1',
    venueId: 'v1',
    joinedAt: FIXED_NOW,
    lastActiveAt: FIXED_NOW,
    isGuest: false,
    isActive: true,
    sessionExpiredAt: null,
    activeRequestCount: 0,
    cooldownEndsAt: null,
    lastVoteAt: null,
    lastRequestAt: null,
    joinLatitude: null,
    joinLongitude: null,
    ...over,
  };
}

function build(repo: FakeRepo, catalog: Map<string, Track>) {
  const provider = new FakeProvider(catalog);
  const resolver: MusicProviderResolver = {
    async getProvider() {
      return provider;
    },
    async getPlaybackTarget() {
      return { venueId: 'v1', providerDeviceId: 'dev' };
    },
  };
  const events: AnalyticsEventInput[] = [];
  const broadcasts: Parameters<Broadcaster['broadcastToVenue']>[] = [];
  const broadcaster: Broadcaster = {
    broadcastToVenue(venueId, event) {
      broadcasts.push([venueId, event]);
    },
  };
  const service = new QueueService({
    repository: repo,
    providerResolver: resolver,
    broadcaster,
    emitAnalyticsEvent: (e) => events.push(e),
    clock,
  });
  return { service, provider, events, broadcasts };
}

describe('QueueService.createRequest', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
    repo.sessions.set('s1', makeSession());
  });

  it('creates a request, records the session, and emits request_created', async () => {
    const catalog = new Map([['trk-1', track()]]);
    const { service, events, broadcasts } = build(repo, catalog);
    const result = await service.createRequest({
      venueId: 'v1',
      sessionId: 's1',
      providerTrackId: 'trk-1',
    });
    expect(result.queueItem.songId).toBe('trk-1');
    expect(repo.recordRequestCalls).toBe(1);
    expect(events.map((e) => e.eventType)).toContain('request_created');
    expect(broadcasts.some(([, e]) => e.type === 'queue_updated')).toBe(true);
  });

  it('holds items for approval in suggestion mode', async () => {
    repo.venue = { ...repo.venue, controlMode: 'suggestion' };
    const { service } = build(repo, new Map([['trk-1', track()]]));
    const result = await service.createRequest({
      venueId: 'v1',
      sessionId: 's1',
      providerTrackId: 'trk-1',
    });
    expect(result.queueItem.playabilityState).toBe('awaiting_approval');
  });

  it('rejects when eligibility fails (blocked artist) with the mapped code', async () => {
    repo.venue = { ...repo.venue, blockedArtists: ['artist'] };
    const { service } = build(repo, new Map([['trk-1', track()]]));
    await expect(
      service.createRequest({ venueId: 'v1', sessionId: 's1', providerTrackId: 'trk-1' }),
    ).rejects.toMatchObject({ code: 'venue_blocked_artist' });
  });

  it('rejects an unknown session', async () => {
    const { service } = build(repo, new Map([['trk-1', track()]]));
    await expect(
      service.createRequest({ venueId: 'v1', sessionId: 'nope', providerTrackId: 'trk-1' }),
    ).rejects.toBeInstanceOf(QueueError);
  });
});

describe('QueueService votes (idempotency + source of truth)', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
    const item = makeQueueItem({ queueItemId: 'qi', venueId: 'v1' });
    repo.items.set('qi', item);
  });

  it('adds an upvote and emits vote_added', async () => {
    const { service, events } = build(repo, new Map());
    const res = await service.castVote({ queueItemId: 'qi', userId: 'u1', direction: 'up' });
    expect(res.queueItem.upvotesCount).toBe(1);
    expect(res.queueItem.uniqueSupporterCount).toBe(1);
    expect(events.map((e) => e.eventType)).toEqual(['vote_added']);
  });

  it('is a no-op when re-casting the same direction (no analytics, no counter change)', async () => {
    const { service, events } = build(repo, new Map());
    await service.castVote({ queueItemId: 'qi', userId: 'u1', direction: 'up' });
    const res = await service.castVote({ queueItemId: 'qi', userId: 'u1', direction: 'up' });
    expect(res.queueItem.upvotesCount).toBe(1);
    expect(events.filter((e) => e.eventType === 'vote_added')).toHaveLength(1);
  });

  it('switches direction (up -> down) updating both counters', async () => {
    const { service } = build(repo, new Map());
    await service.castVote({ queueItemId: 'qi', userId: 'u1', direction: 'up' });
    const res = await service.castVote({ queueItemId: 'qi', userId: 'u1', direction: 'down' });
    expect(res.queueItem.upvotesCount).toBe(0);
    expect(res.queueItem.downvotesCount).toBe(1);
    expect(res.queueItem.uniqueSupporterCount).toBe(0);
  });

  it('removes a vote and emits vote_removed', async () => {
    const { service, events } = build(repo, new Map());
    await service.castVote({ queueItemId: 'qi', userId: 'u1', direction: 'up' });
    const res = await service.removeVote({ queueItemId: 'qi', userId: 'u1' });
    expect(res.queueItem.upvotesCount).toBe(0);
    expect(events.map((e) => e.eventType)).toEqual(['vote_added', 'vote_removed']);
  });

  it('removing a non-existent vote is a no-op', async () => {
    const { service, events } = build(repo, new Map());
    const res = await service.removeVote({ queueItemId: 'qi', userId: 'u1' });
    expect(res.queueItem.upvotesCount).toBe(0);
    expect(events).toHaveLength(0);
  });
});

describe('QueueService.advance (DJ brain)', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
  });

  it('finishes the current song (song_played), plays the top-ranked next item', async () => {
    const current = makeQueueItem({ queueItemId: 'cur', status: 'playing', artist: 'Old' });
    const next = makeQueueItem({
      queueItemId: 'nxt',
      status: 'queued',
      artist: 'New',
      upvotesCount: 3,
      songId: 'trk-next',
    });
    repo.items.set('cur', current);
    repo.items.set('nxt', next);
    repo.displayNames.set(next.requestingUserId, 'DJ Alex');
    const catalog = new Map([['trk-next', track({ providerTrackId: 'trk-next' })]]);
    const { service, provider, events, broadcasts } = build(repo, catalog);

    const result = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(result.nowPlaying?.queueItemId).toBe('nxt');
    expect(result.usedFallback).toBe(false);
    expect(provider.playCalls).toBe(1);
    expect(events.some((e) => e.eventType === 'song_played')).toBe(true);
    expect(
      broadcasts.some(
        ([, e]) => e.type === 'now_playing_changed' && e.payload.djAttribution === 'DJ Alex',
      ),
    ).toBe(true);
  });

  it('emits song_skipped when reason is skipped', async () => {
    repo.items.set('cur', makeQueueItem({ queueItemId: 'cur', status: 'playing' }));
    const { service, events } = build(repo, new Map());
    await service.advance({ venueId: 'v1', reason: 'skipped' });
    expect(events.some((e) => e.eventType === 'song_skipped')).toBe(true);
  });

  it('falls back to the venue playlist when no item is eligible', async () => {
    repo.venue = { ...repo.venue, fallbackPlaylist: ['fallback-1'] };
    repo.playedCount = 0;
    const catalog = new Map([['fallback-1', track({ providerTrackId: 'fallback-1' })]]);
    const { service, provider } = build(repo, catalog);
    const res = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(res.usedFallback).toBe(true);
    expect(res.nowPlaying).toBeNull();
    expect(provider.queued.map((t) => t.providerTrackId)).toEqual(['fallback-1']);
  });

  it('goes silent when nothing is playable and no fallback exists', async () => {
    const { service, broadcasts } = build(repo, new Map());
    const res = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(res.usedFallback).toBe(false);
    expect(res.nowPlaying).toBeNull();
    expect(
      broadcasts.some(
        (b) => b[1].type === 'now_playing_changed' && b[1].payload.queueItem === null,
      ),
    ).toBe(true);
  });
});

describe('QueueService.playNow (precise override routing)', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
  });

  it('skips the current item (song_skipped, settlement-relevant) and plays the target now', async () => {
    const current = makeQueueItem({
      queueItemId: 'cur',
      venueId: 'v1',
      status: 'playing',
      artist: 'Old',
    });
    // Higher-ranked than target — playNow must still pick target, not the top of the queue.
    const higherRanked = makeQueueItem({
      queueItemId: 'higher',
      venueId: 'v1',
      status: 'queued',
      upvotesCount: 100,
      songId: 'trk-higher',
    });
    const target = makeQueueItem({
      queueItemId: 'target',
      venueId: 'v1',
      status: 'queued',
      upvotesCount: 0,
      songId: 'trk-target',
      requestingUserId: 'requester-1',
    });
    repo.items.set('cur', current);
    repo.items.set('higher', higherRanked);
    repo.items.set('target', target);
    repo.displayNames.set('requester-1', 'DJ Target');
    const catalog = new Map([
      ['trk-higher', track({ providerTrackId: 'trk-higher' })],
      ['trk-target', track({ providerTrackId: 'trk-target' })],
    ]);
    const { service, provider, events, broadcasts } = build(repo, catalog);

    const result = await service.playNow('target');

    expect(result.nowPlaying.queueItemId).toBe('target');
    expect(result.nowPlaying.status).toBe('playing');
    expect(repo.items.get('cur')?.status).toBe('skipped');
    expect(repo.items.get('higher')?.status).toBe('queued'); // untouched by the override
    expect(provider.queued.map((t) => t.providerTrackId)).toEqual(['trk-target']);
    expect(provider.playCalls).toBe(1);

    const skipEvent = events.find((e) => e.eventType === 'song_skipped');
    expect(skipEvent).toMatchObject({ venueId: 'v1', queueItemId: 'cur' });

    expect(
      broadcasts.some(
        ([, e]) =>
          e.type === 'now_playing_changed' &&
          e.payload.queueItem?.queueItemId === 'target' &&
          e.payload.djAttribution === 'DJ Target',
      ),
    ).toBe(true);
    expect(broadcasts.some(([, e]) => e.type === 'queue_updated')).toBe(true);
  });

  it('works with nothing currently playing (no song_skipped emitted)', async () => {
    const target = makeQueueItem({
      queueItemId: 'target',
      venueId: 'v1',
      status: 'queued',
      songId: 'trk-1',
    });
    repo.items.set('target', target);
    const { service, events } = build(repo, new Map([['trk-1', track()]]));

    const result = await service.playNow('target');

    expect(result.nowPlaying.queueItemId).toBe('target');
    expect(events.some((e) => e.eventType === 'song_skipped')).toBe(false);
  });

  it('throws a typed QueueError (not_found) for an unknown queue item', async () => {
    const { service } = build(repo, new Map());
    await expect(service.playNow('nope')).rejects.toMatchObject({
      name: 'QueueError',
      code: 'not_found',
    });
  });

  it('rejects an item that is not currently queued (e.g. already playing)', async () => {
    const item = makeQueueItem({
      queueItemId: 'already-playing',
      venueId: 'v1',
      status: 'playing',
    });
    repo.items.set('already-playing', item);
    const { service } = build(repo, new Map());
    await expect(service.playNow('already-playing')).rejects.toMatchObject({
      name: 'QueueError',
      code: 'validation',
    });
  });

  it('rejects an item awaiting venue approval', async () => {
    const item = makeQueueItem({
      queueItemId: 'pending',
      venueId: 'v1',
      status: 'queued',
      playabilityState: 'awaiting_approval',
    });
    repo.items.set('pending', item);
    const { service } = build(repo, new Map());
    await expect(service.playNow('pending')).rejects.toMatchObject({
      name: 'QueueError',
      code: 'validation',
    });
  });

  it('clears a stale forced-next marker pointing at the item it just promoted', async () => {
    const target = makeQueueItem({
      queueItemId: 'target',
      venueId: 'v1',
      status: 'queued',
      songId: 'trk-1',
    });
    repo.items.set('target', target);
    repo.forcedNextByVenue.set('v1', 'target');
    const { service } = build(repo, new Map([['trk-1', track()]]));

    await service.playNow('target');

    expect(repo.forcedNextByVenue.get('v1')).toBeUndefined();
  });
});

describe('QueueService.playNext (forced-pick priority)', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
  });

  it('flags the item as forced-next without touching current playback yet', async () => {
    const target = makeQueueItem({ queueItemId: 'target', venueId: 'v1', status: 'queued' });
    repo.items.set('target', target);
    const { service, provider, broadcasts } = build(repo, new Map());

    const result = await service.playNext('target');

    expect(result.queueItemId).toBe('target');
    expect(repo.forcedNextByVenue.get('v1')).toBe('target');
    expect(provider.playCalls).toBe(0);
    expect(broadcasts).toHaveLength(0);
  });

  it('a subsequent advance() picks the forced item over a higher-ranked one', async () => {
    const higherRanked = makeQueueItem({
      queueItemId: 'higher',
      venueId: 'v1',
      status: 'queued',
      upvotesCount: 100,
      songId: 'trk-higher',
    });
    const forced = makeQueueItem({
      queueItemId: 'forced',
      venueId: 'v1',
      status: 'queued',
      upvotesCount: 0,
      songId: 'trk-forced',
    });
    repo.items.set('higher', higherRanked);
    repo.items.set('forced', forced);
    const catalog = new Map([
      ['trk-higher', track({ providerTrackId: 'trk-higher' })],
      ['trk-forced', track({ providerTrackId: 'trk-forced' })],
    ]);
    const { service } = build(repo, catalog);

    await service.playNext('forced');
    const result = await service.advance({ venueId: 'v1', reason: 'ended' });

    expect(result.nowPlaying?.queueItemId).toBe('forced');
  });

  it('bypasses the artist-repeat vibe constraint for a forced pick', async () => {
    repo.playedArtists = ['Drake'];
    const forced = makeQueueItem({
      queueItemId: 'forced',
      venueId: 'v1',
      status: 'queued',
      artist: 'Drake', // would normally be skipped by the vibe constraint
      songId: 'trk-forced',
    });
    repo.items.set('forced', forced);
    const { service } = build(
      repo,
      new Map([['trk-forced', track({ providerTrackId: 'trk-forced' })]]),
    );

    await service.playNext('forced');
    const result = await service.advance({ venueId: 'v1', reason: 'ended' });

    expect(result.nowPlaying?.queueItemId).toBe('forced');
  });

  it('the forced marker is consumed by advance() even if it falls through (stale item)', async () => {
    const only = makeQueueItem({ queueItemId: 'only', status: 'queued', songId: 'trk-only' });
    repo.items.set('only', only);
    repo.forcedNextByVenue.set('v1', 'gone'); // stale: item no longer exists
    const { service } = build(
      repo,
      new Map([['trk-only', track({ providerTrackId: 'trk-only' })]]),
    );

    const result = await service.advance({ venueId: 'v1', reason: 'ended' });

    expect(result.nowPlaying?.queueItemId).toBe('only'); // falls through to normal ranking
    expect(repo.forcedNextByVenue.has('v1')).toBe(false); // one-shot: consumed regardless
  });

  it('still respects venue block eligibility: a held forced item falls through', async () => {
    const held = makeQueueItem({
      queueItemId: 'held',
      status: 'queued',
      playabilityState: 'held',
      songId: 'trk-held',
    });
    const other = makeQueueItem({ queueItemId: 'other', status: 'queued', songId: 'trk-other' });
    repo.items.set('held', held);
    repo.items.set('other', other);
    repo.forcedNextByVenue.set('v1', 'held');
    const catalog = new Map([
      ['trk-held', track({ providerTrackId: 'trk-held' })],
      ['trk-other', track({ providerTrackId: 'trk-other' })],
    ]);
    const { service } = build(repo, catalog);

    const result = await service.advance({ venueId: 'v1', reason: 'ended' });

    expect(result.nowPlaying?.queueItemId).toBe('other');
  });

  it('throws a typed QueueError (not_found) for an unknown queue item', async () => {
    const { service } = build(repo, new Map());
    await expect(service.playNext('nope')).rejects.toMatchObject({
      name: 'QueueError',
      code: 'not_found',
    });
  });

  it('rejects an item that is not currently queued', async () => {
    const item = makeQueueItem({ queueItemId: 'done', status: 'played' });
    repo.items.set('done', item);
    const { service } = build(repo, new Map());
    await expect(service.playNext('done')).rejects.toMatchObject({
      name: 'QueueError',
      code: 'validation',
    });
  });
});

describe('QueueService.castCrowdSkipVote (crowd-voted skip)', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
  });

  it('increments the tally and emits crowd_skip_vote + crowd_skip_vote_update below threshold', async () => {
    repo.activeUserCount = 10; // threshold = 5
    repo.items.set('cur', makeQueueItem({ queueItemId: 'cur', status: 'playing' }));
    const { service, events, broadcasts } = build(repo, new Map());

    const res = await service.castCrowdSkipVote({ queueItemId: 'cur', userId: 'u1' });

    expect(res.crowdSkipVotes).toBe(1);
    expect(res.skipped).toBe(false);
    expect(events.map((e) => e.eventType)).toContain('crowd_skip_vote');
    const update = broadcasts.find(([, e]) => e.type === 'crowd_skip_vote_update');
    expect(update?.[1]).toMatchObject({
      type: 'crowd_skip_vote_update',
      payload: { queueItemId: 'cur', crowdSkipVotes: 1, threshold: 5 },
    });
  });

  it('is idempotent per user — a repeat vote throws already_skip_voted', async () => {
    repo.activeUserCount = 10;
    repo.items.set('cur', makeQueueItem({ queueItemId: 'cur', status: 'playing' }));
    const { service } = build(repo, new Map());

    await service.castCrowdSkipVote({ queueItemId: 'cur', userId: 'u1' });
    await expect(
      service.castCrowdSkipVote({ queueItemId: 'cur', userId: 'u1' }),
    ).rejects.toMatchObject({ name: 'QueueError', code: 'already_skip_voted' });
  });

  it('skips the song when the tally crosses the threshold (song_crowd_skipped + song_skipped, advances)', async () => {
    repo.activeUserCount = 4; // threshold floor = 3
    repo.items.set('cur', makeQueueItem({ queueItemId: 'cur', status: 'playing' }));
    const { service, events, broadcasts } = build(repo, new Map());

    await service.castCrowdSkipVote({ queueItemId: 'cur', userId: 'u1' });
    await service.castCrowdSkipVote({ queueItemId: 'cur', userId: 'u2' });
    const res = await service.castCrowdSkipVote({ queueItemId: 'cur', userId: 'u3' });

    expect(res.skipped).toBe(true);
    expect(events.some((e) => e.eventType === 'song_crowd_skipped')).toBe(true);
    expect(events.some((e) => e.eventType === 'song_skipped')).toBe(true);
    expect(broadcasts.some(([, e]) => e.type === 'song_crowd_skipped')).toBe(true);
    expect(repo.items.get('cur')?.status).toBe('skipped');
  });

  it('rejects a crowd-skip vote against an item that is not now-playing', async () => {
    repo.items.set('q', makeQueueItem({ queueItemId: 'q', status: 'queued' }));
    const { service } = build(repo, new Map());
    await expect(service.castCrowdSkipVote({ queueItemId: 'q', userId: 'u1' })).rejects.toMatchObject(
      { name: 'QueueError', code: 'validation' },
    );
  });

  it('throws not_found for an unknown queue item', async () => {
    const { service } = build(repo, new Map());
    await expect(
      service.castCrowdSkipVote({ queueItemId: 'nope', userId: 'u1' }),
    ).rejects.toMatchObject({ name: 'QueueError', code: 'not_found' });
  });
});

describe('QueueService V1 scoring model + playability gate', () => {
  let repo: FakeRepo;
  beforeEach(() => {
    repo = new FakeRepo();
    repo.venue = { ...repo.venue, scoringModel: 'v1' };
  });

  it('ranks with the V1 engine when scoringModel is v1', async () => {
    repo.activeUserCount = 4; // gate off so this test isolates ranking behavior
    repo.items.set(
      'crowd',
      makeQueueItem({
        queueItemId: 'crowd',
        status: 'queued',
        upvotesCount: 3,
        downvotesCount: 0,
        songId: 'trk-crowd',
      }),
    );
    repo.items.set(
      'paid',
      makeQueueItem({
        queueItemId: 'paid',
        status: 'queued',
        upvotesCount: 2,
        downvotesCount: 0,
        instantVoteCount: 1,
        songId: 'trk-paid',
      }),
    );
    const { service } = build(
      repo,
      new Map([
        ['trk-crowd', track({ providerTrackId: 'trk-crowd' })],
        ['trk-paid', track({ providerTrackId: 'trk-paid' })],
      ]),
    );
    const res = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(res.nowPlaying?.queueItemId).toBe('paid');
  });

  it('plays a healthy item at scale under the V1 model', async () => {
    repo.activeUserCount = 20;
    repo.items.set(
      'good',
      makeQueueItem({
        queueItemId: 'good',
        status: 'queued',
        upvotesCount: 8,
        downvotesCount: 2,
        songId: 'trk-good',
      }),
    );
    const { service } = build(repo, new Map([['trk-good', track({ providerTrackId: 'trk-good' })]]));
    const res = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(res.nowPlaying?.queueItemId).toBe('good');
  });

  it('gates a low-approval top item at scale and falls back to the venue playlist (never silence)', async () => {
    repo.activeUserCount = 20;
    repo.venue = { ...repo.venue, fallbackPlaylist: ['fb-1'] };
    repo.items.set(
      'weak',
      makeQueueItem({
        queueItemId: 'weak',
        status: 'queued',
        upvotesCount: 2,
        downvotesCount: 8, // ratio 0.2 < 0.60 at scale → gated out
        songId: 'trk-weak',
      }),
    );
    const { service } = build(repo, new Map([['fb-1', track({ providerTrackId: 'fb-1' })]]));
    const res = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(res.usedFallback).toBe(true);
    expect(res.nowPlaying).toBeNull();
  });

  it('lets the same low-approval item play in a small room (gate off below 10 actives)', async () => {
    repo.activeUserCount = 4;
    repo.items.set(
      'weak',
      makeQueueItem({
        queueItemId: 'weak',
        status: 'queued',
        upvotesCount: 2,
        downvotesCount: 8,
        songId: 'trk-weak',
      }),
    );
    const { service } = build(repo, new Map([['trk-weak', track({ providerTrackId: 'trk-weak' })]]));
    const res = await service.advance({ venueId: 'v1', reason: 'ended' });
    expect(res.nowPlaying?.queueItemId).toBe('weak');
  });
});
