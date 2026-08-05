/**
 * Queue repository — the only place the queue core touches SQL. The service depends on
 * the QueueRepository interface (stubbable in tests); PostgresQueueRepository is the
 * production implementation over the shared pool. Decision logic stays in the pure
 * modules, so unit tests never need a live database.
 */

import type { Pool } from 'pg';
import type {
  MusicProviderId,
  QueueItem,
  QueueItemId,
  Session,
  SessionId,
  UserId,
  VenueControlMode,
  VenueId,
  VoteDirection,
} from '@openaux/shared';
import type { ScoringWeights } from '@openaux/shared';
import type { VoteCounterDelta } from './votes.js';

/** Venue config the queue core needs (subset of the venues row). */
export interface VenueConfig {
  venueId: VenueId;
  name: string;
  controlMode: VenueControlMode;
  musicProvider: MusicProviderId;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
  scoringWeightsOverride: Partial<ScoringWeights> | null;
  fallbackPlaylist: string[];
}

export interface InsertQueueItemInput {
  venueId: VenueId;
  songId: string;
  provider: MusicProviderId;
  requestingUserId: UserId;
  artist: string;
  title: string;
  genre: string | null;
  explicitFlag: boolean;
  playabilityState: QueueItem['playabilityState'];
  playabilityReason: string | null;
}

export interface ScoreUpdate {
  queueItemId: QueueItemId;
  currentScore: number;
  lastScoreCalculatedAt: Date;
}

export interface QueueRepository {
  getVenueConfig(venueId: VenueId): Promise<VenueConfig | null>;
  getSessionById(sessionId: SessionId): Promise<Session | null>;
  getDisplayName(userId: UserId): Promise<string | null>;

  getQueueItem(queueItemId: QueueItemId): Promise<QueueItem | null>;
  /** Live (status = 'queued') items for a venue. */
  getLiveQueueItems(venueId: VenueId): Promise<QueueItem[]>;
  getNowPlaying(venueId: VenueId): Promise<QueueItem | null>;

  /** created_at of the most recent same-song item within the lockout window, or null. */
  getMostRecentSameSongAt(venueId: VenueId, songId: string, since: Date): Promise<Date | null>;

  insertQueueItem(input: InsertQueueItemInput): Promise<QueueItem>;

  getVote(queueItemId: QueueItemId, userId: UserId): Promise<VoteDirection | null>;
  setVote(queueItemId: QueueItemId, userId: UserId, direction: VoteDirection): Promise<void>;
  deleteVote(queueItemId: QueueItemId, userId: UserId): Promise<void>;
  /** Apply a counter delta to the denormalized queue_items counters and return the row. */
  applyVoteCounters(queueItemId: QueueItemId, delta: VoteCounterDelta): Promise<QueueItem>;

  updateScores(updates: ScoreUpdate[]): Promise<void>;

  /** Artists of the last N played songs, most-recent first (DJ-brain vibe constraint). */
  getRecentPlayedArtists(venueId: VenueId, limit: number): Promise<string[]>;
  /** Count of songs already played/skipped — the fallback rotation cursor. */
  getPlayedCount(venueId: VenueId): Promise<number>;

  markPlaying(queueItemId: QueueItemId): Promise<QueueItem | null>;
  markFinished(queueItemId: QueueItemId, status: 'played' | 'skipped'): Promise<void>;

  /** Bump session request bookkeeping after a successful request (WS1 owns sessions,
   * but the queue increments the counters it gates on transactionally at request time). */
  recordRequestOnSession(sessionId: SessionId, now: Date, cooldownEndsAt: Date): Promise<void>;

  // -------------------------------------------------------------------------
  // Overrides layer — forced-next marker (QueueService.playNext)
  // -------------------------------------------------------------------------

