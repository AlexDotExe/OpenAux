/**
 * Queue service — orchestrates the six layers over the repository and injected seams.
 * Holds NO decision logic of its own: eligibility, ranking, playability/DJ-brain, and
 * snapshot math all live in the pure modules; scoring lives in @openaux/shared. This
 * layer only sequences I/O, emits realtime + analytics events, and drives playback
 * through the MusicProvider.
 */

import type {
  CreateRequestResponse,
  CastVoteResponse,
  QueuePositionResponse,
  QueueSnapshot,
  QueueItem,
  QueueItemId,
  SessionId,
  UserId,
  VenueId,
  VoteDirection,
} from '@openaux/shared';
import {
  ARTIST_REPEAT_WINDOW,
  DUPLICATE_LOCKOUT_MINUTES,
  REQUEST_COOLDOWN_MINUTES,
} from './constants.js';
import { checkRequestEligibility } from './eligibility.js';
import { isPlayable, selectNextTrack, type PlayabilityContext } from './dj-brain.js';
import { rankItems, resolveWeights } from './ranking.js';
import { buildPositionResponse, buildQueueSnapshot } from './snapshot.js';
import { resolveCastVote, resolveRemoveVote } from './votes.js';
import { QueueError } from './errors.js';
import type { QueueRepository, VenueConfig } from './repository.js';
import {
  systemClock,
  zeroFrictionProvider,
  noopBroadcaster,
  noopEmitAnalyticsEvent,
  unavailableProviderResolver,
  type Broadcaster,
  type Clock,
  type EmitAnalyticsEvent,
  type FrictionInputs,
  type FrictionProvider,
  type MusicProviderResolver,
} from './seams.js';

export interface QueueServiceDeps {
  repository: QueueRepository;
  frictionProvider: FrictionProvider;
  broadcaster: Broadcaster;
  emitAnalyticsEvent: EmitAnalyticsEvent;
  providerResolver: MusicProviderResolver;
  clock: Clock;
}

export type QueueServiceOptions = Partial<QueueServiceDeps> & Pick<QueueServiceDeps, 'repository'>;

const MS_PER_MINUTE = 60_000;

/** Fill unset seams with their safe defaults. */
export function resolveDeps(options: QueueServiceOptions): QueueServiceDeps {
  return {
    repository: options.repository,
    frictionProvider: options.frictionProvider ?? zeroFrictionProvider,
    broadcaster: options.broadcaster ?? noopBroadcaster,
    emitAnalyticsEvent: options.emitAnalyticsEvent ?? noopEmitAnalyticsEvent,
    providerResolver: options.providerResolver ?? unavailableProviderResolver,
    clock: options.clock ?? systemClock,
  };
}

interface RecomputeResult {
  venue: VenueConfig;
  nowPlaying: QueueItem | null;
  ranked: QueueItem[];
  frictionByItem: Map<QueueItemId, FrictionInputs>;
}

export class QueueService {
  private readonly deps: QueueServiceDeps;

  constructor(options: QueueServiceOptions) {
    this.deps = resolveDeps(options);
  }

  // -----------------------------------------------------------------------
  // Requests (layer 1 eligibility + insert)
  // -----------------------------------------------------------------------

  async createRequest(params: {
    venueId: VenueId;
    sessionId: SessionId;
    providerTrackId: string;
  }): Promise<CreateRequestResponse> {
    const { repository } = this.deps;
    const now = this.deps.clock.now();

    const [venue, session] = await Promise.all([
      repository.getVenueConfig(params.venueId),
      repository.getSessionById(params.sessionId),
    ]);
    if (!venue) throw new QueueError('not_found', 'Venue not found.');
    if (!session || session.venueId !== params.venueId) {
      throw new QueueError('session_invalid', 'No active session for this venue.');
    }

    const provider = await this.deps.providerResolver.getProvider(params.venueId);
    const track = await provider.getTrack(params.providerTrackId);
    if (!track) throw new QueueError('not_found', 'Track not found.');

    const since = new Date(now.getTime() - DUPLICATE_LOCKOUT_MINUTES * MS_PER_MINUTE);
    const mostRecentSameSongAt = await repository.getMostRecentSameSongAt(
      params.venueId,
      params.providerTrackId,
      since,
    );

    const eligibility = checkRequestEligibility({
      now,
      venue,
      track: { artist: track.artist, genres: track.genres, explicit: track.explicit },
      session: {
        isActive: session.isActive,
        sessionExpiredAt: session.sessionExpiredAt,
        activeRequestCount: session.activeRequestCount,
        lastRequestAt: session.lastRequestAt,
      },
      mostRecentSameSongAt,
    });
    if (!eligibility.eligible) throw new QueueError(eligibility.code, eligibility.message);

    // Suggestion mode holds the item for venue approval before it can play.
    const awaitingApproval = venue.controlMode === 'suggestion';
    const queueItem = await repository.insertQueueItem({
      venueId: params.venueId,
      songId: params.providerTrackId,
      provider: venue.musicProvider,
      requestingUserId: session.userId,
      artist: track.artist,
      title: track.title,
      genre: track.genres[0] ?? null,
      explicitFlag: track.explicit,
      playabilityState: awaitingApproval ? 'awaiting_approval' : 'playable',
      playabilityReason: awaitingApproval ? 'Awaiting venue approval (suggestion mode).' : null,
    });

    const cooldownEndsAt = new Date(now.getTime() + REQUEST_COOLDOWN_MINUTES * MS_PER_MINUTE);
    await repository.recordRequestOnSession(session.sessionId, now, cooldownEndsAt);

    await this.recomputeAndBroadcast(params.venueId);
    this.deps.emitAnalyticsEvent({
      eventType: 'request_created',
      venueId: params.venueId,
      actorUserId: session.userId,
      queueItemId: queueItem.queueItemId,
      metadata: { songId: params.providerTrackId, artist: track.artist },
    });

    return { queueItem };
  }

