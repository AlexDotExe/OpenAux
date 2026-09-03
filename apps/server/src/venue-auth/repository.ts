/**
 * Persistence for venue-owner accounts, admin sessions, and owner-created venues.
 * SQL stays in this file; the rest of venue-auth/ depends on the interface so the
 * service/verifier are unit-testable with an in-memory stub.
 */
import type { MusicProviderId, VenueOwner, VenueSummary } from '@openaux/shared';
import { pool as sharedPool } from '../db.js';

export interface QueryablePool {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface OwnerWithSecret {
  owner: VenueOwner;
  passwordHash: string;
}

export interface SessionRecord {
  venueOwnerId: string;
  expiresAt: Date;
}

/** Raised when an email is already registered (maps to a 'validation' API error). */
export class DuplicateEmailError extends Error {}

export interface VenueAuthRepository {
  createOwner(email: string, passwordHash: string, displayName: string): Promise<VenueOwner>;
  findOwnerByEmail(email: string): Promise<OwnerWithSecret | null>;
  findOwnerById(venueOwnerId: string): Promise<VenueOwner | null>;
  createSession(tokenHash: string, venueOwnerId: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(tokenHash: string, now: Date): Promise<void>;
  createVenue(
    ownerId: string,
    name: string,
    musicProvider: MusicProviderId,
    qrToken: string,
  ): Promise<VenueSummary>;
  listVenuesByOwner(ownerId: string): Promise<VenueSummary[]>;
  ownerOwnsVenue(ownerId: string, venueId: string): Promise<boolean>;
}

interface OwnerRow {
  venue_owner_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
}

interface VenueRow {
  venue_id: string;
  name: string;
  music_provider: MusicProviderId;
  control_mode: VenueSummary['controlMode'];
  qr_token: string;
  block_explicit: boolean;
  blocked_genres: string[];
  blocked_artists: string[];
}

function mapOwner(row: OwnerRow): VenueOwner {
  return {
    venueOwnerId: row.venue_owner_id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function mapVenueSummary(row: VenueRow): VenueSummary {
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

const PG_UNIQUE_VIOLATION = '23505';

export class PgVenueAuthRepository implements VenueAuthRepository {
  constructor(private readonly pool: QueryablePool = sharedPool) {}

  async createOwner(email: string, passwordHash: string, displayName: string): Promise<VenueOwner> {
    try {
      const { rows } = await this.pool.query<OwnerRow>(
        `insert into venue_owners (email, password_hash, display_name)
         values ($1, $2, $3)
         returning venue_owner_id, email, display_name, password_hash, created_at`,
        [email.toLowerCase(), passwordHash, displayName],
      );
      return mapOwner(rows[0]!);
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new DuplicateEmailError('email already registered');
      }
      throw err;
    }
  }

  async findOwnerByEmail(email: string): Promise<OwnerWithSecret | null> {
    const { rows } = await this.pool.query<OwnerRow>(
      `select venue_owner_id, email, display_name, password_hash, created_at
         from venue_owners where email = $1`,
      [email.toLowerCase()],
    );
    const row = rows[0];
    return row ? { owner: mapOwner(row), passwordHash: row.password_hash } : null;
  }

  async findOwnerById(venueOwnerId: string): Promise<VenueOwner | null> {
    const { rows } = await this.pool.query<OwnerRow>(
      `select venue_owner_id, email, display_name, password_hash, created_at
         from venue_owners where venue_owner_id = $1`,
      [venueOwnerId],
    );
    return rows[0] ? mapOwner(rows[0]) : null;
  }

  async createSession(tokenHash: string, venueOwnerId: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `insert into venue_admin_sessions (token_hash, venue_owner_id, expires_at)
       values ($1, $2, $3)`,
      [tokenHash, venueOwnerId, expiresAt],
    );
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<{ venue_owner_id: string; expires_at: Date }>(
      `select venue_owner_id, expires_at from venue_admin_sessions where token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    return row ? { venueOwnerId: row.venue_owner_id, expiresAt: row.expires_at } : null;
  }

  async touchSession(tokenHash: string, now: Date): Promise<void> {
    await this.pool.query(
      `update venue_admin_sessions set last_used_at = $2 where token_hash = $1`,
      [tokenHash, now],
    );
  }

  async createVenue(
    ownerId: string,
    name: string,
    musicProvider: MusicProviderId,
    qrToken: string,
  ): Promise<VenueSummary> {
    const { rows } = await this.pool.query<VenueRow>(
      `insert into venues (owner_id, name, music_provider, qr_token)
       values ($1, $2, $3, $4)
       returning venue_id, name, music_provider, control_mode, qr_token,
                 block_explicit, blocked_genres, blocked_artists`,
      [ownerId, name, musicProvider, qrToken],
    );
    return mapVenueSummary(rows[0]!);
  }

  async listVenuesByOwner(ownerId: string): Promise<VenueSummary[]> {
    const { rows } = await this.pool.query<VenueRow>(
      `select venue_id, name, music_provider, control_mode, qr_token,
              block_explicit, blocked_genres, blocked_artists
         from venues where owner_id = $1 order by created_at desc`,
      [ownerId],
    );
    return rows.map(mapVenueSummary);
  }

  async ownerOwnsVenue(ownerId: string, venueId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `select exists(select 1 from venues where venue_id = $1 and owner_id = $2) as exists`,
      [venueId, ownerId],
    );
    return rows[0]?.exists ?? false;
  }
}
