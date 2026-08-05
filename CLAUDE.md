# OpenAux — Agent Conventions

Read `SPEC.md` for the product spec and milestone checklists. Read `CONTRACTS.md` before
touching anything shared. This file is binding for every agent working in this repo.

## Stack (pinned — do not substitute or add frameworks)

- Node 22+, TypeScript 5 strict, npm workspaces monorepo
- Backend: **Fastify 5** + **ws** in `apps/server`; **PostgreSQL** (canonical schema: `db/schema.sql`)
- Frontend: **Next.js 15** (App Router) + **React 19** in `apps/web`
- Shared contracts + scoring: `packages/shared` (imported as `@openaux/shared`)
- Tests: **Vitest**. Lint/format: ESLint 9 (flat config) + Prettier — configs at repo root
- Payments: Stripe (+ Stripe Connect for venue payouts). Music: Spotify Web API / MusicKit,
  only behind the `MusicProvider` interface

## Layout & ownership map

Work ONLY inside the paths your task assigns. If you need a change outside your area,
write a TODO in your PR description instead of editing it.

| Path                          | Owner (workstream)                                                               |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `packages/shared/`            | Contract layer — frozen; see change process below                                |
| `db/schema.sql`               | Contract layer — frozen; same process                                            |
| `apps/server/src/venue-auth/` | Venue-owner accounts, admin sessions, venue creation, admin verifier             |
| `apps/server/src/sessions/`   | WS1 — auth, guest identity, QR join, session lifecycle                           |
| `apps/server/src/realtime/`   | WS1 — WebSocket channel per venue, broadcast helpers                             |
| `apps/server/src/queue/`      | WS3 — requests, votes, eligibility, ranking loop, DJ brain                       |
| `apps/server/src/providers/`  | WS2 — Spotify / Apple Music adapters                                             |
| `apps/server/src/venue/`      | WS4 — control modes, blocks, overrides, anthem, announcements                    |
| `apps/server/src/payments/`   | WS5 — credits ledger, boosts, refunds, payouts                                   |
| `apps/server/src/antispam/`   | WS6 — cooldowns, session expiry, friction inputs                                 |
| `apps/server/src/analytics/`  | WS6 — async event pipeline                                                       |
| `apps/server/src/db.ts`       | Shared pg pool — import it, don't create your own                                |
| `apps/web/`                   | Web workstream — patron UI under `app/patron/`, venue console under `app/venue/` |

Server route modules: export a Fastify plugin (`export function registerQueueRoutes(app)`)
from your folder's `index.ts`. Do NOT edit `apps/server/src/index.ts` — the maintainer
wires plugins up at merge time. Unit tests must not require a live database: keep logic
in pure functions or behind repository interfaces you can stub.

## Hard rules

1. **Contract changes**: `packages/shared/` and `db/schema.sql` change only as a deliberate,
   separate commit that updates BOTH sides (TS types ↔ SQL) plus the changelog in
   `CONTRACTS.md`. Never drive-by edit them while building a feature.
2. **Scoring has one implementation**: `packages/shared/src/scoring/`. Import it; never
   re-derive the formula or hardcode weights anywhere else.
3. **Six decoupled layers** (SPEC.md §1): eligibility, ranking, playability, overrides,
   settlement, analytics. Don't mix them — e.g. no payment logic inside ranking, no
   analytics writes that can block queue operations.
4. **Provider isolation**: only `apps/server/src/providers/` may import Spotify/Apple SDKs.
   Everything else depends on the `MusicProvider` interface from `@openaux/shared`.
5. **Naming**: DB columns snake_case; TS camelCase; types PascalCase. Canonical vocabulary —
   "Instant Play Vote" (never "Instant Vote"), "Priority Boost", "Super Boost",
   "Pass the Aux", `queue_rank_score`. Match SPEC.md terms exactly.
6. **Money**: integer cents only. Credits: integers only. Every paid action writes a
   `payment_events` row and a `credits_ledger` entry; all payment endpoints idempotent
   (use `idempotency_key`).
7. **Analytics**: every event type in `ANALYTICS_EVENT_TYPES` must be emitted where it
   occurs. New feature → add its events to the contract first.
8. **Before finishing any task**: `npm run typecheck && npm test && npm run lint` must pass.
   Add tests for new logic; scoring/eligibility/settlement logic must be pure functions
   with unit tests.
9. **Git**: never commit to `main` directly; branch per task (`ws3/eligibility-layer` style).
   Small, reviewable commits.
10. **Secrets**: env vars only (`.env`, gitignored). Never commit keys. Document new vars
    in `.env.example`.
