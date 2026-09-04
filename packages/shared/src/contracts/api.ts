/**
 * REST API contract — request/response shapes for every V0 endpoint.
 *
 * All endpoints are JSON over HTTPS, camelCase fields, prefixed /api.
 * Errors always return: { error: { code: ApiErrorCode, message: string } }.
 *
 * Auth transport (V0):
 *  - Patron calls carry their session in the `X-Session-Id: <sessionId>` header
 *    (issued by POST /api/sessions/join). Public reads (search, queue snapshot,
 *    join, GET venue) need no auth.
 *  - Venue-admin calls carry a venue-owner session token as `Authorization:
 *    Bearer <token>`, obtained from POST /api/venue-owners/signup|login. The token
 *    authorizes every venue the owner controls (the guard checks ownership of the
 *    :venueId in the path) and is also the credential for the console WebSocket
 *    (?role=console&token=) and Spotify linking routes. A legacy shared secret
 *    (VENUE_ADMIN_TOKEN) is still accepted as a fallback during migration.
 *  - Payment endpoints (POST /api/credits/purchase, POST /api/queue-items/:id/boosts)
 *    SHOULD send an `Idempotency-Key: <uuid>` header; the server generates one when
 *    absent, but retries without a stable key are not deduplicated.
 */

import type {
  BoostCodeTier,
  MusicProviderId,
  QueueItem,
  Session,
  VenueControlMode,
  VoteDirection,
} from "../types/domain.js";
import type { Track } from "./music-provider.js";

// ---------------------------------------------------------------------------
// Venue owner accounts (venue operator signup/login + venue creation)
// ---------------------------------------------------------------------------

/** Public view of a venue owner — never includes password hash or tokens. */
export interface VenueOwnerPublic {
  venueOwnerId: string;
  email: string;
  displayName: string;
}

/** POST /api/venue-owners/signup */
export interface VenueOwnerSignupRequest {
  email: string;
  password: string;
  displayName: string;
}

/** POST /api/venue-owners/login */
export interface VenueOwnerLoginRequest {
  email: string;
  password: string;
}

/** Response for signup + login: a bearer session token and the owner. */
export interface VenueOwnerAuthResponse {
  /** Bearer token for `Authorization: Bearer <token>` on venue-admin calls. */
  token: string;
  expiresAt: string;
  owner: VenueOwnerPublic;
}

/** GET /api/venue-owners/me (owner-authenticated) — the owner and their venues. */
export interface VenueOwnerMeResponse {
  owner: VenueOwnerPublic;
  venues: VenueSummary[];
}

/** POST /api/venues (owner-authenticated) — create a venue the caller owns. */
export interface CreateVenueRequest {
  name: string;
  musicProvider: MusicProviderId;
}
export interface CreateVenueResponse {
  venue: VenueSummary;
}

/**
 * Eligibility-layer rejections (binary gate, spec §1 layer 1) plus general errors.
 * `validation` — request body/params failed validation (bad request, not a server bug).
 * `boost_type_unavailable` / `payment_gateway_error` — settlement-layer failures.
 */
export type ApiErrorCode =
  | "venue_blocked_artist"
  | "venue_blocked_genre"
  | "explicit_blocked"
  | "duplicate_locked"
  | "max_active_requests"
  | "request_cooldown"
  | "session_invalid"
  | "session_expired"
  | "insufficient_credits"
  | "boost_limit_reached"
  | "validation"
  | "boost_type_unavailable"
  | "payment_gateway_error"
  // Boost Code redemption (V1, decision D7).
  | "boost_code_invalid"
  | "boost_code_expired"
  | "boost_code_already_redeemed"
  // Crowd-skip vote (V1) — the caller already voted to skip the current song.
  | "already_skip_voted"
  // Location verification (V1, SPEC.md §5/§7) — join rejected by the venue geofence.
  | "outside_geofence"
  | "not_found"
  | "unauthorized"
  | "internal";

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// Patron endpoints
// ---------------------------------------------------------------------------

