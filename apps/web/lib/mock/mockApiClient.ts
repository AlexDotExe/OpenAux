/**
 * In-memory fixture implementing the same `ApiClient` interface as the real
 * HTTP client (lib/api.ts). Lets every screen in apps/web be demoed with
 * NEXT_PUBLIC_API_MOCK=1 and no backend running. State lives for the life of
 * the page/module — good enough for a demo, not persisted.
 *
 * Mirrors the six-layer model from SPEC.md §1 loosely (eligibility checks in
 * createRequest, ranking via the real @openaux/shared scoring engine,
 * overrides in createOverride/skip) but friction inputs (artistRepeatPenalty,
 * spamPenalty) are the anti-spam layer's job (apps/server/src/antispam) —
 * this mock always passes 0 for those and only enforces the request cooldown
 * / max-active-requests / duplicate-lock rules described in SPEC.md §5.
 */

import {
  DEFAULT_V0_WEIGHTS,
  computeQueueRankScore,
  rankQueue,
  type ApiErrorCode,
  type ApprovalRequest,
  type CastVoteRequest,
  type CastVoteResponse,
  type CreateRequestRequest,
  type CreateRequestResponse,
  type JoinSessionRequest,
  type JoinSessionResponse,
  type PurchaseBoostRequest,
  type PurchaseBoostResponse,
  type PurchaseCreditsRequest,
  type PurchaseCreditsResponse,
  type QueueItem,
  type QueuePositionResponse,
  type QueueSnapshot,
  type ReportPlaybackStateRequest,
  type ReportPlaybackStateResponse,
  type SearchResponse,
  type Session,
  type SetAnthemRequest,
  type SetFallbackPlaylistRequest,
  type Track,
  type UpdateVenueSettingsRequest,
  type VenueOverrideRequest,
  type VoteDirection,
  PAID_BOOST_POINTS,
} from '@openaux/shared';

import { ApiClientError, type ApiClient, type AuthContext, type VenueSummary } from '../api';
import { mockEventBus } from './eventBus';
import { CATALOG, SEED_USERS, findTrack, makeDemoVenue, type MockVenueRecord } from './fixtures';

const AVG_SONG_MINUTES = 3.5;
const REQUEST_COOLDOWN_MS = 2 * 60 * 1000;
const DUPLICATE_LOCKOUT_MS = 45 * 60 * 1000;
const MAX_ACTIVE_REQUESTS = 3;
const BOOST_COST_CREDITS: Record<PurchaseBoostRequest['boostType'], number> = {
  priority_boost: 1,
  instant_play_vote: 3,
  super_boost: 5,
};
const CREDIT_BUNDLES: Record<string, number> = {
  bundle_5: 5,
  bundle_12: 12,
  bundle_25: 25,
};