  /** Record the item the next advance() call must select, superseding rank. One per venue;
   * setting a new value replaces any prior marker for that venue. */
  setForcedNextItem(venueId: VenueId, queueItemId: QueueItemId): Promise<void>;
  /** The venue's pending forced-next item id, or null if none is set. */
  getForcedNextItem(venueId: VenueId): Promise<QueueItemId | null>;
  /** Consume (clear) the venue's forced-next marker. Idempotent. */
  clearForcedNextItem(venueId: VenueId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface QueueItemRow {
  queue_item_id: string;
  venue_id: string;
  song_id: string;
  provider: MusicProviderId;
  requesting_user_id: string;
  created_at: Date;
  status: QueueItem['status'];
  upvotes_count: number;
  downvotes_count: number;
  unique_supporter_count: number;
  priority_boost_count: number;
  instant_vote_count: number;
  super_boost_count: number;
  explicit_flag: boolean;
  genre: string | null;
  artist: string;
  title: string;
  is_duplicate_locked: boolean;
  last_score_calculated_at: Date | null;
  current_score: string | number;
  playability_state: QueueItem['playabilityState'];
  playability_reason: string | null;
  source_type: QueueItem['sourceType'];
  played_at: Date | null;
}

function mapQueueItem(row: QueueItemRow): QueueItem {
  return {
    queueItemId: row.queue_item_id,
    venueId: row.venue_id,
    songId: row.song_id,
    provider: row.provider,
    requestingUserId: row.requesting_user_id,
    createdAt: row.created_at,
    status: row.status,
    upvotesCount: row.upvotes_count,
    downvotesCount: row.downvotes_count,
    uniqueSupporterCount: row.unique_supporter_count,
    priorityBoostCount: row.priority_boost_count,
    instantVoteCount: row.instant_vote_count,
    superBoostCount: row.super_boost_count,
    explicitFlag: row.explicit_flag,
    genre: row.genre,
    artist: row.artist,
    title: row.title,
    isDuplicateLocked: row.is_duplicate_locked,
    lastScoreCalculatedAt: row.last_score_calculated_at,
    currentScore: Number(row.current_score),
    playabilityState: row.playability_state,
    playabilityReason: row.playability_reason,
    sourceType: row.source_type,
    playedAt: row.played_at,
  };
}

interface SessionRow {
  session_id: string;
  user_id: string;
  venue_id: string;
  joined_at: Date;
  last_active_at: Date;
  is_guest: boolean;
  is_active: boolean;
  session_expired_at: Date | null;
  active_request_count: number;
  cooldown_ends_at: Date | null;
  last_vote_at: Date | null;
  last_request_at: Date | null;
}

function mapSession(row: SessionRow): Session {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    venueId: row.venue_id,
    joinedAt: row.joined_at,
    lastActiveAt: row.last_active_at,
    isGuest: row.is_guest,
    isActive: row.is_active,
    sessionExpiredAt: row.session_expired_at,
    activeRequestCount: row.active_request_count,
    cooldownEndsAt: row.cooldown_ends_at,
    lastVoteAt: row.last_vote_at,
    lastRequestAt: row.last_request_at,
  };
}

const QUEUE_ITEM_COLUMNS = `
  queue_item_id, venue_id, song_id, provider, requesting_user_id, created_at, status,
  upvotes_count, downvotes_count, unique_supporter_count, priority_boost_count,
  instant_vote_count, super_boost_count, explicit_flag, genre, artist, title,
  is_duplicate_locked, last_score_calculated_at, current_score, playability_state,
  playability_reason, source_type, played_at`;

export class PostgresQueueRepository implements QueueRepository {
  // Forced-next marker (overrides layer, QueueService.playNext): kept in-memory rather
  // than in a new column. There is no queue_items/venues column for "play this specific
  // item next" today, and adding one is a deliberate schema change (CLAUDE.md contract
  // rules) out of scope here. The marker is short-lived by design — set by a venue
  // override, consumed by the very next advance() — so losing it on process restart
  // only degrades a pending override back to normal ranking, it never corrupts state.
  // This does assume a single server process (already true elsewhere, e.g.
  // InMemoryVenueTokenStore in providers/); a future multi-instance deployment should
  // promote this to a real column (e.g. venues.forced_next_queue_item_id) instead.
  private readonly forcedNextByVenue = new Map<VenueId, QueueItemId>();

