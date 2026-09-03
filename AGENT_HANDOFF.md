# OpenAux — Agent Handoff (V1 → continuation)

This file is the pickup point for any coding agent (GitHub Copilot, etc.) continuing OpenAux.
It is self-contained: read this, then `CLAUDE.md` (binding conventions), `SPEC.md` (product +
milestones), and `CONTRACTS.md` (contract map) before writing code.

_Last updated: 2026-09-03. Author of this state: prior agent run (V0 → V1)._

---

## 1. Current state

- **Active branch: `v1/foundation`** (tip is a chain of merge commits; `main` is behind and does NOT
  have V1). Base your work on `v1/foundation` unless told otherwise.
- **Repo is fully green on `v1/foundation`:** `npm run typecheck` ✅, `npx vitest run` ✅ (**611 tests**),
  `npm run lint` ✅. Run all three before and after any change — this is the enforced gate (CLAUDE.md rule #8).
  Note: bare `prettier --check` flags many pre-existing files; it is **not** the enforced gate, eslint is.
- V0 (crowd jukebox + basic monetization) and V1 (fairness, drink-driven boosts) feature logic are
  implemented. What remains is a small amount of **wiring/activation glue** (Section 3) and then **V2+**
  (Section 4).

### How the code is organized (see CLAUDE.md "Layout & ownership map")
- Backend: Fastify 5 in `apps/server/src/<workstream>/`. Each workstream folder exports a Fastify plugin
  from its `index.ts` (e.g. `registerQueueRoutes`). **Do not edit `apps/server/src/index.ts`** casually —
  it is the composition root wired by the maintainer; new routes should live inside an existing plugin.
- Frontend: Next.js 15 in `apps/web/` (patron UI under `app/patron/`, venue console under `app/venue/`).
- Shared contracts + the single scoring engine: `packages/shared/` (imported as `@openaux/shared`).
- DB schema (canonical): `db/schema.sql`.
- **Contract layer is frozen-by-process:** `packages/shared/` and `db/schema.sql` change ONLY as a
  deliberate, separate commit that updates BOTH the TS types and the SQL, plus the `CONTRACTS.md`
  changelog. Never drive-by edit them inside a feature commit (CLAUDE.md rule #1).

---

## 2. What V1 delivered (already done — do not redo)

- **Scoring V1 (capped model):** `packages/shared/src/scoring/index.ts` exports `computeQueueRankScoreV1`,
  `DEFAULT_V1_WEIGHTS` `{a:1,b:0.6,c:0.4,d:2,e:3}`, `PAID_BOOST_POINTS` `{priority_boost:1,
  instant_play_vote:4, super_boost:7}`, `DOWNVOTE_NET_WEIGHT=0.7`. V0 engine still present and is the default.
- **Queue** (`apps/server/src/queue/`): V1 scoring path (opt-in via `venue.scoringModel==='v1'`),
  playability gate (`playability.ts`: ≥10 actives ⇒ up≥6 AND up/(up+down)≥0.60; 70%-of-actives override),
  distinct-supporter 1.5× (`effectiveUpvotes`), crowd-voted skip (`crowd-skip.ts`, endpoint
  `POST /api/queue-items/:id/skip-vote`, persists `crowd_skip_votes`).
- **Venue** (`apps/server/src/venue/`): Power Hour (`POST /api/venues/:venueId/power-hour`,
  `power-hour-logic.ts`, expiry computed on read — no background timer), Boost Code generation
  (`POST`/`GET /api/venues/:venueId/boost-codes`, `boost-code-logic.ts`, `boost-code-repository.ts`).
- **Payments** (`apps/server/src/payments/`): Instant Play Vote $3 enabled (via `available` flag in
  `boost-catalog.ts`), Boost Code redemption (`POST /api/boost-codes/redeem`), auto-refund extended to
  instant/super boosts (`REFUNDABLE_BOOST_TYPES`).
- **Anti-spam** (`apps/server/src/antispam/`): `reputation.ts` (`computeReputationScore`,
  `updateReputation`, `createPgReputationRepository`), `location.ts` (`isWithinRadius`, haversine),
  `group-abuse.ts` (arrival-time clustering signal).
- **Web** (`apps/web/`): two-list queue (Up Next 3 + shuffled rest), Instant Play Vote UI, crowd-skip
  button, Power Hour + Boost Code console, `RedeemBoostCodePanel`. Client methods in `lib/api.ts` and the
  mock in `lib/mock/mockApiClient.ts`; new realtime events handled in `lib/realtimeReducer.ts`.
- Contract additions live in `packages/shared/src/{types/domain.ts,contracts/*.ts}` and `db/schema.sql`
  (reputation cols, power-hour cols, `boost_codes` table, location cols, `crowd_skip_votes`, new realtime
  events + analytics types). See the `CONTRACTS.md` changelog entry dated 2026-09-03.

---

## 3. NEXT TASKS — start here (small, high-value glue)

Each is independently shippable. Follow the gate (Section 1) and CLAUDE.md conventions. Branch per task
(e.g. `ws1/location-at-join`).

### Task A — Wire location verification into session join  (owner area: `apps/server/src/sessions/`)
Anti-spam shipped the pure check but could not edit `sessions/`. Do this:
1. In the QR-join handler (`apps/server/src/sessions/service.ts` / `routes.ts`), read
   `JoinSessionRequest.latitude`/`longitude` (already optional on the contract) and load the venue's
   `latitude/longitude/geofenceRadiusM` (already on `Venue`).
2. Call `isWithinRadius(venue, { latitude, longitude })` from `apps/server/src/antispam/location.ts`.
3. If it returns `false`, reject the join before persisting (e.g. 403). If `true`, persist and store the
   coords into `session.joinLatitude/joinLongitude` (columns already exist; the row-mapper already reads
   them — make the INSERT write them).
4. Semantics: venue with null geofence ⇒ allow. **Sensitive data (CLAUDE.md / SPEC §7):** capture location
   only at join, state the purpose in the UI, never store precise history.
5. Add unit tests (stub repo, no live DB).
_Product note: this is the one genuinely privacy-sensitive feature — confirm it's wanted before enabling by
default; it can also be left behind a per-venue flag._

### Task B — Activate the V1 scoring model + playability gate  (owner area: `apps/server/src/queue/` + `index.ts` wiring)
V1 scoring and the playability gate are implemented but **opt-in** and not yet fed live data.
1. Ensure `getVenueConfig` can surface `scoringModel` (default `'v0'`) so a venue can select `'v1'`.
2. Pass the active-user-count `gate` into the DJ-brain selection (`SelectNextInput.gate`) so the min-vote
   threshold / 70% override actually apply at run time. `getActiveUserCount(venueId)` already exists on the
   queue repository.
3. Add an integration test proving a venue on `scoringModel:'v1'` ranks via `computeQueueRankScoreV1` and
   that the gate holds/falls-back correctly.

### Task C — Confirm route registration at deploy  (owner area: `apps/server/src/index.ts`, maintainer)
All new endpoints live inside already-registered plugins (`registerQueueRoutes`, `registerVenueRoutes`,
`registerPaymentRoutes`), so no new registration was required. `registerVenueRoutes` gained an optional
`boostCodeRepository?` that defaults to Postgres. Verify these are reachable in a running server (see the
`/run` or manual `npm run dev` path) and that the DB has the V1 columns from `db/schema.sql` applied.

### Task D — Open a PR / merge `v1/foundation`
`v1/foundation` is self-contained and green but not yet on `main`. Open a PR (or merge) once Tasks A–C are
in. Triage the stale `origin/copilot/*` branches from the earlier prototype — most are superseded.

---

## 4. V2+ backlog (from SPEC.md §5, in priority order)

Not started. Build in the same contract-first way: if a feature needs new shared types / DB columns, land
that as its own contract commit first, then the feature.

- **V2:** Reputation v2 (+songs played, +time in venue); Premium user (any paid action that night ⇒ max 5
  active requests); **Super Boost $5** (front of queue if ≥30% positive ratio — flag already exists in the
  boost catalog, just gated off); Crowd Mood dashboard.
- **Deferred from V1 (explicitly not built):** group-abuse via WiFi/BT proximity, social graph, and
  correlated-voting (only arrival-time is done); venue-abuse dispute system (13pts, keep behind a flag).
- **V3–V6:** Vibe Score reactions, "Beat the Song Above You" dynamic pricing, analytics UI for
  labels/DJs, brand promotions, leaderboards, Pass the Aux, live city dashboard, AI Auto Queue, ads.

Also still open from the V0 "last mile" (pre-V1): real user sign-in (Apple/Google/phone — `sessions/auth.ts`
is a stub that throws), live Stripe intake + Connect payouts (`payments/payouts.ts` is a TODO stub), and
finishing the Spotify/Apple playback flow. These are higher-value for a real deployment than V2 features.

---

## 5. Rules a continuing agent MUST follow (condensed from CLAUDE.md)

1. Contract changes (`packages/shared/`, `db/schema.sql`) = separate commit, both sides + `CONTRACTS.md`.
2. Scoring has ONE implementation (`packages/shared/src/scoring/`) — import it, never re-derive weights.
3. Keep the six layers decoupled (eligibility, ranking, playability, overrides, settlement, analytics).
4. Only `apps/server/src/providers/` may import Spotify/Apple SDKs; everything else uses the
   `MusicProvider` interface.
5. Naming: DB snake_case, TS camelCase, types PascalCase. Use exact SPEC vocabulary ("Instant Play Vote",
   "Priority Boost", "Super Boost", "Power Hour", `queue_rank_score`).
6. Money = integer cents; credits = integers; every paid action writes `payment_events` + `credits_ledger`;
   payment endpoints idempotent via `idempotency_key`.
7. Every analytics event in `ANALYTICS_EVENT_TYPES` must be emitted where it occurs; analytics writes never
   block queue ops.
8. Gate before finishing: `npm run typecheck && npx vitest run && npm run lint`. Add tests; scoring /
   eligibility / settlement logic must be pure functions with unit tests (no live DB in unit tests).
9. Never commit to `main` directly; branch per task. Secrets via env only; document new vars in `.env.example`.
