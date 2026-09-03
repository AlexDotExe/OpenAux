# OpenAux Contracts

The **code is the contract** — this file is the map and the changelog. Typed definitions
live in `packages/shared/src/` and the compiler enforces them; prose here never overrides
the types.

## Canonical contract files

| Contract                                       | File                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| Domain entities (mirror of `db/schema.sql`)    | `packages/shared/src/types/domain.ts`               |
| Music provider abstraction (Spotify/Apple)     | `packages/shared/src/contracts/music-provider.ts`   |
| REST API request/response shapes + error codes | `packages/shared/src/contracts/api.ts`              |
| WebSocket events (server → client)             | `packages/shared/src/contracts/realtime-events.ts`  |
| Analytics event types                          | `packages/shared/src/contracts/analytics-events.ts` |
| Scoring engine (formula, weights, tiebreakers) | `packages/shared/src/scoring/index.ts`              |
| Database schema                                | `db/schema.sql`                                     |

## API surface (V0)

Full shapes in `api.ts`; this is the route map:

| Method + Path                                      | Purpose                                            |
| -------------------------------------------------- | -------------------------------------------------- |
| `POST /api/venue-owners/signup`                    | Create a venue owner, returns bearer token         |
| `POST /api/venue-owners/login`                     | Owner login, returns bearer token                  |
| `GET /api/venue-owners/me`                         | Owner: profile + owned venues                      |
| `POST /api/venues`                                 | Owner: create a venue (returns QR token)           |
| `POST /api/sessions/join`                          | QR token → venue session (guest or authed)         |
| `GET /api/venues/:venueId`                         | Public venue summary (name, QR, block settings)    |
| `GET /api/venues/:venueId/search?q=`               | Track search via venue's provider                  |
| `GET /api/venues/:venueId/queue`                   | Queue snapshot (nowPlaying / upNext 3 / rest)      |
| `POST /api/venues/:venueId/requests`               | Request a song (eligibility-gated)                 |
| `PUT /api/queue-items/:id/vote`                    | Cast/switch vote (idempotent)                      |
| `DELETE /api/queue-items/:id/vote`                 | Remove vote                                        |
| `POST /api/queue-items/:id/boosts`                 | Purchase boost (V0: priority_boost)                |
| `GET /api/queue-items/:id/position`                | Position + ETA + boost preview (monetization UI)   |
| `POST /api/credits/purchase`                       | Buy credit bundle                                  |
| `PATCH /api/venues/:venueId/settings`              | Venue: control mode, blocks                        |
| `POST /api/venues/:venueId/overrides`              | Venue: play track now/next                         |
| `POST /api/venues/:venueId/approvals/:queueItemId` | Venue: suggestion-mode decision                    |
| `POST /api/venues/:venueId/skip`                   | Venue: skip current song                           |
| `GET /api/venues/:venueId/fallback-playlist`       | Venue: read current silence-fallback playlist      |
| `PUT /api/venues/:venueId/fallback-playlist`       | Venue: silence-fallback playlist                   |
| `POST /api/venues/:venueId/anthem`                 | Venue: set anthem + promo                          |
| `POST /api/venues/:venueId/playback/state`         | Console: report playback state / track ended       |
| `GET /api/venues/:venueId/playback/devices`        | Console: list Spotify Connect devices              |
| `PUT /api/venues/:venueId/playback/device`         | Console: pick playback device                      |
| `POST /api/venues/:venueId/spotify/connect`        | Console: start Spotify OAuth, returns authorizeUrl |
| `GET /api/spotify/callback`                        | Public: Spotify OAuth redirect target              |
| `GET /api/venues/:venueId/spotify/status`          | Console: Spotify link status                       |

Auth transport (V0): patron calls send `X-Session-Id`; venue-admin calls send
`X-Venue-Admin-Token` (server currently reads `Authorization: Bearer`); payment
endpoints accept an `Idempotency-Key` header. See `api.ts` header comment.

Realtime channel: `WS /ws/venues/:venueId` — events in `realtime-events.ts`.

## Change process

1. Contract changes are their own branch/commit — never bundled into a feature commit.
2. Update every affected side together: TS types, `db/schema.sql`, tests, and this file.
3. Add a changelog line below. The human maintainer merges contract changes before
   dependent feature work starts.

## Changelog

- **2026-07-24** — Initial contracts: V0 domain model, MusicProvider interface, V0 API
  surface, realtime + analytics events, V0 scoring engine with default weights
  (RequestBase 2, Up 1, Down 1.25, UniqueSupporter 0.5, PriorityBoost 3) and tiebreakers.