  constructor(private readonly pool: Pool) {}

  async setForcedNextItem(venueId: VenueId, queueItemId: QueueItemId): Promise<void> {
    this.forcedNextByVenue.set(venueId, queueItemId);
  }

  async getForcedNextItem(venueId: VenueId): Promise<QueueItemId | null> {
    return this.forcedNextByVenue.get(venueId) ?? null;
  }

  async clearForcedNextItem(venueId: VenueId): Promise<void> {
    this.forcedNextByVenue.delete(venueId);
  }

  async getVenueConfig(venueId: VenueId): Promise<VenueConfig | null> {
    const { rows } = await this.pool.query(
      `select venue_id, name, control_mode, music_provider, block_explicit,
              blocked_genres, blocked_artists, scoring_weights_override, fallback_playlist
         from venues where venue_id = $1`,
      [venueId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      venueId: row.venue_id,
      name: row.name,
      controlMode: row.control_mode,
      musicProvider: row.music_provider,
      blockExplicit: row.block_explicit,
      blockedGenres: row.blocked_genres ?? [],
      blockedArtists: row.blocked_artists ?? [],
      scoringWeightsOverride: row.scoring_weights_override ?? null,
      fallbackPlaylist: Array.isArray(row.fallback_playlist) ? row.fallback_playlist : [],
    };
  }

  async getSessionById(sessionId: SessionId): Promise<Session | null> {
    const { rows } = await this.pool.query(`select * from sessions where session_id = $1`, [
      sessionId,
    ]);
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async getDisplayName(userId: UserId): Promise<string | null> {
    const { rows } = await this.pool.query(`select display_name from users where user_id = $1`, [
      userId,
    ]);
    return rows[0]?.display_name ?? null;
  }

  async getQueueItem(queueItemId: QueueItemId): Promise<QueueItem | null> {
    const { rows } = await this.pool.query(
      `select ${QUEUE_ITEM_COLUMNS} from queue_items where queue_item_id = $1`,
      [queueItemId],
    );
    return rows[0] ? mapQueueItem(rows[0]) : null;
  }

  async getLiveQueueItems(venueId: VenueId): Promise<QueueItem[]> {
    const { rows } = await this.pool.query(
      `select ${QUEUE_ITEM_COLUMNS} from queue_items
         where venue_id = $1 and status = 'queued'`,
      [venueId],
    );
    return rows.map(mapQueueItem);
  }

  async getNowPlaying(venueId: VenueId): Promise<QueueItem | null> {
    const { rows } = await this.pool.query(
      `select ${QUEUE_ITEM_COLUMNS} from queue_items
         where venue_id = $1 and status = 'playing'
         order by last_score_calculated_at desc nulls last limit 1`,
      [venueId],
    );
    return rows[0] ? mapQueueItem(rows[0]) : null;
  }

  async getMostRecentSameSongAt(
    venueId: VenueId,
    songId: string,
    since: Date,
  ): Promise<Date | null> {
    const { rows } = await this.pool.query(
      `select max(created_at) as most_recent from queue_items
         where venue_id = $1 and song_id = $2 and created_at >= $3
           and status not in ('blocked', 'expired')`,
      [venueId, songId, since],
    );
    return rows[0]?.most_recent ?? null;
  }

  async insertQueueItem(input: InsertQueueItemInput): Promise<QueueItem> {
    const { rows } = await this.pool.query(
      `insert into queue_items
         (venue_id, song_id, provider, requesting_user_id, artist, title, genre,
          explicit_flag, playability_state, playability_reason, source_type, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'organic','queued')
       returning ${QUEUE_ITEM_COLUMNS}`,
      [
        input.venueId,
        input.songId,
        input.provider,
        input.requestingUserId,
        input.artist,
        input.title,
        input.genre,
        input.explicitFlag,
        input.playabilityState,
        input.playabilityReason,
      ],
    );
    return mapQueueItem(rows[0]);
  }

  async getVote(queueItemId: QueueItemId, userId: UserId): Promise<VoteDirection | null> {
    const { rows } = await this.pool.query(
      `select direction from votes where queue_item_id = $1 and user_id = $2`,
      [queueItemId, userId],
    );
    return rows[0]?.direction ?? null;
  }

  async setVote(queueItemId: QueueItemId, userId: UserId, direction: VoteDirection): Promise<void> {
    await this.pool.query(
      `insert into votes (queue_item_id, user_id, direction)
         values ($1, $2, $3)
       on conflict (queue_item_id, user_id)
         do update set direction = excluded.direction, created_at = now()`,
      [queueItemId, userId, direction],
    );
  }

  async deleteVote(queueItemId: QueueItemId, userId: UserId): Promise<void> {
    await this.pool.query(`delete from votes where queue_item_id = $1 and user_id = $2`, [
      queueItemId,
      userId,
    ]);
  }

  async applyVoteCounters(queueItemId: QueueItemId, delta: VoteCounterDelta): Promise<QueueItem> {
    const { rows } = await this.pool.query(
      `update queue_items set
         upvotes_count = greatest(0, upvotes_count + $2),
         downvotes_count = greatest(0, downvotes_count + $3),
         unique_supporter_count = greatest(0, unique_supporter_count + $4)
       where queue_item_id = $1
       returning ${QUEUE_ITEM_COLUMNS}`,
      [queueItemId, delta.upvotesDelta, delta.downvotesDelta, delta.uniqueSupporterDelta],
    );
    return mapQueueItem(rows[0]);
  }

  async updateScores(updates: ScoreUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    // Batch update via a values() join.
    const values: unknown[] = [];
    const tuples = updates.map((u, i) => {
      const base = i * 3;
      values.push(u.queueItemId, u.currentScore, u.lastScoreCalculatedAt);
      return `($${base + 1}::uuid, $${base + 2}::numeric, $${base + 3}::timestamptz)`;
    });
    await this.pool.query(
      `update queue_items q set
         current_score = v.score,
         last_score_calculated_at = v.calc_at
       from (values ${tuples.join(', ')}) as v(id, score, calc_at)
       where q.queue_item_id = v.id`,
      values,
    );
  }

  async getRecentPlayedArtists(venueId: VenueId, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select artist from queue_items
         where venue_id = $1 and status = 'played'
         order by last_score_calculated_at desc nulls last, created_at desc
         limit $2`,
      [venueId, limit],
    );
    return rows.map((r) => r.artist as string);
  }

  async getPlayedCount(venueId: VenueId): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from queue_items
         where venue_id = $1 and status in ('played', 'skipped')`,
      [venueId],
    );
    return rows[0]?.n ?? 0;
  }

  async markPlaying(queueItemId: QueueItemId): Promise<QueueItem | null> {
    const { rows } = await this.pool.query(
      `update queue_items set status = 'playing'
         where queue_item_id = $1 returning ${QUEUE_ITEM_COLUMNS}`,
      [queueItemId],
    );
    return rows[0] ? mapQueueItem(rows[0]) : null;
  }

  async markFinished(queueItemId: QueueItemId, status: 'played' | 'skipped'): Promise<void> {
    // Stamp played_at only on the actual-play terminal state (not skipped), so the
    // antispam recently-played lookup and DJ-brain vibe window use real play order.
    await this.pool.query(
      `update queue_items
         set status = $2,
             played_at = case when $2 = 'played' then now() else played_at end
       where queue_item_id = $1`,
      [queueItemId, status],
    );
  }

  async recordRequestOnSession(
    sessionId: SessionId,
    now: Date,
    cooldownEndsAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `update sessions set
         active_request_count = active_request_count + 1,
         last_request_at = $2,
         cooldown_ends_at = $3,
         last_active_at = $2
       where session_id = $1`,
      [sessionId, now, cooldownEndsAt],
    );
  }
}