/** POST /api/sessions/join */
export interface JoinSessionRequest {
  venueQrToken: string;
  /** Omitted for guests; server issues a guest identity. */
  authToken?: string;
  /**
   * Presence coordinates (SPEC.md §5 V1 anti-spam). Sensitive: captured only at
   * join, for the stated purpose of confirming the patron is within the venue
   * geofence; never stored as precise history. Optional — omitted when the patron
   * declines the location prompt.
   */
  latitude?: number;
  longitude?: number;
}
export interface JoinSessionResponse {
  session: Session;
  venue: { venueId: string; name: string; controlMode: VenueControlMode };
}

/** GET /api/venues/:venueId/search?q=... */
export interface SearchResponse {
  tracks: Track[];
}

/** GET /api/venues/:venueId/queue */
export interface QueueSnapshot {
  nowPlaying: QueueItem | null;
  /** Top 3 by rank — the ordered "Up Next" list. */
  upNext: QueueItem[];
  /** Remaining queued items; server pre-shuffles (V1 two-list display). */
  rest: QueueItem[];
}

/** POST /api/venues/:venueId/requests */
export interface CreateRequestRequest {
  providerTrackId: string;
}
export interface CreateRequestResponse {
  queueItem: QueueItem;
}

/** PUT /api/queue-items/:queueItemId/vote — idempotent; re-voting switches direction. */
export interface CastVoteRequest {
  direction: VoteDirection;
}
/** DELETE /api/queue-items/:queueItemId/vote removes the caller's vote. */
export interface CastVoteResponse {
  queueItem: QueueItem;
}

/** POST /api/queue-items/:queueItemId/boosts */
export interface PurchaseBoostRequest {
  /**
   * Paid boost applied to this queue item.
   *  - `priority_boost` — $1, V0 (+1 paid point in the V1 capped model).
   *  - `instant_play_vote` — Instant Play Vote $3, V1 (+4 paid points); ≈10 votes
   *    instantly but capped so the crowd can override (SPEC.md §5 V1, decision D4).
   *  - `super_boost` — $5, V2 (+7 paid points).
   * Point values live in PAID_BOOST_POINTS (@openaux/shared scoring).
   */
  boostType: "priority_boost" | "instant_play_vote" | "super_boost";
}
export interface PurchaseBoostResponse {
  queueItem: QueueItem;
  creditBalance: number;
  /** Paid points this boost contributed (post-cap effect is reflected in queueItem.currentScore). */
  paidPointsAdded: number;
}

/**
 * POST /api/queue-items/:queueItemId/skip-vote — a patron casts a crowd-skip vote
 * against the currently-playing song (SPEC.md §5 V1). Idempotent per session: a
 * second vote from the same patron returns `already_skip_voted`.
 */
export type CrowdSkipVoteRequest = Record<string, never>;
export interface CrowdSkipVoteResponse {
  queueItem: QueueItem;
  /** Running crowd-skip tally after this vote (mirrors queueItem.crowdSkipVotes). */
  crowdSkipVotes: number;
  /** True when this vote pushed the song over the skip threshold and it was skipped. */
  skipped: boolean;
}

/** POST /api/credits/purchase */
export interface PurchaseCreditsRequest {
  bundleId: string;
  paymentMethodToken: string;
}
export interface PurchaseCreditsResponse {
  creditBalance: number;
}

/**
 * POST /api/boost-codes/redeem — a patron redeems a venue-issued Boost Code for
 * credits (SPEC.md §5 V1, decision D7). Writes a `promo_code_redemption` payment
 * event + a credits_ledger entry; emits the `promo_code_redeemed` analytics event.
 * Errors: boost_code_invalid / boost_code_expired / boost_code_already_redeemed.
 */
