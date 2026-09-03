/**
 * Postgres-backed VenueRepository. Uses the shared pool from
 * apps/server/src/db.ts (never a private pool). Not exercised by the unit
 * suite — pure logic lives in *-logic.ts / announcements.ts and is tested
 * without a live DB; this class is the thin, mostly-untested SQL layer.
 *
 * The venues.anthem_* columns setAnthem/getAnthem use now exist in
 * db/schema.sql (added in the 2026-07-24 contract change).
 */
import type { Pool } from 'pg';
import type {
  MusicProviderId,
  PlayabilityState,
  QueueItem,
  QueueItemId,
  QueueItemSourceType,
  QueueItemStatus,
  Track,
  UserId,
  VenueControlMode,
  VenueId,
  VenueSummary,
} from '@openaux/shared';
import type { AnthemConfig, VenueRepository, VenueSettingsRecord } from './types.js';

interface QueueItemRow {
  queue_item_id: string;
  venue_id: string;
  song_id: string;
  provider: MusicProviderId;
  requesting_user_id: string;
  created_at: Date;
  status: QueueItemStatus;
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
  playability_state: PlayabilityState;
  playability_reason: string | null;
  source_type: QueueItemSourceType;
  played_at: Date | null;
  crowd_skip_votes?: number;
}

function mapQueueItemRow(row: QueueItemRow): QueueItem {
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
    crowdSkipVotes: row.crowd_skip_votes ?? 0,
  };
}

const QUEUE_ITEM_COLUMNS = `
  queue_item_id, venue_id, song_id, provider, requesting_user_id, created_at, status,
  upvotes_count, downvotes_count, unique_supporter_count, priority_boost_count,
  instant_vote_count, super_boost_count, explicit_flag, genre, artist, title,
  is_duplicate_locked, last_score_calculated_at, current_score, playability_state,
  playability_reason, source_type, played_at
`;

export class PostgresVenueRepository implements VenueRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(venueId: VenueId): Promise<VenueSettingsRecord | null> {
    const { rows } = await this.pool.query<{
      venue_id: string;
      control_mode: VenueControlMode;
      block_explicit: boolean;
      blocked_genres: string[];
      blocked_artists: string[];
    }>(
      `select venue_id, control_mode, block_explicit, blocked_genres, blocked_artists
       from venues where venue_id = $1`,
      [venueId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      venueId: row.venue_id,
      controlMode: row.control_mode,
      blockExplicit: row.block_explicit,
      blockedGenres: row.blocked_genres,
      blockedArtists: row.blocked_artists,
    };
  }

