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
  MusicProviderId,
  QueueItem,
  Session,
  VenueControlMode,
  VoteDirection,
} from '../types/domain.js';
import type { Track } from './music-provider.js';

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
  | 'venue_blocked_artist'
  | 'venue_blocked_genre'
  | 'explicit_blocked'
  | 'duplicate_locked'
  | 'max_active_requests'
  | 'request_cooldown'
  | 'session_invalid'
  | 'session_expired'
  | 'insufficient_credits'
  | 'boost_limit_reached'
  | 'validation'
  | 'boost_type_unavailable'
  | 'payment_gateway_error'
  | 'not_found'
  | 'unauthorized'
  | 'internal';

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
  /** V0 supports priority_boost only; instant_play_vote (V1), super_boost (V2). */
  boostType: 'priority_boost' | 'instant_play_vote' | 'super_boost';
}
export interface PurchaseBoostResponse {
  queueItem: QueueItem;
  creditBalance: number;
}

/** POST /api/credits/purchase */
export interface PurchaseCreditsRequest {
  bundleId: string;
  paymentMethodToken: string;
}
export interface PurchaseCreditsResponse {
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
}

/** POST /api/venues/:venueId/overrides — venue plays a track immediately/next. */
export interface VenueOverrideRequest {
  providerTrackId: string;
  when: 'now' | 'next';
}

/** POST /api/venues/:venueId/approvals/:queueItemId — suggestion mode. */
export interface ApprovalRequest {
  decision: 'approve' | 'reject';
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
