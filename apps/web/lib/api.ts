/**
 * Thin API client wrapping fetch against the V0 REST surface in
 * packages/shared/src/contracts/api.ts (see CONTRACTS.md route map).
 *
 * Every request/response shape is imported from @openaux/shared — nothing is
 * hand-rolled here. `getApiClient()` returns either the real HTTP client or
 * the in-memory mock client (NEXT_PUBLIC_API_MOCK=1), both implementing the
 * same `ApiClient` interface, so every screen works against either.
 *
 * Contract gaps (flagged, not fixed here — packages/shared is frozen for
 * this workstream):
 *  - Several venue-admin endpoints (settings, overrides, approvals, skip,
 *    fallback-playlist, anthem) declare a request type but no response type
 *    in api.ts. We treat them as fire-and-forget acks (`Promise<void>`); the
 *    resulting state is expected to arrive via the `queue_updated` /
 *    `now_playing_changed` / `announcement` realtime events. If the real
 *    backend returns a body, callers here simply ignore it.
 *  - No documented auth transport (header name/scheme) for patron session
 *    calls or venue-admin calls. We assume `X-Session-Id: <sessionId>` and
 *    `X-Venue-Admin-Token: <token>` respectively.
 *  - `GET /api/venues/:venueId` returns the official `VenueSummary` contract
 *    type (name, controlMode, qrToken + current block settings), consumed
 *    directly from @openaux/shared below.
 */

import type {
  ApiErrorCode,
  ApprovalRequest,
  CastVoteRequest,
  CastVoteResponse,
  CreateRequestRequest,
  CreateRequestResponse,
  JoinSessionRequest,
  JoinSessionResponse,
  PurchaseBoostRequest,
  PurchaseBoostResponse,
  PurchaseCreditsRequest,
  PurchaseCreditsResponse,
  QueuePositionResponse,
  QueueSnapshot,
  ReportPlaybackStateRequest,
  ReportPlaybackStateResponse,
  CreateVenueRequest,
  CreateVenueResponse,
  SearchResponse,
  SetAnthemRequest,
  SetFallbackPlaylistRequest,
  UpdateVenueSettingsRequest,
  VenueOverrideRequest,
  VenueOwnerAuthResponse,
  VenueOwnerLoginRequest,
  VenueOwnerMeResponse,
  VenueOwnerSignupRequest,
  VenueSummary,
} from '@openaux/shared';

/** Re-exported so existing importers (e.g. the mock client) keep resolving it from here. */
export type { VenueSummary } from '@openaux/shared';

import { apiBaseUrl, isMockMode } from './config';
import { createMockApiClient } from './mock/mockApiClient';

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
  }
}

/** Auth context threaded through calls that need identity. Either field may
 * be omitted for anonymous/public calls (search, queue snapshot, join). */
export interface AuthContext {
  sessionId?: string;
  venueAdminToken?: string;
}

export interface ApiClient {
  venueOwnerSignup(req: VenueOwnerSignupRequest): Promise<VenueOwnerAuthResponse>;
  venueOwnerLogin(req: VenueOwnerLoginRequest): Promise<VenueOwnerAuthResponse>;
  venueOwnerMe(ownerToken: string): Promise<VenueOwnerMeResponse>;
  createVenue(req: CreateVenueRequest, ownerToken: string): Promise<CreateVenueResponse>;
  joinSession(req: JoinSessionRequest): Promise<JoinSessionResponse>;
  getVenue(venueId: string): Promise<VenueSummary>;
  search(venueId: string, query: string): Promise<SearchResponse>;
  getQueue(venueId: string): Promise<QueueSnapshot>;
  createRequest(
    venueId: string,
    req: CreateRequestRequest,
    auth: AuthContext,
  ): Promise<CreateRequestResponse>;
  castVote(queueItemId: string, req: CastVoteRequest, auth: AuthContext): Promise<CastVoteResponse>;
  removeVote(queueItemId: string, auth: AuthContext): Promise<CastVoteResponse>;
  purchaseBoost(
    queueItemId: string,
    req: PurchaseBoostRequest,
    auth: AuthContext,
  ): Promise<PurchaseBoostResponse>;
  getPosition(queueItemId: string, auth: AuthContext): Promise<QueuePositionResponse>;
  purchaseCredits(req: PurchaseCreditsRequest, auth: AuthContext): Promise<PurchaseCreditsResponse>;
  updateVenueSettings(
    venueId: string,
    req: UpdateVenueSettingsRequest,
    auth: AuthContext,
  ): Promise<void>;
  createOverride(venueId: string, req: VenueOverrideRequest, auth: AuthContext): Promise<void>;
  decideApproval(
    venueId: string,
    queueItemId: string,
    req: ApprovalRequest,
    auth: AuthContext,
  ): Promise<void>;
  skip(venueId: string, auth: AuthContext): Promise<void>;
  setFallbackPlaylist(
    venueId: string,
    req: SetFallbackPlaylistRequest,
    auth: AuthContext,
  ): Promise<void>;
  setAnthem(venueId: string, req: SetAnthemRequest, auth: AuthContext): Promise<void>;
  /**
   * Console reports current playback state / track end (Apple venues via
   * MusicKit; the Spotify poller's client). `auth.venueAdminToken` doubles as
   * the console token (same provisional shared secret).
   */
  reportPlaybackState(
    venueId: string,
    req: ReportPlaybackStateRequest,
    auth: AuthContext,
  ): Promise<ReportPlaybackStateResponse>;
}