export interface RedeemBoostCodeRequest {
  code: string;
}
export interface RedeemBoostCodeResponse {
  tier: BoostCodeTier;
  creditsAdded: number;
  creditBalance: number;
}

/** GET /api/queue-items/:queueItemId/position */
export interface QueuePositionResponse {
  position: number;
  estimatedMinutesUntilPlay: number;
  /** Positions gained if a Priority Boost were applied right now (monetization UI). */
  boostPreviewPositions: number;
}

// ---------------------------------------------------------------------------
// Venue admin endpoints (venue-authenticated)
// ---------------------------------------------------------------------------

/** PATCH /api/venues/:venueId/settings */
export interface UpdateVenueSettingsRequest {
  controlMode?: VenueControlMode;
  blockExplicit?: boolean;
  blockedGenres?: string[];
  blockedArtists?: string[];
  scoringModel?: "v0" | "v1";
}

/** POST /api/venues/:venueId/overrides — venue plays a track immediately/next. */
export interface VenueOverrideRequest {
  providerTrackId: string;
  when: "now" | "next";
}

/** POST /api/venues/:venueId/approvals/:queueItemId — suggestion mode. */
export interface ApprovalRequest {
  decision: "approve" | "reject";
}

/** POST /api/venues/:venueId/skip — skip the current song. */
export type SkipRequest = Record<string, never>;

/** PUT /api/venues/:venueId/fallback-playlist */
export interface SetFallbackPlaylistRequest {
  providerTrackIds: string[];
}

/** POST /api/venues/:venueId/anthem */
export interface SetAnthemRequest {
  providerTrackId: string;
  promoText: string;
  promoDurationMinutes: number;
}

/**
 * POST /api/venues/:venueId/power-hour — activate Power Hour Mode (SPEC.md §5 V1):
 * boost a genre by `multiplier` for `durationMinutes`. Re-activating replaces the
 * current window. Emits the `power_hour_activated` analytics + realtime events.
 */
export interface ActivatePowerHourRequest {
  genre: string;
  multiplier: number;
  durationMinutes: number;
}

/**
 * POST /api/venues/:venueId/boost-codes — venue generates a single-use Boost Code
 * for a purchase tier (decision D7). credit_value is fixed by the tier server-side;
 * the code expires 30 min after issue. Emits `boost_code_generated`.
 */
export interface GenerateBoostCodeRequest {
  tier: BoostCodeTier;
}

// ---------------------------------------------------------------------------
// Venue admin response shapes
// ---------------------------------------------------------------------------

/** Current venue settings (subset of the venues row the console reads/edits). */
export interface VenueSettingsSummary {
  venueId: string;
  controlMode: VenueControlMode;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
  scoringModel: "v0" | "v1";
}

/** Resolved anthem + promo config. */
export interface AnthemSummary {
  provider: MusicProviderId;
  providerTrackId: string;
  title: string;
  artist: string;
  promoText: string;
  promoDurationMinutes: number;
}

/** PATCH /api/venues/:venueId/settings response. */
export interface UpdateVenueSettingsResponse {
  venue: VenueSettingsSummary;
}

/** POST /api/venues/:venueId/overrides response (201). */
export interface VenueOverrideResponse {
  queueItem: QueueItem;
}

/** POST /api/venues/:venueId/approvals/:queueItemId response. */
export interface ApprovalResponse {
  queueItem: QueueItem;
}

/** POST /api/venues/:venueId/skip response. */
export interface SkipResponse {
  queueItem: QueueItem;
}

/** PUT /api/venues/:venueId/fallback-playlist response. */
export interface SetFallbackPlaylistResponse {
  providerTrackIds: string[];
}

/** POST /api/venues/:venueId/anthem response (201). */
export interface SetAnthemResponse {
  anthem: AnthemSummary;
}

/** Active Power Hour window (SPEC.md §5 V1). Null on VenueSummary when inactive. */
export interface PowerHourState {
  genre: string;
  multiplier: number;
  /** ISO-8601 instant the window ends. */
  endsAt: string;
}

