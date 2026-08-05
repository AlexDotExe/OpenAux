/**
 * Postgres-backed, encrypted VenueTokenStore for per-venue Spotify user
 * tokens. Satisfies the VenueTokenStore interface (providers/types.ts) so the
 * SpotifyProvider's refresh-and-retry machinery persists refreshed tokens
 * straight back through it.
 *
 * All token material is AES-256-GCM encrypted at rest via TokenCipher; the
 * `access_token_encrypted` / `refresh_token_encrypted` columns of
 * venue_provider_tokens only ever hold ciphertext. Plaintext exists solely
 * inside this folder.
 *
 * SQL lives here (this workstream owns providers/); the shared pool is passed
 * in rather than imported, so a fake `{ query }` exercises it without a live DB.
 */
import type { MusicProviderId, VenueId } from '@openaux/shared';
import type { TokenCipher } from './crypto.js';
import type { VenueMusicTokens, VenueTokenStore } from './types.js';

/** Minimal surface of pg.Pool used here; lets tests pass a `{ query }` stub. */
export interface QueryablePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface TokenRow {
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: Date | string | null;
  scope: string | null;
}

/** Link status surfaced to the console — never carries token material. */
export interface VenueLinkStatus {
  linked: boolean;
  scope: string | null;
  expiresAt: Date | null;
}

/** Initial credentials captured from the OAuth callback (includes granted scope). */
export interface VenueLinkInput {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms after which the access token must be refreshed. */
  expiresAt: number;
  scope: string;
}

function toEpochMs(value: Date | string | null): number {
  if (value === null) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

export class PgVenueTokenStore implements VenueTokenStore {
  constructor(
    private readonly pool: QueryablePool,
    private readonly cipher: TokenCipher,
    private readonly provider: MusicProviderId = 'spotify',
  ) {}

  /** VenueTokenStore.get — decrypts the stored tokens for provider use. */
  async get(venueId: VenueId): Promise<VenueMusicTokens | null> {
    const { rows } = await this.pool.query(
      `select access_token_encrypted, refresh_token_encrypted, expires_at, scope
         from venue_provider_tokens
        where venue_id = $1 and provider = $2`,
      [venueId, this.provider],
    );
    const row = rows[0] as unknown as TokenRow | undefined;
    if (!row) return null;
    return {
      accessToken: this.cipher.decrypt(row.access_token_encrypted),
      refreshToken: row.refresh_token_encrypted
        ? this.cipher.decrypt(row.refresh_token_encrypted)
        : '',
      expiresAt: toEpochMs(row.expires_at),
    };
  }

  /**
   * VenueTokenStore.set — the refresh path. Encrypts and upserts the rotated
   * access/refresh tokens; leaves `scope` untouched (a refresh does not
   * re-grant scope).
   */
  async set(venueId: VenueId, tokens: VenueMusicTokens): Promise<void> {
    await this.pool.query(
      `insert into venue_provider_tokens
         (venue_id, provider, access_token_encrypted, refresh_token_encrypted, expires_at, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (venue_id, provider) do update set
         access_token_encrypted = excluded.access_token_encrypted,
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         expires_at = excluded.expires_at,
         updated_at = now()`,
      [
        venueId,
        this.provider,
        this.cipher.encrypt(tokens.accessToken),
        tokens.refreshToken ? this.cipher.encrypt(tokens.refreshToken) : null,
        new Date(tokens.expiresAt),
      ],
    );
  }

  /**
   * Initial link from the OAuth callback — writes token material *and* the
   * granted scope. A re-link overwrites everything.
   */
  async link(venueId: VenueId, input: VenueLinkInput): Promise<void> {
    await this.pool.query(
      `insert into venue_provider_tokens
         (venue_id, provider, access_token_encrypted, refresh_token_encrypted, expires_at, scope, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (venue_id, provider) do update set
         access_token_encrypted = excluded.access_token_encrypted,
         refresh_token_encrypted = excluded.refresh_token_encrypted,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = now()`,
      [
        venueId,
        this.provider,
        this.cipher.encrypt(input.accessToken),
        this.cipher.encrypt(input.refreshToken),
        new Date(input.expiresAt),
        input.scope,
      ],
    );
  }

  /** Link status for the console. Reads metadata only — no token material. */
  async getStatus(venueId: VenueId): Promise<VenueLinkStatus> {
    const { rows } = await this.pool.query(
      `select expires_at, scope
         from venue_provider_tokens
        where venue_id = $1 and provider = $2`,
      [venueId, this.provider],
    );
    const row = rows[0] as unknown as Pick<TokenRow, 'expires_at' | 'scope'> | undefined;
    if (!row) {
      return { linked: false, scope: null, expiresAt: null };
    }
    return { linked: true, scope: row.scope ?? null, expiresAt: toDate(row.expires_at) };
  }
}

/**
 * Persists the chosen Spotify Connect device onto venues.playback_device_id.
 * Returns false if the venue row does not exist. SQL kept in-folder; the
 * venues table is otherwise WS4's, but a single-column write behind this
 * repository function keeps the query text here.
 */
export async function setVenuePlaybackDeviceId(
  pool: QueryablePool,
  venueId: VenueId,
  playbackDeviceId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `update venues set playback_device_id = $2 where venue_id = $1 returning venue_id`,
    [venueId, playbackDeviceId],
  );
  return rows.length > 0;
}