function authHeaders(auth: AuthContext): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth.sessionId) headers['X-Session-Id'] = auth.sessionId;
  // Venue-admin calls carry the owner session token as a standard Bearer token
  // (what the server reads). This is the credential returned by venue-owner login.
  if (auth.venueAdminToken) headers['Authorization'] = `Bearer ${auth.venueAdminToken}`;
  return headers;
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: AuthContext } = {},
): Promise<T> {
  const { method = 'GET', body, auth } = opts;
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? authHeaders(auth) : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError('internal', 'Network error — could not reach the server.');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const errBody = json as { error?: { code?: ApiErrorCode; message?: string } } | undefined;
    throw new ApiClientError(
      errBody?.error?.code ?? 'internal',
      errBody?.error?.message ?? `Request failed with status ${res.status}`,
    );
  }

  return json as T;
}

/** Exported for direct unit testing (mocked fetch) — normal callers should use getApiClient(). */
export class HttpApiClient implements ApiClient {
  venueOwnerSignup(req: VenueOwnerSignupRequest): Promise<VenueOwnerAuthResponse> {
    return request('/api/venue-owners/signup', { method: 'POST', body: req });
  }

  venueOwnerLogin(req: VenueOwnerLoginRequest): Promise<VenueOwnerAuthResponse> {
    return request('/api/venue-owners/login', { method: 'POST', body: req });
  }

  venueOwnerMe(ownerToken: string): Promise<VenueOwnerMeResponse> {
    return request('/api/venue-owners/me', { auth: { venueAdminToken: ownerToken } });
  }

  createVenue(req: CreateVenueRequest, ownerToken: string): Promise<CreateVenueResponse> {
    return request('/api/venues', {
      method: 'POST',
      body: req,
      auth: { venueAdminToken: ownerToken },
    });
  }

  joinSession(req: JoinSessionRequest): Promise<JoinSessionResponse> {
    return request('/api/sessions/join', { method: 'POST', body: req });
  }

  getVenue(venueId: string): Promise<VenueSummary> {
    return request(`/api/venues/${venueId}`);
  }

  search(venueId: string, query: string): Promise<SearchResponse> {
    return request(`/api/venues/${venueId}/search?q=${encodeURIComponent(query)}`);
  }

  getQueue(venueId: string): Promise<QueueSnapshot> {
    return request(`/api/venues/${venueId}/queue`);
  }

  createRequest(
    venueId: string,
    req: CreateRequestRequest,
    auth: AuthContext,
  ): Promise<CreateRequestResponse> {
    return request(`/api/venues/${venueId}/requests`, { method: 'POST', body: req, auth });
  }

  castVote(
    queueItemId: string,
    req: CastVoteRequest,
    auth: AuthContext,
  ): Promise<CastVoteResponse> {
    return request(`/api/queue-items/${queueItemId}/vote`, { method: 'PUT', body: req, auth });
  }

  removeVote(queueItemId: string, auth: AuthContext): Promise<CastVoteResponse> {
    return request(`/api/queue-items/${queueItemId}/vote`, { method: 'DELETE', auth });
  }

  purchaseBoost(
    queueItemId: string,
    req: PurchaseBoostRequest,
    auth: AuthContext,
  ): Promise<PurchaseBoostResponse> {
    return request(`/api/queue-items/${queueItemId}/boosts`, { method: 'POST', body: req, auth });
  }

  getPosition(queueItemId: string, auth: AuthContext): Promise<QueuePositionResponse> {
    return request(`/api/queue-items/${queueItemId}/position`, { auth });
  }

  purchaseCredits(
    req: PurchaseCreditsRequest,
    auth: AuthContext,
  ): Promise<PurchaseCreditsResponse> {
    return request('/api/credits/purchase', { method: 'POST', body: req, auth });
  }

  updateVenueSettings(
    venueId: string,
    req: UpdateVenueSettingsRequest,
    auth: AuthContext,
  ): Promise<void> {
    return request(`/api/venues/${venueId}/settings`, { method: 'PATCH', body: req, auth });
  }

  createOverride(venueId: string, req: VenueOverrideRequest, auth: AuthContext): Promise<void> {
    return request(`/api/venues/${venueId}/overrides`, { method: 'POST', body: req, auth });
  }

  decideApproval(
    venueId: string,
    queueItemId: string,
    req: ApprovalRequest,
    auth: AuthContext,
  ): Promise<void> {
    return request(`/api/venues/${venueId}/approvals/${queueItemId}`, {
      method: 'POST',
      body: req,
      auth,
    });
  }

  skip(venueId: string, auth: AuthContext): Promise<void> {
    return request(`/api/venues/${venueId}/skip`, { method: 'POST', body: {}, auth });
  }

  setFallbackPlaylist(
    venueId: string,
    req: SetFallbackPlaylistRequest,
    auth: AuthContext,
  ): Promise<void> {
    return request(`/api/venues/${venueId}/fallback-playlist`, { method: 'PUT', body: req, auth });
  }

  setAnthem(venueId: string, req: SetAnthemRequest, auth: AuthContext): Promise<void> {
    return request(`/api/venues/${venueId}/anthem`, { method: 'POST', body: req, auth });
  }

  reportPlaybackState(
    venueId: string,
    req: ReportPlaybackStateRequest,
    auth: AuthContext,
  ): Promise<ReportPlaybackStateResponse> {
    return request(`/api/venues/${venueId}/playback/state`, { method: 'POST', body: req, auth });
  }
}

let cachedClient: ApiClient | null = null;

/** Returns the mock client when NEXT_PUBLIC_API_MOCK=1, else the real HTTP client. */
export function getApiClient(): ApiClient {
  if (!cachedClient) {
    cachedClient = isMockMode() ? createMockApiClient() : new HttpApiClient();
  }
  return cachedClient;
}

/** Test-only escape hatch to reset the memoized singleton between test cases. */
export function __resetApiClientForTests(): void {
  cachedClient = null;
}