  // -----------------------------------------------------------------------
  // Votes (layer 2 — votes table source of truth, counters denormalized)
  // -----------------------------------------------------------------------

  async castVote(params: {
    queueItemId: QueueItemId;
    userId: UserId;
    direction: VoteDirection;
  }): Promise<CastVoteResponse> {
    const { repository } = this.deps;
    const item = await repository.getQueueItem(params.queueItemId);
    if (!item) throw new QueueError('not_found', 'Queue item not found.');

    const existing = await repository.getVote(params.queueItemId, params.userId);
    const resolution = resolveCastVote(existing, params.direction);

    if (resolution.change === 'unchanged') {
      return { queueItem: item }; // idempotent no-op
    }

    await repository.setVote(params.queueItemId, params.userId, params.direction);
    const updated = await repository.applyVoteCounters(params.queueItemId, resolution.delta);

    await this.recomputeAndBroadcast(item.venueId);
    this.deps.emitAnalyticsEvent({
      eventType: 'vote_added',
      venueId: item.venueId,
      actorUserId: params.userId,
      queueItemId: params.queueItemId,
      metadata: { direction: params.direction, change: resolution.change },
    });

    return { queueItem: updated };
  }

  async removeVote(params: {
    queueItemId: QueueItemId;
    userId: UserId;
  }): Promise<CastVoteResponse> {
    const { repository } = this.deps;
    const item = await repository.getQueueItem(params.queueItemId);
    if (!item) throw new QueueError('not_found', 'Queue item not found.');

    const existing = await repository.getVote(params.queueItemId, params.userId);
    const resolution = resolveRemoveVote(existing);
    if (resolution.change === 'unchanged') {
      return { queueItem: item }; // idempotent no-op
    }

    await repository.deleteVote(params.queueItemId, params.userId);
    const updated = await repository.applyVoteCounters(params.queueItemId, resolution.delta);

    await this.recomputeAndBroadcast(item.venueId);
    this.deps.emitAnalyticsEvent({
      eventType: 'vote_removed',
      venueId: item.venueId,
      actorUserId: params.userId,
      queueItemId: params.queueItemId,
      metadata: { previousDirection: resolution.previousDirection },
    });

    return { queueItem: updated };
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  async getQueueSnapshot(venueId: VenueId): Promise<QueueSnapshot> {
    const { nowPlaying, ranked } = await this.recompute(venueId, { persist: false });
    return buildQueueSnapshot({ nowPlaying, rankedQueued: ranked });
  }

  async getPosition(queueItemId: QueueItemId): Promise<QueuePositionResponse> {
    const item = await this.deps.repository.getQueueItem(queueItemId);
    if (!item) throw new QueueError('not_found', 'Queue item not found.');

    const { venue, nowPlaying, ranked, frictionByItem } = await this.recompute(item.venueId, {
      persist: false,
    });
    const target = ranked.find((i) => i.queueItemId === queueItemId) ?? item;
    const response = buildPositionResponse({
      target,
      rankedQueued: ranked,
      weights: resolveWeights(venue.scoringWeightsOverride),
      frictionByItem,
      nowPlaying,
    });
    if (!response) throw new QueueError('not_found', 'Item is no longer in the live queue.');
    return response;
  }

  // -----------------------------------------------------------------------
  // DJ brain (layers 3 & 4) — advance on song end / skip
  // -----------------------------------------------------------------------

  /**
   * Advance the queue: finish the current song, pick the next playable item (vibe
   * constraint honored), fall back to the venue playlist when nothing is eligible, and
   * emit now_playing_changed + queue_updated. Callers: playback loop (ended) and the
   * venue skip endpoint (skipped, WS4).
   */
  async advance(params: {
    venueId: VenueId;
    reason: 'ended' | 'skipped';
  }): Promise<{ nowPlaying: QueueItem | null; usedFallback: boolean }> {
    const { repository } = this.deps;
    const venue = await repository.getVenueConfig(params.venueId);
    if (!venue) throw new QueueError('not_found', 'Venue not found.');

    await this.finishCurrent(params.venueId, params.reason);

    const { ranked } = await this.recompute(params.venueId, { persist: true });
    const [recentArtists, playedCount, forcedItemId] = await Promise.all([
      repository.getRecentPlayedArtists(params.venueId, ARTIST_REPEAT_WINDOW),
      repository.getPlayedCount(params.venueId),
      repository.getForcedNextItem(params.venueId),
    ]);
    // A forced pick is one-shot: it's consumed by this advance() regardless of whether
    // it ends up playable (stale/removed forced items just fall through to normal pick).
    if (forcedItemId) await repository.clearForcedNextItem(params.venueId);

    const context: PlayabilityContext = { controlMode: venue.controlMode };
    const selection = selectNextTrack({
      rankedItems: ranked,
      recentArtists,
      context,
      fallbackPlaylist: venue.fallbackPlaylist,
      fallbackCursor: playedCount,
      forcedItemId,
    });

    if (selection.kind === 'queue_item') {
      const playing = await this.startPlayingQueueItem(params.venueId, selection.item);
      return { nowPlaying: playing, usedFallback: false };
    }

    const provider = await this.deps.providerResolver.getProvider(params.venueId);
    const target = await this.deps.providerResolver.getPlaybackTarget(params.venueId);

    if (selection.kind === 'fallback') {
      const track = await provider.getTrack(selection.providerTrackId);
      if (track) {
        await provider.queueNext(target, track);
        await provider.play(target);
      }
      this.deps.broadcaster.broadcastToVenue(params.venueId, {
        type: 'now_playing_changed',
        payload: { queueItem: null, djAttribution: null },
      });
      await this.recomputeAndBroadcast(params.venueId);
      return { nowPlaying: null, usedFallback: true };
    }

    // Silent: nothing to play and no fallback configured.
    this.deps.broadcaster.broadcastToVenue(params.venueId, {
      type: 'now_playing_changed',
      payload: { queueItem: null, djAttribution: null },
    });
    return { nowPlaying: null, usedFallback: false };
  }

  // -----------------------------------------------------------------------
  // Overrides (layer 4) — venue-forced playback, precise routing
  // -----------------------------------------------------------------------

  /**
   * Play a specific queued item immediately: skip whatever is currently playing (same
   * settlement-relevant `song_skipped` analytics as a normal skip/advance), then start
   * `queueItemId` via the injected provider resolver. `queueItemId` must reference a
   * `queued`, `playable` item belonging to a real venue, or this throws a typed
   * `QueueError` (`not_found` / `validation`) instead of silently falling back to
   * top-ranked selection the way the old `advance()`-based approximation did.
   */
  async playNow(queueItemId: QueueItemId): Promise<{ nowPlaying: QueueItem }> {
    const { repository } = this.deps;
    const item = await repository.getQueueItem(queueItemId);
    if (!item) throw new QueueError('not_found', 'Queue item not found.');

    const venue = await repository.getVenueConfig(item.venueId);
    if (!venue) throw new QueueError('not_found', 'Venue not found.');

    if (item.status !== 'queued') {
      throw new QueueError('validation', 'Queue item is not currently queued.');
    }
    if (!isPlayable(item, { controlMode: venue.controlMode })) {
      throw new QueueError(
        'validation',
        'Queue item is not eligible to play (awaiting approval or held).',
      );
    }

    await this.finishCurrent(item.venueId, 'skipped');
    const playing = await this.startPlayingQueueItem(item.venueId, item);
    // The promoted item can no longer be the pending forced-next pick (and if some other
    // item held that marker, it's still valid for the *next* advance() — leave it alone).
    const forcedNextId = await repository.getForcedNextItem(item.venueId);
    if (forcedNextId === item.queueItemId) {
      await repository.clearForcedNextItem(item.venueId);
    }
    return { nowPlaying: playing };
  }

  /**
   * Flag a queued item as the forced next pick: the next `advance()` call (song end or
   * skip) selects it regardless of rank, bypassing the artist-repeat vibe constraint
   * (overrides are deliberate) while still requiring the item to be `queued` and
   * `playable` (venue block eligibility is enforced at request time and re-checked here
   * and again at selection time, so a since-blocked item is never force-played).
   *
   * Persistence choice: the marker lives in-memory on the repository (one queueItemId per
   * venue), not a new column — see `PostgresQueueRepository.forcedNextByVenue` for the
   * rationale (no schema change; a forced pick is short-lived and self-heals to normal
   * ranking if lost). `QueueRepository` exposes it as `setForcedNextItem` /
   * `getForcedNextItem` / `clearForcedNextItem` so a future persistent implementation is a
   * repository-only change.
   */
  async playNext(queueItemId: QueueItemId): Promise<QueueItem> {
    const { repository } = this.deps;
    const item = await repository.getQueueItem(queueItemId);
    if (!item) throw new QueueError('not_found', 'Queue item not found.');

    const venue = await repository.getVenueConfig(item.venueId);
    if (!venue) throw new QueueError('not_found', 'Venue not found.');

    if (item.status !== 'queued') {
      throw new QueueError('validation', 'Queue item is not currently queued.');
    }
    if (!isPlayable(item, { controlMode: venue.controlMode })) {
      throw new QueueError(
        'validation',
        'Queue item is not eligible to play (awaiting approval or held).',
      );
    }

    await repository.setForcedNextItem(item.venueId, item.queueItemId);
    return item;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Finish whatever is currently playing at a venue, if anything, stamping the same
   * terminal status + analytics event `advance()` always has (played on natural end,
   * skipped otherwise). Shared by `advance()` and `playNow()` so overrides emit
   * identical, settlement-relevant analytics to a normal skip. */
  private async finishCurrent(
    venueId: VenueId,
    reason: 'ended' | 'skipped',
  ): Promise<QueueItem | null> {
    const { repository } = this.deps;
    const current = await repository.getNowPlaying(venueId);
    if (!current) return null;
    await repository.markFinished(current.queueItemId, reason === 'skipped' ? 'skipped' : 'played');
    this.deps.emitAnalyticsEvent({
      eventType: reason === 'skipped' ? 'song_skipped' : 'song_played',
      venueId,
      actorUserId: current.requestingUserId,
      queueItemId: current.queueItemId,
      metadata: { songId: current.songId, artist: current.artist },
    });
    return current;
  }

  /** Mark a queue item playing, drive it through the provider, and broadcast
   * now_playing_changed + queue_updated. Shared by `advance()`'s queue_item selection and
   * `playNow()`. */
  private async startPlayingQueueItem(venueId: VenueId, item: QueueItem): Promise<QueueItem> {
    const { repository } = this.deps;
    const provider = await this.deps.providerResolver.getProvider(venueId);
    const target = await this.deps.providerResolver.getPlaybackTarget(venueId);

    const playing = await repository.markPlaying(item.queueItemId);
    if (!playing) throw new QueueError('not_found', 'Queue item not found.');

    const track = await provider.getTrack(item.songId);
    if (track) {
      await provider.queueNext(target, track);
      await provider.play(target);
    }
    const djAttribution = await repository.getDisplayName(item.requestingUserId);
    this.deps.broadcaster.broadcastToVenue(venueId, {
      type: 'now_playing_changed',
      payload: { queueItem: playing, djAttribution },
    });
    await this.recomputeAndBroadcast(venueId);
    return playing;
  }

  private async recompute(venueId: VenueId, opts: { persist: boolean }): Promise<RecomputeResult> {
    const { repository } = this.deps;
    const venue = await repository.getVenueConfig(venueId);
    if (!venue) throw new QueueError('not_found', 'Venue not found.');

    const [nowPlaying, items] = await Promise.all([
      repository.getNowPlaying(venueId),
      repository.getLiveQueueItems(venueId),
    ]);

    const frictionByItem = await this.deps.frictionProvider.getFriction({
      venueId,
      items: items.map((i) => ({
        queueItemId: i.queueItemId,
        artist: i.artist,
        requestingUserId: i.requestingUserId,
      })),
    });

    const weights = resolveWeights(venue.scoringWeightsOverride);
    const ranked = rankItems(items, weights, frictionByItem);

    if (opts.persist && ranked.length > 0) {
      const calcAt = this.deps.clock.now();
      await repository.updateScores(
        ranked.map((i) => ({
          queueItemId: i.queueItemId,
          currentScore: i.currentScore,
          lastScoreCalculatedAt: calcAt,
        })),
      );
    }

    return { venue, nowPlaying, ranked, frictionByItem };
  }

  private async recomputeAndBroadcast(venueId: VenueId): Promise<void> {
    const { nowPlaying, ranked } = await this.recompute(venueId, { persist: true });
    const snapshot = buildQueueSnapshot({ nowPlaying, rankedQueued: ranked });
    this.deps.broadcaster.broadcastToVenue(venueId, { type: 'queue_updated', payload: snapshot });
  }
}

export function createQueueService(options: QueueServiceOptions): QueueService {
  return new QueueService(options);
}