- **2026-07-24** — Integration wire-up batch (schema ↔ domain ↔ api together):
  - `queue_items.played_at timestamptz` + `QueueItem.playedAt` — actual play time,
    stamped by the queue engine on the `played` terminal transition; drives the
    antispam recently-played lookup and DJ-brain vibe window.
  - `venues` anthem columns (`anthem_provider`, `anthem_provider_track_id`,
    `anthem_title`, `anthem_artist`, `anthem_promo_text`,
    `anthem_promo_duration_minutes`) + `venues.stripe_account_id` (payout stub),
    mirrored on `Venue` along with the previously-missing `fallbackPlaylist`.
  - `ApiErrorCode` gains `validation`, `boost_type_unavailable`, `payment_gateway_error`
    (folds in the local widening from payments/errors.ts).
  - New response types for the six venue-admin endpoints (`UpdateVenueSettingsResponse`,
    `VenueOverrideResponse`, `ApprovalResponse`, `SkipResponse`,
    `SetFallbackPlaylistResponse`, `SetAnthemResponse`), plus `VenueSummary`
    (GET `/api/venues/:venueId`) and `GetFallbackPlaylistResponse`
    (GET `/api/venues/:venueId/fallback-playlist`).
  - Documented auth transport (`X-Session-Id`, `X-Venue-Admin-Token`) and the payment
    `Idempotency-Key` header in `api.ts`.
- **2026-07-27** — Playback wiring surface (schema ↔ domain ↔ api ↔ realtime together):
  - `venue_provider_tokens` table + `VenueProviderToken` — per-venue Spotify user
    tokens, AES-256-GCM encrypted at rest (`TOKEN_ENCRYPTION_KEY` env); plaintext
    confined to `apps/server/src/providers/`.
  - `venues.playback_device_id` + `Venue.playbackDeviceId` — the Spotify Connect
    device the DJ brain targets (null for Apple Music venues; the console is the device).
  - `PlaybackCommandEvent` added to `RealtimeEvent` — sent only to console-role
    WS connections (`?role=console`); carries queue_next/play/pause/skip + track +
    commandId. Apple venues execute via MusicKit JS and report back over REST.
  - Playback endpoints: `POST .../playback/state` (state report + trackEnded → advance),
    `GET .../playback/devices`, `PUT .../playback/device`.
  - Spotify OAuth endpoints: `POST .../spotify/connect` (authorizeUrl with signed
    state), public `GET /api/spotify/callback`, `GET .../spotify/status`.
- **2026-07-27** — Venue-owner accounts (schema ↔ domain ↔ api together):
  - `venue_owners` table + `VenueOwner` domain type — venue operators (email +
    scrypt password), distinct from patron `users`.
  - `venue_admin_sessions` table (server-internal, no shared type) — bearer session
    tokens stored as SHA-256 hashes; the token is the venue-admin credential
    everywhere (console routes, Spotify linking, console WS).
  - `venues.owner_id` + `Venue.ownerId` (nullable — legacy/seeded venues and the
    shared-secret fallback still work).
  - API: `VenueOwnerPublic`, signup/login (`VenueOwnerAuthResponse`), `me`
    (`VenueOwnerMeResponse`), and `POST /api/venues` (`CreateVenueRequest/Response`)
    — the first real venue-creation path. Venue-admin auth transport is now
    `Authorization: Bearer <owner session token>` (VENUE_ADMIN_TOKEN kept as fallback).
  - `VenueSummary` gains `musicProvider` (the web console can now detect the
    provider from the API instead of `NEXT_PUBLIC_VENUE_MUSIC_PROVIDER`).
- **2026-09-03** — V1 scoring model + playability gate (schema ↔ domain ↔ scoring
  ↔ queue core together):
  - `scoring_model` enum (`'v0' | 'v1'`) + `venues.scoring_model not null default 'v0'`,
    mirrored as `ScoringModel` + `Venue.scoringModel` in `domain.ts`.
  - `packages/shared/src/scoring/index.ts` gains the V1+ capped engine (SPEC.md §4):
    `V1ScoringWeights`, `DEFAULT_V1_WEIGHTS` (A=1.0, B=0.6, C=0.4, D=2.0, E=3.0,
    downvoteWeight=0.7, paidPointsCap=10, PriorityBoost=1/InstantPlayVote=4/SuperBoost=7),
    `V1ScoringInputs`, `computeQueueRankScoreV1`. V0 (`computeQueueRankScore`) remains
    the default; this is the only implementation of either formula.
  - `QueueRepository.getActiveUserCount(venueId)` — live active-session count backing
    the min-vote gate (WS1 `sessions.is_active`).
  - New `apps/server/src/queue/playability.ts`: `passesMinVoteGate` — the V1 hard
    guardrail (SPEC.md §4/D3): off below 10 active users; once active, requires
    `up >= 6 AND up/(up+down) >= 0.60`, unless upvotes alone clear 70% of active users
    (crowd-override, always plays).
  - `dj-brain.ts`: `PlayabilityContext.scoringModel` (opt-in gate activation),
    `isPlayable(item, context, gate?)`, `SelectNextInput.gate` — wired through
    `QueueService.advance/playNow/playNext` via a `getGate()` helper that only queries
    `getActiveUserCount` for `scoringModel: 'v1'` venues.
  - `ranking.ts`: `scoreItem`/`rankItems` switch to `computeQueueRankScoreV1` when the
    venue's `scoringModel` is `'v1'` (default `'v0'`, fully backward compatible).