  async updateSettings(
    venueId: VenueId,
    patch: Partial<Omit<VenueSettingsRecord, 'venueId'>>,
  ): Promise<VenueSettingsRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.controlMode !== undefined) {
      values.push(patch.controlMode);
      sets.push(`control_mode = $${values.length}`);
    }
    if (patch.blockExplicit !== undefined) {
      values.push(patch.blockExplicit);
      sets.push(`block_explicit = $${values.length}`);
    }
    if (patch.blockedGenres !== undefined) {
      values.push(patch.blockedGenres);
      sets.push(`blocked_genres = $${values.length}`);
    }
    if (patch.blockedArtists !== undefined) {
      values.push(patch.blockedArtists);
      sets.push(`blocked_artists = $${values.length}`);
    }

    if (sets.length === 0) {
      return this.getSettings(venueId);
    }

    values.push(venueId);
    const { rows } = await this.pool.query<{
      venue_id: string;
      control_mode: VenueControlMode;
      block_explicit: boolean;
      blocked_genres: string[];
      blocked_artists: string[];
    }>(
      `update venues set ${sets.join(', ')} where venue_id = $${values.length}
       returning venue_id, control_mode, block_explicit, blocked_genres, blocked_artists`,
      values,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      venueId: row.venue_id,
      controlMode: row.control_mode,
      blockExplicit: row.block_explicit,
      blockedGenres: row.blocked_genres,
      blockedArtists: row.blocked_artists,
    };
  }

  async getVenueSummary(venueId: VenueId): Promise<VenueSummary | null> {
    const { rows } = await this.pool.query<{
      venue_id: string;
      name: string;
      music_provider: MusicProviderId;
      control_mode: VenueControlMode;
      qr_token: string;
      block_explicit: boolean;
      blocked_genres: string[];
      blocked_artists: string[];
    }>(
      `select venue_id, name, music_provider, control_mode, qr_token, block_explicit, blocked_genres, blocked_artists
       from venues where venue_id = $1`,
      [venueId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      venueId: row.venue_id,
      name: row.name,
      musicProvider: row.music_provider,
      controlMode: row.control_mode,
      qrToken: row.qr_token,
      blockExplicit: row.block_explicit,
      blockedGenres: row.blocked_genres,
      blockedArtists: row.blocked_artists,
      powerHour: null,
    };
  }

  async getFallbackPlaylist(venueId: VenueId): Promise<string[]> {
    const { rows } = await this.pool.query<{ fallback_playlist: string[] }>(
      `select fallback_playlist from venues where venue_id = $1`,
      [venueId],
    );
    return rows[0]?.fallback_playlist ?? [];
  }

  async getMusicProviderId(venueId: VenueId): Promise<MusicProviderId | null> {
    const { rows } = await this.pool.query<{ music_provider: MusicProviderId }>(
      `select music_provider from venues where venue_id = $1`,
      [venueId],
    );
    return rows[0]?.music_provider ?? null;
  }

  async getOrCreateVenueActorUserId(venueId: VenueId): Promise<UserId> {
    const authSubject = `venue:${venueId}:system`;
    const existing = await this.pool.query<{ user_id: string }>(
      `select user_id from users where auth_provider = 'guest' and auth_subject = $1`,
      [authSubject],
    );
    if (existing.rows[0]) return existing.rows[0].user_id;

    const inserted = await this.pool.query<{ user_id: string }>(
      `insert into users (display_name, auth_provider, auth_subject)
       values ('Venue', 'guest', $1)
       on conflict (auth_provider, auth_subject) do update set display_name = excluded.display_name
       returning user_id`,
      [authSubject],
    );
    return inserted.rows[0]!.user_id;
  }

  async insertQueueItem(input: {
    venueId: VenueId;
    track: Track;
    requestingUserId: UserId;
    sourceType: QueueItemSourceType;
    playabilityState: PlayabilityState;
  }): Promise<QueueItem> {
    const { rows } = await this.pool.query<QueueItemRow>(
      `insert into queue_items (
         venue_id, song_id, provider, requesting_user_id, status,
         explicit_flag, genre, artist, title, playability_state, source_type
       ) values ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10)
       returning ${QUEUE_ITEM_COLUMNS}`,
      [
        input.venueId,
        input.track.providerTrackId,
        input.track.provider,
        input.requestingUserId,
        input.track.explicit,
        input.track.genres[0] ?? null,
        input.track.artist,
        input.track.title,
        input.playabilityState,
        input.sourceType,
      ],
    );
    return mapQueueItemRow(rows[0]!);
  }

  async getQueueItem(queueItemId: QueueItemId): Promise<QueueItem | null> {
    const { rows } = await this.pool.query<QueueItemRow>(
      `select ${QUEUE_ITEM_COLUMNS} from queue_items where queue_item_id = $1`,
      [queueItemId],
    );
    return rows[0] ? mapQueueItemRow(rows[0]) : null;
  }

  async setPlayabilityState(
    queueItemId: QueueItemId,
    state: PlayabilityState,
  ): Promise<QueueItem | null> {
    const { rows } = await this.pool.query<QueueItemRow>(
      `update queue_items set playability_state = $2 where queue_item_id = $1
       returning ${QUEUE_ITEM_COLUMNS}`,
      [queueItemId, state],
    );
    return rows[0] ? mapQueueItemRow(rows[0]) : null;
  }

  async setStatus(queueItemId: QueueItemId, status: QueueItemStatus): Promise<QueueItem | null> {
    const { rows } = await this.pool.query<QueueItemRow>(
      `update queue_items set status = $2 where queue_item_id = $1
       returning ${QUEUE_ITEM_COLUMNS}`,
      [queueItemId, status],
    );
    return rows[0] ? mapQueueItemRow(rows[0]) : null;
  }

  async getCurrentlyPlaying(venueId: VenueId): Promise<QueueItem | null> {
    const { rows } = await this.pool.query<QueueItemRow>(
      `select ${QUEUE_ITEM_COLUMNS} from queue_items
       where venue_id = $1 and status = 'playing'
       order by created_at desc limit 1`,
      [venueId],
    );
    return rows[0] ? mapQueueItemRow(rows[0]) : null;
  }

  async setFallbackPlaylist(venueId: VenueId, providerTrackIds: string[]): Promise<void> {
    await this.pool.query(`update venues set fallback_playlist = $2::jsonb where venue_id = $1`, [
      venueId,
      JSON.stringify(providerTrackIds),
    ]);
  }

  async setAnthem(venueId: VenueId, anthem: AnthemConfig): Promise<void> {
    await this.pool.query(
      `update venues set
         anthem_provider = $2,
         anthem_provider_track_id = $3,
         anthem_title = $4,
         anthem_artist = $5,
         anthem_promo_text = $6,
         anthem_promo_duration_minutes = $7
       where venue_id = $1`,
      [
        venueId,
        anthem.provider,
        anthem.providerTrackId,
        anthem.title,
        anthem.artist,
        anthem.promoText,
        anthem.promoDurationMinutes,
      ],
    );
  }

  async getAnthem(venueId: VenueId): Promise<AnthemConfig | null> {
    const { rows } = await this.pool.query<{
      anthem_provider: MusicProviderId | null;
      anthem_provider_track_id: string | null;
      anthem_title: string | null;
      anthem_artist: string | null;
      anthem_promo_text: string | null;
      anthem_promo_duration_minutes: number | null;
    }>(
      `select anthem_provider, anthem_provider_track_id, anthem_title, anthem_artist,
              anthem_promo_text, anthem_promo_duration_minutes
       from venues where venue_id = $1`,
      [venueId],
    );
    const row = rows[0];
    if (!row || !row.anthem_provider_track_id || !row.anthem_provider) return null;
    return {
      provider: row.anthem_provider,
      providerTrackId: row.anthem_provider_track_id,
      title: row.anthem_title ?? '',
      artist: row.anthem_artist ?? '',
      promoText: row.anthem_promo_text ?? '',
      promoDurationMinutes: row.anthem_promo_duration_minutes ?? 0,
    };
  }

  async getUserDisplayName(userId: UserId): Promise<string | null> {
    const { rows } = await this.pool.query<{ display_name: string }>(
      `select display_name from users where user_id = $1`,
      [userId],
    );
    return rows[0]?.display_name ?? null;
  }
}