/** POST /api/venues/:venueId/power-hour response (201). */
export interface ActivatePowerHourResponse {
  powerHour: PowerHourState;
}

/**
 * A Boost Code as surfaced to the venue console (decision D7). The `code` string
 * is shown to the operator to hand to the patron; only ever returned to the venue.
 */
export interface BoostCodePublic {
  boostCodeId: string;
  code: string;
  venueId: string;
  tier: BoostCodeTier;
  creditValue: number;
  issuedAt: string;
  expiresAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
}

/** POST /api/venues/:venueId/boost-codes response (201). */
export interface GenerateBoostCodeResponse {
  boostCode: BoostCodePublic;
}

/** GET /api/venues/:venueId/boost-codes response — codes issued by this venue. */
export interface ListBoostCodesResponse {
  boostCodes: BoostCodePublic[];
}

// ---------------------------------------------------------------------------
// Venue read endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/venues/:venueId — public venue summary for the console's QR/session
 * display and the settings screen's current-state view. Folds in the current
 * block settings so the console can render them before a PATCH .../settings.
 */
export interface VenueSummary {
  venueId: string;
  name: string;
  /** Lets the web console detect Spotify vs Apple without an env var. */
  musicProvider: MusicProviderId;
  controlMode: VenueControlMode;
  qrToken: string;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
  /** Active Power Hour window (SPEC.md §5 V1), or null when none is running. */
  powerHour: PowerHourState | null;
}

/** GET /api/venues/:venueId/fallback-playlist — current silence-fallback playlist. */
export interface GetFallbackPlaylistResponse {
  providerTrackIds: string[];
}

// ---------------------------------------------------------------------------
// Playback (venue-console-authenticated unless noted)
// ---------------------------------------------------------------------------

/**
 * POST /api/venues/:venueId/playback/state — the venue console (Apple Music
 * venues) or the Spotify poller's client reports current playback state.
 * `trackEnded: true` tells the queue engine to advance.
 */
export interface ReportPlaybackStateRequest {
  isPlaying: boolean;
  positionMs: number;
  /** Provider-native id of the track the device is on, null if idle. */
  providerTrackId: string | null;
  trackEnded?: boolean;
  /** commandId echoed from the playback_command this state responds to, if any. */
  commandId?: string;
}
export interface ReportPlaybackStateResponse {
  acknowledged: true;
  /** Set when trackEnded triggered an advance: the item now playing. */
  nowPlaying: QueueItem | null;
}

/** GET /api/venues/:venueId/playback/devices — Spotify Connect devices visible to the venue account. */
export interface PlaybackDevice {
  providerDeviceId: string;
  name: string;
  isActive: boolean;
}
export interface ListPlaybackDevicesResponse {
  devices: PlaybackDevice[];
}

/** PUT /api/venues/:venueId/playback/device — pick the Connect device the DJ brain targets. */
export interface SetPlaybackDeviceRequest {
  providerDeviceId: string;
}
export interface SetPlaybackDeviceResponse {
  playbackDeviceId: string;
}

// ---------------------------------------------------------------------------
// Provider account linking (Spotify OAuth, venue-console-authenticated)
// ---------------------------------------------------------------------------

/**
 * POST /api/venues/:venueId/spotify/connect — begin the authorization-code
 * flow. The console redirects the venue operator to authorizeUrl; Spotify
 * calls back to GET /api/spotify/callback?code=&state= (public endpoint; the
 * signed state parameter carries the venueId and expiry).
 */
export interface SpotifyConnectResponse {
  authorizeUrl: string;
}

/** GET /api/venues/:venueId/spotify/status — is a Spotify account linked and usable? */
export interface SpotifyLinkStatusResponse {
  linked: boolean;
  /** Token scope granted, null when not linked. */
  scope: string | null;
  expiresAt: string | null;
}