let idSeq = 0;
function uid(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

function err(code: ApiErrorCode, message: string): never {
  throw new ApiClientError(code, message);
}

interface Store {
  venue: MockVenueRecord;
  sessions: Map<string, Session>;
  displayNames: Map<string, string>;
  creditBalances: Map<string, number>;
  queueItems: QueueItem[];
  nowPlaying: QueueItem | null;
  /** queueItemId -> userId -> direction. One row per user/song, per domain.ts note. */
  votes: Map<string, Map<string, VoteDirection>>;
  /** queueItemId -> set of "userId:boostType" who've spent that boost (1 per song per user). */
  boostsGivenByUser: Map<string, Set<string>>;
  overrideNextItemId: string | null;
}

function seedQueueItem(
  store: Store,
  opts: {
    providerTrackId: string;
    requestingUserId: string;
    status: QueueItem['status'];
    upvotesCount?: number;
    downvotesCount?: number;
    priorityBoostCount?: number;
    createdAtOffsetMs?: number;
  },
): QueueItem {
  const t = findTrack(opts.providerTrackId);
  if (!t) throw new Error(`seed track not found: ${opts.providerTrackId}`);
  const item: QueueItem = {
    queueItemId: uid('qi'),
    venueId: store.venue.venueId,
    songId: t.providerTrackId,
    provider: t.provider,
    requestingUserId: opts.requestingUserId,
    createdAt: new Date(Date.now() - (opts.createdAtOffsetMs ?? 0)),
    status: opts.status,
    upvotesCount: opts.upvotesCount ?? 0,
    downvotesCount: opts.downvotesCount ?? 0,
    uniqueSupporterCount: opts.upvotesCount ?? 0,
    priorityBoostCount: opts.priorityBoostCount ?? 0,
    instantVoteCount: 0,
    superBoostCount: 0,
    explicitFlag: t.explicit,
    genre: t.genres[0] ?? null,
    artist: t.artist,
    title: t.title,
    isDuplicateLocked: false,
    lastScoreCalculatedAt: null,
    currentScore: 0,
    playabilityState: 'playable',
    playabilityReason: null,
    sourceType: 'organic',
    playedAt: null,
    crowdSkipVotes: 0,
  };
  recomputeScore(store, item);
  return item;
}

function recomputeScore(store: Store, item: QueueItem): void {
  const voters = store.votes.get(item.queueItemId);
  const upvotesCount = voters
    ? [...voters.values()].filter((d) => d === 'up').length
    : item.upvotesCount;
  const downvotesCount = voters
    ? [...voters.values()].filter((d) => d === 'down').length
    : item.downvotesCount;
  item.upvotesCount = upvotesCount;
  item.downvotesCount = downvotesCount;
  // Each vote row is unique per user (domain.ts), so distinct upvoters == upvotesCount here.
  item.uniqueSupporterCount = upvotesCount;

  const breakdown = computeQueueRankScore(
    {
      upvotesCount: item.upvotesCount,
      downvotesCount: item.downvotesCount,
      uniqueSupporterCount: item.uniqueSupporterCount,
      priorityBoostCount: item.priorityBoostCount,
      // Friction layer (anti-spam) is out of this workstream's scope; mock defaults to 0.
      artistRepeatPenalty: 0,
      spamPenalty: 0,
    },
    DEFAULT_V0_WEIGHTS,
  );
  item.currentScore = breakdown.total;
  item.lastScoreCalculatedAt = new Date();
}

function buildSnapshot(store: Store): QueueSnapshot {
  const playableQueued = store.queueItems.filter(
    (i) => i.status === 'queued' && i.playabilityState === 'playable',
  );
  const pendingApproval = store.queueItems.filter(
    (i) => i.status === 'queued' && i.playabilityState === 'awaiting_approval',
  );

  let ranked = rankQueue(playableQueued);

  if (store.overrideNextItemId) {
    const idx = ranked.findIndex((i) => i.queueItemId === store.overrideNextItemId);
    if (idx > 0) {
      const [forced] = ranked.splice(idx, 1);
      if (forced) ranked = [forced, ...ranked];
    }
  }

  const upNext = ranked.slice(0, 3);
  const rest = shuffle([...ranked.slice(3), ...pendingApproval]);

  return { nowPlaying: store.nowPlaying, upNext, rest };
}

function publishQueueUpdated(store: Store): void {
  mockEventBus.publish(store.venue.venueId, {
    type: 'queue_updated',
    payload: buildSnapshot(store),
  });
}

function publishNowPlayingChanged(store: Store): void {
  const djAttribution =
    store.nowPlaying && store.nowPlaying.sourceType === 'organic'
      ? (store.displayNames.get(store.nowPlaying.requestingUserId) ?? 'A guest')
      : null;
  mockEventBus.publish(store.venue.venueId, {
    type: 'now_playing_changed',
    payload: { queueItem: store.nowPlaying, djAttribution },
  });
  if (djAttribution) {
    mockEventBus.publish(store.venue.venueId, {
      type: 'announcement',
      payload: {
        kind: 'dj_attribution',
        text: `DJ ${djAttribution} is playing "${store.nowPlaying!.title}"`,
        ttlSeconds: 12,
      },
    });
  }
  maybeAnnounceAnthemWon(store);
}

function maybeAnnounceAnthemWon(store: Store): void {
  if (!store.venue.anthem || !store.nowPlaying) return;
  if (store.nowPlaying.songId !== store.venue.anthem.providerTrackId) return;
  mockEventBus.publish(store.venue.venueId, {
    type: 'announcement',
    payload: {
      kind: 'anthem_won',
      text: `The venue anthem just started — ${store.venue.anthem.promoText}`,
      ttlSeconds: store.venue.anthem.promoDurationMinutes * 60,
    },
  });
}

/**
 * Emit a playback_command onto the mock bus so the venue console's Playback
 * panel (role=console) is demoable end-to-end: in a real Apple venue the queue
 * engine sends this and MusicKit executes it; here the mock plays that role.
 */
function publishPlaybackCommand(
  store: Store,
  command: 'queue_next' | 'play' | 'pause' | 'skip',
  track: Track | null,
): void {
  mockEventBus.publish(store.venue.venueId, {
    type: 'playback_command',
    payload: { command, track, commandId: uid('cmd') },
  });
}

/**
 * Advance playback to the next ranked item (or a fallback-playlist song), marking
 * the outgoing track with the given terminal status. Shared by the venue skip
 * action and the console's trackEnded state report. Emits now_playing_changed +
 * queue_updated, plus a queue_next playback_command for the console.
 */
function advanceQueue(store: Store, terminalStatus: 'skipped' | 'played'): QueueItem | null {
  if (store.nowPlaying) store.nowPlaying.status = terminalStatus;

  const snapshot = buildSnapshot(store);
  const next = snapshot.upNext[0] ?? null;
  let nextTrack: Track | null = null;

  if (next) {
    next.status = 'playing';
    store.nowPlaying = next;
    if (store.overrideNextItemId === next.queueItemId) store.overrideNextItemId = null;
    nextTrack = findTrack(next.songId);
  } else {
    const fallbackId = store.venue.fallbackPlaylistTrackIds[0];
    const fallbackTrack = fallbackId ? findTrack(fallbackId) : null;
    if (fallbackTrack) {
      const fallbackItem: QueueItem = {
        queueItemId: uid('qi'),
        venueId: store.venue.venueId,
        songId: fallbackTrack.providerTrackId,
        provider: fallbackTrack.provider,
        requestingUserId: 'venue',
        createdAt: new Date(),
        status: 'playing',
        upvotesCount: 0,
        downvotesCount: 0,
        uniqueSupporterCount: 0,
        priorityBoostCount: 0,
        instantVoteCount: 0,
        superBoostCount: 0,
        explicitFlag: fallbackTrack.explicit,
        genre: fallbackTrack.genres[0] ?? null,
        artist: fallbackTrack.artist,
        title: fallbackTrack.title,
        isDuplicateLocked: false,
        lastScoreCalculatedAt: new Date(),
        currentScore: 0,
        playabilityState: 'playable',
        playabilityReason: null,
        sourceType: 'venue',
        playedAt: null,
        crowdSkipVotes: 0,
      };
      store.queueItems.push(fallbackItem);
      store.nowPlaying = fallbackItem;
      nextTrack = fallbackTrack;
      // Rotate the fallback list so repeated advances with no queue don't loop one song forever.
      store.venue.fallbackPlaylistTrackIds.push(store.venue.fallbackPlaylistTrackIds.shift()!);
    } else {
      store.nowPlaying = null;
    }
  }

  publishNowPlayingChanged(store);
  publishQueueUpdated(store);
  if (store.nowPlaying && nextTrack) publishPlaybackCommand(store, 'queue_next', nextTrack);
  return store.nowPlaying;
}

function requireSession(store: Store, auth: AuthContext): Session {
  if (!auth.sessionId) err('session_invalid', 'Missing session.');
  const session = store.sessions.get(auth.sessionId);
  if (!session) err('session_invalid', 'Unknown session — please rejoin via the venue QR code.');
  if (!session.isActive) err('session_expired', 'Your session expired — please rejoin.');
  return session;
}

function requireVenueAdmin(store: Store, auth: AuthContext): void {
  if (!auth.venueAdminToken || auth.venueAdminToken !== store.venue.adminToken) {
    err('unauthorized', 'Invalid venue admin token.');
  }
}

function findItemOrThrow(store: Store, queueItemId: string): QueueItem {
  const item = store.queueItems.find((i) => i.queueItemId === queueItemId);
  if (!item) err('not_found', 'Queue item not found.');
  return item;
}

/** Ranks `subject` against the current queue, substituting it in place of the
 * stored item with the same id — lets callers preview a hypothetical (e.g.
 * boosted) version of an item without mutating the store. */
function positionOf(store: Store, subject: QueueItem): number {
  const playableQueued = store.queueItems
    .filter((i) => i.status === 'queued' && i.playabilityState === 'playable')
    .map((i) => (i.queueItemId === subject.queueItemId ? subject : i));
  if (!playableQueued.some((i) => i.queueItemId === subject.queueItemId)) {
    playableQueued.push(subject);
  }
  const ranked = rankQueue(playableQueued);
  const idx = ranked.findIndex((i) => i.queueItemId === subject.queueItemId);
  return idx === -1 ? ranked.length : idx + 1;
}

function createStore(): Store {
  const store: Store = {
    venue: makeDemoVenue(),
    sessions: new Map(),
    displayNames: new Map(Object.entries(SEED_USERS)),
    creditBalances: new Map(),
    queueItems: [],
    nowPlaying: null,
    votes: new Map(),
    boostsGivenByUser: new Map(),
    overrideNextItemId: null,
  };

  store.nowPlaying = seedQueueItem(store, {
    providerTrackId: 't-blinding-lights',
    requestingUserId: 'seed-user-jordan',
    status: 'playing',
    upvotesCount: 14,
    downvotesCount: 2,
    createdAtOffsetMs: 3 * 60 * 1000,
  });
  // store.queueItems is the single source of truth for every queue item regardless of
  // status — nowPlaying just points at the same object so lookups (findItemOrThrow,
  // duplicate-lock checks, getPosition) work for the currently playing song too.
  store.queueItems.push(store.nowPlaying);

  const seeds: Array<[string, string, number, number, number, number]> = [
    ['t-levitating', 'seed-user-alex', 9, 1, 1, 60_000],
    ['t-industry-baby', 'seed-user-sam', 6, 0, 0, 120_000],
    ['t-good-4-u', 'seed-user-riley', 5, 2, 0, 90_000],
    ['t-heat-waves', 'seed-user-alex', 3, 0, 0, 30_000],
    ['t-dance-monkey', 'seed-user-jordan', 2, 1, 0, 20_000],
    ['t-shivers', 'seed-user-sam', 1, 0, 0, 10_000],
  ];
  for (const [providerTrackId, userId, up, down, boosts, ageMs] of seeds) {
    const item = seedQueueItem(store, {
      providerTrackId,
      requestingUserId: userId,
      status: 'queued',
      upvotesCount: up,
      downvotesCount: down,
      priorityBoostCount: boosts,
      createdAtOffsetMs: ageMs,
    });
    // Seed vote rows so unique-supporter math + future votes on these stay consistent.
    const voters = new Map<string, VoteDirection>();
    for (let i = 0; i < up; i += 1) voters.set(`seed-voter-up-${item.queueItemId}-${i}`, 'up');
    for (let i = 0; i < down; i += 1)
      voters.set(`seed-voter-down-${item.queueItemId}-${i}`, 'down');
    store.votes.set(item.queueItemId, voters);
    store.queueItems.push(item);
  }

  return store;
}

export function createMockApiClient(): ApiClient {
  const store = createStore();
  const mockOwner = {
    venueOwnerId: 'owner-mock',
    email: 'owner@demo.bar',
    displayName: 'Demo Owner',
  };
  const mockToken = 'mock-owner-token';

  // Spotify linking state for the mock: the real flow redirects to Spotify and
  // completes via the public callback, which we can't round-trip here — so
  // spotifyConnect just marks the account linked so the console's device picker
  // becomes reachable for demos.
  let spotifyLinked = false;
  let selectedDeviceId: string | null = null;
  const mockDevices = [
    { providerDeviceId: 'dev-console', name: 'Bar Speakers (this Mac)', isActive: true },
    { providerDeviceId: 'dev-booth', name: 'DJ Booth iPad', isActive: false },
  ];

  return {
    async venueOwnerSignup(req) {
      return {
        token: mockToken,
        expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
        owner: { ...mockOwner, email: req.email, displayName: req.displayName },
      };
    },

    async venueOwnerLogin() {
      return {
        token: mockToken,
        expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
        owner: mockOwner,
      };
    },

    async venueOwnerMe() {
      return {
        owner: mockOwner,
        venues: [
          {
            venueId: store.venue.venueId,
            name: store.venue.name,
            musicProvider: store.venue.musicProvider,
            controlMode: store.venue.controlMode,
            qrToken: store.venue.qrToken,
            blockExplicit: store.venue.blockExplicit,
            blockedGenres: store.venue.blockedGenres,
            blockedArtists: store.venue.blockedArtists,
            powerHour: null,
          },
        ],
      };
    },

    async createVenue(req) {
      // Mock mode has a single fixed venue; echo it back with the requested name.
      return {
        venue: {
          venueId: store.venue.venueId,
          name: req.name,
          musicProvider: req.musicProvider,
          controlMode: store.venue.controlMode,
          qrToken: store.venue.qrToken,
          blockExplicit: store.venue.blockExplicit,
          blockedGenres: store.venue.blockedGenres,
          blockedArtists: store.venue.blockedArtists,
          powerHour: null,
        },
      };
    },

    async joinSession(req: JoinSessionRequest): Promise<JoinSessionResponse> {
      if (req.venueQrToken !== store.venue.qrToken) {
        err('session_invalid', 'This QR code / join link is invalid or expired.');
      }
      const userId = uid('guest');
      const displayName = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
      store.displayNames.set(userId, displayName);
      store.creditBalances.set(userId, 5);

      const session: Session = {
        sessionId: uid('session'),
        userId,
        venueId: store.venue.venueId,
        joinedAt: new Date(),
        lastActiveAt: new Date(),
        isGuest: true,
        isActive: true,
        sessionExpiredAt: null,
        activeRequestCount: 0,
        cooldownEndsAt: null,
        lastVoteAt: null,
        lastRequestAt: null,
        joinLatitude: null,
        joinLongitude: null,
      };
      store.sessions.set(session.sessionId, session);

      return {
        session,
        venue: {
          venueId: store.venue.venueId,
          name: store.venue.name,
          controlMode: store.venue.controlMode,
        },
      };
    },

    async getVenue(venueId: string): Promise<VenueSummary> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      return {
        venueId: store.venue.venueId,
        name: store.venue.name,
        musicProvider: store.venue.musicProvider,
        controlMode: store.venue.controlMode,
        qrToken: store.venue.qrToken,
        blockExplicit: store.venue.blockExplicit,
        blockedGenres: store.venue.blockedGenres,
        blockedArtists: store.venue.blockedArtists,
        powerHour: null,
      };
    },

    async search(venueId: string, query: string): Promise<SearchResponse> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      const q = query.trim().toLowerCase();
      if (!q) return { tracks: [] };
      const tracks = CATALOG.filter(
        (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
      ).slice(0, 10);
      return { tracks };
    },

    async getQueue(venueId: string): Promise<QueueSnapshot> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      return buildSnapshot(store);
    },

    async createRequest(
      venueId: string,
      req: CreateRequestRequest,
      auth: AuthContext,
    ): Promise<CreateRequestResponse> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      const session = requireSession(store, auth);

      if (session.cooldownEndsAt && session.cooldownEndsAt.getTime() > Date.now()) {
        err('request_cooldown', 'You can request again in a moment — one request per 2 minutes.');
      }
      const activeCount = store.queueItems.filter(
        (i) =>
          i.requestingUserId === session.userId &&
          (i.status === 'queued' || i.status === 'playing'),
      ).length;
      if (activeCount >= MAX_ACTIVE_REQUESTS) {
        err(
          'max_active_requests',
          `You can only have ${MAX_ACTIVE_REQUESTS} active requests at once.`,
        );
      }

      const track = findTrack(req.providerTrackId);
      if (!track) err('not_found', 'Track not found.');

      if (store.venue.blockExplicit && track.explicit) {
        err('explicit_blocked', 'This venue does not play explicit songs.');
      }
      if (track.genres.some((g) => store.venue.blockedGenres.includes(g))) {
        err('venue_blocked_genre', 'This venue has blocked that genre.');
      }
      if (store.venue.blockedArtists.includes(track.artist)) {
        err('venue_blocked_artist', 'This venue does not play that artist.');
      }

      const recentDuplicate = store.queueItems.some(
        (i) =>
          i.songId === track.providerTrackId &&
          i.status !== 'blocked' &&
          Date.now() - i.createdAt.getTime() < DUPLICATE_LOCKOUT_MS,
      );
      if (recentDuplicate) {
        err('duplicate_locked', 'That song was just requested — try again in a bit.');
      }

      const item: QueueItem = {
        queueItemId: uid('qi'),
        venueId: store.venue.venueId,
        songId: track.providerTrackId,
        provider: track.provider,
        requestingUserId: session.userId,
        createdAt: new Date(),
        status: 'queued',
        upvotesCount: 0,
        downvotesCount: 0,
        uniqueSupporterCount: 0,
        priorityBoostCount: 0,
        instantVoteCount: 0,
        superBoostCount: 0,
        explicitFlag: track.explicit,
        genre: track.genres[0] ?? null,
        artist: track.artist,
        title: track.title,
        isDuplicateLocked: false,
        lastScoreCalculatedAt: null,
        currentScore: 0,
        playabilityState:
          store.venue.controlMode === 'suggestion' ? 'awaiting_approval' : 'playable',
        playabilityReason:
          store.venue.controlMode === 'suggestion' ? 'Awaiting venue approval' : null,
        sourceType: 'organic',
        playedAt: null,
        crowdSkipVotes: 0,
      };
      recomputeScore(store, item);
      store.queueItems.push(item);

      session.activeRequestCount = activeCount + 1;
      session.lastRequestAt = new Date();
      session.cooldownEndsAt = new Date(Date.now() + REQUEST_COOLDOWN_MS);

      publishQueueUpdated(store);
      return { queueItem: item };
    },

    async castVote(
      queueItemId: string,
      req: CastVoteRequest,
      auth: AuthContext,
    ): Promise<CastVoteResponse> {
      const session = requireSession(store, auth);
      const item = findItemOrThrow(store, queueItemId);

      let voters = store.votes.get(queueItemId);
      if (!voters) {
        voters = new Map();
        store.votes.set(queueItemId, voters);
      }
      voters.set(session.userId, req.direction);
      session.lastVoteAt = new Date();

      recomputeScore(store, item);
      publishQueueUpdated(store);
      return { queueItem: item };
    },

    async removeVote(queueItemId: string, auth: AuthContext): Promise<CastVoteResponse> {
      const session = requireSession(store, auth);
      const item = findItemOrThrow(store, queueItemId);

      store.votes.get(queueItemId)?.delete(session.userId);
      recomputeScore(store, item);
      publishQueueUpdated(store);
      return { queueItem: item };
    },

    async purchaseBoost(
      queueItemId: string,
      req: PurchaseBoostRequest,
      auth: AuthContext,
    ): Promise<PurchaseBoostResponse> {
      const session = requireSession(store, auth);
      const item = findItemOrThrow(store, queueItemId);

      let userBoosts = store.boostsGivenByUser.get(queueItemId);
      if (!userBoosts) {
        userBoosts = new Set();
        store.boostsGivenByUser.set(queueItemId, userBoosts);
      }
      const boostKey = `${session.userId}:${req.boostType}`;
      if (userBoosts.has(boostKey)) {
        err('boost_limit_reached', 'You already boosted this song.');
      }

      const cost = BOOST_COST_CREDITS[req.boostType];
      const balance = store.creditBalances.get(session.userId) ?? 0;
      if (balance < cost) {
        err('insufficient_credits', `You need ${cost} credit(s) for this boost.`);
      }

      store.creditBalances.set(session.userId, balance - cost);
      userBoosts.add(boostKey);

      if (req.boostType === 'priority_boost') item.priorityBoostCount += 1;
      if (req.boostType === 'instant_play_vote') item.instantVoteCount += 1;
      if (req.boostType === 'super_boost') item.superBoostCount += 1;

      recomputeScore(store, item);
      publishQueueUpdated(store);

      return {
        queueItem: item,
        creditBalance: store.creditBalances.get(session.userId) ?? 0,
        paidPointsAdded: PAID_BOOST_POINTS[req.boostType as keyof typeof PAID_BOOST_POINTS] ?? 0,
      };
    },

    async getPosition(queueItemId: string, auth: AuthContext): Promise<QueuePositionResponse> {
      requireSession(store, auth);
      const item = findItemOrThrow(store, queueItemId);

      if (item.status === 'playing') {
        return { position: 0, estimatedMinutesUntilPlay: 0, boostPreviewPositions: 0 };
      }

      const currentPosition = positionOf(store, item);
      const clone: QueueItem = { ...item, priorityBoostCount: item.priorityBoostCount + 1 };
      const breakdown = computeQueueRankScore(
        {
          upvotesCount: clone.upvotesCount,
          downvotesCount: clone.downvotesCount,
          uniqueSupporterCount: clone.uniqueSupporterCount,
          priorityBoostCount: clone.priorityBoostCount,
          artistRepeatPenalty: 0,
          spamPenalty: 0,
        },
        DEFAULT_V0_WEIGHTS,
      );
      clone.currentScore = breakdown.total;
      const boostedPosition = positionOf(store, clone);

      return {
        position: currentPosition,
        estimatedMinutesUntilPlay: Math.round(currentPosition * AVG_SONG_MINUTES),
        boostPreviewPositions: Math.max(0, currentPosition - boostedPosition),
      };
    },

    async purchaseCredits(
      req: PurchaseCreditsRequest,
      auth: AuthContext,
    ): Promise<PurchaseCreditsResponse> {
      const session = requireSession(store, auth);
      const credits = CREDIT_BUNDLES[req.bundleId] ?? 5;
      const balance = (store.creditBalances.get(session.userId) ?? 0) + credits;
      store.creditBalances.set(session.userId, balance);
      return { creditBalance: balance };
    },

    async updateVenueSettings(
      venueId: string,
      req: UpdateVenueSettingsRequest,
      auth: AuthContext,
    ): Promise<void> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      if (req.controlMode) store.venue.controlMode = req.controlMode;
      if (req.blockExplicit !== undefined) store.venue.blockExplicit = req.blockExplicit;
      if (req.blockedGenres) store.venue.blockedGenres = req.blockedGenres;
      if (req.blockedArtists) store.venue.blockedArtists = req.blockedArtists;
      publishQueueUpdated(store);
    },

    async createOverride(
      venueId: string,
      req: VenueOverrideRequest,
      auth: AuthContext,
    ): Promise<void> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      const track = findTrack(req.providerTrackId);
      if (!track) err('not_found', 'Track not found.');

      const item: QueueItem = {
        queueItemId: uid('qi'),
        venueId: store.venue.venueId,
        songId: track.providerTrackId,
        provider: track.provider,
        requestingUserId: 'venue',
        createdAt: new Date(),
        status: req.when === 'now' ? 'playing' : 'queued',
        upvotesCount: 0,
        downvotesCount: 0,
        uniqueSupporterCount: 0,
        priorityBoostCount: 0,
        instantVoteCount: 0,
        superBoostCount: 0,
        explicitFlag: track.explicit,
        genre: track.genres[0] ?? null,
        artist: track.artist,
        title: track.title,
        isDuplicateLocked: false,
        lastScoreCalculatedAt: new Date(),
        currentScore: Number.POSITIVE_INFINITY,
        playabilityState: 'playable',
        playabilityReason: null,
        sourceType: 'override',
        playedAt: null,
        crowdSkipVotes: 0,
      };

      store.queueItems.push(item);

      if (req.when === 'now') {
        if (store.nowPlaying) store.nowPlaying.status = 'played';
        store.nowPlaying = item;
        publishNowPlayingChanged(store);
      } else {
        store.overrideNextItemId = item.queueItemId;
      }
      publishQueueUpdated(store);
    },

    async decideApproval(
      venueId: string,
      queueItemId: string,
      req: ApprovalRequest,
      auth: AuthContext,
    ): Promise<void> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      const item = findItemOrThrow(store, queueItemId);

      if (req.decision === 'approve') {
        item.playabilityState = 'playable';
        item.playabilityReason = null;
        recomputeScore(store, item);
      } else {
        item.status = 'blocked';
        item.playabilityReason = 'Rejected by venue';
      }
      publishQueueUpdated(store);
    },

    async skip(venueId: string, auth: AuthContext): Promise<void> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      advanceQueue(store, 'skipped');
    },

    async reportPlaybackState(
      venueId: string,
      req: ReportPlaybackStateRequest,
      auth: AuthContext,
    ): Promise<ReportPlaybackStateResponse> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      // On track end, advance exactly like the real POST .../playback/state route.
      const nowPlaying = req.trackEnded ? advanceQueue(store, 'played') : store.nowPlaying;
      return { acknowledged: true, nowPlaying };
    },

    async setFallbackPlaylist(
      venueId: string,
      req: SetFallbackPlaylistRequest,
      auth: AuthContext,
    ): Promise<void> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      store.venue.fallbackPlaylistTrackIds = [...req.providerTrackIds];
    },

    async setAnthem(venueId: string, req: SetAnthemRequest, auth: AuthContext): Promise<void> {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      const track = findTrack(req.providerTrackId);
      if (!track) err('not_found', 'Track not found.');

      store.venue.anthem = {
        providerTrackId: req.providerTrackId,
        promoText: req.promoText,
        promoDurationMinutes: req.promoDurationMinutes,
      };

      mockEventBus.publish(store.venue.venueId, {
        type: 'announcement',
        payload: {
          kind: 'venue_anthem',
          text: `Venue Anthem set: "${track.title}" — ${req.promoText}`,
          ttlSeconds: 20,
        },
      });
    },

    async spotifyStatus(venueId, auth) {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      return {
        linked: spotifyLinked,
        scope: spotifyLinked ? 'user-read-playback-state user-modify-playback-state' : null,
        expiresAt: spotifyLinked ? new Date(Date.now() + 3600_000).toISOString() : null,
      };
    },

    async spotifyConnect(venueId, auth) {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      // Real flow redirects to Spotify; the mock links immediately so the picker shows.
      spotifyLinked = true;
      return { authorizeUrl: 'https://accounts.spotify.com/authorize?mock=1' };
    },

    async listPlaybackDevices(venueId, auth) {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      if (!spotifyLinked) err('unauthorized', 'Link a Spotify account first.');
      return {
        devices: mockDevices.map((d) => ({
          ...d,
          isActive: selectedDeviceId ? d.providerDeviceId === selectedDeviceId : d.isActive,
        })),
      };
    },

    async setPlaybackDevice(venueId, req, auth) {
      if (venueId !== store.venue.venueId) err('not_found', 'Venue not found.');
      requireVenueAdmin(store, auth);
      if (!spotifyLinked) err('unauthorized', 'Link a Spotify account first.');
      selectedDeviceId = req.providerDeviceId;
      return { playbackDeviceId: selectedDeviceId };
    },
  };
}
