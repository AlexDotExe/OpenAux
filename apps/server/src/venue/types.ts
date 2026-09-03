/**
 * WS4 (venue controls) — injectable seams into the pieces this workstream
 * does not own. See CLAUDE.md ownership map: apps/server/src/queue/ is WS3,
 * apps/server/src/realtime/ is WS1, apps/server/src/providers/ is WS2. This
 * module never imports from those folders; it depends only on the shapes
 * below, which the maintainer wires with real implementations at merge time
 * (apps/server/src/index.ts is off-limits to this workstream).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  BoostCode,
  BoostCodeTier,
  MusicProvider,
  MusicProviderId,
  PlayabilityState,
  QueueItem,
  QueueItemId,
  QueueItemSourceType,
  QueueItemStatus,
  RealtimeEvent,
  Track,
  UserId,
  VenueControlMode,
  VenueId,
  VenueSummary,
} from '@openaux/shared';

/**
 * Narrow seam into WS3's queue engine (spec §1 layers 2-4: ranking,
 * playability, overrides). WS4 owns writing the queue_items row for
 * venue-initiated actions and flipping simple status/playability_state
 * columns directly (those are atomic writes on a shared table, not ranking
 * logic) — but WS4 does NOT own telling the venue's physical playback
 * device what actually plays next. That's the queue engine's job, and this
 * interface is the seam between the two.
 */
export interface QueueControl {
  /**
   * Called after WS4 has already inserted a venue override queue_items row
   * (source_type 'override'). Tells the engine to route actual playback so
   * the override plays now or next, superseding normal ranking.
   */
  insertOverride(input: {
    venueId: VenueId;
    queueItemId: QueueItemId;
    when: 'now' | 'next';
  }): Promise<void>;

  /**
   * Called after WS4 has already marked the venue's current queue_items row
   * status = 'skipped'. Tells the engine to advance actual playback (via
   * MusicProvider) to the next eligible item.
   */
  skipCurrent(venueId: VenueId): Promise<void>;
}

/** Matches the realtime channel's server-push helper (WS1, apps/server/src/realtime/). */
export interface Broadcaster {
  broadcastToVenue(venueId: VenueId, event: RealtimeEvent): void;
}

/** Resolves the MusicProvider for a venue's configured provider id (WS2-owned concrete impls). */
export type MusicProviderResolver = (providerId: MusicProviderId) => MusicProvider;

/** Minimal analytics write seam — never blocks the calling operation (spec §1 layer 6). */
export interface AnalyticsSink {
  record(event: {
    eventType: string;
    venueId: VenueId;
    actorUserId?: UserId | null;
    queueItemId?: QueueItemId | null;
    metadata?: Record<string, unknown>;
  }): void;
}

export interface VenueSettingsRecord {
  venueId: VenueId;
  controlMode: VenueControlMode;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
}

export interface AnthemConfig {
  provider: MusicProviderId;
  providerTrackId: string;
  title: string;
  artist: string;
  promoText: string;
  promoDurationMinutes: number;
}

/** Persisted Power Hour window (SPEC.md §5 V1) — the raw venues.power_hour_* columns. */
export interface PowerHourRecord {
  genre: string;
  multiplier: number;
  endsAt: Date;
}

/** Fields to persist for a freshly minted Boost Code (decision D7); code+creditValue server-set. */
export interface NewBoostCode {
  code: string;
  venueId: VenueId;
  tier: BoostCodeTier;
  creditValue: number;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * Thrown by BoostCodeRepository.insert when the generated `code` collides with
 * an existing row (unique violation). The generation route regenerates and
 * retries a bounded number of times.
 */
export class BoostCodeConflictError extends Error {
  constructor() {
    super('boost code collision');
    this.name = 'BoostCodeConflictError';
  }
}

/**
 * Boost Code persistence seam (decision D7). WS4 owns generation + listing
 * only; WS5 payments owns redemption (the redeemed_by/redeemed_at UPDATE), so
 * this interface deliberately exposes no redeem method.
 */
export interface BoostCodeRepository {
  /** Insert a new single-use code. Throws BoostCodeConflictError on a `code` unique violation. */
  insert(input: NewBoostCode): Promise<BoostCode>;
  /** All codes issued by a venue, newest first. */
  listByVenue(venueId: VenueId): Promise<BoostCode[]>;
}

/** Repository seam over the shared Postgres pool (apps/server/src/db.ts) — swappable for tests. */
export interface VenueRepository {
  getSettings(venueId: VenueId): Promise<VenueSettingsRecord | null>;
  updateSettings(
    venueId: VenueId,
    patch: Partial<Omit<VenueSettingsRecord, 'venueId'>>,
  ): Promise<VenueSettingsRecord | null>;

  /** Public venue summary for GET /api/venues/:venueId (name, qr token, block settings). */
  getVenueSummary(venueId: VenueId): Promise<VenueSummary | null>;
  /** Current silence-fallback playlist for GET /api/venues/:venueId/fallback-playlist. */
  getFallbackPlaylist(venueId: VenueId): Promise<string[]>;

  getMusicProviderId(venueId: VenueId): Promise<MusicProviderId | null>;

  /**
   * Venue-initiated queue items (overrides) need a requesting_user_id
   * (NOT NULL in db/schema.sql) but there's no patron behind them. This
   * finds-or-creates a stable per-venue "system" user row (auth_provider
   * 'guest', display name "Venue") rather than requiring a schema change.
   */
  getOrCreateVenueActorUserId(venueId: VenueId): Promise<UserId>;

  insertQueueItem(input: {
    venueId: VenueId;
    track: Track;
    requestingUserId: UserId;
    sourceType: QueueItemSourceType;
    playabilityState: PlayabilityState;
  }): Promise<QueueItem>;

  getQueueItem(queueItemId: QueueItemId): Promise<QueueItem | null>;
  setPlayabilityState(queueItemId: QueueItemId, state: PlayabilityState): Promise<QueueItem | null>;
  setStatus(queueItemId: QueueItemId, status: QueueItemStatus): Promise<QueueItem | null>;
  getCurrentlyPlaying(venueId: VenueId): Promise<QueueItem | null>;

  setFallbackPlaylist(venueId: VenueId, providerTrackIds: string[]): Promise<void>;

  setAnthem(venueId: VenueId, anthem: AnthemConfig): Promise<void>;
  getAnthem(venueId: VenueId): Promise<AnthemConfig | null>;

  /** Activate/replace the Power Hour window (SPEC.md §5 V1); writes venues.power_hour_*. */
  setPowerHour(venueId: VenueId, record: PowerHourRecord): Promise<void>;
  /** Raw stored window, or null when no columns are set. Used for read-time expiry checks. */
  getPowerHour(venueId: VenueId): Promise<PowerHourRecord | null>;
  /** Null out venues.power_hour_* once a window has elapsed (lazy expiry on read). */
  clearPowerHour(venueId: VenueId): Promise<void>;

  getUserDisplayName(userId: UserId): Promise<string | null>;
}

/** Shared plumbing every route handler module needs. */
export interface VenueRouteContext {
  repository: VenueRepository;
  boostCodeRepository: BoostCodeRepository;
  analytics: AnalyticsSink;
  queueControl: QueueControl;
  broadcaster: Broadcaster;
  resolveMusicProvider?: MusicProviderResolver;
  adminGuard: (
    request: FastifyRequest<{ Params: { venueId: string } }>,
    reply: FastifyReply,
  ) => Promise<void>;
}
