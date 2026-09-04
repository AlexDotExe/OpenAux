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

export type QueueItemStatus =
  "queued" | "playing" | "played" | "skipped" | "expired" | "blocked";

export type QueueItemSourceType = "organic" | "sponsor" | "venue" | "override";

export type PlayabilityState = "playable" | "held" | "awaiting_approval";

export type VenueControlMode = "crowd" | "suggestion";

export type MusicProviderId = "spotify" | "apple_music";

export interface User {
  userId: UserId;
  displayName: string;
  authProvider: "apple" | "google" | "phone" | "guest";
  creditBalance: number;
  influenceScore: number;
  /**
   * Reputation-based weighting v1 (SPEC.md §5 V1). Rolling reputation derived from
   * the counters below; feeds the anti-spam / skip-risk inputs of the V1 scoring
   * model. Updated by the reputation layer, never inside ranking.
   */
  reputationScore: number;
  upvotesReceived: number;
  downvotesReceived: number;
  spamAttempts: number;
  songsSkipped: number;
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
  scoringWeightsOverride: Partial<
    import("../scoring/index.js").ScoringWeights
  > | null;
  /** Active queue scoring model for this venue; default 'v0', opt-in 'v1'. */
  scoringModel: "v0" | "v1";
  /** V1-only per-venue weight overrides; null = V1 defaults. */
  scoringWeightsOverrideV1: Partial<
    import("../scoring/index.js").ScoringWeightsV1
  > | null;
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
  /**
   * Power Hour Mode (SPEC.md §5 V1) — venue manually boosts a genre for a window
   * (e.g. Hip-Hop ×2 for 15 min, funded by drink totals). All null when inactive;
   * the venue layer clears them when powerHourEndsAt passes.
   */
  powerHourGenre: string | null;
  powerHourMultiplier: number | null;
  powerHourEndsAt: Date | null;
  /**
   * Venue location for join-time presence verification (SPEC.md §5 V1 anti-spam).
   * Sensitive: patron location is captured ONLY at join, for the stated purpose of
   * confirming presence within geofenceRadiusM, and is never stored as precise
   * history. Null until the venue sets its coordinates.
   */
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number | null;
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
  /**
   * Coordinates captured at join for presence verification (SPEC.md §5 V1).
   * Sensitive: requested only at join with a stated purpose, used to confirm the
   * patron is within the venue geofence, never treated as location history.
   * Null when the patron declined or location was not requested.
   */
  joinLatitude: number | null;
  joinLongitude: number | null;
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
  /** Running tally of crowd-skip votes against this item while it is playing (SPEC.md §5 V1). */
  crowdSkipVotes: number;
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

export type VoteDirection = "up" | "down";

export interface Vote {
  queueItemId: QueueItemId;
  userId: UserId;
  direction: VoteDirection;
  createdAt: Date;
}

export type PaymentType =
  | "credit_purchase"
  | "priority_boost"
  | "instant_play_vote"
  | "super_boost"
  | "promo_code_redemption";

export type PaymentStatus = "pending" | "completed" | "failed";
export type RefundStatus = "none" | "pending" | "refunded_to_credit";

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
  reason: PaymentType | "refund" | "admin_adjustment";
  paymentEventId: PaymentEventId | null;
  createdAt: Date;
}

export type BoostCodeId = string;

/**
 * Boost Code tiers (decision D7). Venues generate single-use codes from these
 * app-fixed tiers tied to qualifying purchases; they pick the tier per product
 * but never an arbitrary credit amount. Codes expire 30 min after issue.
 */
export type BoostCodeTier = "beer" | "cocktail" | "bottle";

/** Fixed tier → credit value map (decision D7: Beer +1, Cocktail +2, Bottle +10). */
export const BOOST_CODE_TIER_CREDITS: Readonly<Record<BoostCodeTier, number>> =
  {
    beer: 1,
    cocktail: 2,
    bottle: 10,
  };

/** A single-use, venue-issued promo code redeemable by a patron for credits (D7). */
export interface BoostCode {
  boostCodeId: BoostCodeId;
  /** The human-enterable code string (unique). */
  code: string;
  venueId: VenueId;
  tier: BoostCodeTier;
  /** Credit value granted on redemption; mirrors BOOST_CODE_TIER_CREDITS[tier]. */
  creditValue: number;
  issuedAt: Date;
  /** 30 min after issue (D7). */
  expiresAt: Date;
  /** Redeeming patron; null until redeemed. */
  redeemedBy: UserId | null;
  redeemedAt: Date | null;
}
