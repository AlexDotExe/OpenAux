/**
 * Domain entities. Mirrors db/schema.sql — if you change one, change both
 * and log it in CONTRACTS.md.
 *
 * Conventions: DB columns are snake_case, these TS fields are camelCase.
 * All money values are integer cents. All credit values are integers.
 */

export type UserId = string;
export type VenueId = string;
export type SessionId = string;
export type QueueItemId = string;
export type PaymentEventId = string;

export type QueueItemStatus = 'queued' | 'playing' | 'played' | 'skipped' | 'expired' | 'blocked';

export type QueueItemSourceType = 'organic' | 'sponsor' | 'venue' | 'override';

export type PlayabilityState = 'playable' | 'held' | 'awaiting_approval';

export type VenueControlMode = 'crowd' | 'suggestion';

export type MusicProviderId = 'spotify' | 'apple_music';

export interface User {
  userId: UserId;
  displayName: string;
  authProvider: 'apple' | 'google' | 'phone' | 'guest';
  creditBalance: number;
  influenceScore: number;
  createdAt: Date;
}

export type VenueOwnerId = string;

/**
 * A venue operator. Password auth (scrypt); bearer sessions are server-internal
 * (venue_admin_sessions table — never crosses to the client, so no shared type).
 */
export interface VenueOwner {
  venueOwnerId: VenueOwnerId;
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface Venue {
  venueId: VenueId;
  /** Owning operator; null for legacy/seeded venues (shared-secret fallback). */
  ownerId: VenueOwnerId | null;
  name: string;
  musicProvider: MusicProviderId;
  controlMode: VenueControlMode;
  qrToken: string;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
  /** Overrides for scoring weights; null = global defaults. */
  scoringWeightsOverride: Partial<import('../scoring/index.js').ScoringWeights> | null;
  /** Ordered provider track ids played when the live queue runs dry (silence fallback). */
  fallbackPlaylist: string[];
  /** Venue anthem + promo (SPEC.md §5). All null when no anthem is configured. */
  anthemProvider: MusicProviderId | null;
  anthemProviderTrackId: string | null;
  anthemTitle: string | null;
  anthemArtist: string | null;
  anthemPromoText: string | null;
  anthemPromoDurationMinutes: number | null;
  /** Stripe Connect account for venue revenue-share payouts; null until connected. */
  stripeAccountId: string | null;
  /**
   * Provider playback device the DJ brain targets (Spotify Connect device id;
   * unused for Apple Music, where the venue console IS the device). Null until
   * the venue picks one in the console.
   */
  playbackDeviceId: string | null;
  createdAt: Date;
}

/**
 * Per-venue provider credentials (Spotify user tokens for Connect playback).
 * Token values are encrypted at rest (AES-256-GCM, TOKEN_ENCRYPTION_KEY env);
 * these fields carry ciphertext at the persistence boundary — plaintext never
 * leaves apps/server/src/providers/.
 */
export interface VenueProviderToken {
  venueId: VenueId;
  provider: MusicProviderId;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  scope: string | null;
  updatedAt: Date;
}

export interface Session {
  sessionId: SessionId;
  userId: UserId;
  venueId: VenueId;
  joinedAt: Date;
  lastActiveAt: Date;
  isGuest: boolean;
  isActive: boolean;
  sessionExpiredAt: Date | null;
  activeRequestCount: number;
  cooldownEndsAt: Date | null;
  lastVoteAt: Date | null;
  lastRequestAt: Date | null;
}

export interface QueueItem {
  queueItemId: QueueItemId;
  venueId: VenueId;
  songId: string;
  provider: MusicProviderId;
  requestingUserId: UserId;
  createdAt: Date;
  status: QueueItemStatus;
  upvotesCount: number;
  downvotesCount: number;
  uniqueSupporterCount: number;
  priorityBoostCount: number;
  instantVoteCount: number;
  superBoostCount: number;
  explicitFlag: boolean;
  genre: string | null;
  artist: string;
  title: string;
  isDuplicateLocked: boolean;
  lastScoreCalculatedAt: Date | null;
  currentScore: number;
  playabilityState: PlayabilityState;
  playabilityReason: string | null;
  sourceType: QueueItemSourceType;
  /** Actual play time; set when the item reaches terminal 'played'. Null otherwise. */
  playedAt: Date | null;
}

export type VoteDirection = 'up' | 'down';

export interface Vote {
  queueItemId: QueueItemId;
  userId: UserId;
  direction: VoteDirection;
  createdAt: Date;
}

export type PaymentType =
  | 'credit_purchase'
  | 'priority_boost'
  | 'instant_play_vote'
  | 'super_boost'
  | 'promo_code_redemption';

export type PaymentStatus = 'pending' | 'completed' | 'failed';
export type RefundStatus = 'none' | 'pending' | 'refunded_to_credit';

export interface PaymentEvent {
  paymentEventId: PaymentEventId;
  userId: UserId;
  venueId: VenueId;
  queueItemId: QueueItemId | null;
  paymentType: PaymentType;
  creditAmount: number;
  cashAmountCents: number;
  createdAt: Date;
  status: PaymentStatus;
  refundStatus: RefundStatus;
}

export interface CreditsLedgerEntry {
  entryId: string;
  userId: UserId;
  /** Positive = credit added, negative = credit spent. */
  delta: number;
  reason: PaymentType | 'refund' | 'admin_adjustment';
  paymentEventId: PaymentEventId | null;
  createdAt: Date;
}
