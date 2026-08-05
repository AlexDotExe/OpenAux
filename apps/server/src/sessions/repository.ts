/**
 * Session/venue/user persistence for the sessions module.
 *
 * Keep SQL in this file only. Everything else in sessions/ depends on the
 * SessionRepository interface so join eligibility, guest creation, and
 * expiry logic are unit-testable with a stub — no live database required.
 */
import type { Pool, QueryResult } from 'pg';
import type { MusicProviderId, Session, User, Venue, VenueControlMode } from '@openaux/shared';
import { pool as sharedPool } from '../db.js';

export interface SessionRepository {
  findVenueByQrToken(qrToken: string): Promise<Venue | null>;
  findActiveSession(userId: string, venueId: string): Promise<Session | null>;
  createGuestUser(displayName: string): Promise<User>;
  findOrCreateAuthedUser(
    provider: 'apple' | 'google' | 'phone',
    subject: string,
    displayName: string,
  ): Promise<User>;
  createSession(userId: string, venueId: string, isGuest: boolean): Promise<Session>;
  touchSession(sessionId: string, now: Date): Promise<void>;
  /** All currently-active sessions; the lifecycle sweep filters these with isSessionExpired. */
  findActiveSessions(): Promise<Session[]>;
  expireSession(sessionId: string, expiredAt: Date): Promise<void>;
}

interface VenueRow {
  venue_id: string;
  owner_id: string | null;
  name: string;
  music_provider: MusicProviderId;
  control_mode: VenueControlMode;
  qr_token: string;
  block_explicit: boolean;
  blocked_genres: string[];
  blocked_artists: string[];
  scoring_weights_override: Venue['scoringWeightsOverride'];
  fallback_playlist: string[];
  anthem_provider: MusicProviderId | null;
  anthem_provider_track_id: string | null;
  anthem_title: string | null;
  anthem_artist: string | null;
  anthem_promo_text: string | null;
  anthem_promo_duration_minutes: number | null;
  stripe_account_id: string | null;
  playback_device_id: string | null;
  created_at: Date;
}

function mapVenue(row: VenueRow): Venue {
  return {
    venueId: row.venue_id,
    ownerId: row.owner_id,
    name: row.name,
    musicProvider: row.music_provider,
    controlMode: row.control_mode,
    qrToken: row.qr_token,
    blockExplicit: row.block_explicit,
    blockedGenres: row.blocked_genres,
    blockedArtists: row.blocked_artists,
    scoringWeightsOverride: row.scoring_weights_override,
    fallbackPlaylist: row.fallback_playlist ?? [],
    anthemProvider: row.anthem_provider,
    anthemProviderTrackId: row.anthem_provider_track_id,
    anthemTitle: row.anthem_title,
    anthemArtist: row.anthem_artist,
    anthemPromoText: row.anthem_promo_text,
    anthemPromoDurationMinutes: row.anthem_promo_duration_minutes,
    stripeAccountId: row.stripe_account_id,
    playbackDeviceId: row.playback_device_id,
    createdAt: row.created_at,
  };
}

interface UserRow {
  user_id: string;
  display_name: string;
  auth_provider: User['authProvider'];
  credit_balance: number;
  influence_score: string | number;
  created_at: Date;
}

function mapUser(row: UserRow): User {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    authProvider: row.auth_provider,
    creditBalance: row.credit_balance,
    influenceScore: Number(row.influence_score),
    createdAt: row.created_at,
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

/** Postgres-backed implementation. Uses the shared pool from apps/server/src/db.ts. */
export class PgSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool = sharedPool) {}

  async findVenueByQrToken(qrToken: string): Promise<Venue | null> {
    const result: QueryResult<VenueRow> = await this.pool.query(
      'select * from venues where qr_token = $1',
      [qrToken],
    );
    return result.rows[0] ? mapVenue(result.rows[0]) : null;
  }

  async findActiveSession(userId: string, venueId: string): Promise<Session | null> {
    const result: QueryResult<SessionRow> = await this.pool.query(
      'select * from sessions where user_id = $1 and venue_id = $2 and is_active limit 1',
      [userId, venueId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async createGuestUser(displayName: string): Promise<User> {
    const result: QueryResult<UserRow> = await this.pool.query(
      "insert into users (display_name, auth_provider) values ($1, 'guest') returning *",
      [displayName],
    );
    return mapUser(result.rows[0]!);
  }

  async findOrCreateAuthedUser(
    provider: 'apple' | 'google' | 'phone',
    subject: string,
    displayName: string,
  ): Promise<User> {
    const existing: QueryResult<UserRow> = await this.pool.query(
      'select * from users where auth_provider = $1 and auth_subject = $2',
      [provider, subject],
    );
    if (existing.rows[0]) return mapUser(existing.rows[0]);

    const created: QueryResult<UserRow> = await this.pool.query(
      'insert into users (display_name, auth_provider, auth_subject) values ($1, $2, $3) returning *',
      [displayName, provider, subject],
    );
    return mapUser(created.rows[0]!);
  }

  async createSession(userId: string, venueId: string, isGuest: boolean): Promise<Session> {
    const result: QueryResult<SessionRow> = await this.pool.query(
      'insert into sessions (user_id, venue_id, is_guest) values ($1, $2, $3) returning *',
      [userId, venueId, isGuest],
    );
    return mapSession(result.rows[0]!);
  }

  async touchSession(sessionId: string, now: Date): Promise<void> {
    await this.pool.query('update sessions set last_active_at = $2 where session_id = $1', [
      sessionId,
      now,
    ]);
  }

  async findActiveSessions(): Promise<Session[]> {
    const result: QueryResult<SessionRow> = await this.pool.query(
      'select * from sessions where is_active',
    );
    return result.rows.map(mapSession);
  }

  async expireSession(sessionId: string, expiredAt: Date): Promise<void> {
    await this.pool.query(
      'update sessions set is_active = false, session_expired_at = $2 where session_id = $1',
      [sessionId, expiredAt],
    );
  }
}
