# OpenAux — Agent Handoff (V1 → continuation)

This file is the pickup point for any coding agent (GitHub Copilot, etc.) continuing OpenAux.
It is self-contained: read this, then `CLAUDE.md` (binding conventions), `SPEC.md` (product +
milestones), and `CONTRACTS.md` (contract map) before writing code.

_Last updated: 2026-09-04. V1 is on `main` except Task B (PR #75, in review). §3 routes remaining work by
agent capability ([COPILOT] = Sonnet-class GitHub Copilot agent; [CLAUDE] = stronger model / human-in-loop);
§5 is the test plan._

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

## 3. DELEGATION PLAN — who does what

Work is routed by agent capability. Tags:

- **[COPILOT]** — safe for a GitHub Copilot coding agent (Sonnet-class model). These tasks are tightly
  specified, mirror an existing pattern in the repo, are unit-testable without live credentials, and touch
  no money-movement, auth-verification, or contract-layer judgment calls.
- **[COPILOT+REVIEW]** — Copilot may draft it, but a strong-model (Claude Opus-class) review is
  **mandatory before merge**. Do not self-merge.
- **[CLAUDE]** — requires a stronger model and/or a human-in-the-loop (live credentials, secrets, money,
  contract-layer design). Do NOT assign these to Copilot agents.

**Standing rules for every Copilot task** (learned from failed attempts — see §3.4 history):
1. Branch from current `main`. Before writing code, verify: `git merge-base HEAD origin/main` equals
   `git rev-parse origin/main`. If not, STOP and re-branch.
2. Gate before marking ready: `npm run typecheck && npx vitest run && npm run lint` all green.
3. **Never invent schema.** If a column/type you need does not literally exist in `db/schema.sql` +
   `packages/shared/src/types/domain.ts`, do not fake it (no `to_jsonb` tricks, no optional-field
   workarounds). Stop and report that a contract change is needed — a [CLAUDE] contract commit will land
   first, then your feature builds on it. (PR #75's first draft failed exactly this way.)
4. Stay inside the ownership folder(s) the issue names (CLAUDE.md ownership map).

### 3.1 V1 remainder
| # | Task | Tag | Status |
|---|------|-----|--------|
| B | Activate V1 scoring model + gate — needs real `venues.scoring_model` column (contract change) + settable via `PATCH .../settings` | [COPILOT+REVIEW] | In flight: PR #75, changes requested (invented column). Issue #69. |
| D | Board/branch hygiene: close superseded `copilot/*` prototype branches and stale prototype issues (#8–#20, #55–#67) | [CLAUDE] (trivial, human confirms) | Issue #71 |

### 3.2 Test-harness tasks — build these NEXT (they unblock all end-to-end testing)
| # | Task | Tag | Scope |
|---|------|-----|-------|
| T1 | **FakeMusicProvider** for credential-less E2E: a deterministic in-repo `MusicProvider` implementation (fixed catalog, instant playback state) in `apps/server/src/providers/fake/`, selectable via env (e.g. `MUSIC_PROVIDER_FAKE=1`) in the provider factory. Never active unless the flag is set. Unit tests. | [COPILOT] | `apps/server/src/providers/` |
| T2 | **DB-backed integration suite**: `docker-compose.test.yml` (Postgres 16 + schema apply) plus an integration test script (`npm run test:integration`, NOT part of the unit gate) that boots the real server and drives the full API flow with real SQL: owner signup → venue create → QR join → request → vote → boost → skip-vote → power hour → boost code generate/redeem → session-end refund. Uses T1's fake provider. | [COPILOT] | new `tests/integration/` + compose file; no src changes |
| T3 | **Realtime two-client smoke test**: script/vitest test opening two WS connections (patron + `?role=console`) against a running server, asserting `queue_updated`, `crowd_skip_vote_update`, `power_hour_activated`, and console-only `PlaybackCommandEvent` routing. | [COPILOT] | `tests/integration/` |
| T4 | **Load sanity script**: simulate ~200 active users on one venue (SPEC §7 NFR) — join, vote, request storms — and report latency/error counts. Plain node script, not CI. | [COPILOT] | `tests/load/` |

### 3.3 V0 last-mile (deployment-critical — mostly NOT Copilot)
| # | Task | Tag | Notes |
|---|------|-----|-------|
| L1a | Google sign-in: implement the `AuthVerifier` seam in `sessions/auth.ts` for Google ID tokens (`google-auth-library`, verify `aud`/`iss`/`exp`), env-configured client ID | [COPILOT+REVIEW] | Well-trodden pattern; security review before merge is mandatory |
| L1b | Apple sign-in + phone OTP | [CLAUDE] | Apple JWKS/JWT nuances + SMS provider secrets |
| L2 | Stripe live intake + Connect payouts (70/30), webhooks, `payments/payouts.ts` stub | [CLAUDE] | Money movement + idempotency design. Never Copilot. |
| L3 | Verify Spotify/Apple playback end-to-end on real accounts | [CLAUDE + human] | This is Test Phase 2, §5 below |

### 3.4 V2 backlog (Copilot-friendly majority — assign AFTER Task B merges; several touch `queue/`/`payments/`)
| # | Task | Tag | Scope |
|---|------|-----|-------|
| V2.1a | Enable **Super Boost $5** purchase: flip `available` in `boost-catalog.ts`, per-song-per-user limit, ledger + `payment_events` + idempotency — mirror the Instant Play Vote enablement commit | [COPILOT] | `apps/server/src/payments/` |
| V2.1b | Super Boost queue semantics (SPEC §5 V2 + D12): "if #1-eligible, picked next" flag in DJ-brain selection, only when the item's positive ratio ≥ 30%; paid actions never override crowd hate. Pure + unit tests. | [COPILOT] | `apps/server/src/queue/` |
| V2.2 | Reputation v2 (+songs played, +time in venue): **contract change first** (new counters) → [CLAUDE] contract commit, then [COPILOT] extends `computeReputationScore` + increments | [CLAUDE→COPILOT] | contract, then `antispam/` |
| V2.3 | Premium user: any completed paid action tonight at this venue (query `payment_events`) ⇒ `maxActiveRequests` 5 instead of 3, in the eligibility layer | [COPILOT] | `apps/server/src/queue/eligibility` + `payments` read seam |
| V2.4 | Crowd Mood dashboard: analytics queries (skip rate, vote velocity, genre engagement) + venue-console panel; read-only, must not block queue ops | [COPILOT] | `apps/server/src/analytics/` + `apps/web/` |
| V2.5 | Web: Super Boost UI ("Super Boost for $5") mirroring Instant Play Vote UI | [COPILOT] | `apps/web/` |

### 3.5 Deferred / V3+
Group-abuse via proximity/social graph/correlated voting; venue-abuse dispute system (flagged, 13pts);
V3–V6 items (Vibe Score, dynamic pricing, label analytics UI, brand promos, leaderboards, Pass the Aux,
city dashboard, AI Auto Queue, ads). Route each through the same tagging when scheduled — anything touching
new contracts, money, or auth defaults to [CLAUDE].

---

## 4. Assignment order (manager's sequencing)

1. **Now, in parallel** (disjoint areas, no conflicts): T1, T2, T3 → Copilot. Task B continues on PR #75.
2. **After Task B merges**: V2.1a + V2.1b + V2.3 + V2.4 + V2.5 (V2.1a/V2.1b are separate branches but
   review together), T4 anytime.
3. **Claude sessions** (batch to save usage credits): Task B review/merge, contract commit for V2.2,
   L1b/L2, Test Phases 1–2 below, board hygiene (D).

---

## 5. TESTING PLAN — how we prove it all works

Layered so the cheap layers run constantly and the expensive (credentialed/manual) layers run once per
milestone. Phases 1–2 are executed in a Claude session with browser control; the harness they rely on
(T1–T4) is Copilot-built.

### Phase 0 — always-on unit gate (exists today)
`npm run typecheck && npx vitest run && npm run lint` — 615+ tests, pure functions, no DB. Every PR.

### Phase 1 — credential-less end-to-end (needs T1 + T2; no Spotify/Apple/Stripe accounts)
1. `docker compose -f docker-compose.test.yml up` → real Postgres with `db/schema.sql` applied.
2. Boot the real server with `MUSIC_PROVIDER_FAKE=1` (T1) and the real web app (`npm run dev`).
3. Run the T2 integration suite (full API flow incl. money paths with seeded credits) and T3 realtime smoke.
4. Browser pass (Claude drives via Chrome): two tabs — venue console + patron. Owner signup → venue create →
   QR render → patron joins via join link → search fake catalog → request → vote both directions → Priority
   Boost + Instant Play Vote (seeded credits) → crowd-skip to threshold → Power Hour activate + banner →
   Boost Code generate (console) and redeem (patron) → verify realtime updates land in both tabs, and
   session-end refund appears in the ledger.
This phase catches ~90% of integration bugs and costs nothing but local compute.

### Phase 2 — real-provider E2E (the human-assisted pass)
Prereqs supplied by the human: Claude-in-Chrome extension installed; **Spotify Premium** account signed in
(Apple Music optional, needs MusicKit keys); `.env` populated (`SPOTIFY_CLIENT_ID/SECRET`,
`TOKEN_ENCRYPTION_KEY`, redirect URI registered in the Spotify dashboard).
Claude then drives, in a real browser session:
1. Venue console → **Connect Spotify** → OAuth consent (human approves the login) → device picker shows a
   real Spotify Connect device → select it.
2. Patron tab → search the **real catalog** → request a real track → vote/boost.
3. Verify the DJ brain actually starts playback on the venue device, `now_playing_changed` broadcasts, DJ
   attribution announcement renders, track-end auto-advances the queue.
4. Crowd-skip a playing song and confirm the device actually skips.
5. Repeat the monetization + Power Hour + Boost Code flow from Phase 1 against the live stack.
6. If Apple Music is configured: same pass with the MusicKit console-as-device path.

### Phase 3 — money + scale (after Phases 1–2 pass)
- **Stripe test mode**: human supplies test-mode keys; verify credit purchase via test cards, webhook
  handling, idempotent retries, refund-to-credit at session end, and (once L2 lands) Connect payout split.
- **Load sanity** (T4): ~200 simulated users on one venue; assert score-recompute latency and zero dropped
  WS events (SPEC §7 NFR).

Record every Phase 1–3 finding as a GitHub issue tagged per §3 so fixes are routable to the right agent.

---

## 6. Rules a continuing agent MUST follow (condensed from CLAUDE.md)

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
